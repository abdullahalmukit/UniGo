import { sendNotification, setVapidDetails, WebPushError } from "web-push";
import { env } from "../../config/env.js";
import { rules } from "../../config/rules.js";

// Sends one Web Push message to one device. web-push in development and
// production (VAPID keys from server/.env); tests record the messages in
// memory and can make an endpoint answer with a status code.

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushPayload = {
  title: string;
  body: string;
  // A path on this site
  url: string;
  // Same tag replaces the earlier notification on the device (one per chat)
  tag: string;
  // Alert again (sound, vibration) when replacing a notification with the same tag
  renotify: boolean;
  notificationId: string;
};

export type PushResult = "SENT" | "GONE";

export class PushSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
  }
}

// For tests: every push "sent", and endpoints that answer with an error status.
export const sentPushes: { endpoint: string; payload: PushPayload }[] = [];
export const failingPushEndpoints = new Map<string, number>();

let configured = false;

export function pushAvailable() {
  return env.pushTransport !== "off";
}

export function vapidPublicKey() {
  if (env.pushTransport === "memory") return "test-vapid-public-key";
  return env.pushTransport === "webpush" ? (env.VAPID_PUBLIC_KEY ?? null) : null;
}

// GONE: the push service says the subscription no longer exists (404 or 410);
// the caller deletes it. Any other failure throws, so the job retries.
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  if (env.pushTransport === "memory") {
    const status = failingPushEndpoints.get(target.endpoint);
    if (status === 404 || status === 410) return "GONE";
    if (status) throw new PushSendError(`Push service answered ${status}`, status);
    sentPushes.push({ endpoint: target.endpoint, payload });
    return "SENT";
  }
  if (env.pushTransport === "off") throw new PushSendError("Web Push is not configured", null);

  if (!configured) {
    setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  try {
    await sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(payload), {
      TTL: rules.notifications.pushTtlSeconds,
      urgency: "normal",
      // Push services keep only the latest message per topic (max 32 characters)
      topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
    });
    return "SENT";
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return "GONE";
    // The endpoint is never logged: it identifies the device.
    const status = error instanceof WebPushError ? error.statusCode : null;
    throw new PushSendError(`Push failed${status ? ` with status ${status}` : ""}`, status);
  }
}
