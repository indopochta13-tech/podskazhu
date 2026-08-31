/**
 * Мост между поддержкой в приложении и телеграм-ботом.
 */
import { db, save, findUserByCode } from "./store.js";
import { addAnswer, markDelivered, undelivered } from "./support.js";

const API = () => process.env.VC_TG_API || "https://api.telegram.org";
const TOKEN = () => String(process.env.VC_TG_BOT_TOKEN || "").trim();
const ADMIN_CHAT = () => String(process.env.VC_TG_CHAT_ID || "").trim();
const LINKS_KEEP = 3000;

let running = false;
let stopping = false;
let inFlight = null;

export function telegramReady() {
  return Boolean(TOKEN() && ADMIN_CHAT());
}

async function call(method, params, { timeoutMs = 20000, formData = null } = {}) {
  const token = TOKEN();
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (method === "getUpdates") inFlight = controller;
  try {
    const res = await fetch(`${API()}/bot${token}/${method}`, {
      method: "POST",
      headers: formData ? undefined : { "Content-Type": "application/json" },
      body: formData || JSON.stringify(params || {}),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      console.error(`[telegram] ${method}: ${data?.description || `HTTP ${res.status}`}`);
      return null;
    }
    return data.result;
  } catch (err) {
    if (err?.name !== "AbortError") console.error(`[telegram] ${method}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
    if (method === "getUpdates") inFlight = null;
  }
}

function rememberLink(messageId, userId) {
  db.supportTg = db.supportTg || {};
  db.supportTg[String(messageId)] = userId;
  const keys = Object.keys(db.supportTg);
  if (keys.length > LINKS_KEEP) {
    for (const key of keys.slice(0, keys.length - LINKS_KEEP)) delete db.supportTg[key];
  }
  save();
}

function ticketText(thread, message) {
  const about = [thread.platform, thread.appVersion].filter(Boolean).join(" · ");
  const head = about ? `Поддержка · ${thread.code} · ${about}` : `Поддержка · ${thread.code}`;
  return `${head}\n\n${message.text}\n\nОтветьте на это сообщение — ответ придёт человеку в приложение.`;
}

export async function sendTicket(thread, message) {
  const chat = ADMIN_CHAT();
  if (!TOKEN() || !chat) return false;
  const sent = await call("sendMessage", {
    chat_id: chat,
    text: ticketText(thread, message),
    disable_web_page_preview: true,
  });
  if (!sent?.message_id) return false;
  rememberLink(sent.message_id, thread.userId);
  return true;
}

export async function flushQueue() {
  if (!telegramReady()) return 0;
  let sent = 0;
  for (const { thread, message } of undelivered()) {
    const ok = await sendTicket(thread, message);
    markDelivered(message, ok);
    if (ok) sent += 1;
    else break;
  }
  return sent;
}

function isAdmin(chatId) {
  const admin = ADMIN_CHAT();
  return Boolean(admin) && String(chatId) === admin;
}

async function reply(chatId, text, replyTo, extra = {}) {
  await call("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
    ...extra,
  });
}

async function handleCallbackQuery(q) {
  if (!isAdmin(q.message?.chat?.id)) return null;
  return null;
}

export async function handleUpdate(update, hooks = {}) {
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }

  const msg = update?.message;
  const chatId = msg?.chat?.id;
  if (!msg || chatId === undefined) return null;

  const text = String(msg.text || msg.caption || "").trim();

  if (!ADMIN_CHAT()) console.warn(`[telegram] боту пишет чат ${chatId}`);

  if (text && /^\/(start|help|id)\b/i.test(text)) {
    await reply(chatId, isAdmin(chatId)
      ? `Чат оператора подключён.
Поддержка: ответ на сообщение или «КОД текст».
ID: ${chatId}`
      : `Служебный бот SoulVoice.\nID чата: ${chatId}`, msg.message_id);
    return null;
  }

  if (!isAdmin(chatId)) {
    if (text || msg.document) {
      await reply(chatId, "Напишите из приложения: Настройки → Поддержка.", msg.message_id);
    }
    return null;
  }

  if (!text) return null;

  let userId = db.supportTg?.[String(msg.reply_to_message?.message_id || "")] || null;
  let answer = text;
  if (!userId) {
    const byCode = text.match(/^([A-Za-z0-9]{6})[\s:,.\-–—]+([\s\S]+)$/);
    const user = byCode ? findUserByCode(byCode[1]) : null;
    if (user) {
      userId = user.id;
      answer = byCode[2].trim();
    }
  }
  if (!userId) {
    await reply(chatId, "Не поняла, кому ответить. Ответьте на сообщение с кодом или начните: «ACDEF2 текст».", msg.message_id);
    return null;
  }

  const added = addAnswer(userId, answer);
  if (!added) {
    await reply(chatId, "Переписка не найдена.", msg.message_id);
    return null;
  }
  rememberLink(msg.message_id, userId);
  await reply(chatId, `Отправила ${added.thread.code}`, msg.message_id);
  await hooks.onAnswer?.({ userId, code: added.thread.code, text: answer });
  return added;
}

async function pump(hooks) {
  await call("deleteWebhook", { drop_pending_updates: false }, { timeoutMs: 10000 });
  while (!stopping) {
    const updates = await call("getUpdates", {
      offset: db.tgOffset || 0,
      timeout: 25,
      allowed_updates: ["message", "callback_query"],
    }, { timeoutMs: 40000 });

    if (!updates) {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (!updates.length) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    for (const update of updates) {
      db.tgOffset = Math.max(db.tgOffset || 0, update.update_id + 1);
      try {
        await handleUpdate(update, hooks);
      } catch (err) {
        console.error("[telegram] ошибка:", err.message);
      }
    }
    if (updates.length) save();
  }
  running = false;
}

export function startTelegram(hooks = {}) {
  if (running) return false;
  if (!TOKEN()) {
    console.warn("[telegram] бот не настроен");
    return false;
  }
  running = true;
  stopping = false;
  pump(hooks);
  return true;
}

export function stopTelegram() {
  stopping = true;
  inFlight?.abort();
}
