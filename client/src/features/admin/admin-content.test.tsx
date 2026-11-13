import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import type { SessionState } from "../../lib/session";

// B8 Content — client tests for AdminSpotlightPage, AdminPromosPage, AdminBannersPage
// and HomePage spotlight integration.

// ---- session mock ---------------------------------------------------------------
const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn() },
}));
vi.mock("../../lib/google-identity", () => ({ googleClientId: undefined, loadGoogleIdentity: vi.fn() }));
vi.mock("../verification/verification-api", () => ({
  getStudentVerification: vi.fn().mockResolvedValue({ status: "VERIFIED" }),
}));

// ---- admin-api mock (dashboard etc.) -------------------------------------------
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

// ---- content-api mock ----------------------------------------------------------
const contentApiMock = vi.hoisted(() => ({
  listSpotlight: vi.fn(),
  createSpotlight: vi.fn(),
  updateSpotlight: vi.fn(),
  deleteSpotlight: vi.fn(),
  listPromos: vi.fn(),
  createPromo: vi.fn(),
  updatePromo: vi.fn(),
  deletePromo: vi.fn(),
  listBanners: vi.fn(),
  createBanner: vi.fn(),
  updateBanner: vi.fn(),
  deleteBanner: vi.fn(),
}));
vi.mock("../content/content-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../content/content-api")>()),
  adminContentApi: contentApiMock,
  // public getSpotlight used by HomePage
  getSpotlight: vi.fn().mockResolvedValue([]),
}));

// ---- helpers -------------------------------------------------------------------
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
  totalUsers: 1, activeUsers: 1, verifiedStudents: 0, verifiedRiders: 0,
  pendingStudentVerifications: 0, pendingRiderApplications: 0,
  openDisputes: 0, openReports: 0, openNoShowReports: 0,
  newRequestsToday: { ride: 0, carpool: 0, food: 0, service: 0 },
};

const sampleSpotlight = [
  { id: "s1", title: "Promo campaign", mediaType: "IMAGE" as const, mediaUrl: "https://cdn.test/a.jpg", linkUrl: null, linkLabel: null, startsAt: "2026-11-01T00:00:00.000Z", expiresAt: null, sortOrder: 0, isActive: true, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
  { id: "s2", title: "Event reel", mediaType: "VIDEO" as const, mediaUrl: "https://cdn.test/b.mp4", linkUrl: null, linkLabel: null, startsAt: "2026-11-01T00:00:00.000Z", expiresAt: null, sortOrder: 1, isActive: false, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
];

const samplePromos = [
  { id: "p1", title: "10% off rides", description: null, imageUrl: null, promoCode: "RIDE10", startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z", isActive: true, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
];

const sampleBanners = [
  { id: "b1", title: "Welcome back!", imageUrl: "https://cdn.test/banner.jpg", linkUrl: "https://unigo.app", startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z", sortOrder: 0, isActive: true, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
];

beforeEach(() => {
  adminApi.dashboard.mockResolvedValue(dashboard);
  adminApi.idCards.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
  adminApi.users.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
  adminApi.auditLogs.mockResolvedValue({ items: [], actions: [], page: 1, pageSize: 20, total: 0 });
  contentApiMock.listSpotlight.mockResolvedValue(sampleSpotlight);
  contentApiMock.listPromos.mockResolvedValue(samplePromos);
  contentApiMock.listBanners.mockResolvedValue(sampleBanners);
});

afterEach(() => {
  vi.clearAllMocks();
  state.current = { status: "guest" };
});

// ---- Admin Spotlight Page ------------------------------------------------------

describe("AdminSpotlightPage", () => {
  it("shows nav links for Spotlight, Promos and Banners in the sidebar", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/spotlight");
    const nav = await screen.findByRole("navigation", { name: "Admin menu" });
    expect(nav.querySelector('[href="/admin/spotlight"]')).toBeInTheDocument();
    expect(nav.querySelector('[href="/admin/promos"]')).toBeInTheDocument();
    expect(nav.querySelector('[href="/admin/banners"]')).toBeInTheDocument();
  });

  it("lists spotlight items loaded from the API", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/spotlight");
    expect(await screen.findByText("Promo campaign")).toBeInTheDocument();
    expect(await screen.findByText("Event reel")).toBeInTheDocument();
  });

  it("shows empty state when no items are returned", async () => {
    contentApiMock.listSpotlight.mockResolvedValue([]);
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/spotlight");
    expect(await screen.findByText("No items yet.")).toBeInTheDocument();
  });

  it("opens create sheet and calls createSpotlight on save", async () => {
    contentApiMock.createSpotlight.mockResolvedValue({ ...sampleSpotlight[0], id: "s-new" });
    contentApiMock.listSpotlight.mockResolvedValue([]);
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/spotlight");

    // Wait for page load
    await screen.findByText("No items yet.");

    // Click Add button
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    // The ConfirmSheet renders a Save button at the bottom — just check it appears
    // (The BottomSheet renders in a portal so ARIA structure differs; we verify
    //  the save button is visible and clicking it triggers the API call.)
    contentApiMock.listSpotlight.mockResolvedValue([{ ...sampleSpotlight[0], id: "s-new" }]);
    const saveBtn = await screen.findByRole("button", { name: "Save" });
    await userEvent.click(saveBtn);

    // createSpotlight is called (even with empty mediaUrl — validation is server-side)
    await waitFor(() => expect(contentApiMock.createSpotlight).toHaveBeenCalledOnce());
  });

  it("calls deleteSpotlight when delete is confirmed", async () => {
    contentApiMock.deleteSpotlight.mockResolvedValue(undefined);
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/spotlight");

    await screen.findByText("Promo campaign");

    // Click the first Delete button
    const deleteBtns = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteBtns[0]);

    // Confirm in the sheet
    contentApiMock.listSpotlight.mockResolvedValue([sampleSpotlight[1]]);
    const confirmBtns = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => expect(contentApiMock.deleteSpotlight).toHaveBeenCalledWith("s1"));
  });
});

