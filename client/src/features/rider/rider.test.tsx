import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ToastProvider } from "../../components/toast";
import { ApiError } from "../../lib/api";
import type { SessionState } from "../../lib/session";
import type { RiderOverview } from "./rider-api";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() },
}));
vi.mock("../../lib/google-identity", () => ({ googleClientId: undefined, loadGoogleIdentity: vi.fn() }));
vi.mock("../verification/verification-api", () => ({
  getStudentVerification: vi.fn().mockResolvedValue({ status: "VERIFIED" }),
}));
// jsdom cannot draw images; photos are sent as chosen.
vi.mock("../profile/shrink-image", () => ({ shrinkImage: async (file: File) => file }));

const riderApi = vi.hoisted(() => ({
  getRiderOverview: vi.fn(),
  getRiderDashboard: vi.fn(),
  setRiderActive: vi.fn(),
  submitApplication: vi.fn(),
}));
vi.mock("./rider-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./rider-api")>()), ...riderApi }));

const adminApi = vi.hoisted(() => ({
  riderApplications: vi.fn(),
  riderApplication: vi.fn(),
  riderDocument: vi.fn(),
  approveRiderApplication: vi.fn(),
  rejectRiderApplication: vi.fn(),
  riders: vi.fn(),
  suspendRider: vi.fn(),
  reinstateRider: vi.fn(),
}));
vi.mock("../admin/admin-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../admin/admin-api")>();
  return { ...original, adminApi: { ...original.adminApi, ...adminApi } };
});

const signedIn = (role = "USER"): SessionState => ({
  status: "authenticated",
  session: { accessToken: "t", expiresAt: Date.now() + 60_000, user: { id: "me", role } },
});

const limits = {
  maxVehiclesPerApplication: 5,
  maxActiveVehicles: 5,
  licenceMaxYearsAhead: 10,
  seats: { bike: { min: 1, max: 1 }, car: { min: 1, max: 4 } },
};

const overview = (changes: Partial<RiderOverview> = {}): RiderOverview => ({
  studentVerified: true,
  accountStatus: "ACTIVE",
  isVerifiedRider: false,
  riderActive: false,
  riderSuspended: false,
  riderSuspendedUntil: null,
  licenceExpiresOn: null,
  licenceExpired: false,
  activeBlocker: null,
  latestApplication: null,
  history: [],
  vehicles: [],
  limits,
  ...changes,
});

const application = (status: "PENDING" | "APPROVED" | "REJECTED", extra = {}) => ({
  id: "app1",
  kind: "INITIAL" as const,
  status,
  licenceExpiresOn: "2028-01-31",
  submittedAt: "2026-11-04T06:00:00.000Z",
  reviewedAt: null,
  rejectionReason: null,
  documents: [],
  vehicleCount: 1,
  ...extra,
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>,
  );
  return router;
}

const file = (name: string, type: string) => new File(["x"], name, { type });

beforeEach(() => {
  vi.clearAllMocks();
  state.current = signedIn();
  riderApi.getRiderDashboard.mockResolvedValue({
    totalRides: 0,
    accepted: 0,
    completed: 0,
    cancelled: 0,
    completionRate: null,
    lateCancellationRate: null,
    rating: null,
    activeCarpoolContracts: 0,
    carpoolSessionCancellations: 0,
    earnings: 0,
  });
});

