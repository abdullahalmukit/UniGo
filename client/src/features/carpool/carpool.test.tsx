import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ToastProvider } from "../../components/toast";
import { ApiError } from "../../lib/api";
import type { SessionState } from "../../lib/session";
import type { CarpoolBooking, CarpoolPost, CarpoolPostDetail } from "./carpool-api";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() },
}));
vi.mock("../../components/MapPicker", () => ({ MapPicker: () => <div data-testid="map-picker" /> }));

const carpoolApi = vi.hoisted(() => ({
  searchCarpools: vi.fn(),
  getCarpoolConfig: vi.fn(),
  getPost: vi.fn(),
  getBooking: vi.fn(),
  quote: vi.fn(),
  requestSeat: vi.fn(),
  acceptBooking: vi.fn(),
  agreeBooking: vi.fn(),
  // B6b
  completeSession: vi.fn(),
  setPaymentMethod: vi.fn(),
  markPaymentPaid: vi.fn(),
  requestTermination: vi.fn(),
  withdrawTermination: vi.fn(),
  answerTermination: vi.fn(),
  renewContract: vi.fn(),
}));
vi.mock("./carpool-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./carpool-api")>()), ...carpoolApi }));

const riderApi = vi.hoisted(() => ({ getRiderOverview: vi.fn() }));
vi.mock("../rider/rider-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../rider/rider-api")>()), ...riderApi }));

const LAZY = { timeout: 5000 };
const person = (id: string, name: string) => ({
  id,
  name,
  photo: null,
  university: { name: "Alpha University", shortName: "AU" },
  department: "CSE",
  isVerifiedRider: true,
  rating: null,
  completionRate: null,
  badges: [],
});
const campus = { address: "Campus gate", lat: 23.81, lng: 90.41 };
const farmgate = { address: "Farmgate", lat: 23.75, lng: 90.39 };

function post(overrides: Partial<CarpoolPostDetail> = {}): CarpoolPostDetail {
  return {
    kind: "CARPOOL_POST",
    id: "p1",
    status: "OPEN",
    closeReason: null,
    paused: false,
    // Sunday, Tuesday, Thursday
    daysOfWeek: 0b0010101,
    departureMinute: 8 * 60 + 30,
    validFrom: "2026-11-01",
    validUntil: null,
    nextRide: "2026-11-10T02:30:00.000Z",
    pickup: campus,
    destination: farmgate,
    totalSeats: 3,
    seatsAvailable: 2,
    notes: null,
    prices: [
      { durationMonths: 1, monthlyPrice: 2000 },
      { durationMonths: 3, monthlyPrice: 1800 },
    ],
    rider: person("rider", "Karim Hasan"),
    vehicle: { id: "v1", type: "CAR", brand: "Toyota", model: "Axio", colour: "White", seatCapacity: 4, registrationNumber: "DHAKA ••34" },
    riderSessionCancellations: 2,
    mine: false,
    createdAt: "2026-11-01T00:00:00.000Z",
    bookings: [],
    myBooking: null,
    ...overrides,
  };
}

function booking(overrides: Partial<CarpoolBooking> = {}): CarpoolBooking {
  return {
    activityId: "b1",
    postId: "p1",
    status: "ACCEPTED",
    subStatus: null,
    durationMonths: 1,
    monthlyPrice: 2000,
    startDate: "2026-11-10",
    endDate: "2026-12-09",
    firstRide: "2026-11-10T02:30:00.000Z",
    holdExpiresAt: "2026-11-09T10:00:00.000Z",
    agreed: { me: false, other: true },
    rejectionReason: null,
    closureReason: null,
    cancelledBy: null,
    cancellationReason: null,
    isLateCancellation: false,
    contract: null,
    passenger: person("me", "Rina Akter"),
    rider: person("rider", "Karim Hasan"),
    chatId: "c1",
    role: "PASSENGER",
    createdAt: "2026-11-08T00:00:00.000Z",
    phone: "+8801711000000",
    post: post(),
    sessions: [],
    payments: [],
    history: [],
    renewal: null,
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
  carpoolApi.getCarpoolConfig.mockResolvedValue({
    maxSchedules: 12,
    durationMonths: [1, 2, 3, 4],
    monthlyPrice: { min: 100, max: 10000 },
    notesMaxLength: 500,
    validFromMaxDaysAhead: 60,
    rejectReasonMaxLength: 500,
    seatHoldHours: 24,
    searchRadiusKm: [1, 2, 5],
    defaultSearchRadiusKm: 2,
    seats: { bike: { min: 1, max: 1 }, car: { min: 1, max: 4 } },
  });
  carpoolApi.quote.mockResolvedValue({ startDate: "2026-11-10", endDate: "2026-12-09", sessions: 13, firstRide: null, monthlyPrice: 2000, total: 2000 });
});

