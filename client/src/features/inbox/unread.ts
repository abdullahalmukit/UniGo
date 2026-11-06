import { useEffect, useSyncExternalStore } from "react";
import { useSession } from "../../app/use-session";
import { chatSocket } from "../../lib/socket";
import { getUnreadTotal } from "./chat-api";

// The Inbox tab badge: unread messages across all chats (B2b). Loaded once
// after login, then kept current by the socket's "inbox:update" events and by
// the answers of "mark read".

let total = 0;
const listeners = new Set<() => void>();

export function setUnreadTotal(value: number) {
  if (value === total) return;
  total = value;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

chatSocket.on("inbox:update", (update: { unreadTotal: number }) => setUnreadTotal(update.unreadTotal));

// Used once by the app layout: starts the socket and loads the count for a
// logged-in user; resets it on logout.
export function useUnreadTotal() {
  const state = useSession();
  const userId = state.status === "authenticated" ? state.session.user.id : null;

  useEffect(() => {
    if (!userId) {
      setUnreadTotal(0);
      return;
    }
    chatSocket.start();
    let cancelled = false;
    const load = () =>
      getUnreadTotal()
        .then((r) => !cancelled && setUnreadTotal(r.unreadTotal))
        .catch(() => undefined);
    void load();
    // After a reconnect, events may have been missed.
    const stop = chatSocket.on("connect", () => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, [userId]);

  return useSyncExternalStore(subscribe, () => total);
}
