import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import type { SessionState } from "../../lib/session";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn() },
}));
vi.mock("../verification/verification-api", () => ({ getStudentVerification: vi.fn().mockResolvedValue({ status: "VERIFIED" }) }));

const ridesApi = vi.hoisted(() => ({ list: vi.fn(), activity: vi.fn(), offer: vi.fn(), cancelActivity: vi.fn(), cancelOffer: vi.fn(), hideReview: vi.fn() }));
vi.mock("./admin-rides-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./admin-rides-api")>()), adminRidesApi: ridesApi }));

const LAZY = { timeout: 5000 };
const person = (id: string, name: string) => ({ id, name, email: `${id}@example.test`, phone: "+8801711000000" });

function renderAt(path: string, role = "MODERATOR") {
  state.current = { status: "authenticated", session: { accessToken: "t", expiresAt: Date.now() + 60_000, user: { id: "me", role } } } as SessionState;
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => vi.clearAllMocks());

describe("admin Ride Sharing (proposal 17)", () => {
  it("lists rides for a Moderator and filters by kind", async () => {
    ridesApi.list.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ kind: "REQUEST", id: "r1", status: "ACCEPTED", time: "2026-11-08T08:20:00.000Z", pickup: "Campus", destination: "Farmgate", amount: 150, seats: null, bookings: null, creator: person("p1", "Rina"), accepter: person("d1", "Karim") }],
    });
    renderAt("/admin/rides");
    expect(await screen.findByRole("link", { name: /Campus → Farmgate/ }, LAZY)).toHaveAttribute("href", "/admin/rides/activities/r1");
    expect(screen.getAllByRole("link", { name: "Ride Sharing" }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("tab", { name: "Offers" }));
    await waitFor(() => expect(ridesApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "offers", page: 1 })));
  });

  it("shows the status history and cancels with a reason", async () => {
    ridesApi.activity.mockResolvedValue({
      kind: "REQUEST",
      id: "r1",
      status: "ACCEPTED",
      subStatus: "RIDE_CONFIRMED",
      startTime: "2026-11-08T08:20:00.000Z",
      acceptedAt: null,
      completedAt: null,
      cancelledAt: null,
      isLateCancellation: false,
      closureReason: null,
      deletedAt: null,
      createdAt: "2026-11-07T08:20:00.000Z",
      creator: person("p1", "Rina"),
      accepter: person("d1", "Karim"),
      cancelledBy: null,
      rideRequest: { pickupAddress: "Campus", destinationAddress: "Farmgate", offeredAmount: 150, passengerCount: 1, notes: null, subArea: null, vehicle: { id: "v1", type: "CAR", brand: "Toyota", model: "Axio", colour: "White", registrationNumber: "Dhaka Metro-GA 11-1234", seatCapacity: 4 } },
      rideBooking: null,
      history: [
        { id: "h1", fromStatus: null, toStatus: "OPEN", fromSubStatus: null, toSubStatus: null, actorType: "USER", reason: null, createdAt: "2026-11-07T08:20:00.000Z", actor: { id: "p1", name: "Rina" } },
        { id: "h2", fromStatus: "OPEN", toStatus: "ACCEPTED", fromSubStatus: null, toSubStatus: "RIDE_CONFIRMED", actorType: "USER", reason: null, createdAt: "2026-11-07T09:20:00.000Z", actor: { id: "d1", name: "Karim" } },
      ],
      payment: { amount: 150, method: null, status: "UNPAID", paidAt: null, payeeId: "d1" },
      reviews: [],
    });
    ridesApi.cancelActivity.mockResolvedValue({});
    renderAt("/admin/rides/activities/r1");

    expect(await screen.findByText("Status history", {}, LAZY)).toBeInTheDocument();
    expect(screen.getByText(/Dhaka Metro-GA 11-1234/)).toBeInTheDocument();
    expect(screen.getByText("Open → Accepted (RIDE_CONFIRMED)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel ride" }));
    const sheet = screen.getByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Reason"), "Reported as unsafe");
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel ride" }));
    expect(ridesApi.cancelActivity).toHaveBeenCalledWith("r1", "Reported as unsafe");
  });

  it("is not open to normal users", async () => {
    renderAt("/admin/rides", "USER");
    expect(await screen.findByText("You are not allowed to open this page.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(ridesApi.list).not.toHaveBeenCalled();
  });
});
