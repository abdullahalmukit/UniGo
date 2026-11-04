import { useEffect } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { session } from "../lib/api";
import { ToastProvider } from "../components/toast";
import { routes } from "./routes";
import { ThemeProvider, useTheme } from "./theme-provider";
import { useAccountPreferences } from "./use-session";

const router = createBrowserRouter(routes);

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
  useAccountPreferences(setChoice);

  return null;
}
