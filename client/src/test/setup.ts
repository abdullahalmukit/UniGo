import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "../i18n";

// No real Socket.IO connection in tests (B2b). Tests that need socket events
// call fakeSocket.emit(event, payload).
const socketHandlers = vi.hoisted(() => new Map<string, Set<(...args: unknown[]) => void>>());
export const fakeSocket = {
  emit(event: string, ...args: unknown[]) {
    for (const handler of socketHandlers.get(event) ?? []) handler(...args);
  },
};
vi.mock("../lib/socket", () => ({
  SOCKET_PATH: "/api/socket",
  chatSocket: {
    start: () => undefined,
    connected: false,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const set = socketHandlers.get(event) ?? new Set();
      set.add(handler);
      socketHandlers.set(event, set);
      return () => set.delete(handler);
    },
    joinChat: () => () => undefined,
    setViewingChat: () => undefined,
    emitWithAck: () => Promise.reject(new Error("not connected")),
  },
}));

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
