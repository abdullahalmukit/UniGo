import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { ServiceCardItem } from "./service-api";
import { categoryLabel, categorySafetyWarning, ServiceAmount, ServiceCard } from "./ServiceCard";

const sampleServiceItem: ServiceCardItem = {
  id: "srv-1",
  status: "OPEN",
  startTime: "2026-11-15T14:30:00.000Z",
  preferredDate: "2026-11-15",
  hasPreferredTime: true,
  category: { id: "cat-1", code: "SHOPPING_PURCHASING" },
  serviceTitle: "Grocery Run",
  taskTitle: "Buy groceries from Meena Bazar",
  description: "Need fresh eggs and bread for breakfast.",
  destination: { address: "Shahidullah Hall, DU", lat: 23.73, lng: 90.39 },
  pickup: { address: "Meena Bazar, Shantinagar", lat: 23.74, lng: 90.41 },
  subArea: { id: "sub-1", name: "Campus Area" },
  offeredAmount: 150,
  estimatedBudget: 400,
  itemDetails: "1 dozen eggs, 1 brown bread",
  quantity: 2,
  requester: {
    id: "user-1",
    name: "Tanvir Hasan",
    photo: null,
    university: { name: "University of Dhaka", shortName: "DU" },
    department: "Physics",
    isVerifiedRider: false,
    rating: 4.9,
    ratingCount: 8,
    completionRate: 98,
    badges: ["VERIFIED_STUDENT"],
  },
  mine: false,
  createdAt: "2026-11-10T10:00:00.000Z",
};

describe("Uni Service UI Components", () => {
  it("renders ServiceCard with details, route and amount", () => {
    render(
      <MemoryRouter>
        <ServiceCard item={sampleServiceItem} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Grocery Run: Buy groceries from Meena Bazar/i)).toBeInTheDocument();
    expect(screen.getByText(/Need fresh eggs and bread/i)).toBeInTheDocument();
    expect(screen.getByText("Shahidullah Hall, DU")).toBeInTheDocument();
    expect(screen.getByText("Tanvir Hasan")).toBeInTheDocument();
    expect(screen.getByText("Campus Area")).toBeInTheDocument();
  });

  it("categorySafetyWarning gives safety alert for pharmacy and financial categories", () => {
    const fakeT = (k: string) => k;

    const pharmacyWarning = categorySafetyWarning("PHARMACY_HEALTHCARE", fakeT);
    expect(pharmacyWarning).not.toBeNull();
    expect(pharmacyWarning?.message).toBe("service.safety.pharmacyWarning");

    const financialWarning = categorySafetyWarning("FINANCIAL_ADMINISTRATIVE", fakeT);
    expect(financialWarning).not.toBeNull();
    expect(financialWarning?.message).toBe("service.safety.financialWarning");

    const shoppingWarning = categorySafetyWarning("SHOPPING_PURCHASING", fakeT);
    expect(shoppingWarning).toBeNull();
  });

  it("ServiceAmount renders offered amount with or without budget", () => {
    const { rerender } = render(<ServiceAmount offered={120} budget={null} />);
    expect(screen.getByText(/৳120/)).toBeInTheDocument();

    rerender(<ServiceAmount offered={120} budget={350} />);
    expect(screen.getByText(/৳120/)).toBeInTheDocument();
    expect(screen.getByText(/350/)).toBeInTheDocument();
  });
});

