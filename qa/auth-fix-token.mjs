// Отдельная проверка сброса сессии по настоящему протухшему токену (только ASCII,
// иначе fetch отклоняет заголовок ещё до отправки и запрос не уходит на сервер).
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import path from "node:path";

const BASE = "http://127.0.0.1:8791";
const QA_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(QA_DIR, "screens");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const net = [], js = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow" });
const page = await ctx.newPage();
page.on("pageerror", e => js.push("pageerror: " + e.message));
page.on("response", async r => {
  if (r.status() >= 400) {
    let body = ""; try { body = (await r.text()).slice(0, 200); } catch {}
    net.push({ status: r.status(), method: r.request().method(), url: r.url(), body });
  }
});

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.click("#auth-start");
await page.waitForSelector("#onb-done", { timeout: 20000 });
const code = await page.evaluate(() => document.querySelector(".step .code").textContent.trim());
await page.click("#onb-done");
await sleep(500);
const realToken = await page.evaluate(() => localStorage.getItem("vc.token"));
console.log("сессия создана, ID", code);

/* 1. Запрос из работающего приложения с чужим/протухшим токеном */
await page.evaluate(() => localStorage.setItem("vc.token", "expired0token0000000000000000000"));
await page.click('.home-top [data-go="settings"]');
await sleep(400);
await page.click('[data-toggle="alarmMeetings"]');
await sleep(1500);
const afterCall = await page.evaluate(() => ({
  auth: Boolean(document.querySelector(".auth")),
  startBtn: document.querySelector("#auth-start")?.textContent.trim(),
  token: localStorage.getItem("vc.token"),
  toast: document.getElementById("toast")?.textContent.trim(),
}));
console.log("после запроса с протухшим токеном:", JSON.stringify(afterCall));
await page.screenshot({ path: `${OUT}/auth-fix-11-expired-token-in-app.png`, fullPage: true });

/* 2. Перезагрузка с протухшим токеном */
await page.evaluate(() => localStorage.setItem("vc.token", "expired0token0000000000000000001"));
await page.reload({ waitUntil: "networkidle" });
await sleep(1200);
const afterReload = await page.evaluate(() => ({
  auth: Boolean(document.querySelector(".auth")),
  home: Boolean(document.querySelector(".home")),
  token: localStorage.getItem("vc.token"),
}));
console.log("после перезагрузки с протухшим токеном:", JSON.stringify(afterReload));
await page.screenshot({ path: `${OUT}/auth-fix-12-expired-token-reload.png`, fullPage: true });

/* 3. Обратная совместимость: живой токен по-прежнему пускает */
await page.evaluate(t => localStorage.setItem("vc.token", t), realToken);
await page.reload({ waitUntil: "networkidle" });
await sleep(1200);
const back = await page.evaluate(() => ({
  home: Boolean(document.querySelector(".home")),
  id: document.querySelector(".home-hello strong")?.textContent.trim(),
}));
console.log("возврат с настоящим токеном:", JSON.stringify(back));
await page.screenshot({ path: `${OUT}/auth-fix-13-valid-token-back.png`, fullPage: true });

console.log("\nJS:", JSON.stringify(js));
console.log("NET 4xx/5xx:", JSON.stringify(net, null, 1));
await browser.close();
