import { describe, expect, it } from "vitest";
import { createServiceSchema, editServiceSchema, listServicesQuery } from "../../src/modules/service/service.validation.js";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("Uni Service Validation", () => {
  const baseValid = {
    categoryId: VALID_UUID,
    serviceTitle: "Grocery Shopping",
    taskTitle: "Buy snacks from Agora",
    description: "Please buy some snacks and drinks for group study session.",
    destination: {
      address: "Hall 3, Dhaka University",
      lat: 23.73,
      lng: 90.39,
    },
    preferredDate: "2026-11-15",
    offeredAmount: 150,
  };

  it("accepts valid input with required fields only", () => {
    const parsed = createServiceSchema.parse(baseValid);
    expect(parsed.serviceTitle).toBe("Grocery Shopping");
    expect(parsed.offeredAmount).toBe(150);
    expect(parsed.preferredTime).toBeUndefined();
  });

  it("accepts optional fields (preferredTime, budget, pickup, itemDetails, quantity, instructions)", () => {
    const full = {
      ...baseValid,
      preferredTime: "14:30",
      pickup: {
        address: "Agora Superstore, Dhanmondi",
        lat: 23.74,
        lng: 90.38,
      },
      estimatedBudget: 500,
      itemDetails: "2 packs chips, 1 juice box",
      quantity: 3,
      instructions: "Call when you reach the gate",
      subAreaId: VALID_UUID,
    };
    const parsed = createServiceSchema.parse(full);
    expect(parsed.preferredTime).toBe("14:30");
    expect(parsed.estimatedBudget).toBe(500);
    expect(parsed.quantity).toBe(3);
  });

  it("rejects amount below minimum or above maximum", () => {
    expect(() =>
      createServiceSchema.parse({
        ...baseValid,
        offeredAmount: 5, // minimum is 10
      }),
    ).toThrow();

    expect(() =>
      createServiceSchema.parse({
        ...baseValid,
        offeredAmount: 20000, // maximum is 10000
      }),
    ).toThrow();
  });

  it("rejects invalid time format", () => {
    expect(() =>
      createServiceSchema.parse({
        ...baseValid,
        preferredTime: "25:00",
      }),
    ).toThrow();

    expect(() =>
      createServiceSchema.parse({
        ...baseValid,
        preferredTime: "2pm",
      }),
    ).toThrow();
  });

  it("editServiceSchema allows partial fields", () => {
    const edit = editServiceSchema.parse({
      offeredAmount: 200,
      taskTitle: "Updated task title",
    });
    expect(edit.offeredAmount).toBe(200);
    expect(edit.taskTitle).toBe("Updated task title");
    expect(edit.serviceTitle).toBeUndefined();
  });

  it("listServicesQuery parses defaults correctly", () => {
    const query = listServicesQuery.parse({});
    expect(query.page).toBe(1);
    expect(query.radiusKm).toBeDefined();
  });
});

