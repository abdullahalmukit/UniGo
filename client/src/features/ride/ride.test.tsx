import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ToastProvider } from "../../components/toast";
import { fromDhakaInput, toDhakaInput } from "../../lib/dates";
import type { SessionState } from "../../lib/session";
import type { RideOffer, RideRequest } from "./ride-api";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() },
}));
// The map needs a real browser
vi.mock("./RideMap", () => ({ RideMap: () => <div data-testid="ride-map" /> }));
vi.mock("../../components/MapPicker", () => ({ MapPicker: () => <div data-testid="map-picker" /> }));

const rideApi = vi.hoisted(() => ({
  listRides: vi.fn(),
  getRideConfig: vi.fn(),
  estimateFare: vi.fn(),
  createRequest: vi.fn(),
  getRequest: vi.fn(),
  getOffer: vi.fn(),
  bookOffer: vi.fn(),
  acceptRequest: vi.fn(),
}));
vi.mock("./ride-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./ride-api")>()), ...rideApi }));

const riderApi = vi.hoisted(() => ({ getRiderOverview: vi.fn() }));
vi.mock("../rider/rider-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../rider/rider-api")>()), ...riderApi }));

const person = (name: string) => ({
  id: name,
  name,
  photo: null,
  university: { name: "Alpha University", shortName: "AU" },
  department: "CSE",
  isVerifiedRider: false,
  rating: null,
  completionRate: null,
  badges: [],
});
// Ride pages are lazy routes: the first load can take a moment in a full run.
const LAZY = { timeout: 5000 };
const campus = { address: "Campus gate", lat: 23.81, lng: 90.41 };
const farmgate = { address: "Farmgate", lat: 23.75, lng: 90.39 };

function request(overrides: Partial<RideRequest> = {}): RideRequest {
  return {
    kind: "REQUEST",
    id: "r1",
    status: "OPEN",
    subStatus: null,
    startTime: "2026-11-08T03:30:00.000Z",
    pickup: campus,
    destination: farmgate,
    offeredAmount: 150,
    passengerCount: 2,
    notes: null,
    routeDistanceKm: 6.2,
    subArea: { id: "s1", name: "Dhanmondi" },
    passenger: person("Rina"),
    rider: null,
    vehicle: null,
    chatId: null,
    mine: false,
    role: null,
    completionRequestedBy: null,
    createdAt: "2026-11-07T06:00:00.000Z",
    ...overrides,
  };
}

