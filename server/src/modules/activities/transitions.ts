import type { ActivityStatus, ActivitySubStatus, ActivityType, ClosureReason } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";

// The one transition table for every feature (CLAUDE.md section 5.1, B2a
// decisions 3 and 4). Every status change goes through applyTransition()
// (engine.ts), which looks the action up here. Anything not listed is refused.
//
// The sub-status is its own column and never replaces the main status. The
// column holds the latest sub-status; a step that passes through two
// sub-statuses at once (Service: SERVICE_DELIVERED, then COMPLETION_REQUESTED)
// lists the first one in `records`, so activity_status_history keeps both.

export type ActivityAction =
  | "ACCEPT"
  | "START"
  | "CONFIRM_ORDER"
  | "REOPEN_ORDER"
  | "COLLECT_FOOD"
  | "DELIVER_SERVICE"
  | "REQUEST_COMPLETION"
  | "CONFIRM_COMPLETION"
  | "DISPUTE"
  | "CANCEL"
  | "DELETE"
  | "COMPLETE_SESSION"
  | "ACCEPT_BOOKING"
  | "REJECT_BOOKING"
  | "WITHDRAW_BOOKING"
  | "AGREE_CONTRACT"
  | "TERMINATE_CONTRACT"
  | "EXPIRE"
  | "MARK_NOT_MARKED"
  | "AUTO_COMPLETE"
  | "RELEASE_HOLD"
  | "END_CONTRACT"
  | "MODERATION_CLOSE"
  | "ADMIN_CANCEL"
  | "RESOLVE_COMPLETED"
  | "RESOLVE_CANCELLED";

// Who may take an action. CREATOR owns the post or request; ACCEPTER took it
// (A2 decision 7). OTHER_PARTICIPANT is the participant who did not ask for
// completion. NON_CREATOR is any user except the creator (accepting).
export type Performer = "CREATOR" | "ACCEPTER" | "EITHER" | "OTHER_PARTICIPANT" | "NON_CREATOR" | "SYSTEM" | "ADMIN";

type Sub = ActivitySubStatus | null;

export type TransitionRule = {
  action: ActivityAction;
  types: readonly ActivityType[];
  // Allowed starting points. Without `subStatus` any sub-status is allowed.
  from: readonly { status: ActivityStatus; subStatus?: readonly Sub[] }[];
  // Without `subStatus` the current sub-status is kept.
  to: { status: ActivityStatus; subStatus?: Sub };
  by: readonly Performer[];
  // Sub-statuses passed through on the way, written to the history first.
  records?: readonly ActivitySubStatus[];
  reasonRequired?: boolean;
  closure?: ClosureReason;
};

const RIDE = ["RIDE_REQUEST", "RIDE_BOOKING"] as const satisfies readonly ActivityType[];
// Features that use two-step completion (CLAUDE.md 5.3)
export const TWO_STEP_TYPES = ["RIDE_REQUEST", "RIDE_BOOKING", "FOOD", "SERVICE"] as const satisfies readonly ActivityType[];
// Items a user creates as OPEN requests: they count toward the limits and expire
export const OPEN_REQUEST_TYPES = ["RIDE_REQUEST", "FOOD", "SERVICE"] as const satisfies readonly ActivityType[];
// B6a: OPEN items that expire at their start. A carpool booking request the
// rider never answered expires at its first session (Q3); it is not in
// OPEN_REQUEST_TYPES, so it never counts toward the open and daily limits.
export const EXPIRING_TYPES = [...OPEN_REQUEST_TYPES, "CARPOOL_BOOKING"] as const satisfies readonly ActivityType[];
// Items closed as NOT_MARKED 6 hours after start if still ACCEPTED. Carpool
// bookings are left out: their contract has its own end (B6).
export const NOT_MARKED_TYPES = [...TWO_STEP_TYPES, "CARPOOL_SESSION"] as const satisfies readonly ActivityType[];
export const ALL_ACTIVITY_TYPES = [
  "RIDE_REQUEST",
  "RIDE_BOOKING",
  "CARPOOL_BOOKING",
  "CARPOOL_SESSION",
  "FOOD",
  "SERVICE",
] as const satisfies readonly ActivityType[];

// Every sub-status except COMPLETION_REQUESTED, which is never auto-closed or
// cancelled (proposal 7.4 and 12.2).
export const NOT_COMPLETION_REQUESTED: readonly Sub[] = [
  null,
  "RIDE_CONFIRMED",
  "CONTRACT_ACTIVE",
  "ORDER_CONFIRMED",
  "FOOD_COLLECTED",
  "SERVICE_DELIVERED",
];
const NOT_TERMINAL = [{ status: "OPEN" }, { status: "ACCEPTED" }, { status: "IN_PROGRESS" }, { status: "DISPUTED" }] as const;