describe("Drive with UniGo", () => {
  it("asks unverified students to verify first", async () => {
    riderApi.getRiderOverview.mockResolvedValue(overview({ studentVerified: false }));
    renderAt("/drive");
    expect(await screen.findByText(/Only verified students can become riders/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verify now" })).toHaveAttribute("href", "/verify-student?next=%2Fdrive");
  });

  it("checks the form in the browser, then sends the application with every file", async () => {
    riderApi.getRiderOverview.mockResolvedValue(overview());
    riderApi.submitApplication.mockResolvedValue(overview({ latestApplication: application("PENDING") }));
    renderAt("/drive");

    await userEvent.click(await screen.findByRole("button", { name: "Apply now" }));
    await userEvent.click(screen.getByRole("button", { name: "Send application" }));
    expect(screen.getByText("Check the highlighted fields.")).toBeInTheDocument();
    expect(riderApi.submitApplication).not.toHaveBeenCalled();

    await userEvent.upload(screen.getByLabelText("NID front"), file("front.png", "image/png"));
    await userEvent.upload(screen.getByLabelText("NID back"), file("back.pdf", "application/pdf"));
    await userEvent.upload(screen.getByLabelText("Motorcycle licence"), file("lic.jpg", "image/jpeg"));
    await userEvent.type(screen.getByLabelText("Licence expiry date"), "2028-01-31");
    await userEvent.type(screen.getByLabelText("Brand"), "Honda");
    await userEvent.type(screen.getByLabelText("Model"), "Hornet");
    await userEvent.type(screen.getByLabelText("Colour"), "Red");
    await userEvent.type(screen.getByLabelText("Registration number"), "Dhaka Metro-HA 12-3456");
    await userEvent.upload(screen.getByLabelText("Vehicle photo (JPG or PNG)"), file("bike.jpg", "image/jpeg"));
    expect(screen.getByLabelText("Passenger seats")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Send application" }));

    await waitFor(() => expect(riderApi.submitApplication).toHaveBeenCalled());
    const draft = riderApi.submitApplication.mock.calls[0][0];
    expect(draft).toMatchObject({
      licenceExpiresOn: "2028-01-31",
      vehicles: [{ type: "BIKE", brand: "Honda", model: "Hornet", colour: "Red", registrationNumber: "Dhaka Metro-HA 12-3456", seatCapacity: 1 }],
    });
    expect(draft.nidFront.name).toBe("front.png");
    expect(draft.motorcycleLicence.name).toBe("lic.jpg");
    expect(await screen.findByText("An admin is reviewing your documents and vehicles.")).toBeInTheDocument();
  });

  it("shows the server's error under the right vehicle field", async () => {
    riderApi.getRiderOverview.mockResolvedValue(overview());
    riderApi.submitApplication.mockRejectedValue(
      new ApiError(409, { code: "REGISTRATION_TAKEN", fields: { "vehicles.0.registrationNumber": ["taken"] } }),
    );
    renderAt("/drive");
    await userEvent.click(await screen.findByRole("button", { name: "Apply now" }));
    await userEvent.upload(screen.getByLabelText("NID front"), file("f.png", "image/png"));
    await userEvent.upload(screen.getByLabelText("NID back"), file("b.png", "image/png"));
    await userEvent.upload(screen.getByLabelText("Motorcycle licence"), file("l.png", "image/png"));
    await userEvent.type(screen.getByLabelText("Licence expiry date"), "2028-01-31");
    for (const label of ["Brand", "Model", "Colour"]) await userEvent.type(screen.getByLabelText(label), "x");
    await userEvent.type(screen.getByLabelText("Registration number"), "Dhaka Metro-HA 12-3456");
    await userEvent.upload(screen.getByLabelText("Vehicle photo (JPG or PNG)"), file("v.jpg", "image/jpeg"));
    await userEvent.click(screen.getByRole("button", { name: "Send application" }));

    expect(await screen.findByText("This registration number is already registered by another rider.")).toBeInTheDocument();
  });

  it("shows the rejection reason and offers to apply again", async () => {
    riderApi.getRiderOverview.mockResolvedValue(
      overview({ latestApplication: application("REJECTED", { rejectionReason: "Blurry NID photo" }) }),
    );
    renderAt("/drive");
    expect(await screen.findByText("Blurry NID photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fix and apply again" })).toBeInTheDocument();
  });

  it("gives an approved rider the badge, the Active switch and the dashboard", async () => {
    riderApi.getRiderOverview.mockResolvedValue(
      overview({ isVerifiedRider: true, licenceExpiresOn: "2028-01-31", latestApplication: application("APPROVED") }),
    );
    riderApi.setRiderActive.mockResolvedValue(
      overview({ isVerifiedRider: true, riderActive: true, licenceExpiresOn: "2028-01-31", latestApplication: application("APPROVED") }),
    );
    renderAt("/drive");

    expect(await screen.findByText("Verified Rider")).toBeInTheDocument();
    expect(screen.getByText("Valid until 31 January 2028")).toBeInTheDocument();
    expect(await screen.findByText("Rider Dashboard")).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Inactive" });
    await userEvent.click(toggle);
    expect(riderApi.setRiderActive).toHaveBeenCalledWith(true);
    expect(await screen.findByRole("switch", { name: "Active" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the switch off and explains why when the licence has expired", async () => {
    riderApi.getRiderOverview.mockResolvedValue(
      overview({
        isVerifiedRider: true,
        licenceExpiresOn: "2026-01-31",
        licenceExpired: true,
        activeBlocker: "LICENCE_EXPIRED",
        latestApplication: application("APPROVED"),
      }),
    );
    renderAt("/drive");
    expect(await screen.findByRole("switch", { name: "Inactive" })).toBeDisabled();
    expect(screen.getByText(/Your licence has expired. Re-verify/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Re-verify or add a vehicle" }));
    expect(screen.queryByLabelText("NID front")).toBeNull();
    expect(screen.getByRole("button", { name: "Send re-verification" })).toBeInTheDocument();
  });
});

describe("Rider Requests (admin)", () => {
  const applicant = {
    id: "u1",
    name: "Karim",
    email: "karim@example.com",
    phone: "+8801712345678",
    studentVerificationStatus: "VERIFIED",
    isVerifiedRider: false,
    riderActive: false,
    riderSuspended: false,
    riderSuspendedUntil: null,
    university: { id: "uni", name: "Alpha University", shortName: null },
  };

  it("reviews an application: documents through a signed link, then approve", async () => {
    state.current = signedIn("MODERATOR");
    adminApi.riderApplication.mockResolvedValue({
      application: {
        ...application("PENDING"),
        reviewedBy: null,
        user: { ...applicant, licenceExpiresOn: null, licenceExpired: false },
        documents: [{ id: "d1", type: "NID_FRONT", mimeType: "image/png", sizeBytes: 10 }],
        documentsOnFile: [],
        vehicles: [
          {
            id: "v1",
            type: "BIKE",
            brand: "Honda",
            model: "Hornet",
            colour: "Red",
            registrationNumber: "Dhaka Metro-HA 12-3456",
            seatCapacity: 1,
            status: "PENDING",
            rejectionReason: null,
            photo: { url: "/api/files/x", expiresAt: "" },
          },
        ],
        approvedVehicles: [],
        history: [],
      },
    });
    adminApi.riderDocument.mockResolvedValue({ url: "/api/files/doc", expiresAt: "", mimeType: "image/png" });
    adminApi.approveRiderApplication.mockResolvedValue(null);
    adminApi.riderApplications.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const router = renderAt("/admin/rider-requests/app1");

    expect(await screen.findByText(/Dhaka Metro-HA 12-3456/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "NID front" }));
    expect(adminApi.riderDocument).toHaveBeenCalledWith("app1", "d1");
    expect(await screen.findByRole("img", { name: "Student ID card" })).toHaveAttribute("src", "/api/files/doc");

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
    expect(adminApi.approveRiderApplication).toHaveBeenCalledWith("app1");
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/rider-requests"));
  });

  it("lets only Super Admins suspend a rider", async () => {
    const rider = { ...applicant, isVerifiedRider: true, riderActive: true, licenceExpiresOn: "2028-01-31", licenceExpired: false, vehicleCount: 1 };
    adminApi.riders.mockResolvedValue({ items: [rider], page: 1, pageSize: 20, total: 1 });
    adminApi.riderApplications.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    adminApi.suspendRider.mockResolvedValue({});

    state.current = signedIn("SUPER_ADMIN");
    renderAt("/admin/rider-requests");
    await userEvent.click(await screen.findByRole("tab", { name: "Riders" }));
    await userEvent.click(await screen.findByRole("button", { name: "Suspend rider" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Unsafe driving");
    await userEvent.click(within(dialog).getByRole("button", { name: "Suspend rider" }));
    expect(adminApi.suspendRider).toHaveBeenCalledWith("u1", { reason: "Unsafe driving", endsAt: undefined });
  });

  it("hides suspend from Moderators", async () => {
    const rider = { ...applicant, isVerifiedRider: true, licenceExpiresOn: null, licenceExpired: true, vehicleCount: 1 };
    adminApi.riders.mockResolvedValue({ items: [rider], page: 1, pageSize: 20, total: 1 });
    adminApi.riderApplications.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    state.current = signedIn("MODERATOR");
    renderAt("/admin/rider-requests");
    await userEvent.click(await screen.findByRole("tab", { name: "Riders" }));
    expect(await screen.findByText("Karim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend rider" })).toBeNull();
  });
});