// ---- Admin Promos Page ---------------------------------------------------------

describe("AdminPromosPage", () => {
  it("lists promos with their promo codes", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/promos");
    expect(await screen.findByText("10% off rides")).toBeInTheDocument();
    expect(await screen.findByText("RIDE10")).toBeInTheDocument();
  });

  it("shows empty state when no promos", async () => {
    contentApiMock.listPromos.mockResolvedValue([]);
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/promos");
    expect(await screen.findByText("No items yet.")).toBeInTheDocument();
  });
});

// ---- Admin Banners Page --------------------------------------------------------

describe("AdminBannersPage", () => {
  it("lists banners with their titles", async () => {
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/banners");
    expect(await screen.findByText("Welcome back!")).toBeInTheDocument();
  });

  it("shows empty state when no banners", async () => {
    contentApiMock.listBanners.mockResolvedValue([]);
    state.current = signedInAs("MODERATOR");
    renderAt("/admin/banners");
    expect(await screen.findByText("No items yet.")).toBeInTheDocument();
  });
});

// ---- HomePage spotlight --------------------------------------------------------

describe("HomePage — spotlight section", () => {
  it("hides the spotlight section when the API returns an empty array", async () => {
    // getSpotlight is already mocked to return [] in the module mock above
    state.current = { status: "guest" };
    renderAt("/");
    // Services section is always present
    expect(await screen.findByText("Services")).toBeInTheDocument();
    // Spotlight title should NOT appear when list is empty
    await waitFor(() => {
      expect(screen.queryByText("UniGo Spotlight")).not.toBeInTheDocument();
    });
  });

  it("renders spotlight items when the API returns them", async () => {
    const { getSpotlight } = await import("../content/content-api");
    vi.mocked(getSpotlight).mockResolvedValueOnce([
      { id: "x1", title: "Hot Deal", mediaType: "IMAGE", mediaUrl: "https://cdn.test/x.jpg", linkUrl: null, linkLabel: null, startsAt: "2026-11-01T00:00:00Z", expiresAt: null, sortOrder: 0, isActive: true, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" },
    ]);
    state.current = { status: "guest" };
    renderAt("/");
    expect(await screen.findByText("UniGo Spotlight")).toBeInTheDocument();
    expect(await screen.findByText("Hot Deal")).toBeInTheDocument();
  });
});
