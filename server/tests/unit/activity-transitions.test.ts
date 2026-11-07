import { describe, expect, it } from "vitest";
import type { ActivityStatus, ActivitySubStatus, ActivityType } from "../../src/generated/prisma/client.js";
import {
  ALL_ACTIVITY_TYPES,
  TRANSITIONS,
  checkTransition,
  findRule,
  matchesFrom,
  type ActivityAction,
  type ActorRef,
  type Performer,
  type TransitionSubject,
} from "../../src/modules/activities/transitions.js";

const STATUSES: ActivityStatus[] = ["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"];
const TERMINAL: ActivityStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"];
const SUBS: (ActivitySubStatus | null)[] = [
  null,
  "RIDE_CONFIRMED",
  "CONTRACT_ACTIVE",
  "ORDER_CONFIRMED",
  "FOOD_COLLECTED",
  "SERVICE_DELIVERED",
  "COMPLETION_REQUESTED",
];
const ACTIONS = [...new Set(TRANSITIONS.map((rule) => rule.action))];

const CREATOR = "creator";
const ACCEPTER = "accepter";

function subject(type: ActivityType, status: ActivityStatus, subStatus: ActivitySubStatus | null): TransitionSubject {
  return { type, status, subStatus, creatorId: CREATOR, accepterId: ACCEPTER, completionRequestedById: CREATOR };
}

const user = (id: string): ActorRef => ({ type: "USER", id });

// An actor the rule allows, so only the state decides.
function allowedActor(performer: Performer): ActorRef {
  switch (performer) {
    case "CREATOR":
    case "EITHER":
      return user(CREATOR);
    case "ACCEPTER":
    case "OTHER_PARTICIPANT":
      return user(ACCEPTER);
    case "NON_CREATOR":
      return user("someone-else");
    case "SYSTEM":
      return { type: "SYSTEM" };
    case "ADMIN":
      return { type: "ADMIN", id: "admin" };
  }
}

