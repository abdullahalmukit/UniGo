import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./i18n";
import { App } from "./app/App";
import { registerServiceWorker } from "./lib/push";

// B2c: the service worker shows Web Push notifications; it caches nothing.
void registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
