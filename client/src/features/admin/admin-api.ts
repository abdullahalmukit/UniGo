import { api, apiBaseUrl } from "../../lib/api";

// The admin panel API (server/src/modules/admin, A6 and A8).

export type AccountStatus = "ACTIVE" | "RESTRICTED" | "SUSPENDED" | "BANNED";
export type VerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
export type Role = "USER" | "MODERATOR" | "SUPER_ADMIN";
export type AccountAction = "warn" | "restrict" | "suspend" | "ban" | "unban" | "reactivate";
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
type Person = { id: string; name: string | null };
type University = { id: string; name: string; shortName: string | null };

export type Dashboard = {
  totalUsers: number;
  activeUsers: number;
  verifiedStudents: number;
  verifiedRiders: number;
  pendingStudentVerifications: number;
  pendingRiderApplications: number;
  openDisputes: number;
  openReports: number;
  openNoShowReports: number;
  newRequestsToday: { ride: number; carpool: number; food: number; service: number };
};

export type IdCardReview = {
  id: string;
  status: "PENDING" | "VERIFIED" | "REJECTED";
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewedBy: Person | null;
  user: Person & {
    email: string;
    phone: string;
    studentIdNumber: string | null;
    department: string | null;
    batch: string | null;
    university: University;
  };
};

export type UserRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string;
  role: Role;
  accountStatus: AccountStatus;
  studentVerificationStatus: VerificationStatus;
  studentIdNumber: string | null;
  university: University;
  createdAt: string;
};

export type ModerationEntry = {
  id: string;
  type: "WARN" | "RESTRICT" | "SUSPEND" | "BAN" | "UNBAN" | "REACTIVATE" | string;
  reason: string;
  startsAt: string | null;
  endsAt: string | null;
  previousStatus: AccountStatus | null;
  newStatus: AccountStatus | null;
  createdAt: string;
  admin: Person;
};

export type UserDetail = {
  id: string;
  riderActive: boolean;
  riderSuspended?: boolean;
  riderSuspendedUntil?: string | null;
  email: string;
  phone: string;
  role: Role;
  accountStatus: AccountStatus;
  suspendedFrom: string | null;
  suspendedUntil: string | null;
  restrictedUntil: string | null;
  studentVerificationStatus: VerificationStatus;
  verifiedUniversityEmail: string | null;
  isVerifiedRider: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  university: University;
  profile: { fullName: string; studentIdNumber: string | null; department: string | null; batch: string | null } | null;
  photo: { url: string; expiresAt: string } | null;
  verifications: {
    id: string;
    method: "UNIVERSITY_EMAIL" | "ID_CARD";
    status: VerificationStatus;
    universityEmail: string | null;
    createdAt: string;
    rejectionReason: string | null;
    reviewedBy: Person | null;
  }[];
  moderationHistory: ModerationEntry[];
};

export type AdminUniversity = University & {
  isActive: boolean;
  userCount: number;
  domains: { id: string; domain: string }[];
};

export type AdminSubArea = { id: string; name: string; isActive: boolean; userCount: number; activityCount: number };

export type AuditEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
  admin: (Person & { email: string }) | null;
  targetUser: (Person & { email: string }) | null;
};

// ---- Rider Requests (B1) ----------------------------------------------------
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
type SignedFile = { url: string; expiresAt: string };

export type RiderApplicant = Person & {
  email: string;
  phone: string;
  studentVerificationStatus: VerificationStatus;
  isVerifiedRider: boolean;
  riderActive: boolean;
  riderSuspended: boolean;
  riderSuspendedUntil: string | null;
  university: University;
};

export type RiderApplicationRow = {
  id: string;
  kind: "INITIAL" | "REVERIFICATION";
  status: ApprovalStatus;
  licenceExpiresOn: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  vehicleCount: number;
  user: RiderApplicant;
};

export type AdminVehicle = {
  id: string;
  type: "BIKE" | "CAR";
  brand: string;
  model: string;
  colour: string;
  registrationNumber: string;
  seatCapacity: number;
  status: ApprovalStatus;
  rejectionReason: string | null;
  photo: SignedFile;
};

export type RiderDocument = { id: string; type: string; mimeType: string; sizeBytes: number };

export type RiderApplicationDetail = Omit<RiderApplicationRow, "vehicleCount" | "user"> & {
  reviewedBy: Person | null;
  user: RiderApplicant & { licenceExpiresOn: string | null; licenceExpired: boolean };
  documents: RiderDocument[];
  documentsOnFile: RiderDocument[];
  vehicles: AdminVehicle[];
  approvedVehicles: AdminVehicle[];
  history: { id: string; kind: string; status: ApprovalStatus; submittedAt: string; reviewedAt: string | null; rejectionReason: string | null; licenceExpiresOn: string }[];
};

