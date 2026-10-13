// 離線快取：第一次開啟後把 App 存進手機，沒網路也能用；有網路時背景更新，下次打開就是新版
const CACHE = "training-app-v1.1.0";
const FILES = ["./", "index.html", "style.css", "program.js", "app.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});

// 休息提醒：App 切到背景時網頁計時會被暫停，改由這裡到點跳系統通知（App 在前景就不跳，由網頁自己嗶）
// Chrome 讓背景程式最多等約 5 分鐘，一般休息時間都在這之內
let rest = null; // { timers, done }
function cancelRest() {
  if (!rest) return;
  rest.timers.forEach(clearTimeout);
  rest.done();
  rest = null;
}
async function fireRest(item) {
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (wins.some((c) => c.visibilityState === "visible")) return;
  await self.registration.showNotification(item.title, {
    body: item.body, tag: "rest", renotify: true, requireInteraction: item.last,
    vibrate: item.last ? [400, 150, 400, 150, 700] : [250, 100, 250],
    icon: "icons/icon-192.png", badge: "icons/icon-192.png",
  });
}
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "rest-schedule") {
    cancelRest();
    let done;
    const wait = new Promise((r) => { done = r; });
    const items = (d.items || []).filter((it) => it.at > Date.now() - 1000);
    let left = items.length;
    const timers = items.map((it) => setTimeout(() => {
      fireRest(it).catch(() => {}).then(() => { if (--left === 0) cancelRest(); });
    }, Math.max(0, it.at - Date.now())));
    rest = { timers, done };
    if (!left) cancelRest();
    e.waitUntil(wait);
  } else if (d.type === "rest-cancel") {
    cancelRest();
  } else if (d.type === "rest-clear") {
    e.waitUntil(self.registration.getNotifications({ tag: "rest" }).then((ns) => ns.forEach((n) => n.close())));
  }
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    const w = wins[0];
    return w ? w.focus() : self.clients.openWindow("./");
  }));
});
