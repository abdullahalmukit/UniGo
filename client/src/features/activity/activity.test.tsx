import { readFileSync } from "node:fs";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { DateTimeInput, joinTime, splitTime } from "../../components/DateTimeInput";
import { ToastProvider } from "../../components/toast";
import { formatRideTime, formatShortTime } from "../../lib/dates";
import type { SessionState } from "../../lib/session";
import { fakeSocket } from "../../test/setup";
import { countdownText } from "../upcoming/countdown";
import type { FeedItem } from "./feed-api";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() },
}));
vi.mock("../../components/MapPicker", () => ({ MapPicker: () => <div data-testid="map-picker" /> }));

const feedApi = vi.hoisted(() => ({ listActivity: vi.fn(), listUpcoming: vi.fn() }));
vi.mock("./feed-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./feed-api")>()), ...feedApi }));

const rideApi = vi.hoisted(() => ({ getRequest: vi.fn(), getRideConfig: vi.fn() }));
vi.mock("../ride/ride-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ride/ride-api")>()), ...rideApi }));

const LAZY = { timeout: 5000 };
const person = (id: string, name: string) => ({
  id,
  name,
  photo: null,
  university: { name: "Alpha University", shortName: "AU" },
  department: "CSE",
  isVerifiedRider: false,
  rating: null,
  completionRate: null,
  badges: [],
});
const place = (address: string) => ({ address, lat: 23.8, lng: 90.4 });

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    feature: "RIDE",
    kind: "RIDE_REQUEST",
    id: "r1",
    role: "REQUESTED",
    status: "ACCEPTED",
    subStatus: "RIDE_CONFIRMED",
    completionRequestedBy: null,
    time: "2026-11-08T08:20:00.000Z",
    pickup: place("Campus gate"),
    destination: place("Farmgate"),
    amount: 150,
    seats: 1,
    otherPerson: person("rider-1", "Karim Rider"),
    phone: "+8801711000000",
    chatId: "c1",
    bookings: [],
    activeBookings: 0,
    ...overrides,
  };
}

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

beforeEach(() => {
  vi.clearAllMocks();
  state.current = {
    status: "authenticated",
    session: { accessToken: "token", expiresAt: Date.now() + 600_000, user: { id: "me", language: "EN", theme: "LIGHT", studentVerificationStatus: "VERIFIED" } },
  } as SessionState;
  feedApi.listActivity.mockResolvedValue({ items: [], page: 1, hasMore: false });
  feedApi.listUpcoming.mockResolvedValue({ items: [] });
});