export type RiderRow = RiderApplicant & { licenceExpiresOn: string | null; licenceExpired: boolean; vehicleCount: number };

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type FareSettings = {
  current: number | null;
  history: { id: string; ratePerKm: number; effectiveFrom: string }[];
  limits: { min: number; max: number };
};

export const adminApi = {
  dashboard: () => api<Dashboard>("/admin/dashboard"),

  // B3a: Fare Settings (Super Admin)
  fareSettings: () => api<FareSettings>("/admin/fare-settings"),
  setFareRate: (ratePerKm: number) => api<FareSettings>("/admin/fare-settings", { method: "POST", body: { ratePerKm } }),

  idCards: (status: "PENDING" | "VERIFIED" | "REJECTED", page = 1) =>
    api<Page<IdCardReview>>(`/admin/student-verifications${query({ status, page })}`),
  idCardFile: (id: string) =>
    api<{ url: string; expiresAt: string; mimeType: string | null }>(`/admin/student-verifications/${id}/file-url`),
  approveIdCard: (id: string) => api<null>(`/admin/student-verifications/${id}/approve`, { method: "POST" }),
  rejectIdCard: (id: string, reason: string) =>
    api<null>(`/admin/student-verifications/${id}/reject`, { method: "POST", body: { reason } }),

  users: (filters: { q?: string; accountStatus?: string; verification?: string; role?: string; page?: number }) =>
    api<Page<UserRow>>(`/admin/users${query(filters)}`),
  user: (id: string) => api<{ user: UserDetail }>(`/admin/users/${id}`),
  act: (id: string, action: AccountAction, body: { reason: string; startsAt?: string; endsAt?: string }) =>
    api<{ accountStatus: AccountStatus }>(`/admin/users/${id}/${action}`, { method: "POST", body }),

  universities: () => api<{ universities: AdminUniversity[] }>("/admin/universities"),
  createUniversity: (body: { name: string; shortName?: string; domains: string[] }) =>
    api<{ university: AdminUniversity }>("/admin/universities", { method: "POST", body }),
  updateUniversity: (id: string, body: { name?: string; shortName?: string | null; isActive?: boolean }) =>
    api<{ university: AdminUniversity }>(`/admin/universities/${id}`, { method: "PATCH", body }),
  deleteUniversity: (id: string) => api<null>(`/admin/universities/${id}`, { method: "DELETE" }),
  addDomain: (id: string, domain: string) => api<unknown>(`/admin/universities/${id}/domains`, { method: "POST", body: { domain } }),
  removeDomain: (id: string, domainId: string) => api<null>(`/admin/universities/${id}/domains/${domainId}`, { method: "DELETE" }),

  subAreas: () => api<{ subAreas: AdminSubArea[] }>("/admin/sub-areas"),
  createSubArea: (name: string) => api<{ subArea: AdminSubArea }>("/admin/sub-areas", { method: "POST", body: { name } }),
  updateSubArea: (id: string, body: { name?: string; isActive?: boolean }) =>
    api<{ subArea: AdminSubArea }>(`/admin/sub-areas/${id}`, { method: "PATCH", body }),
  removeSubArea: (id: string) => api<{ deleted: boolean }>(`/admin/sub-areas/${id}`, { method: "DELETE" }),

  riderApplications: (status: ApprovalStatus, page = 1) =>
    api<Page<RiderApplicationRow>>(`/admin/rider-applications${query({ status, page })}`),
  riderApplication: (id: string) => api<{ application: RiderApplicationDetail }>(`/admin/rider-applications/${id}`),
  riderDocument: (id: string, documentId: string) =>
    api<{ url: string; expiresAt: string; mimeType: string | null }>(`/admin/rider-applications/${id}/documents/${documentId}/file-url`),
  approveRiderApplication: (id: string) => api<null>(`/admin/rider-applications/${id}/approve`, { method: "POST" }),
  rejectRiderApplication: (id: string, reason: string) =>
    api<null>(`/admin/rider-applications/${id}/reject`, { method: "POST", body: { reason } }),
  riders: (filters: { q?: string; status?: string; page?: number }) => api<Page<RiderRow>>(`/admin/riders${query(filters)}`),
  suspendRider: (id: string, body: { reason: string; endsAt?: string }) =>
    api<unknown>(`/admin/riders/${id}/suspend`, { method: "POST", body }),
  reinstateRider: (id: string, reason: string) => api<unknown>(`/admin/riders/${id}/reinstate`, { method: "POST", body: { reason } }),

  auditLogs: (filters: { action?: string; targetType?: string; targetUserId?: string; from?: string; to?: string; page?: number }) =>
    api<Page<AuditEntry> & { actions: string[] }>(`/admin/audit-logs${query(filters)}`),
};

// The server answers with a path on the API origin ("/api/files/…").
export function privateFileUrl(path: string) {
  return `${apiBaseUrl.replace(/\/api\/?$/, "")}${path}`;
}
