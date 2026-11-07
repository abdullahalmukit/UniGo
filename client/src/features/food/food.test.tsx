import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ToastProvider } from "../../components/toast";
import type { SessionState } from "../../lib/session";
import type { FoodRequest } from "./food-api";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() },
}));
vi.mock("../../components/MapPicker", () => ({ MapPicker: () => <div data-testid="map-picker" /> }));

const foodApi = vi.hoisted(() => ({
  listFood: vi.fn(),
  getFoodConfig: vi.fn(),
  getFood: vi.fn(),
  acceptFood: vi.fn(),
  confirmOrder: vi.fn(),
  decideApproval: vi.fn(),
}));
vi.mock("./food-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./food-api")>()), ...foodApi }));

const extrasApi = vi.hoisted(() => ({ getPayment: vi.fn() }));
vi.mock("../activity/extras-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../activity/extras-api")>()), ...extrasApi }));

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
const restaurant = { address: "Star Kabab, Dhanmondi", lat: 23.74, lng: 90.37 };
const hall = { address: "Shahidullah Hall", lat: 23.72, lng: 90.39 };

function food(overrides: Partial<FoodRequest> = {}): FoodRequest {
  return {
    id: "f1",
    status: "OPEN",
    subStatus: null,
    expectedDeliveryTime: "2026-11-08T08:00:00.000Z",
    restaurantName: "Star Kabab",
    restaurant,
    items: "2 chicken biryani",
    details: "Less spicy",
    quantity: 2,
    estimatedBudget: 600,
    pickup: restaurant,
    delivery: hall,
    deliveryCharge: 60,
    subArea: { id: "s1", name: "Dhanmondi" },
    requester: person("req", "Rina Akter"),
    accepter: null,
    chatId: null,
    mine: false,
    role: null,
    completionRequestedBy: null,
    isLateCancellation: false,
    cancelledBy: null,
    order: null,
    approvals: [],
    receipts: [],
    createdAt: "2026-11-07T06:00:00.000Z",
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
  foodApi.getFoodConfig.mockResolvedValue({
    budget: { min: 10, max: 5000 },
    deliveryCharge: { min: 10, max: 1000 },
    quantity: { min: 1, max: 20 },
    restaurantNameMaxLength: 150,
    itemsMaxLength: 1000,
    detailsMaxLength: 1000,
    searchRadiusKm: [1, 2, 5],
    defaultSearchRadiusKm: 2,
    earliestFromNowMinutes: 15,
    latestFromNowHours: 24,
    paymentMethods: ["CASH", "BKASH", "NAGAD"],
  });
  extrasApi.getPayment.mockResolvedValue({
    amount: 640,
    foodCost: 580,
    deliveryCharge: 60,
    method: "BKASH",
    status: "UNPAID",
    paidAt: null,
    payee: "OTHER",
    canChooseMethod: false,
    canMarkPaid: false,
  });
});

describe("the Food page (10.1)", () => {
  it("lists open requests without a map", async () => {
    foodApi.listFood.mockResolvedValue({ items: [food()], page: 1, hasMore: false });
    renderAt("/food");
    expect(await screen.findByText("Star Kabab", {}, LAZY)).toBeInTheDocument();
    expect(screen.getByText("৳600 + ৳60 delivery")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All Available" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "My Orders" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Accepted Orders" })).toBeInTheDocument();
    expect(screen.queryByTestId("map-picker")).not.toBeInTheDocument();
  });

  it("asks unverified students to verify first", async () => {
    signIn({ studentVerificationStatus: "UNVERIFIED" });
    renderAt("/food");
    expect(await screen.findByText("Verify your student status to use Food Delivery.", {}, LAZY)).toBeInTheDocument();
    expect(foodApi.listFood).not.toHaveBeenCalled();
  });
});

