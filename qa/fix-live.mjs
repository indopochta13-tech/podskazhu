// Короткая проверка живого сайта после деплоя: версия ассетов и новое положение тоста.
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import path from "node:path";

const QA_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(QA_DIR, "screens");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, locale: "ru-RU" });
const page = await context.newPage();
await page.goto("https://soulvoicee.ru/", { waitUntil: "networkidle" });

const info = await page.evaluate(() => {
  const t = document.getElementById("toast");
  const cs = getComputedStyle(t);
  return {
    css: document.querySelector('link[rel="stylesheet"]').getAttribute("href"),
    js: document.querySelector('script[src*="app.js"]').getAttribute("src"),
    toastTop: cs.top,
    toastBottom: cs.bottom,
    toastShadow: cs.boxShadow !== "none",
    screen: document.querySelector(".auth") ? "AUTH" : document.querySelector(".home") ? "HOME" : "?",
  };
});
console.log(JSON.stringify(info, null, 1));
// top у тоста теперь задан явно, а раньше был auto (позиционировался снизу).
console.log(info.css.endsWith("v=4") && info.js.endsWith("v=4") && parseFloat(info.toastTop) < 200
  ? "живой сайт отдаёт v=4, тост переехал наверх"
  : "ПРОБЛЕМА: живой сайт отдаёт старую версию или старое положение тоста");
await page.screenshot({ path: `${OUT}/fix-11-live-auth.png` });
await browser.close();
