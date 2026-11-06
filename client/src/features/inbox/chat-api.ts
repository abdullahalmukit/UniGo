import { api, apiBaseUrl, ApiError } from "../../lib/api";
import { chatSocket, type AckError } from "../../lib/socket";

// Inbox and chat (proposal section 13, B2b).

export type SignedLink = { url: string; expiresAt: string };
export type ActivityType = "RIDE_REQUEST" | "RIDE_BOOKING" | "CARPOOL_BOOKING" | "CARPOOL_SESSION" | "FOOD" | "SERVICE";
export type ActivityStatus = "OPEN" | "ACCEPTED" | "IN_PROGRESS" | "DISPUTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "NOT_MARKED";
export type ReadOnlyReason = "FINISHED" | "BLOCKED";

export type ChatMessage = {
  id: string;
  chatId: string;
  kind: "TEXT" | "IMAGE" | "SYSTEM";
  senderId: string | null;
  body: string | null;
  systemCode: string | null;
  image: SignedLink | null;
  createdAt: string;
};

export type OtherUser = {
  id: string | null;
  name: string;
  university: { name: string; shortName: string | null } | null;
  photo: SignedLink | null;
  // Only while the activity runs and nobody blocked the other
  phone: string | null;
};

export type InboxItem = {
  chatId: string;
  activity: { id: string; type: ActivityType; status: ActivityStatus };
  otherUser: OtherUser;
  lastMessage: Pick<ChatMessage, "kind" | "senderId" | "systemCode" | "body" | "createdAt"> | null;
  unreadCount: number;
  readOnly: ReadOnlyReason | null;
};

export type ChatDetails = {
  id: string;
  activity: { id: string; type: ActivityType; status: ActivityStatus; subStatus: string | null; startTime: string; role: "CREATOR" | "ACCEPTER" };
  otherUser: OtherUser;
  readOnly: ReadOnlyReason | null;
  blockedByMe: boolean;
  canSendImages: boolean;
};

export type BlockImpact = {
  refusedForCarpoolContract: boolean;
  cancels: { id: string; type: ActivityType; status: ActivityStatus; startTime: string }[];
};

export const REPORT_REASONS = ["HARASSMENT", "INAPPROPRIATE_CONTENT", "SPAM", "SCAM_OR_FRAUD", "SAFETY_CONCERN", "FAKE_PROFILE", "OTHER"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Signed file links are paths on the API origin.
export const linkUrl = (link: SignedLink | null | undefined) =>
  link ? (/^https?:/.test(link.url) ? link.url : `${apiBaseUrl.replace(/\/api$/, "")}${link.url}`) : null;

export const listInbox = (before?: string) =>
  api<{ chats: InboxItem[]; nextBefore: string | null }>(`/chats${before ? `?before=${encodeURIComponent(before)}` : ""}`);

export const getUnreadTotal = () => api<{ unreadTotal: number }>("/chats/unread-count");

export const getChat = (chatId: string) => api<{ chat: ChatDetails }>(`/chats/${chatId}`).then((r) => r.chat);

export const listMessages = (chatId: string, before?: string) =>
  api<{ messages: ChatMessage[]; hasMore: boolean }>(`/chats/${chatId}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`);

// Over the socket when it is connected (one round trip, same checks), else REST.
export async function sendMessage(chatId: string, body: string): Promise<ChatMessage> {
  if (chatSocket.connected) {
    try {
      const response = await chatSocket.emitWithAck<{ message: ChatMessage }>("message:send", { chatId, body });
      if ("error" in response) throw socketError(response);
      return response.message;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Lost connection or timeout: fall back to REST below.
    }
  }
  return (await api<{ message: ChatMessage }>(`/chats/${chatId}/messages`, { method: "POST", body: { body } })).message;
}

export async function sendImage(chatId: string, file: Blob) {
  const form = new FormData();
  form.append("image", file, "receipt.jpg");
  return (await api<{ message: ChatMessage }>(`/chats/${chatId}/images`, { method: "POST", body: form })).message;
}

export const markRead = (chatId: string, upTo?: string) =>
  api<{ unreadTotal: number }>(`/chats/${chatId}/read`, { method: "POST", body: upTo ? { upTo } : {} });

export const getBlockImpact = (chatId: string) => api<BlockImpact>(`/chats/${chatId}/block-impact`);
export const blockInChat = (chatId: string) => api<{ cancelledActivityIds: string[] }>(`/chats/${chatId}/block`, { method: "POST" });

export const report = (input: { reason: ReportReason; description?: string; activityId?: string; messageId?: string }) =>
  api<{ report: { id: string } }>("/reports", { method: "POST", body: input });

// A refusal from the socket becomes an ApiError, so screens show it like any
// other server error (formErrors).
function socketError(response: AckError) {
  return new ApiError(400, { code: response.error.code, message: response.error.message });
}
