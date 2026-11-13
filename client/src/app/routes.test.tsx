import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "../lib/session";
import { routes } from "./routes";
import { ThemeProvider } from "./theme-provider";

// The app's session, replaced by one the test controls.
const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  session: {
    getState: () => state.current,
    subscribe: () => () => {},
    logout: vi.fn(),
    signIn: vi.fn(),
  },
}));

// No Google button in these tests.
vi.mock("../lib/google-identity", () => ({ googleClientId: undefined, loadGoogleIdentity: vi.fn() }));

// Content API: return one spotlight item so the Spotlight section renders on /
vi.mock("../features/content/content-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/content/content-api")>()),
  getSpotlight: vi.fn().mockResolvedValue([
    { id: "s1", title: null, mediaType: "IMAGE", mediaUrl: "https://cdn.test/a.jpg", linkUrl: null, linkLabel: null, startsAt: "2026-01-01T00:00:00Z", expiresAt: null, sortOrder: 0, isActive: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  ]),
}));

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

const signedIn: SessionState = {
  status: "authenticated",
  session: { accessToken: "t", expiresAt: Date.now() + 60_000, user: { id: "u1" } },
};

beforeEach(() => {
  state.current = { status: "guest" };
});

describe("public pages", () => {
  it.each([
    ["/", "UniGo Spotlight"],
    ["/services", "All Services"],
  ])("shows %s to guests", async (path, text) => {
    renderAt(path);
    expect(await screen.findAllByText(text)).not.toHaveLength(0);
  });

  it("sends a guest who taps Create on All Services to log in", async () => {
    renderAt("/services");
    const [create] = await screen.findAllByRole("link", { name: "Create" });
    expect(create).toHaveAttribute("href", "/login?next=%2Fservices");
  });
});

describe("protected pages", () => {
  it.each(["/activity", "/upcoming", "/inbox", "/notifications", "/account"])(
    "redirect a guest from %s to /login with next",
    async (path) => {
      const router = renderAt(path);

      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/login");
      expect(router.state.location.search).toBe(`?next=${encodeURIComponent(path)}`);
    },
  );

  it("keeps the query string in next", async () => {
    const router = renderAt("/activity?filter=food");
    await screen.findByRole("heading", { level: 1, name: "Log in" });
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/activity?filter=food")}`);
  });

  it("shows a splash while the session is being restored", async () => {
    state.current = { status: "unknown" };
    renderAt("/activity");
    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");
  });

  it("lets a signed-in user in", async () => {
    state.current = signedIn;
    renderAt("/activity");
    expect(await screen.findByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
  });
});

describe("layout", () => {
  it("has the five phone tabs in the proposal's order", async () => {
    renderAt("/");
    const tabs = within(await screen.findByRole("navigation", { name: "Bottom tabs" })).getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Home", "Activity", "Upcoming", "All Services", "Inbox"]);
  });

  it("has the desktop links in the proposal's order, with Notifications and Account as icons", async () => {
    renderAt("/");
    const nav = within(await screen.findByRole("navigation", { name: "Main navigation" }));
    const links = nav.getAllByRole("link");

    expect(links.map((link) => link.getAttribute("aria-label") ?? link.textContent)).toEqual([
      "Home",
      "All Services",
      "Upcoming",
      "Activity",
      "Inbox",
      "Notifications",
      "Account & Settings",
    ]);
    // Icon only, with a tooltip.
    for (const name of ["Notifications", "Account & Settings"]) {
      const link = nav.getByRole("link", { name });
      expect(link.textContent).toBe("");
      expect(link).toHaveAttribute("data-tooltip", name);
    }
  });

  it("shows the four service cards with title, subtitle, tag and illustration", async () => {
    renderAt("/");
    const cards = await screen.findAllByRole("link", { name: /Bike & Car|Weekly|From campus|7 categories/ });

    expect(cards.map((card) => card.textContent)).toEqual([
      "RideGet or offer a rideBike & Car",
      "CarpoolRide on a scheduleWeekly",
      "FoodFood brought to youFrom campus",
      "Uni ServiceHelp with daily tasks7 categories",
    ]);
    for (const card of cards) {
      const picture = card.querySelector("img")!;
      expect(picture).toHaveAttribute("alt", "");
      // Phone and desktop sizes, each at 1x and 2x.
      expect(picture.getAttribute("srcset")!.split(", ")).toHaveLength(4);
      expect(picture.getAttribute("srcset")).toMatch(/\.webp \d+w/);
      expect(picture.getAttribute("sizes")).toMatch(/^\(min-width: 768px\) \d+px, \d+px$/);
    }
  });

  it("marks the current tab as active", async () => {
    state.current = signedIn;
    renderAt("/upcoming");
    const tabs = within(await screen.findByRole("navigation", { name: "Bottom tabs" }));
    expect(tabs.getByRole("link", { name: "Upcoming" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("shows a not-found page for unknown paths", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
  });
});
