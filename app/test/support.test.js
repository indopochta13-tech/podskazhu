/**
 * Мост поддержки: обращение уходит оператору в телеграм, ответ возвращается человеку.
 * Сеть не трогаем — подменяем fetch и смотрим, что именно бот отправил бы.
 *
 * Запуск: node test/support.test.js
 */
process.env.VC_DATA_DIR = process.env.VC_DATA_DIR || "/tmp/vc-support-test";
process.env.VC_TG_BOT_TOKEN = "test-token";
process.env.VC_TG_CHAT_ID = "555";

import fs from "node:fs";

fs.rmSync(process.env.VC_DATA_DIR, { recursive: true, force: true });

const { db, createUser } = await import("../lib/store.js");
const { addUserMessage, markDelivered, markRead, supportSummary, threadView, pruneSupport } = await import("../lib/support.js");
const { handleUpdate, sendTicket, flushQueue, telegramReady } = await import("../lib/telegram.js");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

/* —— Подставной телеграм —— */

let sentToTelegram = [];
let nextMessageId = 1000;
let failNext = false;

globalThis.fetch = async (url, options) => {
  const method = String(url).split("/").pop();
  const params = JSON.parse(options.body || "{}");
  if (method !== "sendMessage") return { json: async () => ({ ok: true, result: [] }) };
  if (failNext) {
    failNext = false;
    return { json: async () => ({ ok: false, description: "сеть отвалилась" }), status: 502 };
  }
  nextMessageId += 1;
  sentToTelegram.push({ ...params, message_id: nextMessageId });
  return { json: async () => ({ ok: true, result: { message_id: nextMessageId, chat: { id: params.chat_id } } }) };
};

const ADMIN = { id: 555 };
const STRANGER = { id: 777 };

function adminMessage(text, extra = {}) {
  return { update_id: nextMessageId++, message: { message_id: nextMessageId, chat: ADMIN, text, ...extra } };
}

/* —— Проверки —— */

console.log("Поддержка через телеграм-бот\n");

check("мост считается настроенным при токене и чате", telegramReady() === true);

const user = createUser("Europe/Moscow");
const other = createUser("Europe/Moscow");

const short = addUserMessage(user, "ой");
check("короткое сообщение не принимается", short === null);

const first = addUserMessage(user, "Не пришло напоминание в 9 утра", { platform: "android", appVersion: "1.7.4" });
check("сообщение легло в переписку", first?.message?.from === "user" && threadView(user.id).messages.length === 1);

const delivered = await sendTicket(first.thread, first.message);
markDelivered(first.message, delivered);
check("обращение ушло оператору", delivered === true && sentToTelegram.length === 1, JSON.stringify(sentToTelegram[0] || {}));
check("оператор видит код и платформу", sentToTelegram[0].text.includes(user.code) && sentToTelegram[0].text.includes("android"),
  sentToTelegram[0].text);
check("оператор получил сообщение в свой чат", String(sentToTelegram[0].chat_id) === "555");

const ticketMessageId = sentToTelegram[0].message_id;
sentToTelegram = [];

// Ответ оператора: обычный «reply» на сообщение бота.
const answered = await handleUpdate(adminMessage("Проверила, напоминание было выключено — включила", {
  reply_to_message: { message_id: ticketMessageId },
}));
check("ответ дошёл до нужного человека", answered?.thread?.userId === user.id, String(answered?.thread?.userId));
const view = threadView(user.id);
check("ответ виден в переписке", view.messages.at(-1)?.from === "support" && view.messages.length === 2);
check("счётчик непрочитанного вырос", view.unread === 1 && supportSummary(user.id).unread === 1, String(view.unread));
check("оператору пришло подтверждение", sentToTelegram.some(m => m.text.includes(user.code)),
  JSON.stringify(sentToTelegram.map(m => m.text)));

markRead(user.id);
check("после открытия экрана счётчик гаснет", supportSummary(user.id).unread === 0);

// Ответ по коду в начале строки — когда листать переписку неудобно.
sentToTelegram = [];
addUserMessage(other, "Будильник молчит по утрам");
const byCode = await handleUpdate(adminMessage(`${other.code}: проверьте звук будильника в настройках`));
check("ответ по коду находит человека", byCode?.thread?.userId === other.id, String(byCode?.thread?.userId));
check("код из ответа в текст не попал",
  threadView(other.id).messages.at(-1)?.text === "проверьте звук будильника в настройках",
  threadView(other.id).messages.at(-1)?.text);

// Непонятный адресат и чужой чат.
sentToTelegram = [];
const lost = await handleUpdate(adminMessage("просто мысли вслух"));
check("без адресата ответ никому не уходит", lost === null);
check("оператору объяснили, как ответить", sentToTelegram[0]?.text.includes("кому ответить"), sentToTelegram[0]?.text);

sentToTelegram = [];
const stranger = await handleUpdate({ update_id: 1, message: { message_id: 9, chat: STRANGER, text: "привет" } });
check("чужой чат ответить не может", stranger === null);
check("постороннему бот отвечает вежливо", sentToTelegram[0]?.text.includes("из приложения"), sentToTelegram[0]?.text);

sentToTelegram = [];
await handleUpdate({ update_id: 2, message: { message_id: 10, chat: STRANGER, text: "/id" } });
check("«/id» подсказывает номер чата", sentToTelegram[0]?.text.includes("777"), sentToTelegram[0]?.text);

// Сеть моргнула: сообщение остаётся в очереди и уходит следующим кругом.
sentToTelegram = [];
failNext = true;
const third = addUserMessage(user, "Ещё вопрос про будильник");
const okNow = await sendTicket(third.thread, third.message);
markDelivered(third.message, okNow);
check("при сбое сети сообщение не считается доставленным", okNow === false && third.message.delivered === false);
const flushed = await flushQueue();
check("следующий круг доставляет его сам", flushed >= 1 && third.message.delivered === true, String(flushed));

// Старые ветки чистятся.
db.support[user.id].updatedAt = Date.now() - 200 * 86400000;
const removed = pruneSupport(180 * 86400000);
check("переписка старше полугода удаляется", removed === 1 && !db.support[user.id], String(removed));
check("связка с сообщениями бота чистится вместе с ней",
  !Object.values(db.supportTg).includes(user.id), JSON.stringify(db.supportTg));

console.log(`\n${failed ? `Провалено: ${failed} из ${passed + failed}` : `Все ${passed} проверок прошли`}`);
process.exit(failed ? 1 : 0);
