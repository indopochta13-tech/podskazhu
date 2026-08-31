/**
 * Firebase Cloud Messaging для Android (Capacitor Push Notifications).
 * Сервисный аккаунт Firebase — в VC_FIREBASE_SERVICE_ACCOUNT или путь в VC_FIREBASE_SERVICE_ACCOUNT_FILE.
 */
import fs from "node:fs";
import firebaseAdmin from "firebase-admin";
import { db, save } from "./store.js";

let ready = false;

const TOKENS_PER_USER = 5;

function loadServiceAccount() {
  const inline = String(process.env.VC_FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      console.error("[fcm] VC_FIREBASE_SERVICE_ACCOUNT — невалидный JSON");
      return null;
    }
  }
  const file = String(process.env.VC_FIREBASE_SERVICE_ACCOUNT_FILE || "").trim();
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("[fcm] не прочитать", file, err.message);
    return null;
  }
}

export function initFcm() {
  const creds = loadServiceAccount();
  if (!creds?.project_id) return;
  try {
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(creds) });
    }
    ready = true;
  } catch (err) {
    console.error("[fcm] init:", err.message);
  }
}

export function fcmReady() {
  return ready;
}

function ensureTokens() {
  if (!db.fcmTokens || typeof db.fcmTokens !== "object") db.fcmTokens = {};
  return db.fcmTokens;
}

export function addFcmToken(userId, token) {
  const clean = String(token || "").trim();
  if (!clean) return false;
  const bucket = ensureTokens();
  const list = bucket[userId] || [];
  if (!list.includes(clean)) {
    if (list.length >= TOKENS_PER_USER) list.shift();
    list.push(clean);
    bucket[userId] = list;
    save();
  }
  return true;
}

export function removeFcmToken(userId, token) {
  const clean = String(token || "").trim();
  if (!clean) return;
  const list = ensureTokens()[userId] || [];
  ensureTokens()[userId] = list.filter(t => t !== clean);
  save();
}

export async function sendFcmTo(userId, payload) {
  if (!ready) return { sent: 0 };
  const tokens = ensureTokens()[userId] || [];
  if (!tokens.length) return { sent: 0 };

  const data = {
    title: String(payload.title || "SoulVoice"),
    body: String(payload.body || ""),
    tag: String(payload.tag || ""),
    url: String(payload.url || ""),
    itemId: String(payload.itemId || ""),
  };

  let sent = 0;
  const dead = [];
  try {
    const res = await firebaseAdmin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: data.title, body: data.body },
      data,
      android: { priority: payload.urgent ? "high" : "normal" },
    });
    sent = res.successCount;
    res.responses.forEach((r, idx) => {
      if (!r.success && (
        r.error?.code === "messaging/registration-token-not-registered"
        || r.error?.code === "messaging/invalid-registration-token"
      )) {
        dead.push(tokens[idx]);
      }
    });
  } catch (err) {
    console.error("[fcm] send:", err?.message || err);
  }

  if (dead.length) {
    ensureTokens()[userId] = tokens.filter(t => !dead.includes(t));
    save();
  }
  return { sent };
}