describe("Activity (proposal 12.2)", () => {
  it("shows an accepted ride with the other person's phone, Call and the status actions", async () => {
    feedApi.listActivity.mockResolvedValue({ items: [item()], page: 1, hasMore: false });
    renderAt("/activity");

    const card = (await screen.findByText("Campus gate", {}, LAZY)).closest("article")!;
    expect(within(card).getByText("Accepted")).toBeInTheDocument();
    expect(within(card).getByText("+8801711000000")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Call +8801711000000" })).toHaveAttribute("href", "tel:+8801711000000");
    expect(within(card).getByRole("button", { name: "Start Ride" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Cancel ride" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open chat" })).toHaveAttribute("href", "/inbox/c1");
    expect(within(card).getByRole("link", { name: "View details" })).toHaveAttribute("href", "/ride/requests/r1");
    expect(within(card).getByRole("link", { name: /Open Karim Rider's profile/ })).toHaveAttribute("href", "/u/rider-1");
  });

  it("sends the chosen feature, role and tab to the server", async () => {
    renderAt("/activity");
    await screen.findByRole("tab", { name: "History" }, LAZY);
    await userEvent.click(screen.getByRole("button", { name: "Ride Sharing" }));
    await userEvent.click(screen.getByRole("button", { name: "Accepted by me" }));
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await waitFor(() => expect(feedApi.listActivity).toHaveBeenLastCalledWith({ feature: "ride", role: "accepted", tab: "history", page: 1 }));
    expect(await screen.findByText("Finished activities will show here.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Food Delivery" }));
    expect(await screen.findByText("This service is coming soon.")).toBeInTheDocument();
  });

  it("offers Edit for an open request and Create again for a finished one", async () => {
    feedApi.listActivity.mockResolvedValue({
      items: [
        item({ id: "open", status: "OPEN", subStatus: null, otherPerson: null, phone: null, chatId: null }),
        item({ id: "done", status: "EXPIRED", subStatus: null, otherPerson: null, phone: null, chatId: null }),
      ],
      page: 1,
      hasMore: false,
    });
    renderAt("/activity");
    expect(await screen.findByRole("link", { name: "Edit" }, LAZY)).toHaveAttribute("href", "/ride/requests/open/edit");
    expect(screen.getByRole("link", { name: "Create again" })).toHaveAttribute("href", "/ride/requests/new?from=done");
  });

  it("shows a rider's offer with its bookings and each passenger's phone", async () => {
    feedApi.listActivity.mockResolvedValue({
      items: [
        item({
          kind: "RIDE_OFFER",
          id: "o1",
          status: "FULL",
          subStatus: null,
          otherPerson: null,
          phone: null,
          chatId: null,
          activeBookings: 1,
          bookings: [{ activityId: "b1", status: "ACCEPTED", seatsBooked: 2, amount: 160, passenger: person("p1", "Rina Passenger"), phone: "+8801811000000" }],
        }),
      ],
      page: 1,
      hasMore: false,
    });
    renderAt("/activity");
    expect(await screen.findByText("1 passenger booked", {}, LAZY)).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
    expect(screen.getByText("+8801811000000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open booking" })).toHaveAttribute("href", "/ride/bookings/b1");
  });

  it("reloads when a notification about an activity arrives", async () => {
    renderAt("/activity");
    await screen.findByText("Nothing active right now.", {}, LAZY);
    const calls = feedApi.listActivity.mock.calls.length;
    act(() => fakeSocket.emit("notification:new", { notification: { id: "n1", activityId: "r1" }, unreadCount: 1 }));
    await waitFor(() => expect(feedApi.listActivity.mock.calls.length).toBeGreaterThan(calls));
  });
});

describe("Upcoming (proposal 12.3)", () => {
  it("lists rides nearest first with a countdown on the nearest", async () => {
    const soon = new Date(Date.now() + (2 * 60 + 15) * 60 * 1000 - 1000).toISOString();
    feedApi.listUpcoming.mockResolvedValue({ items: [item({ time: soon }), item({ id: "r2", time: "2026-12-08T08:20:00.000Z" })] });
    renderAt("/upcoming");
    expect(await screen.findByText("in 2 h 15 min", {}, LAZY)).toBeInTheDocument();
    expect(screen.getAllByText(/in \d/)).toHaveLength(1);
  });

  it("words the countdown in minutes, hours and days", () => {
    const t = (key: string, o?: Record<string, unknown>) => `${key}:${JSON.stringify(o ?? {})}`;
    expect(countdownText(45 * 60 * 1000, t, "en")).toBe('upcoming.inMinutes:{"minutes":"45"}');
    expect(countdownText(26 * 3600 * 1000, t, "en")).toBe('upcoming.inDays:{"days":"1","hours":"2"}');
    expect(countdownText(-1, t, "en")).toBe("upcoming.startingNow:{}");
  });

  it("shows the next three on Home", async () => {
    feedApi.listUpcoming.mockResolvedValue({ items: [item()] });
    renderAt("/");
    expect(await screen.findByText("Campus gate", {}, LAZY)).toBeInTheDocument();
    expect(feedApi.listUpcoming).toHaveBeenCalledWith({ limit: 3 });
  });
});

describe("12-hour clock (B3b-1)", () => {
  it("shows times with am/pm, never 24-hour", () => {
    expect(formatRideTime("2026-11-07T08:20:00.000Z", "en")).toMatch(/2:20 pm/);
    expect(formatRideTime("2026-11-07T08:20:00.000Z", "en")).not.toContain("14:20");
    expect(formatShortTime("2026-11-07T08:20:00.000Z", "en", new Date("2026-11-07T09:00:00.000Z"))).toBe("2:20 pm");
  });

  it("splits and joins times on a 12-hour clock in 5-minute steps", () => {
    expect(splitTime("14:07")).toEqual({ hour: 2, minute: 5, pm: true });
    expect(splitTime("00:30")).toEqual({ hour: 12, minute: 30, pm: false });
    expect(joinTime(12, 0, true)).toBe("12:00");
    expect(joinTime(12, 0, false)).toBe("00:00");
    expect(joinTime(9, 45, true)).toBe("21:45");
  });

  it("picks a date and a 12-hour time", async () => {
    function Harness() {
      const [value, setValue] = useState("2026-11-08T09:00");
      return (
        <>
          <DateTimeInput label="Pickup" value={value} onChange={setValue} />
          <output>{value}</output>
        </>
      );
    }
    render(<Harness />);
    await userEvent.selectOptions(screen.getByLabelText("Hour"), "2");
    await userEvent.selectOptions(screen.getByLabelText("Minute"), "30");
    await userEvent.selectOptions(screen.getByLabelText("AM or PM"), "pm");
    expect(screen.getByRole("status")).toHaveTextContent("2026-11-08T14:30");
  });
});

describe("maps never cover sheets, dialogs or bars (B3b-1 F)", () => {
  const css = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("isolates every map and puts the layers above the map library's own", () => {
    expect(css("../../components/MapPicker.module.css")).toMatch(/\.wrap \{[^}]*isolation: isolate/);
    const tokens = css("../../styles/tokens.css");
    const layer = (name: string) => Number(new RegExp(`--z-${name}: (\\d+);`).exec(tokens)?.[1]);
    for (const name of ["bar", "sheet", "toast", "drawer"]) expect(layer(name)).toBeGreaterThan(1000);
    expect(css("../../components/form.module.css")).toContain("z-index: var(--z-sheet)");
    expect(css("../../components/toast.module.css")).toContain("z-index: var(--z-toast)");
    expect(css("../../app/layout/layout.module.css")).toContain("z-index: var(--z-bar)");
  });
});

describe("public profile (B3b-1 G)", () => {
  it("shows public details and badges, and no reviews yet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          profile: {
            id: "rider-1",
            name: "Karim Rider",
            photo: null,
            university: { name: "Alpha University", shortName: "AU" },
            department: "CSE",
            batch: "2023",
            memberSince: "2026-11-01T00:00:00.000Z",
            badges: ["VERIFIED_STUDENT", "VERIFIED_RIDER"],
            vehicles: [{ id: "v1", type: "CAR", brand: "Toyota", model: "Axio", colour: "White", seatCapacity: 4, registrationNumber: "Dhaka Metro-GA 11-••34" }],
            stats: { rating: null, completed: null, completionRate: null, lateCancellationRate: null },
            reviews: [],
            openRides: [],
            isMe: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    renderAt("/u/rider-1");
    expect(await screen.findByRole("heading", { name: "Karim Rider" }, LAZY)).toBeInTheDocument();
    expect(screen.getByText("Verified Student")).toBeInTheDocument();
    expect(screen.getByText("Verified Rider")).toBeInTheDocument();
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
    expect(screen.getByText(/Dhaka Metro-GA 11-••34/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/users/rider-1/profile"))).toBe(true);
    fetchMock.mockRestore();
  });
});
