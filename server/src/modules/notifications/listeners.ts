import { runInBackground } from "../../utils/background.js";
import { onActivityTransition } from "../activities/events.js";
import { onChatEvent } from "../chat/chat-events.js";
import { notifyTransition } from "./activity-notifications.js";
import { markChatNotificationsRead, notifyChatMessage } from "./chat-notifications.js";

// Connects notifications to the activity engine and the chat. Runs after the
// change has committed and never holds up the request that made it.
let registered = false;

export function registerNotificationListeners() {
  if (registered) return;
  registered = true;
  onActivityTransition((event) => runInBackground("activity notification", () => notifyTransition(event)));
  onChatEvent((event) => {
    if (event.kind === "message") runInBackground("chat notification", () => notifyChatMessage(event));
    else if (event.kind === "read") runInBackground("chat notifications read", () => markChatNotificationsRead(event.userId, event.chatId));
  });
}
