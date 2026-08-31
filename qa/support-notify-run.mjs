// Ответ поддержки на телефоне должен звучать. Раньше звук просили у WebView прямо из кода —
// Android такой звук запрещает без нажатия человека, и ответ приходил молча.
// Здесь собран настоящий мост из mobile/native/native.js поверх подставного Capacitor:
// проверяем, что ответ уходит системным уведомлением в канал выбранного звука,
// баннер внутри приложения показывается один раз и без второго сигнала.
// Запуск: node qa/support-notify-run.mjs
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..", "app");
const NATIVE_JS = path.join(here, "..", "mobile", "native", "native.js");
const require = createRequire(import.meta.url);
const esbuild = require("../mobile/node_modules/esbuild/lib/main.js");

const TG_PORT = 8903;
const APP_PORT = 8904;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const DATA_DIR = "/tmp/vc-support-notify-qa";
const OPERATOR_CHAT = 424243;

// Проверочное уведомление занимает 1999999999, номера напоминаний из idFor не поднимаются
// выше 1,6 млрд: ответ поддержки обязан лежать вне обоих диапазонов.
const TEST_NOTIFICATION_ID = 1999999999;
const MAX_ITEM_ID = 1600000003;

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

/* —— Телефон понарошку: те же плагины, только записываем всё, что им отдали —— */

const CAPACITOR_STUB = `
const phone = { channels: [], posted: [], cancelled: [], listeners: {} };
window.__phone = phone;

function fire(event, payload) {
  for (const cb of phone.listeners[event] || []) cb(payload);
}

export const Capacitor = { isNativePlatform: () => true };
export const registerPlugin = () => new Proxy({}, { get: () => async () => ({}) });

export const App = {
  addListener: async () => ({ remove() {} }),
  getLaunchUrl: async () => ({}),
  exitApp() {},
};

export const LocalNotifications = {
  addListener: async (event, cb) => {
    (phone.listeners[event] = phone.listeners[event] || []).push(cb);
    return { remove() {} };
  },
  registerActionTypes: async () => {},
  createChannel: async channel => { phone.channels.push(channel); },
  deleteChannel: async () => {},
  checkPermissions: async () => ({ display: "granted" }),
  requestPermissions: async () => ({ display: "granted" }),
  getPending: async () => ({ notifications: [] }),
  cancel: async ({ notifications }) => { for (const n of notifications) phone.cancelled.push(n.id); },
  // Уведомление без расписания Android показывает сразу и тем же движением возвращает
  // его приложению — на этом держится баннер поверх открытого экрана.
  schedule: async ({ notifications }) => {
    for (const n of notifications) {
      phone.posted.push(n);
      if (!n.schedule) fire("localNotificationReceived", n);
    }
    return { notifications: notifications.map(n => ({ id: n.id })) };
  },
};

export const Preferences = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };
export const SplashScreen = { hide: async () => {} };
export const StatusBar = { setStyle: async () => {}, setBackgroundColor: async () => {} };
export const Style = { Light: "LIGHT" };
export const SpeechRecognition = {
  available: async () => ({ available: false }),
  requestPermissions: async () => ({ speechRecognition: "denied" }),
  addListener: async () => ({ remove() {} }),
  removeAllListeners: async () => {},
  start: async () => ({ matches: [] }),
  stop: async () => {},
  isListening: async () => ({ listening: false }),
};
`;

const built = await esbuild.build({
  entryPoints: [NATIVE_JS],
  bundle: true,
  format: "esm",
  target: "es2020",
  write: false,
  external: ["./app.js"],
  logLevel: "silent",
  plugins: [{
    name: "capacitor-stub",
    setup(build) {
      build.onResolve({ filter: /^@capacitor/ }, () => ({ path: "capacitor-stub", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: CAPACITOR_STUB, loader: "js" }));
    },
  }],
});
const bridge = built.outputFiles[0].text;

/* —— Телеграм понарошку —— */

const toOperator = [];
const pending = [];
let messageId = 7000;

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

console.log(`Звук ответа поддержки: ${BASE}\n`);
ok("сервер поднялся", Boolean(up), serverLog.join("").slice(-200));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

// Страницу собираем так же, как build-www: вместо app.js — мост, он подтянет app.js сам.
await ctx.route(`${BASE}/`, async route => {
  const res = await route.fetch();
  const html = (await res.text())
    .replace(/<script src="\/app\.js[^"]*" type="module"><\/script>/, '<script src="/native.js" type="module"></script>');
  await route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
});
await ctx.route(`${BASE}/native.js`, route =>
  route.fulfill({ contentType: "text/javascript; charset=utf-8", body: bridge }));

await ctx.addInitScript(base => {
  window.VC_API_BASE = base;
  // Так ведёт себя WebView: звук из кода без нажатия человека он не даёт проиграть.
  window.__audio = { plays: 0 };
  window.Audio.prototype.play = function blocked() {
    window.__audio.plays += 1;
    return Promise.reject(new DOMException("play() failed because the user didn't interact", "NotAllowedError"));
  };
  // Баннер живёт до следующей перерисовки экрана, поэтому считаем появления, а не то, что осталось.
  window.__banners = [];
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.id === "live-notice") window.__banners.push(node.textContent.replace(/\s+/g, " ").trim());
      }
    }
  }).observe(document, { childList: true, subtree: true });
}, BASE);

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(1200);

