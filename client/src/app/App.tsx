import { useEffect } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { session } from "../lib/api";
import { onServiceWorkerNavigate, syncPushSubscription } from "../lib/push";
import { ToastProvider } from "../components/toast";
import { routes } from "./routes";
import { ThemeProvider, useTheme } from "./theme-provider";
import { useAccountPreferences, useSession } from "./use-session";

const router = createBrowserRouter(routes);

// A tapped push opens its page in this tab (B2c).
onServiceWorkerNavigate((path) => void router.navigate(path));

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <SessionStarter />
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>
  );
}

// Restores the session on page load (borrowing it from another tab when one is
// open) and applies the account's language and theme once it starts.
function SessionStarter() {
  const { setChoice } = useTheme();

  useEffect(() => {
    void session.start();
  }, []);

  // B2c: keep this device's push subscription with the account that turned it on.
  const state = useSession();
  const userId = state.status === "authenticated" ? state.session.user.id : null;
  useEffect(() => {
    if (userId) void syncPushSubscription().catch(() => undefined);
  }, [userId]);
  useAccountPreferences(setChoice);

  return null;
}