export const TRANSITIONS: readonly TransitionRule[] = [
  // --- Accepting (acceptActivity in engine.ts). Acceptance is the confirmation (5.2).
  // Ride bookings are created ACCEPTED + RIDE_CONFIRMED by the booking itself (B3).
  { action: "ACCEPT", types: ["RIDE_REQUEST"], from: [{ status: "OPEN", subStatus: [null] }], to: { status: "ACCEPTED", subStatus: "RIDE_CONFIRMED" }, by: ["NON_CREATOR"] },
  { action: "ACCEPT", types: ["FOOD", "SERVICE"], from: [{ status: "OPEN", subStatus: [null] }], to: { status: "ACCEPTED", subStatus: null }, by: ["NON_CREATOR"] },

  // --- Starting. Ride: either participant (8.6). Service: the accepter (11.3).
  // Food has no Start: it reaches IN_PROGRESS only through COLLECT_FOOD (10.3).
  { action: "START", types: RIDE, from: [{ status: "ACCEPTED", subStatus: ["RIDE_CONFIRMED"] }], to: { status: "IN_PROGRESS" }, by: ["EITHER"] },
  { action: "START", types: ["SERVICE"], from: [{ status: "ACCEPTED", subStatus: [null] }], to: { status: "IN_PROGRESS" }, by: ["ACCEPTER"] },

  // --- Food steps. B4 calls CONFIRM_ORDER once both have confirmed the order
  // details, and COLLECT_FOOD with the accepter's receipt upload.
  { action: "CONFIRM_ORDER", types: ["FOOD"], from: [{ status: "ACCEPTED", subStatus: [null] }], to: { status: "ACCEPTED", subStatus: "ORDER_CONFIRMED" }, by: ["EITHER"] },
  // B4: a change to confirmed order details needs confirming again.
  { action: "REOPEN_ORDER", types: ["FOOD"], from: [{ status: "ACCEPTED", subStatus: ["ORDER_CONFIRMED"] }], to: { status: "ACCEPTED", subStatus: null }, by: ["EITHER"] },
  { action: "COLLECT_FOOD", types: ["FOOD"], from: [{ status: "ACCEPTED", subStatus: ["ORDER_CONFIRMED"] }], to: { status: "IN_PROGRESS", subStatus: "FOOD_COLLECTED" }, by: ["ACCEPTER"] },

  // --- Service: delivering is the accepter's completion request (11.3).
  {
    action: "DELIVER_SERVICE",
    types: ["SERVICE"],
    from: [{ status: "IN_PROGRESS", subStatus: [null] }],
    to: { status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED" },
    by: ["ACCEPTER"],
    records: ["SERVICE_DELIVERED"],
  },

  // --- Two-step completion (5.3), only once started (12.2)
  { action: "REQUEST_COMPLETION", types: RIDE, from: [{ status: "IN_PROGRESS", subStatus: ["RIDE_CONFIRMED"] }], to: { status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED" }, by: ["EITHER"] },
  { action: "REQUEST_COMPLETION", types: ["FOOD"], from: [{ status: "IN_PROGRESS", subStatus: ["FOOD_COLLECTED"] }], to: { status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED" }, by: ["EITHER"] },
  // The service accepter asks through DELIVER_SERVICE, so SERVICE_DELIVERED is recorded.
  { action: "REQUEST_COMPLETION", types: ["SERVICE"], from: [{ status: "IN_PROGRESS", subStatus: [null] }], to: { status: "IN_PROGRESS", subStatus: "COMPLETION_REQUESTED" }, by: ["CREATOR"] },
  { action: "CONFIRM_COMPLETION", types: TWO_STEP_TYPES, from: [{ status: "IN_PROGRESS", subStatus: ["COMPLETION_REQUESTED"] }], to: { status: "COMPLETED" }, by: ["OTHER_PARTICIPANT"] },
  { action: "AUTO_COMPLETE", types: TWO_STEP_TYPES, from: [{ status: "IN_PROGRESS", subStatus: ["COMPLETION_REQUESTED"] }], to: { status: "COMPLETED" }, by: ["SYSTEM"], closure: "AUTO_COMPLETED" },

  // --- Disputes and complaints (B2a decision 9): from ACCEPTED or IN_PROGRESS.
  // A complaint on a terminal activity does not change its status, so no
  // terminal status is listed. The endpoint comes in B7.
  { action: "DISPUTE", types: TWO_STEP_TYPES, from: [{ status: "ACCEPTED" }, { status: "IN_PROGRESS" }], to: { status: "DISPUTED" }, by: ["EITHER"], reasonRequired: true },
  { action: "DISPUTE", types: ["CARPOOL_SESSION"], from: [{ status: "ACCEPTED" }], to: { status: "DISPUTED" }, by: ["EITHER"], reasonRequired: true },
  { action: "RESOLVE_COMPLETED", types: ALL_ACTIVITY_TYPES, from: [{ status: "DISPUTED" }], to: { status: "COMPLETED" }, by: ["ADMIN"], closure: "DISPUTE_RESOLVED" },
  { action: "RESOLVE_CANCELLED", types: ALL_ACTIVITY_TYPES, from: [{ status: "DISPUTED" }], to: { status: "CANCELLED" }, by: ["ADMIN"], closure: "DISPUTE_RESOLVED" },

  // --- Cancelling after acceptance needs a reason (5.8). Not while completion
  // is requested: the other user can only confirm or dispute (12.2).
  {
    action: "CANCEL",
    types: ["RIDE_REQUEST", "RIDE_BOOKING", "SERVICE"],
    from: [{ status: "ACCEPTED" }, { status: "IN_PROGRESS", subStatus: NOT_COMPLETION_REQUESTED }],
    to: { status: "CANCELLED" },
    by: ["EITHER"],
    reasonRequired: true,
  },
  // B4: food can be cancelled by either side until the receipt is uploaded.
  // After it (FOOD_COLLECTED) only the accepter can; the requester raises a
  // complaint instead (B7).
  { action: "CANCEL", types: ["FOOD"], from: [{ status: "ACCEPTED" }], to: { status: "CANCELLED" }, by: ["EITHER"], reasonRequired: true },
  { action: "CANCEL", types: ["FOOD"], from: [{ status: "IN_PROGRESS", subStatus: ["FOOD_COLLECTED"] }], to: { status: "CANCELLED" }, by: ["ACCEPTER"], reasonRequired: true },
  { action: "CANCEL", types: ["CARPOOL_SESSION"], from: [{ status: "ACCEPTED" }], to: { status: "CANCELLED" }, by: ["EITHER"], reasonRequired: true },
  // A held carpool seat before the contract; after it, see TERMINATE_CONTRACT.
  { action: "CANCEL", types: ["CARPOOL_BOOKING"], from: [{ status: "ACCEPTED", subStatus: [null] }], to: { status: "CANCELLED" }, by: ["EITHER"], reasonRequired: true },

  // --- Deleting before acceptance is free and soft (7.7, A2 decision 2)
  { action: "DELETE", types: OPEN_REQUEST_TYPES, from: [{ status: "OPEN" }], to: { status: "CANCELLED" }, by: ["CREATOR"], closure: "DELETED_BY_CREATOR" },

  // --- Carpool (B6). Sessions are marked in one step (A2 decision 9).
  { action: "COMPLETE_SESSION", types: ["CARPOOL_SESSION"], from: [{ status: "ACCEPTED" }], to: { status: "COMPLETED" }, by: ["EITHER"] },
  // A carpool booking is created OPEN by the passenger (accepter) on the rider's post (creator).
  { action: "ACCEPT_BOOKING", types: ["CARPOOL_BOOKING"], from: [{ status: "OPEN", subStatus: [null] }], to: { status: "ACCEPTED", subStatus: null }, by: ["CREATOR"] },
  { action: "REJECT_BOOKING", types: ["CARPOOL_BOOKING"], from: [{ status: "OPEN" }], to: { status: "CANCELLED" }, by: ["CREATOR"], closure: "BOOKING_REJECTED" },
  { action: "WITHDRAW_BOOKING", types: ["CARPOOL_BOOKING"], from: [{ status: "OPEN" }], to: { status: "CANCELLED" }, by: ["ACCEPTER"] },
  { action: "AGREE_CONTRACT", types: ["CARPOOL_BOOKING"], from: [{ status: "ACCEPTED", subStatus: [null] }], to: { status: "ACCEPTED", subStatus: "CONTRACT_ACTIVE" }, by: ["EITHER"] },
  { action: "TERMINATE_CONTRACT", types: ["CARPOOL_BOOKING"], from: [{ status: "ACCEPTED", subStatus: ["CONTRACT_ACTIVE"] }], to: { status: "CANCELLED" }, by: ["EITHER"], reasonRequired: true },
  { action: "RELEASE_HOLD", types: ["CARPOOL_BOOKING"], from: [{ status: "ACCEPTED", subStatus: [null] }], to: { status: "CANCELLED" }, by: ["SYSTEM"], closure: "SEAT_HOLD_EXPIRED" },
  { action: "END_CONTRACT", types: ["CARPOOL_BOOKING"], from: [{ status: "ACCEPTED", subStatus: ["CONTRACT_ACTIVE"] }], to: { status: "COMPLETED" }, by: ["SYSTEM"] },

  // --- System timers (CLAUDE.md section 8)
  { action: "EXPIRE", types: EXPIRING_TYPES, from: [{ status: "OPEN" }], to: { status: "EXPIRED" }, by: ["SYSTEM"], closure: "EXPIRED_UNACCEPTED" },
  {
    action: "MARK_NOT_MARKED",
    types: NOT_MARKED_TYPES,
    from: [{ status: "ACCEPTED", subStatus: NOT_COMPLETION_REQUESTED }],
    to: { status: "NOT_MARKED" },
    by: ["SYSTEM"],
    closure: "NOT_MARKED_TIMEOUT",
  },

  // --- Admin and account moderation
  {
    action: "MODERATION_CLOSE",
    types: [...OPEN_REQUEST_TYPES, "CARPOOL_BOOKING"],
    from: [{ status: "OPEN" }],
    to: { status: "CANCELLED" },
    by: ["ADMIN", "SYSTEM"],
    closure: "ACCOUNT_MODERATED",
  },
  { action: "ADMIN_CANCEL", types: ALL_ACTIVITY_TYPES, from: NOT_TERMINAL, to: { status: "CANCELLED" }, by: ["ADMIN"], closure: "ADMIN_REMOVED" },
];

export type ActorRef = { type: "USER"; id: string } | { type: "ADMIN"; id: string } | { type: "SYSTEM" };

export type TransitionSubject = {
  type: ActivityType;
  status: ActivityStatus;
  subStatus: ActivitySubStatus | null;
  creatorId: string;
  accepterId: string | null;
  completionRequestedById: string | null;
};

// An action may have several rules for one type, each from different states
// (B4: food CANCEL before and after the receipt). With the current state the
// rule that starts there is chosen; otherwise the first one.
export function findRule(type: ActivityType, action: ActivityAction, state?: { status: ActivityStatus; subStatus: Sub }) {
  const rules = TRANSITIONS.filter((rule) => rule.action === action && rule.types.includes(type));
  if (state) {
    const matching = rules.find((rule) => matchesFrom(rule, state.status, state.subStatus));
    if (matching) return matching;
  }
  return rules[0];
}

export function matchesFrom(rule: TransitionRule, status: ActivityStatus, subStatus: Sub) {
  return rule.from.some((from) => from.status === status && (!from.subStatus || from.subStatus.includes(subStatus)));
}

function performerAllows(performer: Performer, activity: TransitionSubject, actor: ActorRef) {
  if (performer === "SYSTEM") return actor.type === "SYSTEM";
  if (performer === "ADMIN") return actor.type === "ADMIN";
  if (actor.type !== "USER") return false;
  const isCreator = actor.id === activity.creatorId;
  const isAccepter = actor.id === activity.accepterId;
  switch (performer) {
    case "CREATOR":
      return isCreator;
    case "ACCEPTER":
      return isAccepter;
    case "EITHER":
      return isCreator || isAccepter;
    case "OTHER_PARTICIPANT":
      return (isCreator || isAccepter) && actor.id !== activity.completionRequestedById;
    case "NON_CREATOR":
      return !isCreator;
  }
}

// Returns the rule for this action, or throws the error the client should see:
// INVALID_TRANSITION (not available for this feature or in this state),
// NOT_PARTICIPANT, or ACTION_NOT_ALLOWED (a participant, but not their step).
export function checkTransition(activity: TransitionSubject, action: ActivityAction, actor: ActorRef): TransitionRule {
  const rule = findRule(activity.type, action, activity);
  if (!rule) throw invalidTransition();

  if (actor.type === "USER" && !rule.by.includes("NON_CREATOR")) {
    if (actor.id !== activity.creatorId && actor.id !== activity.accepterId) {
      throw new AppError(403, "NOT_PARTICIPANT", "You are not part of this activity");
    }
  }
  if (!rule.by.some((performer) => performerAllows(performer, activity, actor))) {
    throw new AppError(403, "ACTION_NOT_ALLOWED", "You cannot do this on this activity");
  }
  if (!matchesFrom(rule, activity.status, activity.subStatus)) throw invalidTransition();
  return rule;
}

// The same check without errors, for jobs.
export function isTransitionAllowed(activity: TransitionSubject, action: ActivityAction, actor: ActorRef) {
  try {
    checkTransition(activity, action, actor);
    return true;
  } catch (error) {
    if (error instanceof AppError) return false;
    throw error;
  }
}

export function invalidTransition() {
  return new AppError(409, "INVALID_TRANSITION", "This action is not available for this activity now");
}
