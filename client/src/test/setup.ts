import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "../i18n";

// jsdom has no matchMedia; tests set `prefers-color-scheme` through this flag.
export const media = { prefersDark: false };

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: query.includes("dark") && media.prefersDark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })),
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  media.prefersDark = false;
});
