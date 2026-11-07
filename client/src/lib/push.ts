import { api, session } from "./api";

// Web Push on this device (proposal section 14, B2c):
// - the service worker (/sw.js) only shows pushes; it caches nothing;
// - the switch in Account > Notifications subscribes or unsubscribes this
//   device; the server keeps one subscription per device;
// - the account that switched it on is remembered on the device, so after a
//   log-out and a log-in as someone else the device never starts receiving
//   that person's pushes without their consent;
// - logging out removes this device's subscription first.

const SW_URL = "/sw.js";
const OWNER_KEY = "unigo.push.owner";

export type PushState = "unsupported" | "denied" | "on" | "off";

export function isPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

// Registers the service worker once and checks for a new version whenever
// the page becomes visible again.
export function registerServiceWorker() {
  if (registration || typeof window === "undefined" || !("serviceWorker" in navigator)) return registration;
  registration = navigator.serviceWorker.register(SW_URL, { updateViaCache: "none" }).catch(() => null);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void registration?.then((r) => r?.update().catch(() => undefined));
  });
  return registration;
}

// A tapped push asks an open tab to go to its page (see sw.js).
export function onServiceWorkerNavigate(navigate: (path: string) => void) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return () => undefined;
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: unknown } | null;
    if (data?.type === "unigo:navigate" && typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//")) {
      navigate(data.url);
    }
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

async function currentSubscription() {
  const reg = await (registerServiceWorker() ?? Promise.resolve(null));
  return reg ? reg.pushManager.getSubscription() : null;
}

function currentUserId() {
  const state = session.getState();
  return state.status === "authenticated" ? state.session.user.id : null;
}

export async function pushState(): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const subscription = await currentSubscription();
  return subscription && localStorage.getItem(OWNER_KEY) === currentUserId() ? "on" : "off";
}

function toUint8Array(base64url: string) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function saveOnServer(subscription: PushSubscription) {
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api("/me/push-subscriptions", { method: "PUT", body: { endpoint: json.endpoint, keys: json.keys } });
}

// Asks for permission (from the switch, a user gesture) and subscribes.
export async function enablePush(): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const config = await api<{ available: boolean; publicKey: string | null }>("/push/config");
  if (!config.available || !config.publicKey) throw new Error("PUSH_UNAVAILABLE");
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("PUSH_UNAVAILABLE");
  await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8Array(config.publicKey) }));
  await saveOnServer(subscription);
  localStorage.setItem(OWNER_KEY, currentUserId() ?? "");
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription) {
    await api("/me/push-subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => false);
  }
  localStorage.removeItem(OWNER_KEY);
  return isPushSupported() && Notification.permission === "denied" ? "denied" : "off";
}

// After a log-in: the device stays subscribed only for the account that
// switched it on; it is saved again (log out of all devices or a password
// change removed it on the server). Any other account: unsubscribed.
export async function syncPushSubscription() {
  if (!isPushSupported()) return;
  const userId = currentUserId();
  const subscription = await currentSubscription();
  if (!userId || !subscription) return;
  if (localStorage.getItem(OWNER_KEY) === userId && Notification.permission === "granted") {
    await saveOnServer(subscription).catch(() => undefined);
  } else {
    await subscription.unsubscribe().catch(() => false);
    localStorage.removeItem(OWNER_KEY);
  }
}

// Log out on this device: stop its pushes first, while still logged in.
export async function logoutWithPush() {
  if (isPushSupported()) {
    const subscription = await currentSubscription().catch(() => null);
    if (subscription) {
      await api("/me/push-subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => undefined);
      await subscription.unsubscribe().catch(() => false);
    }
    localStorage.removeItem(OWNER_KEY);
  }
  await session.logout();
}
