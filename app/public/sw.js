const SW_VERSION = 134;
const CACHE = `vc-shell-v${SW_VERSION}`;
const SHELL = ["/", "/styles.css?v=103", `/app.js?v=${SW_VERSION}`, "/sounds-catalog.js", "/ui-sounds.js", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

// Эти файлы всегда с сети: иначе старый app.js навсегда показывает экран «Скажите, что напомнить».
function networkOnly(url) {
  const p = url.pathname;
  return p === "/app.js" || p === "/sw.js" || p === "/" || p === "/index.html" || p === "/app-version.json";
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (networkOnly(url)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then(hit => hit || caches.match("/"))),
  );
});

// Токен приложение кладёт в IndexedDB, чтобы кнопки в уведомлении работали без открытия окна.
function readToken() {
  return new Promise(resolve => {
    let request;
    try {
      request = indexedDB.open("vc-auth", 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) return resolve(null);
      try {
        const tx = db.transaction("kv", "readonly");
        const get = tx.objectStore("kv").get("token");
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });
}

async function callApi(path, body) {
  const token = await readToken();
  if (!token) return null;
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => ({}));
  } catch {
    return null;
  }
}

async function refreshOpenApp() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of list) client.postMessage({ type: "state-changed" });
}

async function openApp(target) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of list) {
    if (client.url.startsWith(self.location.origin)) {
      await client.focus();
      if (client.navigate) await client.navigate(target).catch(() => {});
      return;
    }
  }
  await self.clients.openWindow(target);
}

function base64ToBytes(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// Браузер иногда сам сбрасывает подписку. Без этого напоминания молча перестают приходить.
self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil((async () => {
    try {
      const config = await fetch("/api/config").then(r => r.json());
      if (!config?.vapidPublicKey) return;
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(config.vapidPublicKey),
      });
      const token = await readToken();
      if (!token) return;
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscription }),
      });
    } catch {
      // Ничего не делаем: приложение переподпишется при следующем открытии.
    }
  })());
});

// Если приложение открыто, оно показывает баннер само — системное уведомление тогда без звука.
async function tellOpenApp(payload) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const visible = list.filter(c => c.visibilityState === "visible");
  for (const client of visible) client.postMessage({ type: "push", payload });
  return visible.length > 0;
}

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: "Напоминание" }; }

  const options = {
    body: payload.body || "",
    tag: payload.tag || "vc",
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || "/", itemId: payload.itemId || null, title: payload.title || "" },
    requireInteraction: Boolean(payload.alarm),
    vibrate: payload.alarm ? [400, 200, 400, 200, 400] : [180, 90, 180],
    actions: payload.itemId
      ? [
          { action: "snooze-60", title: "+1 час" },
          { action: "done", title: "Сделано" },
        ]
      : [],
  };

  event.waitUntil((async () => {
    const inApp = await tellOpenApp(payload);
    if (inApp && !payload.alarm) {
      options.silent = true;
      options.vibrate = undefined;
      options.renotify = false;
    }
    await self.registration.showNotification(payload.title || "Напоминание", options);
  })());
});

self.addEventListener("notificationclick", event => {
  const data = event.notification.data || {};
  const action = event.action;
  event.notification.close();

  if ((action === "done" || action === "snooze-60") && data.itemId) {
    event.waitUntil((async () => {
      const result = action === "done"
        ? await callApi(`/api/items/${data.itemId}/done`, { done: true })
        : await callApi(`/api/items/${data.itemId}/snooze`, { minutes: 60 });

      if (!result) {
        // Без токена или без сети — просто открываем карточку, чтобы действие не потерялось.
        await openApp(`/?item=${data.itemId}`);
        return;
      }
      await refreshOpenApp();
      await self.registration.showNotification(result.message || (action === "done" ? "Готово" : "Отложила на час"), {
        body: data.title || "",
        tag: `ack-${data.itemId}`,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        silent: true,
      });
    })());
    return;
  }

  event.waitUntil(openApp(data.url || "/"));
});