ok("мост телефона поднялся", await page.evaluate(() => typeof window.VC_NATIVE?.notifySupport === "function"));
ok("страница собрана без app.js напрямую",
  await page.evaluate(() => !document.querySelector('script[src^="/app.js"]')));

await page.check("#auth-consent");
await page.click("#auth-start");
await sleep(1800);
// Мост к телефону приложение подхватывает на запуске с готовым аккаунтом — как при обычном открытии.
await page.reload({ waitUntil: "networkidle" });
await sleep(1500);

/* —— Человек выбирает свой звук уведомлений —— */

await page.click("[aria-label='Настройки']");
await sleep(700);
await page.click("[data-go='sounds']");
await sleep(700);
await page.click(".sound-row:has-text('Стекло')");
await sleep(900);
await page.click(".bar [data-go='settings'], .bar .icon-btn");
await sleep(700);

const chosen = await page.evaluate(() => window.__phone.channels.map(c => c.id));
ok("канал выбранного звука заведён", chosen.includes("reminders_notify_glass"), chosen.join(", "));

// Прослушивание звука человек запускает пальцем — такое WebView пропускает. Считаем с чистого листа.
await page.evaluate(() => { window.__audio.plays = 0; });

/* —— Человек написал в поддержку, оператор ответил —— */

await page.evaluate(async () => {
  await fetch("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("vc.token")}` },
    body: JSON.stringify({ text: "Ответ поддержки приходит без звука, посмотрите пожалуйста" }),
  });
});

const ticket = await waitFor(() => toOperator[0] || null, 10000);
ok("обращение ушло оператору", Boolean(ticket), JSON.stringify(toOperator));

pending.push({
  update_id: 1,
  message: {
    message_id: 90101,
    chat: { id: OPERATOR_CHAT },
    text: "Проверила: звук вернули, теперь ответ слышно.",
    reply_to_message: { message_id: ticket.message_id },
  },
});
await waitFor(() => toOperator.find(m => m.text.startsWith("Отправила")) || null, 10000);

// Возвращение на экран приложение уже ловит само: обновляет состояние и видит новый ответ.
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

const posted = await waitFor(async () => {
  const list = await page.evaluate(() => window.__phone.posted);
  return list.length ? list : null;
}, 10000);
ok("ответ ушёл системным уведомлением", Boolean(posted), "шторка осталась пустой");

const notice = posted?.[0] || {};
ok("уведомление в канале выбранного звука", notice.channelId === "reminders_notify_glass", String(notice.channelId));
ok("сигнал для старых прошивок тот же", notice.sound === "notify_glass.mp3", String(notice.sound));
ok("уведомление показывается сразу", !notice.schedule, JSON.stringify(notice.schedule || null));
ok("номер не спорит с напоминаниями и проверочным",
  notice.id !== TEST_NOTIFICATION_ID && notice.id > MAX_ITEM_ID, String(notice.id));
ok("уведомление ведёт в поддержку",
  notice.extra?.support === true && String(notice.extra?.url).includes("go=support"), JSON.stringify(notice.extra));
ok("в тексте видно, что это ответ поддержки", String(notice.title).includes("Ответ поддержки"), String(notice.title));

const shown = await page.evaluate(() => ({ plays: window.__audio.plays, banners: window.__banners.slice() }));
ok("звук из кода больше не просим", shown.plays === 0, `попыток: ${shown.plays}`);
ok("баннер внутри приложения показан один раз", shown.banners.length === 1, JSON.stringify(shown.banners));
ok("в баннере тот же ответ", String(shown.banners[0]).includes("Ответ поддержки"), String(shown.banners[0]));

await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await sleep(1500);
const again = await page.evaluate(() => ({
  posted: window.__phone.posted.length,
  banners: window.__banners.length,
  plays: window.__audio.plays,
}));
ok("второй раз тот же ответ не звучит", again.posted === 1 && again.banners === 1 && again.plays === 0, JSON.stringify(again));

/* —— Нажатие по уведомлению в шторке —— */

const tapped = await page.evaluate(() => {
  const n = window.__phone.posted[0];
  const listeners = window.__phone.listeners.localNotificationActionPerformed || [];
  for (const cb of listeners) cb({ notification: n, actionId: "tap" });
  return listeners.length;
});
ok("приложение слушает нажатия в шторке", tapped > 0, String(tapped));
await sleep(1500);
ok("нажатие открывает переписку", Boolean(await page.$("#support-text")));

const theirs = await page.$$eval(".chat-msg.them .chat-bubble", els => els.map(e => e.textContent.trim()));
ok("ответ оператора виден в переписке", theirs.some(t => t.includes("звук вернули")), JSON.stringify(theirs));

const cleared = await waitFor(async () => {
  const list = await page.evaluate(() => window.__phone.cancelled);
  return list.includes(notice.id) ? list : null;
}, 5000);
ok("прочитанный ответ снят из шторки", Boolean(cleared), JSON.stringify(cleared || []));

ok("в консоли нет ошибок", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.kill("SIGTERM");
telegram.close();
await sleep(400);
server.kill("SIGKILL");

console.log(problems.length ? `\nПроблем: ${problems.length}` : "\nВсё прошло");
process.exit(problems.length ? 1 : 0);