function errorCode(fn: () => unknown) {
  try {
    fn();
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("transition table", () => {
  // B4: an action may have several rules for one feature (food CANCEL before
  // and after the receipt), but never two from the same state.
  it("has at most one rule per feature, action and starting state", () => {
    for (const type of ALL_ACTIVITY_TYPES) {
      for (const action of ACTIONS) {
        const rules = TRANSITIONS.filter((rule) => rule.action === action && rule.types.includes(type));
        for (const status of STATUSES) {
          for (const subStatus of SUBS) {
            expect(rules.filter((rule) => matchesFrom(rule, status, subStatus)).length, `${type} ${action} ${status}/${subStatus}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("never leaves a terminal status", () => {
    for (const rule of TRANSITIONS) {
      for (const from of rule.from) expect(TERMINAL, `${rule.action}`).not.toContain(from.status);
    }
  });

  it("allows every action only from its listed states and refuses every other state", () => {
    let checked = 0;
    for (const type of ALL_ACTIVITY_TYPES) {
      for (const action of ACTIONS) {
        for (const status of STATUSES) {
          for (const subStatus of SUBS) {
            const rule = findRule(type, action, { status, subStatus });
            const activity = subject(type, status, subStatus);
            checked += 1;
            if (!rule) {
              expect(errorCode(() => checkTransition(activity, action, user(CREATOR)))).toBe("INVALID_TRANSITION");
              continue;
            }
            const expected = matchesFrom(rule, status, subStatus) ? "OK" : "INVALID_TRANSITION";
            expect(errorCode(() => checkTransition(activity, action, allowedActor(rule.by[0]))), `${type} ${action} ${status}/${subStatus}`).toBe(expected);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("refuses a user who is not a participant", () => {
    const ride = subject("RIDE_REQUEST", "ACCEPTED", "RIDE_CONFIRMED");
    expect(errorCode(() => checkTransition(ride, "START", user("stranger")))).toBe("NOT_PARTICIPANT");
    expect(errorCode(() => checkTransition(ride, "CANCEL", user("stranger")))).toBe("NOT_PARTICIPANT");
  });

  it("refuses system and admin steps to users, and user steps to the system", () => {
    expect(errorCode(() => checkTransition(subject("FOOD", "OPEN", null), "EXPIRE", user(CREATOR)))).toBe("ACTION_NOT_ALLOWED");
    expect(errorCode(() => checkTransition(subject("FOOD", "DISPUTED", null), "RESOLVE_COMPLETED", user(CREATOR)))).toBe("ACTION_NOT_ALLOWED");
    expect(errorCode(() => checkTransition(subject("FOOD", "ACCEPTED", null), "CANCEL", { type: "SYSTEM" }))).toBe("ACTION_NOT_ALLOWED");
  });
});

describe("per-feature permissions (B2a decision 4)", () => {
  it("lets either ride participant start a ride", () => {
    for (const type of ["RIDE_REQUEST", "RIDE_BOOKING"] as const) {
      const ride = subject(type, "ACCEPTED", "RIDE_CONFIRMED");
      expect(errorCode(() => checkTransition(ride, "START", user(CREATOR)))).toBe("OK");
      expect(errorCode(() => checkTransition(ride, "START", user(ACCEPTER)))).toBe("OK");
    }
  });

  it("lets only the accepter start a service", () => {
    const service = subject("SERVICE", "ACCEPTED", null);
    expect(errorCode(() => checkTransition(service, "START", user(ACCEPTER)))).toBe("OK");
    expect(errorCode(() => checkTransition(service, "START", user(CREATOR)))).toBe("ACTION_NOT_ALLOWED");
  });

  it("has no Start for food: only the accepter's receipt step reaches IN_PROGRESS", () => {
    expect(errorCode(() => checkTransition(subject("FOOD", "ACCEPTED", "ORDER_CONFIRMED"), "START", user(ACCEPTER)))).toBe("INVALID_TRANSITION");
    const ruleToInProgress = TRANSITIONS.filter(
      (rule) => rule.types.includes("FOOD") && rule.to.status === "IN_PROGRESS" && rule.from.some((from) => from.status !== "IN_PROGRESS"),
    );
    expect(ruleToInProgress.map((rule) => rule.action)).toEqual(["COLLECT_FOOD"]);
    expect(ruleToInProgress[0].by).toEqual(["ACCEPTER"]);
    expect(errorCode(() => checkTransition(subject("FOOD", "ACCEPTED", "ORDER_CONFIRMED"), "COLLECT_FOOD", user(CREATOR)))).toBe("ACTION_NOT_ALLOWED");
    // The order must be confirmed first
    expect(errorCode(() => checkTransition(subject("FOOD", "ACCEPTED", null), "COLLECT_FOOD", user(ACCEPTER)))).toBe("INVALID_TRANSITION");
  });

  it("reopens confirmed food order details on a change, by either participant (B4)", () => {
    const confirmed = subject("FOOD", "ACCEPTED", "ORDER_CONFIRMED");
    expect(errorCode(() => checkTransition(confirmed, "REOPEN_ORDER", user(CREATOR)))).toBe("OK");
    expect(errorCode(() => checkTransition(confirmed, "REOPEN_ORDER", user(ACCEPTER)))).toBe("OK");
    expect(findRule("FOOD", "REOPEN_ORDER")!.to).toEqual({ status: "ACCEPTED", subStatus: null });
    // Not after the receipt
    expect(errorCode(() => checkTransition(subject("FOOD", "IN_PROGRESS", "FOOD_COLLECTED"), "REOPEN_ORDER", user(CREATOR)))).toBe("INVALID_TRANSITION");
  });

  it("lets either side cancel food before the receipt and only the accepter after it (B4)", () => {
    for (const sub of [null, "ORDER_CONFIRMED"] as const) {
      const accepted = subject("FOOD", "ACCEPTED", sub);
      expect(errorCode(() => checkTransition(accepted, "CANCEL", user(CREATOR)))).toBe("OK");
      expect(errorCode(() => checkTransition(accepted, "CANCEL", user(ACCEPTER)))).toBe("OK");
    }
    const collected = subject("FOOD", "IN_PROGRESS", "FOOD_COLLECTED");
    expect(errorCode(() => checkTransition(collected, "CANCEL", user(CREATOR)))).toBe("ACTION_NOT_ALLOWED");
    expect(errorCode(() => checkTransition(collected, "CANCEL", user(ACCEPTER)))).toBe("OK");
    expect(findRule("FOOD", "CANCEL", collected)!.reasonRequired).toBe(true);
    // Other features keep cancelling by either side while in progress
    expect(errorCode(() => checkTransition(subject("SERVICE", "IN_PROGRESS", null), "CANCEL", user(CREATOR)))).toBe("OK");
  });

  it("keeps the main status when only the sub-status changes", () => {
    const deliver = findRule("SERVICE", "DELIVER_SERVICE")!;
    expect(deliver.to).toEqual({ status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED" });
    expect(deliver.records).toEqual(["SERVICE_DELIVERED"]);
    expect(findRule("FOOD", "CONFIRM_ORDER")!.to).toEqual({ status: "ACCEPTED", subStatus: "ORDER_CONFIRMED" });
  });
});

describe("completion (CLAUDE.md 5.3)", () => {
  const requested = (type: ActivityType) => subject(type, "IN_PROGRESS", "COMPLETION_REQUESTED");

  it("is confirmed only by the other participant", () => {
    for (const type of ["RIDE_REQUEST", "RIDE_BOOKING", "FOOD", "SERVICE"] as const) {
      expect(errorCode(() => checkTransition(requested(type), "CONFIRM_COMPLETION", user(CREATOR)))).toBe("ACTION_NOT_ALLOWED");
      expect(errorCode(() => checkTransition(requested(type), "CONFIRM_COMPLETION", user(ACCEPTER)))).toBe("OK");
    }
  });

  it("needs the activity to be started first", () => {
    expect(errorCode(() => checkTransition(subject("RIDE_REQUEST", "ACCEPTED", "RIDE_CONFIRMED"), "REQUEST_COMPLETION", user(CREATOR)))).toBe(
      "INVALID_TRANSITION",
    );
  });

  it("cannot be cancelled while completion is requested, only confirmed or disputed", () => {
    expect(errorCode(() => checkTransition(requested("FOOD"), "CANCEL", user(ACCEPTER)))).toBe("INVALID_TRANSITION");
    expect(errorCode(() => checkTransition(requested("FOOD"), "DISPUTE", user(ACCEPTER)))).toBe("OK");
  });

  it("is one step for carpool sessions", () => {
    const session = subject("CARPOOL_SESSION", "ACCEPTED", null);
    expect(errorCode(() => checkTransition(session, "COMPLETE_SESSION", user(ACCEPTER)))).toBe("OK");
    expect(errorCode(() => checkTransition(session, "REQUEST_COMPLETION", user(ACCEPTER)))).toBe("INVALID_TRANSITION");
    expect(findRule("CARPOOL_SESSION", "COMPLETE_SESSION")!.to.status).toBe("COMPLETED");
  });

  it("never auto-closes COMPLETION_REQUESTED, IN_PROGRESS or DISPUTED as NOT_MARKED", () => {
    const system: ActorRef = { type: "SYSTEM" };
    expect(errorCode(() => checkTransition(subject("RIDE_REQUEST", "ACCEPTED", "COMPLETION_REQUESTED"), "MARK_NOT_MARKED", system))).toBe(
      "INVALID_TRANSITION",
    );
    expect(errorCode(() => checkTransition(subject("RIDE_REQUEST", "IN_PROGRESS", "RIDE_CONFIRMED"), "MARK_NOT_MARKED", system))).toBe(
      "INVALID_TRANSITION",
    );
    expect(errorCode(() => checkTransition(subject("RIDE_REQUEST", "DISPUTED", "COMPLETION_REQUESTED"), "MARK_NOT_MARKED", system))).toBe(
      "INVALID_TRANSITION",
    );
    expect(errorCode(() => checkTransition(subject("CARPOOL_BOOKING", "ACCEPTED", "CONTRACT_ACTIVE"), "MARK_NOT_MARKED", system))).toBe(
      "INVALID_TRANSITION",
    );
  });
});

describe("complaints (B2a decision 9)", () => {
  it("move an ACCEPTED or IN_PROGRESS activity to DISPUTED but never a terminal one", () => {
    const actions: ActivityAction[] = ["DISPUTE"];
    for (const action of actions) {
      expect(errorCode(() => checkTransition(subject("SERVICE", "ACCEPTED", null), action, user(CREATOR)))).toBe("OK");
      expect(errorCode(() => checkTransition(subject("SERVICE", "IN_PROGRESS", null), action, user(CREATOR)))).toBe("OK");
      for (const status of TERMINAL) {
        expect(errorCode(() => checkTransition(subject("SERVICE", status, null), action, user(CREATOR)))).toBe("INVALID_TRANSITION");
      }
    }
  });
});
