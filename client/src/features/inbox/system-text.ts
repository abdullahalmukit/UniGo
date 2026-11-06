import type { ActivityType, ChatMessage } from "./chat-api";

// The i18n key of a system message (chat.system.<code>.<who>). The server sends
// a stable code; who did it decides the wording: "you", "other" (the other
// participant) or "system" (the app or an admin). A food activity's start is
// the accepter collecting the food.
export function systemMessageKey(message: Pick<ChatMessage, "systemCode" | "senderId">, myId: string, type: ActivityType) {
  let code = message.systemCode ?? "UNKNOWN";
  if (code === "STARTED" && type === "FOOD") code = "FOOD_COLLECTED";
  const who = message.senderId === null ? "system" : message.senderId === myId ? "you" : "other";
  return { key: `chat.system.${code}.${who}`, fallbackKey: `chat.system.${code}.system` };
}

// The text under a cancellation: its reason, when the canceller gave one that
// may be shown (a block's reason never reaches the chat).
export function systemMessageDetail(message: Pick<ChatMessage, "systemCode" | "body">) {
  return message.systemCode?.endsWith("CANCELLED") && message.body ? message.body : null;
}
