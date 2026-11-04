import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ApiError } from "../../lib/api";
import type { SessionState } from "../../lib/session";
import type { UserDetail } from "./admin-api";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn() },
}));
vi.mock("../../lib/google-identity", () => ({ googleClientId: undefined, loadGoogleIdentity: vi.fn() }));
vi.mock("../verification/verification-api", () => ({
  getStudentVerification: vi.fn().mockResolvedValue({ status: "VERIFIED" }),
}));

const adminApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  idCards: vi.fn(),
  idCardFile: vi.fn(),
  approveIdCard: vi.fn(),
  rejectIdCard: vi.fn(),
  users: vi.fn(),
  user: vi.fn(),
  act: vi.fn(),
  universities: vi.fn(),
  subAreas: vi.fn(),
  auditLogs: vi.fn(),
}));
vi.mock("./admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admin-api")>()),
  adminApi,
}));

const signedInAs = (role: string): SessionState => ({
  status: "authenticated",
  session: { accessToken: "t", expiresAt: Date.now() + 60_000, user: { id: "me", role } },
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

const dashboard = {
  totalUsers: 12,
  activeUsers: 10,
  verifiedStudents: 7,
  verifiedRiders: 0,
  pendingStudentVerifications: 2,
  pendingRiderApplications: 0,
  openDisputes: 0,
  openReports: 0,
  openNoShowReports: 0,
  newRequestsToday: { ride: 0, carpool: 0, food: 0, service: 0 },
};

const card = {
  id: "v1",
  status: "PENDING" as const,
  submittedAt: "2026-11-04T06:00:00.000Z",
  reviewedAt: null,
  rejectionReason: null,
  reviewedBy: null,
  user: {
    id: "u1",
    name: "Rahim Uddin",
    email: "rahim@example.com",
    phone: "+8801712345678",
    studentIdNumber: "221-15-999",
    department: null,
    batch: null,
    university: { id: "uni", name: "Alpha University", shortName: null },
  },
};

const userDetail: UserDetail = {
  id: "u1",
  email: "rahim@example.com",
  phone: "+8801712345678",
  role: "USER",
  accountStatus: "ACTIVE",
  suspendedFrom: null,
  suspendedUntil: null,
  restrictedUntil: null,
  studentVerificationStatus: "VERIFIED",
  verifiedUniversityEmail: null,
  isVerifiedRider: false,
  riderActive: false,
  createdAt: "2026-11-01T06:00:00.000Z",
  lastLoginAt: null,
  photo: null,
  university: { id: "uni", name: "Alpha University", shortName: null },
  profile: { fullName: "Rahim Uddin", studentIdNumber: null, department: null, batch: null },
  verifications: [],
  moderationHistory: [
    {
      id: "m1",
      type: "WARN",
      reason: "Rude in chat",
      startsAt: null,
      endsAt: null,
      previousStatus: "ACTIVE",
      newStatus: "ACTIVE",
      createdAt: "2026-11-02T06:00:00.000Z",
      admin: { id: "a1", name: "Admin One" },
    },
  ],
};

beforeEach(() => {
  adminApi.dashboard.mockResolvedValue(dashboard);
  adminApi.idCards.mockResolvedValue({ items: [card], page: 1, pageSize: 20, total: 1 });
  adminApi.idCardFile.mockResolvedValue({ url: "/api/files/token", expiresAt: "", mimeType: "image/png" });
  adminApi.user.mockResolvedValue({ user: userDetail });
  adminApi.users.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
  adminApi.auditLogs.mockResolvedValue({ items: [], actions: ["USER_WARN"], page: 1, pageSize: 20, total: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
  state.current = { status: "guest" };
});

describe("admin area access", () => {
  it("sends guests to log in", async () => {
    const router = renderAt("/admin");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("tells a normal user they are not allowed", async () => {
    state.current = signedInAs("USER");
    renderAt("/admin/users");
    expect(await screen.findByText("You are not allowed to open this page.")).toBeInTheDocument();
    expect(adminApi.users).not.toHaveBeenCalled();
  });

  it("shows moderators their menu without the Super Admin pages", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/admin");

    const menu = await screen.findByRole("navigation", { name: "Admin menu" });
    expect(within(menu).getByRole("link", { name: "Student verification" })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(within(menu).queryByRole("link", { name: "Audit Log" })).toBeNull();
    expect(within(menu).queryByRole("link", { name: "Sub-Areas" })).toBeNull();
    expect(await screen.findByText("Pending student verifications")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("refuses Super Admin pages to moderators", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/audit-log");
    expect(await screen.findByText("You are not allowed to open this page.")).toBeInTheDocument();
    expect(adminApi.auditLogs).not.toHaveBeenCalled();
  });

  it("shows Super Admins every page", async () => {
    state.current = signedInAs("SUPER_ADMIN");
    renderAt("/admin");
    const menu = await screen.findByRole("navigation", { name: "Admin menu" });
    for (const name of ["Dashboard", "Student verification", "Users", "Universities", "Sub-Areas", "Audit Log"]) {
      expect(within(menu).getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("opens and closes the phone menu", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/admin");
    const button = await screen.findByRole("button", { name: "Open the admin menu" });
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Close the admin menu" })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("account menu", () => {
  it("shows the Admin panel link to admins only", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/account");
    expect(await screen.findByRole("link", { name: "Admin panel" })).toHaveAttribute("href", "/admin");
  });

  it("hides it from normal users", async () => {
    state.current = signedInAs("USER");
    renderAt("/account");
    await screen.findByText("Account & Settings");
    expect(screen.queryByRole("link", { name: "Admin panel" })).toBeNull();
  });
});

describe("student verification review", () => {
  it("shows the card through the signed link and rejects with a reason", async () => {
    state.current = signedInAs("MODERATOR");
    adminApi.rejectIdCard.mockResolvedValue(null);
    renderAt("/admin/verifications");

    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(await screen.findByRole("img", { name: "Student ID card" })).toHaveAttribute("src", "/api/files/token");

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    const sheet = screen.getByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Reason"), "Blurry photo");
    await userEvent.click(within(sheet).getByRole("button", { name: "Reject" }));

    expect(adminApi.rejectIdCard).toHaveBeenCalledWith("v1", "Blurry photo");
    expect(await screen.findByText("The ID card was rejected.")).toBeInTheDocument();
  });

  it("approves after a confirm step", async () => {
    state.current = signedInAs("MODERATOR");
    adminApi.approveIdCard.mockResolvedValue(null);
    renderAt("/admin/verifications");

    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));

    expect(adminApi.approveIdCard).toHaveBeenCalledWith("v1");
  });
});

describe("user account management", () => {
  it("lets a Super Admin suspend with dates and a reason", async () => {
    state.current = signedInAs("SUPER_ADMIN");
    adminApi.act.mockResolvedValue({ accountStatus: "SUSPENDED" });
    renderAt("/admin/users/u1");

    expect(await screen.findByText("Rude in chat")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
    const sheet = screen.getByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Reason"), "Harassment");
    await userEvent.type(within(sheet).getByLabelText("End"), "2026-12-01T10:00");
    await userEvent.click(within(sheet).getByRole("button", { name: "Suspend" }));

    expect(adminApi.act).toHaveBeenCalledWith("u1", "suspend", {
      reason: "Harassment",
      startsAt: undefined,
      endsAt: new Date("2026-12-01T10:00").toISOString(),
    });
    expect(await screen.findByText("Done. The user has been emailed.")).toBeInTheDocument();
  });

  it("shows the server's reason when an action is refused", async () => {
    state.current = signedInAs("SUPER_ADMIN");
    adminApi.act.mockRejectedValue(new ApiError(409, { code: "INVALID_STATUS_CHANGE" }));
    renderAt("/admin/users/u1");

    await userEvent.click(await screen.findByRole("button", { name: "Warn" }));
    const sheet = screen.getByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Reason"), "Spam");
    await userEvent.click(within(sheet).getByRole("button", { name: "Warn" }));

    expect(await within(sheet).findByText("This action is not possible for the account's current status.")).toBeInTheDocument();
  });

  it("offers only Unban for a banned user", async () => {
    state.current = signedInAs("SUPER_ADMIN");
    adminApi.user.mockResolvedValue({ user: { ...userDetail, accountStatus: "BANNED" } });
    renderAt("/admin/users/u1");

    expect(await screen.findByRole("button", { name: "Unban" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Warn" })).toBeNull();
  });

  it("shows moderators the history but no actions", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/users/u1");

    expect(await screen.findByText("Rude in chat")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Warn" })).toBeNull();
  });
});

describe("audit log", () => {
  it("filters by action and dates in Asia/Dhaka", async () => {
    state.current = signedInAs("SUPER_ADMIN");
    renderAt("/admin/audit-log");

    await screen.findByText("No entries.");
    await userEvent.selectOptions(screen.getByLabelText("Action"), "USER_WARN");
    await userEvent.type(screen.getByLabelText("From"), "2026-11-01");

    await waitFor(() =>
      expect(adminApi.auditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: "USER_WARN", from: "2026-11-01T00:00:00.000+06:00", page: 1 }),
      ),
    );
  });
});
