import { act, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ToastProvider } from "../../components/toast";
import type { SessionState } from "../../lib/session";
import { fakeSocket } from "../../test/setup";
import type { ChatDetails, ChatMessage, InboxItem } from "./chat-api";
import { systemMessageDetail, systemMessageKey } from "./system-text";

const ME = "user-me";
const OTHER = "user-other";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() },
}));

const chatApi = vi.hoisted(() => ({
  listInbox: vi.fn(),
  getUnreadTotal: vi.fn(),
  getChat: vi.fn(),
  listMessages: vi.fn(),
  markRead: vi.fn(),
  sendMessage: vi.fn(),
  sendImage: vi.fn(),
  getBlockImpact: vi.fn(),
  blockInChat: vi.fn(),
  report: vi.fn(),
}));
vi.mock("./chat-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./chat-api")>()), ...chatApi }));

const future = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: "m1", chatId: "c1", kind: "TEXT", senderId: OTHER, body: "Hi", systemCode: null, image: null, createdAt: "2026-11-07T06:00:00.000Z", ...overrides };
}

function chatDetails(overrides: Partial<ChatDetails> = {}): ChatDetails {
  return {
    id: "c1",
    activity: { id: "a1", type: "FOOD", status: "ACCEPTED", subStatus: null, startTime: "2026-11-07T08:00:00.000Z", role: "CREATOR" },
    otherUser: { id: OTHER, name: "Rafi Hasan", university: null, photo: null, phone: "+8801711000000" },
    readOnly: null,
    blockedByMe: false,
    canSendImages: true,
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
}

beforeEach(() => {
  vi.clearAllMocks();
  state.current = {
    status: "authenticated",
    session: { accessToken: "token", expiresAt: Date.now() + 600_000, user: { id: ME, language: "EN", theme: "LIGHT" } },
  };
  chatApi.getUnreadTotal.mockResolvedValue({ unreadTotal: 0 });
  chatApi.markRead.mockResolvedValue({ unreadTotal: 0 });
});

describe("system message text", () => {
  it("names who did it and words a food start as collecting the food", () => {
    expect(systemMessageKey({ systemCode: "CANCELLED", senderId: ME }, ME, "RIDE_REQUEST").key).toBe("chat.system.CANCELLED.you");
    expect(systemMessageKey({ systemCode: "CANCELLED", senderId: OTHER }, ME, "RIDE_REQUEST").key).toBe("chat.system.CANCELLED.other");
    expect(systemMessageKey({ systemCode: "COMPLETED", senderId: null }, ME, "SERVICE").key).toBe("chat.system.COMPLETED.system");
    expect(systemMessageKey({ systemCode: "STARTED", senderId: OTHER }, ME, "FOOD").key).toBe("chat.system.FOOD_COLLECTED.other");
  });

  it("shows a reason only under a cancellation", () => {
    expect(systemMessageDetail({ systemCode: "CANCELLED", body: "Exam moved" })).toBe("Exam moved");
    expect(systemMessageDetail({ systemCode: "CANCELLED", body: null })).toBeNull();
    expect(systemMessageDetail({ systemCode: "DISPUTED", body: "anything" })).toBeNull();
  });
});

describe("Inbox", () => {
  it("lists chats with the other person, type, last message and unread count", async () => {
    const item: InboxItem = {
      chatId: "c1",
      activity: { id: "a1", type: "FOOD", status: "ACCEPTED" },
      otherUser: { id: OTHER, name: "Rafi Hasan", university: null, photo: null, phone: null },
      lastMessage: { kind: "TEXT", senderId: OTHER, systemCode: null, body: "On my way", createdAt: "2026-11-07T06:00:00.000Z" },
      unreadCount: 2,
      readOnly: null,
    };
    chatApi.listInbox.mockResolvedValue({ chats: [item], nextBefore: null });

    renderAt("/inbox");

    const link = await screen.findByRole("link", { name: /Rafi Hasan/ });
    expect(link).toHaveAttribute("href", "/inbox/c1");
    expect(within(link).getByText("Food delivery")).toBeInTheDocument();
    expect(within(link).getByText("On my way")).toBeInTheDocument();
    expect(within(link).getByText("2")).toBeInTheDocument();
  });

  it("shows the unread total on the Inbox tab and updates it live", async () => {
    chatApi.listInbox.mockResolvedValue({ chats: [], nextBefore: null });
    chatApi.getUnreadTotal.mockResolvedValue({ unreadTotal: 3 });

    renderAt("/inbox");

    const tabs = screen.getByRole("navigation", { name: /tabs/i });
    expect(await within(tabs).findByText("3")).toBeInTheDocument();
    act(() => fakeSocket.emit("inbox:update", { chatId: "c1", unreadTotal: 5 }));
    expect(await within(tabs).findByText("5")).toBeInTheDocument();
  });
});

describe("Chat", () => {
  it("shows messages, the Call button and new messages from the socket", async () => {
    chatApi.getChat.mockResolvedValue(chatDetails());
    chatApi.listMessages.mockResolvedValue({
      messages: [message({ id: "m0", kind: "SYSTEM", senderId: OTHER, systemCode: "ACCEPTED", body: null }), message({ id: "m1", body: "<b>Hi</b>" })],
      hasMore: false,
    });

    renderAt("/inbox/c1");

    expect(await screen.findByText("Accepted. Plan the details here.")).toBeInTheDocument();
    // Shown as text, never as HTML
    expect(screen.getByText("<b>Hi</b>")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Call \+8801711000000/ })).toHaveAttribute("href", "tel:+8801711000000");

    act(() => fakeSocket.emit("message:new", message({ id: "m2", body: "Reached the gate" })));
    expect(await screen.findByText("Reached the gate")).toBeInTheDocument();
    await waitFor(() => expect(chatApi.markRead).toHaveBeenLastCalledWith("c1", "m2"));
  });

  it("is read-only when the activity has ended, without Call", async () => {
    chatApi.getChat.mockResolvedValue(chatDetails({ readOnly: "FINISHED", otherUser: { ...chatDetails().otherUser, phone: null } }));
    chatApi.listMessages.mockResolvedValue({ messages: [message({})], hasMore: false });

    renderAt("/inbox/c1");

    expect(await screen.findByText("This activity has ended, so the chat is read-only.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Write a message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Call/ })).not.toBeInTheDocument();
  });

  it("fetches fresh links for an expired receipt photo instead of showing a broken image", async () => {
    chatApi.getChat.mockResolvedValue(chatDetails());
    const expired = message({ id: "m1", kind: "IMAGE", body: null, image: { url: "/api/files/old", expiresAt: past() } });
    const fresh = { ...expired, image: { url: "/api/files/new", expiresAt: future() } };
    chatApi.listMessages.mockResolvedValueOnce({ messages: [expired], hasMore: false }).mockResolvedValue({ messages: [fresh], hasMore: false });

    renderAt("/inbox/c1");

    const image = await screen.findByRole("img", { name: "Photo" });
    expect(image.getAttribute("src")).toMatch(/\/api\/files\/new$/);
    expect(chatApi.listMessages).toHaveBeenCalledTimes(2);
  });
});
