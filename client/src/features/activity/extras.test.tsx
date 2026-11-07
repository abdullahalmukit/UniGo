import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../app/theme-provider";
import { ToastProvider } from "../../components/toast";
import { PersonRow } from "../ride/RideCard";
import type { MiniProfile } from "../ride/ride-api";
import { PaymentCard } from "./PaymentCard";
import { ReviewPanel } from "./ReviewPanel";

const extras = vi.hoisted(() => ({ getPayment: vi.fn(), setPaymentMethod: vi.fn(), markPaid: vi.fn(), getReviews: vi.fn(), submitReview: vi.fn() }));
vi.mock("./extras-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./extras-api")>()), ...extras }));

const wrap = (node: ReactNode) =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );

const payment = (overrides = {}) => ({ amount: 160, method: null, status: "UNPAID", paidAt: null, payee: "ME", canChooseMethod: true, canMarkPaid: false, ...overrides });

beforeEach(() => vi.clearAllMocks());

describe("payment record (proposal 16)", () => {
  it("lets the receiver choose a method and then mark it paid after confirming", async () => {
    extras.getPayment.mockResolvedValue(payment());
    extras.setPaymentMethod.mockResolvedValue(payment({ method: "BKASH", canMarkPaid: true }));
    extras.markPaid.mockResolvedValue(payment({ method: "BKASH", status: "PAID", canChooseMethod: false }));
    wrap(<PaymentCard activityId="a1" />);

    expect(await screen.findByText("Unpaid")).toBeInTheDocument();
    expect(screen.getByText(/you receive/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as paid" })).toBeDisabled();
    expect(screen.getByText("Choose how it was paid first.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "bKash" }));
    expect(extras.setPaymentMethod).toHaveBeenCalledWith("a1", "BKASH");
    await userEvent.click(await screen.findByRole("button", { name: "Mark as paid" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as paid" }));
    expect(extras.markPaid).toHaveBeenCalledWith("a1");
    expect(await screen.findByText("Paid")).toBeInTheDocument();
  });

  it("never offers Mark as paid to the person who pays", async () => {
    extras.getPayment.mockResolvedValue(payment({ payee: "OTHER", method: "CASH" }));
    wrap(<PaymentCard activityId="a1" />);
    expect(await screen.findByText(/you pay/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
  });
});

describe("blind reviews (proposal 15.1)", () => {
  it("sends stars and a comment, then waits for the other review", async () => {
    extras.getReviews.mockResolvedValue({ canReview: true, closesAt: "2026-11-14T08:00:00.000Z", mine: null, theirs: null, otherSubmitted: false });
    extras.submitReview.mockResolvedValue({
      canReview: false,
      closesAt: "2026-11-14T08:00:00.000Z",
      mine: { id: "r1", rating: 4, comment: "Good ride", activityType: "RIDE_REQUEST", reviewer: { id: "me", name: "Me", photo: null }, publishedAt: null, createdAt: "2026-11-07T08:00:00.000Z" },
      theirs: null,
      otherSubmitted: false,
    });
    wrap(<ReviewPanel activityId="a1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Send review" }));
    expect(screen.getByText("Choose from 1 to 5 stars.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    await userEvent.type(screen.getByLabelText("Comment (optional)"), "Good ride");
    await userEvent.click(screen.getByRole("button", { name: "Send review" }));
    expect(extras.submitReview).toHaveBeenCalledWith("a1", 4, "Good ride");
    expect(await screen.findByText("Your review")).toBeInTheDocument();
    expect(screen.getByText(/once both have reviewed/)).toBeInTheDocument();
  });
});

describe("mini profile stats (proposal 15.2)", () => {
  const person = (overrides: Partial<MiniProfile>): MiniProfile => ({
    id: "u1",
    name: "Karim",
    photo: null,
    university: null,
    department: null,
    isVerifiedRider: true,
    rating: null,
    ratingCount: 0,
    completionRate: null,
    badges: [],
    ...overrides,
  });

  it("shows New without enough history, and the rating, rate and earned badges with it", async () => {
    const { unmount } = wrap(<PersonRow person={person({})} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    unmount();

    wrap(<PersonRow person={person({ rating: 4.7, ratingCount: 12, completionRate: 0.95, badges: ["VERIFIED_STUDENT", "VERIFIED_RIDER", "TOP_RATED", "RELIABLE"] })} />);
    await waitFor(() => expect(screen.getByText("4.7 (12 reviews)")).toBeInTheDocument());
    expect(screen.getByText("95% completed")).toBeInTheDocument();
    expect(screen.getByText("Top Rated")).toBeInTheDocument();
    expect(screen.getByText("Reliable")).toBeInTheDocument();
  });
});
