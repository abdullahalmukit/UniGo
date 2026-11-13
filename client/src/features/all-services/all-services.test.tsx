import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AllServicesPage } from "./AllServicesPage";
import * as api from "./all-services-api";

vi.mock("./all-services-api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    listAllRequests: vi.fn(),
  };
});

const sampleItems: api.ServiceRequestCardItem[] = [
  {
    id: "r1",
    activityId: "r1",
    feature: "ride",
    kind: "RIDE_REQUEST",
    status: "OPEN",
    title: "Dhanmondi → TSC",
    creator: {
      id: "u1",
      name: "Sakib Ahmed",
      photo: null,
      university: { name: "Dhaka University", shortName: "DU" },
      department: "CSE",
      isVerifiedRider: true,
      rating: 4.8,
      ratingCount: 12,
      completionRate: 95,
      badges: ["VERIFIED_STUDENT", "TOP_RATED"],
    },
    pickup: { address: "Dhanmondi 27, Dhaka", lat: 23.75, lng: 90.37 },
    destination: { address: "TSC, Dhaka University", lat: 23.73, lng: 90.39 },
    time: "2026-11-10T14:30:00.000Z",
    amount: 120,
    amountLabel: "Offered Fare",
    subArea: { id: "s1", name: "Dhanmondi" },
    mine: false,
    details: { passengerCount: 1, notes: "Please arrive on time" },
    link: "/ride/requests/r1",
    createdAt: "2026-11-10T10:00:00.000Z",
  },
  {
    id: "f1",
    activityId: "f1",
    feature: "food",
    kind: "FOOD",
    status: "OPEN",
    title: "KFC → Curzon Hall",
    creator: {
      id: "u2",
      name: "Nadia Islam",
      photo: null,
      university: { name: "Dhaka University", shortName: "DU" },
      department: "Pharmacy",
      isVerifiedRider: false,
      rating: 5.0,
      ratingCount: 6,
      completionRate: 100,
      badges: ["VERIFIED_STUDENT"],
    },
    pickup: { address: "KFC Nilkhet", lat: 23.73, lng: 90.38 },
    destination: { address: "Curzon Hall", lat: 23.72, lng: 90.4 },
    time: "2026-11-10T15:00:00.000Z",
    amount: 350,
    amountLabel: "Estimated Budget",
    subArea: null,
    mine: false,
    details: { restaurantName: "KFC", items: "1x Zinger Burger, 1x Fries" },
    link: "/food/requests/f1",
    createdAt: "2026-11-10T10:30:00.000Z",
  },
];

describe("All Services Page - Requests Feed (feature/all-service-requests)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAllRequests).mockResolvedValue({
      items: sampleItems,
      total: 2,
      page: 1,
      hasMore: false,
    });
  });

  it("renders the 4 service tiles and the unified request feed", async () => {
    render(
      <MemoryRouter>
        <AllServicesPage />
      </MemoryRouter>,
    );

    // 4 service tiles
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();

    // Requests section heading
    await waitFor(() => {
      expect(screen.getByText("Dhanmondi 27, Dhaka")).toBeInTheDocument();
      expect(screen.getByText("KFC (KFC Nilkhet)")).toBeInTheDocument();
    });

    // Requester info and amount
    expect(screen.getByText("Sakib Ahmed")).toBeInTheDocument();
    expect(screen.getByText("Nadia Islam")).toBeInTheDocument();
    expect(screen.getByText("৳ 120")).toBeInTheDocument();
    expect(screen.getByText("৳ 350")).toBeInTheDocument();
  });

  it("filters requests when a feature chip is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AllServicesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.listAllRequests).toHaveBeenCalled();
    });

    // Click on Food filter chip
    const foodChip = screen.getByRole("button", { name: /food delivery/i });
    await user.click(foodChip);

    await waitFor(() => {
      expect(api.listAllRequests).toHaveBeenCalledWith(
        expect.objectContaining({ feature: "food" }),
      );
    });
  });

  it("sends search term to API when typing in search input", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AllServicesPage />
      </MemoryRouter>,
    );

    const searchInput = screen.getByPlaceholderText(/search requests/i);
    await user.type(searchInput, "Dhanmondi");

    await waitFor(() => {
      expect(api.listAllRequests).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Dhanmondi" }),
      );
    });
  });
});
