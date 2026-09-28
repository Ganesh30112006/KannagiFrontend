// Order alerts (src/lib/order-alerts.ts): shows each alert the API pushes (a new order), even when the
// website is closed, and opens the dashboard when it's tapped. It does nothing else: no caching, and
// pages load exactly as they would without it.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const text = (value, fallback) => (typeof value === "string" && value ? value : fallback);

/** Only this site's own pages open from an alert. */
function pagePath(value) {
  return typeof value === "string" && /^\/(?!\/)/.test(value) ? value : "/dashboard";
}

self.addEventListener("push", (event) => {
  let alert = {};
  try {
    alert = event.data ? event.data.json() : {};
  } catch {
    alert = {};
  }
  // Every push is shown: browsers stop delivering to a site whose pushes show nothing.
  event.waitUntil(
    self.registration.showNotification(text(alert.title, "New order"), {
      body: text(alert.body, "Open the dashboard to see it."),
      icon: "/favicon.png",
      badge: "/favicon.png",
      tag: text(alert.tag, "order"),
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: pagePath(alert.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    pagePath(event.notification.data && event.notification.data.url),
    self.location.origin,
  );
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // The dashboard already open in a tab or the Home Screen app: bring it forward (it syncs by itself).
      const same = open.find((client) => new URL(client.url).pathname === target.pathname);
      if (same) return same.focus();
      const other = open.find(
        (client) => new URL(client.url).origin === target.origin && "navigate" in client,
      );
      if (other) {
        const moved = await other.navigate(target.href).catch(() => null);
        if (moved) return moved.focus();
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
