// UniGo service worker (B2c): Web Push only.
//
// - No "fetch" handler: nothing is cached, so API responses and the app itself
//   always come from the network (a browser no longer needs a fetch handler to
//   install the app).
// - Updates: the page registers this file with updateViaCache "none" and
//   checks for a new version when it becomes visible. Because this worker
//   holds no cache, a new version can take over at once (skipWaiting +
//   clients.claim) without breaking an open page.
// - A push shows its title and text; tapping it focuses an open UniGo tab on
//   the right page, or opens one. Only paths on this site are opened.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function samePath(url) {
  // "/inbox/abc" yes; "//evil.example", "https://..." and anything odd no
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/notifications";
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" && payload.title ? payload.title : "UniGo";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-32.png",
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    // Same tag (one per chat) replaces the earlier notification; it alerts
    // again only when the server says so (first message of an unread run).
    renotify: payload.renotify === true && typeof payload.tag === "string",
    data: { url: samePath(payload.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = samePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        // The page routes on its own, so the app is not reloaded
        open.postMessage({ type: "unigo:navigate", url: path });
        return open.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
