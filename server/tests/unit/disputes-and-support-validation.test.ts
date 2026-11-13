import { describe, expect, it } from "vitest";
import { createDisputeSchema, resolveDisputeSchema } from "../../src/modules/disputes/disputes.validation.js";
import { adminReplySupportSchema, createSupportSchema } from "../../src/modules/support/support.validation.js";

describe("Disputes validation (B7)", () => {
  it("accepts a valid dispute creation input", () => {
    const valid = {
      activityId: "act-123",
      kind: "COMPLAINT",
      reason: "Item was not delivered",
      description: "I waited for 45 minutes and the accepter never showed up at the location.",
      evidenceKeys: ["evidence-1.jpg"],
    };
    const parsed = createDisputeSchema.parse(valid);
    expect(parsed.kind).toBe("COMPLAINT");
    expect(parsed.reason).toBe("Item was not delivered");
  });

  it("refuses too short reason or description", () => {
    expect(() =>
      createDisputeSchema.parse({
        activityId: "act-123",
        reason: "ab", // min 3
        description: "short", // min 10
      }),
    ).toThrow();
  });

  it("enforces max evidence files limit", () => {
    expect(() =>
      createDisputeSchema.parse({
        activityId: "act-123",
        reason: "Valid reason here",
        description: "Valid description text with enough characters.",
        evidenceKeys: ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg"], // max 5
      }),
    ).toThrow();
  });

  it("validates dispute resolution decisions", () => {
    const valid = {
      decision: "RESOLVE_COMPLETED",
      decisionNote: "Reviewed chat history and logs. Verified completion.",
    };
    const parsed = resolveDisputeSchema.parse(valid);
    expect(parsed.decision).toBe("RESOLVE_COMPLETED");

    expect(() =>
      resolveDisputeSchema.parse({
        decision: "INVALID_DECISION",
        decisionNote: "Note",
      }),
    ).toThrow();
  });
});

describe("Support requests validation (B7)", () => {
  it("accepts a valid support request with category and message", () => {
    const valid = {
      category: "APP_FEEDBACK",
      message: "The new UI is super fast and clean! Great experience.",
      rating: 5,
    };
    const parsed = createSupportSchema.parse(valid);
    expect(parsed.category).toBe("APP_FEEDBACK");
    expect(parsed.rating).toBe(5);
  });

  it("refuses message shorter than minimum length", () => {
    expect(() =>
      createSupportSchema.parse({
        category: "TECHNICAL",
        message: "bad", // min 5
      }),
    ).toThrow();
  });

  it("validates admin support reply schema", () => {
    const valid = {
      reply: "Thank you for reporting. This has been resolved in the latest update.",
      status: "RESOLVED",
    };
    const parsed = adminReplySupportSchema.parse(valid);
    expect(parsed.status).toBe("RESOLVED");

    expect(() =>
      adminReplySupportSchema.parse({
        reply: " ", // empty
      }),
    ).toThrow();
  });
});

