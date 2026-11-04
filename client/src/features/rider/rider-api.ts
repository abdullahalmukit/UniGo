import { api } from "../../lib/api";
import type { SignedLink } from "../account/account-api";

// Drive with UniGo (server/src/modules/riders, B1).

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type VehicleType = "BIKE" | "CAR";
export type DocumentType = "NID_FRONT" | "NID_BACK" | "CAR_LICENCE" | "MOTORCYCLE_LICENCE";
export type ActiveBlocker = "NOT_A_RIDER" | "NOT_VERIFIED" | "ACCOUNT_RESTRICTED" | "RIDER_SUSPENDED" | "LICENCE_EXPIRED";

export type RiderApplication = {
  id: string;
  kind: "INITIAL" | "REVERIFICATION";
  status: ApprovalStatus;
  licenceExpiresOn: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  documents: DocumentType[];
  vehicleCount: number;
};

export type RiderVehicle = {
  id: string;
  type: VehicleType;
  brand: string;
  model: string;
  colour: string;
  registrationNumber: string;
  seatCapacity: number;
  status: ApprovalStatus;
  rejectionReason: string | null;
  photo: SignedLink;
};

export type RiderLimits = {
  maxVehiclesPerApplication: number;
  maxActiveVehicles: number;
  licenceMaxYearsAhead: number;
  seats: { bike: { min: number; max: number }; car: { min: number; max: number } };
};

// GET /api/rider
export type RiderOverview = {
  studentVerified: boolean;
  accountStatus: string;
  isVerifiedRider: boolean;
  riderActive: boolean;
  riderSuspended: boolean;
  riderSuspendedUntil: string | null;
  licenceExpiresOn: string | null;
  licenceExpired: boolean;
  activeBlocker: ActiveBlocker | null;
  latestApplication: RiderApplication | null;
  history: RiderApplication[];
  vehicles: RiderVehicle[];
  limits: RiderLimits;
};

export type RiderDashboard = {
  totalRides: number;
  accepted: number;
  completed: number;
  cancelled: number;
  completionRate: number | null;
  lateCancellationRate: number | null;
  rating: number | null;
  activeCarpoolContracts: number;
  carpoolSessionCancellations: number;
  earnings: number;
};

export type VehicleDraft = {
  type: VehicleType;
  brand: string;
  model: string;
  colour: string;
  registrationNumber: string;
  seatCapacity: number;
  photo: Blob | null;
};

export type ApplicationDraft = {
  licenceExpiresOn: string;
  nidFront: File | null;
  nidBack: File | null;
  carLicence: File | null;
  motorcycleLicence: File | null;
  vehicles: VehicleDraft[];
};

export const getRiderOverview = () => api<RiderOverview>("/rider");
export const getRiderDashboard = () => api<RiderDashboard>("/rider/dashboard");
export const setRiderActive = (active: boolean) => api<RiderOverview>("/rider/active", { method: "PATCH", body: { active } });

// One multipart request: the form as JSON in "data", then each file. Vehicle
// photos go in the same order as the vehicles.
export function submitApplication(draft: ApplicationDraft) {
  const body = new FormData();
  body.append(
    "data",
    JSON.stringify({
      licenceExpiresOn: draft.licenceExpiresOn,
      vehicles: draft.vehicles.map(({ photo: _photo, ...vehicle }) => ({ ...vehicle, registrationNumber: vehicle.registrationNumber.trim() })),
    }),
  );
  for (const name of ["nidFront", "nidBack", "carLicence", "motorcycleLicence"] as const) {
    const file = draft[name];
    if (file) body.append(name, file, file.name);
  }
  draft.vehicles.forEach((vehicle, index) => {
    if (vehicle.photo) body.append("vehiclePhotos", vehicle.photo, `vehicle-${index + 1}.jpg`);
  });
  return api<RiderOverview>("/rider/applications", { method: "POST", body });
}
