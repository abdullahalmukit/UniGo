import { EventEmitter } from "node:events";
import type { ActivityStatus, ActivitySubStatus, ActivityType } from "../../generated/prisma/client.js";
import type { ActivityAction, ActorRef } from "./transitions.js";

// Every committed status change is announced here, after the transaction.
// Notifications (B2c) and chat system messages (B2b) listen; the engine does
// not know about them.
export type ActivityTransitionEvent = {
  activityId: string;
  type: ActivityType;
  action: ActivityAction;
  from: { status: ActivityStatus; subStatus: ActivitySubStatus | null };
  to: { status: ActivityStatus; subStatus: ActivitySubStatus | null };
  actor: ActorRef;
  creatorId: string;
  accepterId: string | null;
  at: Date;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onActivityTransition(listener: (event: ActivityTransitionEvent) => void) {
  emitter.on("transition", listener);
  return () => emitter.off("transition", listener);
}

// A failing listener never undoes or blocks the change that was committed.
export function emitActivityTransitions(events: readonly ActivityTransitionEvent[]) {
  for (const event of events) {
    try {
      emitter.emit("transition", event);
    } catch (error) {
      console.error(`Activity transition listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