function offer(overrides: Partial<RideOffer> = {}): RideOffer {
  return {
    kind: "OFFER",
    id: "o1",
    status: "OPEN",
    closeReason: null,
    departureTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    pickup: campus,
    destination: farmgate,
    farePerSeat: 80,
    totalSeats: 3,
    seatsAvailable: 2,
    notes: null,
    routeDistanceKm: null,
    subArea: null,
    rider: { ...person("Karim"), isVerifiedRider: true },
    vehicle: { id: "v1", type: "CAR", brand: "Toyota", model: "Axio", colour: "White", seatCapacity: 4, registrationNumber: "Dhaka Metro-GA 11-••34" },
    mine: false,
    createdAt: "2026-11-07T06:00:00.000Z",
    bookings: [],
    myBooking: null,
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

function signIn(user: Record<string, unknown> = {}) {
  state.current = {
    status: "authenticated",
    session: {
      accessToken: "token",
      expiresAt: Date.now() + 600_000,
      user: { id: "me", language: "EN", theme: "LIGHT", studentVerificationStatus: "VERIFIED", isVerifiedRider: false, ...user },
    },
  } as SessionState;
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn();
  rideApi.getRideConfig.mockResolvedValue({
    amount: { min: 10, max: 1000 },
    passengers: { min: 1, max: 4 },
    notesMaxLength: 500,
    searchRadiusKm: [1, 2, 5],
    defaultSearchRadiusKm: 2,
    startAllowedBeforeMinutes: 30,
    earliestFromNowMinutes: 15,
    latestFromNowHours: 48,
    seats: { bike: { min: 1, max: 1 }, car: { min: 1, max: 4 } },
  });
  rideApi.estimateFare.mockResolvedValue({ distanceKm: null, ratePerKm: null, suggested: null });
});

describe("Asia/Dhaka date-time inputs", () => {
  it("shows and reads Bangladesh wall time whatever the device zone", () => {
    expect(toDhakaInput("2026-11-07T19:30:00.000Z")).toBe("2026-11-08T01:30");
    expect(fromDhakaInput("2026-11-08T01:30")).toBe("2026-11-07T19:30:00.000Z");
  });
});

describe("the Ride page", () => {
  it("lists open requests and offers and switches tabs", async () => {
    rideApi.listRides.mockResolvedValue({ items: [offer(), request()], page: 1, hasMore: false });
    renderAt("/ride");

    expect(await screen.findByRole("link", { name: /Ride offer/ }, LAZY)).toHaveAttribute("href", "/ride/offers/o1");
    expect(screen.getByRole("link", { name: /Ride request/ })).toHaveAttribute("href", "/ride/requests/r1");
    expect(screen.getByText("৳80 per seat")).toBeInTheDocument();
    expect(screen.getByText("2 seats left")).toBeInTheDocument();
    // Only Active riders see Offer a Ride
    expect(screen.queryByRole("link", { name: "Offer a Ride" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Offers" }));
    await waitFor(() => expect(rideApi.listRides).toHaveBeenLastCalledWith(expect.objectContaining({ type: "offers", page: 1 })));
  });

  it("asks unverified users to verify first", async () => {
    signIn({ studentVerificationStatus: "PENDING" });
    renderAt("/ride");
    expect(await screen.findByText("Verify your student status to use Ride Sharing.", {}, LAZY)).toBeInTheDocument();
    expect(rideApi.listRides).not.toHaveBeenCalled();
  });
});

describe("Need a Ride", () => {
  it("checks the required fields in the browser", async () => {
    renderAt("/ride/requests/new");
    await userEvent.click(await screen.findByRole("button", { name: "Post request" }, LAZY));
    expect(screen.getAllByText("Fill in this field.").length).toBeGreaterThanOrEqual(3);
    expect(rideApi.createRequest).not.toHaveBeenCalled();
  });
});

describe("an offer seen by a passenger", () => {
  it("books seats up to the seats left and shows the total", async () => {
    rideApi.getOffer.mockResolvedValue({ offer: offer() });
    rideApi.bookOffer.mockResolvedValue({ booking: { activityId: "b1" } });
    renderAt("/ride/offers/o1");

    const more = await screen.findByRole("button", { name: "One seat more" }, LAZY);
    await userEvent.click(more);
    expect(more).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Book for ৳160" }));
    expect(rideApi.bookOffer).toHaveBeenCalledWith("o1", 2);
  });

  it("shows only the passenger's own booking", async () => {
    rideApi.getOffer.mockResolvedValue({
      offer: offer({ myBooking: { activityId: "b1", status: "ACCEPTED", subStatus: "RIDE_CONFIRMED", seatsBooked: 1, amount: 80, passenger: null, chatId: "c1", createdAt: "" } }),
    });
    renderAt("/ride/offers/o1");
    expect(await screen.findByText("Your booking: 1 seat, ৳80", {}, LAZY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Book for/ })).not.toBeInTheDocument();
  });
});

describe("accepting a request as an Active rider (Q5)", () => {
  it("offers only vehicles with enough seats and sends the chosen one", async () => {
    signIn({ isVerifiedRider: true });
    riderApi.getRiderOverview.mockResolvedValue({
      riderActive: true,
      activeBlocker: null,
      vehicles: [
        { id: "bike", type: "BIKE", brand: "Honda", model: "CB", colour: "Red", registrationNumber: "X", seatCapacity: 1, status: "APPROVED" },
        { id: "car", type: "CAR", brand: "Toyota", model: "Axio", colour: "White", registrationNumber: "Y", seatCapacity: 4, status: "APPROVED" },
      ],
    });
    rideApi.getRequest.mockResolvedValue({ request: request() });
    rideApi.acceptRequest.mockResolvedValue({ request: request({ status: "ACCEPTED" }) });
    renderAt("/ride/requests/r1");

    await userEvent.click(await screen.findByRole("button", { name: "Accept request" }, LAZY));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("radio", { name: /Bike/ })).toBeDisabled();
    // The only vehicle that fits is chosen already
    expect(within(sheet).getByRole("radio", { name: /Car/ })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("button", { name: "Accept request" }));
    expect(rideApi.acceptRequest).toHaveBeenCalledWith("r1", "car");
  });
});
