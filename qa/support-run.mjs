// Поддержка целиком: человек пишет из приложения → сообщение уходит в бот →
// ответ оператора возвращается в приложение и зажигает счётчик.
// Телеграм подменяем своим сервером, приложение поднимаем рядом — проверка сквозная.
// Запуск: node qa/support-run.mjs
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "app");
const TG_PORT = 8901;
const APP_PORT = 8902;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const DATA_DIR = "/tmp/vc-support-qa";
const OPERATOR_CHAT = 424242;

const SHOTS = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "support-screens");
const problems = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ok(label, condition, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition || !detail ? "" : ` → ${detail}`}`);
  if (!condition) problems.push(label);
}

async function waitFor(check, timeoutMs = 15000, step = 200) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await sleep(step);
  }
  return null;
}

/* —— Телеграм понарошку —— */

const toOperator = [];      // что бот отправил в чат оператора
const pending = [];         // что оператор написал в ответ
let messageId = 5000;

const telegram = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", async () => {
    const method = req.url.split("/").pop();
    const params = JSON.parse(body || "{}");
    const answer = payload => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (method === "sendMessage") {
      messageId += 1;
      toOperator.push({ ...params, message_id: messageId });
      return answer({ ok: true, result: { message_id: messageId, chat: { id: params.chat_id } } });
    }
    if (method === "getUpdates") {
      // Долгий опрос: держим соединение, пока оператор не напишет.
      const until = Date.now() + 3000;
      while (!pending.length && Date.now() < until) await sleep(100);
      return answer({ ok: true, result: pending.splice(0, pending.length) });
    }
    return answer({ ok: true, result: true });
  });
});
await new Promise(r => telegram.listen(TG_PORT, "127.0.0.1", r));

/* —— Приложение —— */

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn("node", ["server.js"], {
  cwd: ROOT,
  env: {
    ...process.env,
    VC_PORT: String(APP_PORT),
    VC_HOST: "127.0.0.1",
    VC_DATA_DIR: DATA_DIR,
    VC_RATE_OFF: "1",
    VC_TG_API: `http://127.0.0.1:${TG_PORT}`,
    VC_TG_BOT_TOKEN: "qa-token",
    VC_TG_CHAT_ID: String(OPERATOR_CHAT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverLog = [];
server.stdout.on("data", d => serverLog.push(String(d)));
server.stderr.on("data", d => serverLog.push(String(d)));

const up = await waitFor(async () => {
  try { return (await fetch(`${BASE}/api/config`)).ok; } catch { return false; }
}, 10000);

console.log(`Поддержка: ${BASE}\n`);
ok("сервер поднялся", Boolean(up), serverLog.join("").slice(-200));
ok("мост с ботом подключён", serverLog.join("").includes("[telegram] поддержка подключена"), serverLog.join("").slice(-200));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(1000);
await page.check("#auth-consent");
await page.click("#auth-start");
await sleep(1500);

await page.click("[aria-label='Настройки']");
await sleep(700);

const supportRow = await page.$("button.setting[data-go='support']");
ok("строка поддержки на месте", Boolean(supportRow));
ok("почту и телефон больше не спрашиваем", !(await page.content()).includes("support@soulvoicee.ru"));
await supportRow.click();
await sleep(800);

ok("экран поддержки открылся", Boolean(await page.$("#support-text")));
ok("поля для почты и телефона нет", !(await page.$("#support-contact")));
fs.mkdirSync(SHOTS, { recursive: true });
await page.screenshot({ path: path.join(SHOTS, "1-пусто.png") });

await page.fill("#support-text", "Не пришло напоминание в 9:00, посмотрите пожалуйста");
await page.click("#support-send");
await sleep(1200);

const mine = await page.$$eval(".chat-msg.mine .chat-bubble", els => els.map(e => e.textContent.trim()));
ok("своё сообщение видно в переписке", mine.length === 1 && mine[0].includes("Не пришло напоминание"), JSON.stringify(mine));

const ticket = await waitFor(() => toOperator[0] || null, 8000);
ok("обращение ушло оператору в бот", Boolean(ticket), JSON.stringify(toOperator));
ok("оператор видит чат и код человека",
  ticket && String(ticket.chat_id) === String(OPERATOR_CHAT) && /Поддержка · [A-Z0-9]{6}/.test(ticket.text),
  ticket?.text);
ok("в боте написано, как ответить", ticket?.text.includes("Ответьте на это сообщение"), ticket?.text);

/* —— Оператор отвечает прямо в телеграме —— */

pending.push({
  update_id: 1,
  message: {
    message_id: 90001,
    chat: { id: OPERATOR_CHAT },
    text: "Проверила: у записи был выключен звонок. Включила, завтра придёт вовремя.",
    reply_to_message: { message_id: ticket.message_id },
  },
});

const confirmed = await waitFor(() => toOperator.find(m => m.text.startsWith("Отправила")) || null, 10000);
ok("бот подтвердил отправку оператору", Boolean(confirmed), JSON.stringify(toOperator.map(m => m.text)));

// Человек в это время смотрел настройки: счётчик должен появиться сам после обновления состояния.
await page.click(".bar-back, [data-go='settings']").catch(() => {});
await sleep(500);
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await sleep(1500);

const chromeCount = await page.$eval("[aria-label^='Настройки'] .chrome-count", el => el.textContent.trim()).catch(() => "");
ok("счётчик загорелся на иконке меню", chromeCount === "1", chromeCount || "нет счётчика");

const rowCount = await page.$eval("button.setting[data-go='support'] .pill.count", el => el.textContent.trim()).catch(() => "");
ok("счётчик виден на строке «Поддержка»", rowCount === "1", rowCount || "нет счётчика");
await page.screenshot({ path: path.join(SHOTS, "2-счётчик.png") });

await page.click("button.setting[data-go='support']");
await sleep(1200);

const theirs = await page.$$eval(".chat-msg.them .chat-bubble", els => els.map(e => e.textContent.trim()));
ok("ответ оператора пришёл в приложение", theirs.length === 1 && theirs[0].includes("Включила"), JSON.stringify(theirs));
ok("ответ подписан поддержкой", (await page.$$eval(".chat-msg.them .chat-when", els => els[0]?.textContent || "")).includes("Поддержка"));
await page.screenshot({ path: path.join(SHOTS, "3-переписка.png") });

await page.click("[aria-label^='Настройки']");
await sleep(1000);
const afterRead = await page.$("[aria-label^='Настройки'] .chrome-count");
ok("после прочтения счётчик гаснет", !afterRead);
const rowAfter = await page.$("button.setting[data-go='support'] .pill.count");
ok("на строке поддержки счётчик тоже гаснет", !rowAfter);

/* —— Ответ по коду, без «ответить на сообщение» —— */

const code = ticket.text.match(/Поддержка · ([A-Z0-9]{6})/)[1];
pending.push({
  update_id: 2,
  message: { message_id: 90002, chat: { id: OPERATOR_CHAT }, text: `${code} Если повторится — напишите ещё раз.` },
});
const second = await waitFor(async () => {
  const token = await page.evaluate(() => localStorage.getItem("vc.token"));
  const res = await fetch(`${BASE}/api/support`, { headers: { authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.messages?.some(m => m.text.includes("Если повторится")) ? data : null;
}, 10000);
ok("ответ по коду тоже доходит", Boolean(second), JSON.stringify(second?.messages?.map(m => m.text) || []));
ok("код из ответа в текст не попал",
  second?.messages?.at(-1)?.text.startsWith("Если повторится"), second?.messages?.at(-1)?.text);

ok("в консоли нет ошибок", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.kill("SIGTERM");
telegram.close();
await sleep(400);
server.kill("SIGKILL");

console.log(problems.length ? `\nПроблем: ${problems.length}` : "\nВсё прошло");
process.exit(problems.length ? 1 : 0);
