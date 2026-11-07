import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ToastProvider } from "../../components/toast";
import type { SessionState } from "../../lib/session";
import { fakeSocket } from "../../test/setup";
import { setNotificationUnread, type AppNotification } from "./notifications-api";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() },
}));

const notificationsApi = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  getNotificationUnread: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock("./notifications-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notifications-api")>()),
  ...notificationsApi,
}));
vi.mock("../inbox/chat-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../inbox/chat-api")>()),
  getUnreadTotal: vi.fn().mockResolvedValue({ unreadTotal: 0 }),
  listInbox: vi.fn().mockResolvedValue({ chats: [], nextBefore: null }),
}));

function item(overrides: Partial<AppNotification>): AppNotification {
  return {
    id: "n1",
    type: "REQUEST_ACCEPTED",
    title: "Your request was accepted",
    body: "Rafi accepted your food delivery.",
    link: "/inbox/c1",
    read: false,
    createdAt: "2026-11-07T06:00:00.000Z",
    ...overrides,
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.current = {
    status: "authenticated",
    session: { accessToken: "token", expiresAt: Date.now() + 600_000, user: { id: "me", language: "EN", theme: "LIGHT" } },
  };
  notificationsApi.getNotificationUnread.mockResolvedValue({ unreadCount: 0 });
  setNotificationUnread(0);
  notificationsApi.markNotificationRead.mockResolvedValue({ unreadCount: 0 });
  notificationsApi.markAllNotificationsRead.mockResolvedValue({ unreadCount: 0 });
});

describe("Notifications page", () => {
  it("lists notifications, opens the right page and marks it read", async () => {
    notificationsApi.listNotifications.mockResolvedValue({ notifications: [item({})], nextCursor: null, unreadCount: 1 });
    const router = renderAt("/notifications");

    await userEvent.click(await screen.findByRole("button", { name: /Your request was accepted/ }));
    expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(router.state.location.pathname).toBe("/inbox/c1"));
  });

  it("marks all as read and loads older ones", async () => {
    notificationsApi.listNotifications
      .mockResolvedValueOnce({ notifications: [item({ id: "n2" })], nextCursor: "n2", unreadCount: 2 })
      .mockResolvedValueOnce({ notifications: [item({ id: "n1", title: "Request expired", read: true })], nextCursor: null, unreadCount: 2 });
    renderAt("/notifications");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(notificationsApi.listNotifications).toHaveBeenLastCalledWith("n2");
    expect(await screen.findByRole("button", { name: /Request expired/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(notificationsApi.markAllNotificationsRead).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument());
  });

  it("shows new notifications live and an empty state", async () => {
    notificationsApi.listNotifications.mockResolvedValue({ notifications: [], nextCursor: null, unreadCount: 0 });
    renderAt("/notifications");
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();

    act(() => fakeSocket.emit("notification:new", { notification: item({ id: "n9", title: "New seat booking" }), unreadCount: 1 }));
    expect(await screen.findByRole("button", { name: /New seat booking/ })).toBeInTheDocument();
  });
});

describe("Notification bell", () => {
  it("shows the unread count and follows the socket", async () => {
    renderAt("/");
    expect(await screen.findAllByRole("link", { name: "Notifications" })).toHaveLength(2);

    // Phone top bar and desktop navbar each have the bell
    act(() => fakeSocket.emit("notification:new", { notification: item({}), unreadCount: 3 }));
    expect(await screen.findAllByRole("link", { name: "Notifications, 3 unread" })).toHaveLength(2);
    act(() => fakeSocket.emit("notification:unread", { unreadCount: 5 }));
    expect(await screen.findAllByRole("link", { name: "Notifications, 5 unread" })).toHaveLength(2);
  });
});
