import webpush from "web-push";
import { db, save } from "./store.js";

let ready = false;

export function initPush() {
  if (!db.vapid) {
    db.vapid = webpush.generateVAPIDKeys();
    save();
  }
  webpush.setVapidDetails(
    process.env.VC_CONTACT || "mailto:admin@example.com",
    db.vapid.publicKey,
    db.vapid.privateKey,
  );
  ready = true;
}

export function publicKey() {
  return db.vapid?.publicKey || null;
}

// Больше устройств у одного человека не бывает, а без потолка сюда можно залить сколько угодно.
const SUBS_PER_USER = 20;

// Endpoint приходит от клиента, и сервер сам по нему ходит. Без проверки это способ
// заставить сервер стучаться во внутреннюю сеть — пускаем только настоящие push-сервисы.
const PUSH_HOSTS = [
  /(^|\.)googleapis\.com$/i,       // Chrome / FCM
  /(^|\.)mozilla\.com$/i,          // Firefox
  /(^|\.)push\.services\.mozilla\.com$/i,
  /(^|\.)windows\.com$/i,          // Edge / WNS
  /(^|\.)notify\.windows\.com$/i,
  /(^|\.)push\.apple\.com$/i,      // Safari / iOS
];

function allowedEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return PUSH_HOSTS.some(re => re.test(url.hostname));
}

export function addSubscription(userId, subscription) {
  if (!subscription?.endpoint) return false;
  if (!allowedEndpoint(subscription.endpoint)) {
    console.warn("[push] отклонён неизвестный endpoint");
    return false;
  }
  const list = db.subs[userId] || [];
  if (!list.some(s => s.endpoint === subscription.endpoint)) {
    if (list.length >= SUBS_PER_USER) list.shift();
    list.push({
      endpoint: String(subscription.endpoint),
      expirationTime: subscription.expirationTime ?? null,
      keys: {
        p256dh: String(subscription.keys?.p256dh || ""),
        auth: String(subscription.keys?.auth || ""),
      },
    });
    db.subs[userId] = list;
    save();
  }
  return true;
}

export function removeSubscription(userId, endpoint) {
  const list = db.subs[userId] || [];
  db.subs[userId] = list.filter(s => s.endpoint !== endpoint);
  save();
}

export async function sendTo(userId, payload) {
  if (!ready) return { sent: 0 };
  const list = db.subs[userId] || [];
  if (!list.length) return { sent: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  const dead = [];
  await Promise.all(list.map(async sub => {
    try {
      await webpush.sendNotification(sub, body, { TTL: 3600, urgency: payload.urgent ? "high" : "normal" });
      sent += 1;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(sub.endpoint);
      else console.error("[push] ошибка отправки:", err?.statusCode || err?.message);
    }
  }));
  if (dead.length) {
    db.subs[userId] = list.filter(s => !dead.includes(s.endpoint));
    save();
  }
  return { sent };
}
