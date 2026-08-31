/**
 * Переписка с поддержкой.
 *
 * У каждого человека одна ветка, привязанная к его id: ни почты, ни телефона мы не спрашиваем.
 * Он пишет из приложения, ответ приходит туда же — со счётчиком непрочитанного,
 * чтобы вопрос не потерялся между напоминаниями.
 */
import { db, save, nextId } from "./store.js";

// Больше сотни сообщений в одной ветке — это уже не поддержка, а переписка ни о чём.
// Старое отрезаем: свежее важнее, а база не должна пухнуть.
const KEEP_MESSAGES = 100;
const MAX_TEXT = 2000;

export function threadOf(userId) {
  const thread = db.support[userId];
  return thread && Array.isArray(thread.messages) ? thread : null;
}

export function ensureThread(user) {
  let thread = threadOf(user.id);
  if (!thread) {
    thread = {
      userId: user.id,
      code: user.code,
      at: Date.now(),
      updatedAt: Date.now(),
      unread: 0,
      messages: [],
    };
    db.support[user.id] = thread;
  }
  // Код мог смениться вместе с переносом на другой телефон.
  thread.code = user.code;
  return thread;
}

function trim(thread) {
  if (thread.messages.length > KEEP_MESSAGES) {
    thread.messages = thread.messages.slice(-KEEP_MESSAGES);
  }
}

export function addUserMessage(user, text, meta = {}) {
  const clean = String(text || "").trim().slice(0, MAX_TEXT);
  if (clean.length < 5) return null;
  const thread = ensureThread(user);
  const message = {
    id: nextId("sm"),
    at: Date.now(),
    from: "user",
    text: clean,
    // Пока сообщение не ушло оператору, помечаем: следующий круг попробует снова.
    delivered: false,
    tries: 0,
  };
  thread.messages.push(message);
  thread.updatedAt = message.at;
  thread.platform = String(meta.platform || thread.platform || "").slice(0, 40);
  thread.appVersion = String(meta.appVersion || thread.appVersion || "").slice(0, 40);
  trim(thread);
  save();
  return { thread, message };
}

export function addAnswer(userId, text) {
  const clean = String(text || "").trim().slice(0, MAX_TEXT);
  if (!clean) return null;
  const thread = threadOf(userId);
  if (!thread) return null;
  const message = { id: nextId("sm"), at: Date.now(), from: "support", text: clean };
  thread.messages.push(message);
  thread.updatedAt = message.at;
  thread.unread = (thread.unread || 0) + 1;
  trim(thread);
  save();
  return { thread, message };
}

export function markRead(userId) {
  const thread = threadOf(userId);
  if (!thread || !thread.unread) return 0;
  thread.unread = 0;
  save();
  return 0;
}

export function threadView(userId) {
  const thread = threadOf(userId);
  if (!thread) return { unread: 0, messages: [] };
  return {
    unread: thread.unread || 0,
    messages: thread.messages.map(m => ({ id: m.id, at: m.at, from: m.from, text: m.text })),
  };
}

export function supportSummary(userId) {
  const thread = threadOf(userId);
  return { unread: thread?.unread || 0, updatedAt: thread?.updatedAt || 0 };
}

/** Сообщения, которые не доехали до оператора: их пробуем отправить ещё раз. */
export function undelivered(limit = 5) {
  const out = [];
  for (const thread of Object.values(db.support)) {
    if (!Array.isArray(thread?.messages)) continue;
    for (const message of thread.messages) {
      if (message.from !== "user" || message.delivered || (message.tries || 0) >= 5) continue;
      out.push({ thread, message });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function markDelivered(message, ok) {
  message.tries = (message.tries || 0) + 1;
  if (ok) message.delivered = true;
  save();
}

/** Ветки, в которых давно тихо, чистим — как и жалобы. */
export function pruneSupport(maxAgeMs, now = Date.now()) {
  let removed = 0;
  for (const [key, thread] of Object.entries(db.support)) {
    const last = thread?.updatedAt || thread?.at || 0;
    if (now - last <= maxAgeMs) continue;
    delete db.support[key];
    removed += 1;
  }
  if (removed) {
    for (const [messageId, userId] of Object.entries(db.supportTg || {})) {
      if (!db.support[userId]) delete db.supportTg[messageId];
    }
  }
  return removed;
}