describe("a food request", () => {
  it("lets another student accept an open request", async () => {
    foodApi.getFood.mockResolvedValue({ request: food() });
    foodApi.acceptFood.mockResolvedValue({ request: food({ status: "ACCEPTED", role: "ACCEPTER", chatId: "c1", accepter: person("me", "Me") }) });
    renderAt("/food/requests/f1");
    await userEvent.click(await screen.findByRole("button", { name: "Accept request" }, LAZY));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Accept request" }));
    await waitFor(() => expect(foodApi.acceptFood).toHaveBeenCalledWith("f1"));
    expect(await screen.findByText("Order details")).toBeInTheDocument();
  });

  it("asks the other side to confirm saved order details, naming the version", async () => {
    const order = {
      version: 2,
      items: "2 chicken biryani",
      foodPrice: 580,
      deliveryCharge: 60,
      paymentMethod: "BKASH" as const,
      updatedBy: "OTHER" as const,
      updatedAt: null,
      confirmedByMe: false,
      confirmedByOther: true,
    };
    foodApi.getFood.mockResolvedValue({ request: food({ status: "ACCEPTED", role: "REQUESTER", mine: true, chatId: "c1", order }) });
    foodApi.confirmOrder.mockResolvedValue({ request: food({ status: "ACCEPTED", subStatus: "ORDER_CONFIRMED", role: "REQUESTER", mine: true, order: { ...order, confirmedByMe: true } }) });
    renderAt("/food/requests/f1");
    expect(await screen.findByText("Needs your confirmation", {}, LAZY)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm order" }));
    await waitFor(() => expect(foodApi.confirmOrder).toHaveBeenCalledWith("f1", 2));
    expect(await screen.findByText("Confirmed by both")).toBeInTheDocument();
  });

  it("lets the requester decide a pending over-budget approval", async () => {
    const approval = { id: "a1", amount: 650, previousAmount: 580, status: "PENDING" as const, decidedAt: null, createdAt: "2026-11-08T06:00:00.000Z" };
    const order = { version: 1, items: "x", foodPrice: 580, deliveryCharge: 60, paymentMethod: "CASH" as const, updatedBy: "OTHER" as const, updatedAt: null, confirmedByMe: true, confirmedByOther: true };
    foodApi.getFood.mockResolvedValue({ request: food({ status: "ACCEPTED", subStatus: "ORDER_CONFIRMED", role: "REQUESTER", mine: true, order, approvals: [approval] }) });
    foodApi.decideApproval.mockResolvedValue({ request: food({ status: "ACCEPTED", subStatus: "ORDER_CONFIRMED", role: "REQUESTER", mine: true, order, approvals: [{ ...approval, status: "APPROVED" }] }) });
    renderAt("/food/requests/f1");
    expect(await screen.findByText(/৳580 → ৳650/, {}, LAZY)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(foodApi.decideApproval).toHaveBeenCalledWith("f1", "a1", true));
    expect(await screen.findByText("Approved")).toBeInTheDocument();
  });

  it("offers Cancel to the requester before the receipt but not after it", async () => {
    foodApi.getFood.mockResolvedValue({ request: food({ status: "IN_PROGRESS", subStatus: "FOOD_COLLECTED", role: "REQUESTER", mine: true, chatId: "c1" }) });
    renderAt("/food/requests/f1");
    expect(await screen.findByText(/only the person bringing it can cancel/, {}, LAZY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delivered, mark completed" })).toBeInTheDocument();
  });

  it("lets the accepter cancel after the receipt", async () => {
    foodApi.getFood.mockResolvedValue({ request: food({ status: "IN_PROGRESS", subStatus: "FOOD_COLLECTED", role: "ACCEPTER", chatId: "c1", accepter: person("me", "Me") }) });
    renderAt("/food/requests/f1");
    expect(await screen.findByRole("button", { name: "Cancel order" }, LAZY)).toBeInTheDocument();
  });

  it("shows the food cost and the delivery charge separately in the payment card", async () => {
    foodApi.getFood.mockResolvedValue({ request: food({ status: "ACCEPTED", subStatus: "ORDER_CONFIRMED", role: "REQUESTER", mine: true }) });
    renderAt("/food/requests/f1");
    expect(await screen.findByText("Food ৳580 + delivery ৳60", {}, LAZY)).toBeInTheDocument();
  });
});