describe("the Carpool page (9.1)", () => {
  it("lists bookable posts with their days, time, price and the rider's cancellations, without a map", async () => {
    carpoolApi.searchCarpools.mockResolvedValue({ items: [post() as CarpoolPost], page: 1, hasMore: false });
    renderAt("/carpool");
    expect(await screen.findByText("Sun, Tue, Thu · 8:30 am", {}, LAZY)).toBeInTheDocument();
    expect(screen.getByText("From ৳1,800/month")).toBeInTheDocument();
    expect(screen.getByText("Rider cancelled 2 rides")).toBeInTheDocument();
    // A student who is not a rider sees Search and My bookings only
    expect(screen.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "My carpool posts" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-picker")).not.toBeInTheDocument();
  });
});

describe("a carpool post (9.3 step 1)", () => {
  it("sends a seat request with a duration and a start date", async () => {
    carpoolApi.getPost.mockResolvedValue({ post: post() });
    carpoolApi.requestSeat.mockResolvedValue({ booking: booking({ status: "OPEN", holdExpiresAt: null }) });
    carpoolApi.getBooking.mockResolvedValue({ booking: booking({ status: "OPEN", holdExpiresAt: null }) });
    const router = renderAt("/carpool/posts/p1");
    expect(await screen.findByText("Until 9 December 2026 · 13 rides · ৳2,000 in all", {}, LAZY)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(carpoolApi.requestSeat).toHaveBeenCalledWith("p1", 1, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)));
    await waitFor(() => expect(router.state.location.pathname).toBe("/carpool/bookings/b1"));
  });

  it("shows the rider's pending requests with Accept, and names the clashing days of a conflict", async () => {
    signIn({ id: "rider", isVerifiedRider: true });
    riderApi.getRiderOverview.mockResolvedValue({ riderActive: true, activeBlocker: null, vehicles: [] });
    const pending = { ...booking({ status: "OPEN", holdExpiresAt: null, role: "RIDER" }) };
    carpoolApi.getPost.mockResolvedValue({ post: post({ mine: true, bookings: [pending] }) });
    carpoolApi.acceptBooking.mockRejectedValue(
      new ApiError(409, { code: "TIME_CONFLICT", message: "Conflict", dates: ["2026-11-12", "2026-11-17"] }),
    );
    renderAt("/carpool/posts/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }, LAZY));
    expect(await screen.findByText("You or the other person already has an activity within 90 minutes on: 12 November 2026, 17 November 2026")).toBeInTheDocument();
  });
});

describe("a held seat (9.3 step 4)", () => {
  it("shows whose turn it is and lets the passenger agree", async () => {
    carpoolApi.getBooking.mockResolvedValue({ booking: booking() });
    carpoolApi.agreeBooking.mockResolvedValue({ booking: booking({ subStatus: "CONTRACT_ACTIVE", agreed: { me: true, other: true } }) });
    renderAt("/carpool/bookings/b1");
    expect(await screen.findByText(/The other person agreed\. Your turn/, {}, LAZY)).toBeInTheDocument();
    expect(screen.getByText("Seat held")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Agree" }));
    expect(carpoolApi.agreeBooking).toHaveBeenCalledWith("b1");
  });

  it("lists the sessions of an active contract", async () => {
    carpoolApi.getBooking.mockResolvedValue({
      booking: booking({
        subStatus: "CONTRACT_ACTIVE",
        holdExpiresAt: null,
        agreed: { me: true, other: true },
        contract: { id: "k1", startDate: "2026-11-10", endDate: "2026-12-09", status: "ACTIVE" },
        sessions: [
          { activityId: "s1", date: "2026-11-10", startTime: "2026-11-10T02:30:00.000Z", status: "ACCEPTED", cancelledBy: null },
          { activityId: "s2", date: "2026-11-12", startTime: "2026-11-12T02:30:00.000Z", status: "ACCEPTED", cancelledBy: null },
        ],
      }),
    });
    renderAt("/carpool/bookings/b1");
    expect(await screen.findByText("Contract active", {}, LAZY)).toBeInTheDocument();
    expect(screen.getByText("2 rides")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree" })).not.toBeInTheDocument();
  });
});

describe("a running contract (B6b)", () => {
  const running = (overrides: Partial<CarpoolBooking> = {}) =>
    booking({
      subStatus: "CONTRACT_ACTIVE",
      holdExpiresAt: null,
      agreed: { me: true, other: true },
      contract: { id: "k1", startDate: "2026-11-10", endDate: "2026-12-09", status: "ACTIVE", termination: null },
      payments: [
        { id: "m1", monthNumber: 1, periodStart: "2026-11-10", periodEnd: "2026-12-09", amount: 2000, method: null, status: "UNPAID", paidAt: null },
      ],
      history: [{ monthNumber: 1, periodStart: "2026-11-10", periodEnd: "2026-12-09", total: 13, completed: 2, notMarked: 0, cancelledByMe: 1, cancelledByOther: 0, closed: 0 }],
      ...overrides,
    });

  it("shows the monthly payment and history; the passenger picks the method but cannot mark it paid", async () => {
    carpoolApi.getBooking.mockResolvedValue({ booking: running() });
    carpoolApi.setPaymentMethod.mockResolvedValue({ payment: {} });
    renderAt("/carpool/bookings/b1");
    expect(await screen.findByText("Monthly payments", {}, LAZY)).toBeInTheDocument();
    expect(screen.getByText(/2 completed · 0 not marked · 1 cancelled by you/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark paid" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "How it is paid" }), "BKASH");
    expect(carpoolApi.setPaymentMethod).toHaveBeenCalledWith("m1", "BKASH");
  });

  it("lets the rider mark a month paid once a method is chosen", async () => {
    carpoolApi.getBooking.mockResolvedValue({
      booking: running({
        role: "RIDER",
        payments: [{ id: "m1", monthNumber: 1, periodStart: "2026-11-10", periodEnd: "2026-12-09", amount: 2000, method: "CASH", status: "UNPAID", paidAt: null }],
      }),
    });
    carpoolApi.markPaymentPaid.mockResolvedValue({ payment: {} });
    renderAt("/carpool/bookings/b1");
    await userEvent.click(await screen.findByRole("button", { name: "Mark paid" }, LAZY));
    expect(carpoolApi.markPaymentPaid).toHaveBeenCalledWith("m1");
  });

  it("answers the other person's request to end early", async () => {
    carpoolApi.getBooking.mockResolvedValue({
      booking: running({ contract: { id: "k1", startDate: "2026-11-10", endDate: "2026-12-09", status: "ACTIVE", termination: { requestedBy: "OTHER", reason: "Moving away", requestedAt: null } } }),
    });
    carpoolApi.answerTermination.mockResolvedValue({ booking: running() });
    renderAt("/carpool/bookings/b1");
    expect(await screen.findByText(/asked to end this contract early: Moving away/, {}, LAZY)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Agree to end" }));
    expect(carpoolApi.answerTermination).toHaveBeenCalledWith("b1", true);
  });

  it("offers Renew to the passenger after a normal end", async () => {
    carpoolApi.getBooking.mockResolvedValue({
      booking: running({
        status: "COMPLETED",
        subStatus: "CONTRACT_ACTIVE",
        contract: { id: "k1", startDate: "2026-11-10", endDate: "2026-12-09", status: "ENDED", termination: null },
        renewal: { available: true, postId: "p1", startDate: "2026-12-10", until: "2026-12-17T18:00:00.000Z" },
      }),
    });
    carpoolApi.renewContract.mockResolvedValue({ booking: booking({ activityId: "b2", status: "OPEN" }) });
    renderAt("/carpool/bookings/b1");
    await userEvent.click(await screen.findByRole("button", { name: "Request renewal" }, LAZY));
    expect(carpoolApi.renewContract).toHaveBeenCalledWith("b1", 1);
  });
});
