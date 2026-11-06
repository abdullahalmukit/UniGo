import { EventEmitter } from "node:events";

// Committed chat changes, announced after the transaction. The Socket.IO layer
// (sockets/) listens and pushes them to the participants; the chat service
// does not know about sockets.
export type ChatEvent =
  // A new message in a chat
  | { kind: "message"; chatId: string; messageId: string; participantIds: string[] }
  // A user read a chat (their unread total changed)
  | { kind: "read"; chatId: string; userId: string }
  // Read-only state, phone or block state changed
  | { kind: "changed"; chatId: string; participantIds: string[] };

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onChatEvent(listener: (event: ChatEvent) => void) {
  emitter.on("chat", listener);
  return () => emitter.off("chat", listener);
}

export function publishChatEvents(events: readonly ChatEvent[]) {
  for (const event of events) {
    try {
      emitter.emit("chat", event);
    } catch (error) {
      console.error(`Chat event listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
