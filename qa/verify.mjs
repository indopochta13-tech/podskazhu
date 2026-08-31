import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import path from "node:path";

const QA_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(QA_DIR, "screens");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow" });
const page = await context.newPage();
const errs = [];
page.on("pageerror", e => errs.push("pageerror: " + e.message));
page.on("response", r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });

await page.goto("http://127.0.0.1:8791/", { waitUntil: "networkidle" });
await page.click('[data-auth-tab="login"]');
await page.fill('[data-auth-form="login"] input[name="code"]', "RHRYPL");
await page.fill('[data-auth-form="login"] input[name="pin"]', "5566");
await page.click('[data-auth-form="login"] button[type="submit"]');
await page.waitForFunction(() => !document.querySelector(".auth"), null, { timeout: 15000 });
await sleep(600);
console.log("вход выполнен, экран:", await page.evaluate(() => document.querySelector(".bar h2")?.textContent || (document.querySelector(".home") ? "HOME" : "?")));
if (await page.locator("#onb-done").count()) {
  console.log("после входа на новом устройстве снова показан онбординг — жму «Всё, начинаем»");
  await page.click("#onb-done");
  await sleep(500);
}

// Полки → проверяем горизонтальную прокрутку строки вкладок
await page.click('.widget .w-btn[data-go="shelves"]');
await sleep(500);
const tabs = await page.evaluate(() => {
  const t = document.querySelector(".tabs");
  const last = [...document.querySelectorAll(".tab")].pop();
  return {
    clientWidth: t.clientWidth, scrollWidth: t.scrollWidth,
    overflowX: getComputedStyle(t).overflowX,
    lastTab: last.textContent, lastRight: Math.round(last.getBoundingClientRect().right),
    viewport: document.documentElement.clientWidth,
    canScroll: t.scrollWidth > t.clientWidth,
  };
});
console.log("строка вкладок:", JSON.stringify(tabs));
await page.evaluate(() => { document.querySelector(".tabs").scrollLeft = 999; });
await sleep(300);
await page.screenshot({ path: `${OUT}/16-tabs-scrolled-right.png` });

// Карточка: прокручиваем внутренний контейнер до конца, чтобы увидеть все кнопки действий
await page.click('[data-shelf-tab="notes"]');
await sleep(350);
await page.locator(".card-row").first().locator(".card-main").click();
await sleep(600);
await page.screenshot({ path: `${OUT}/17-detail-top.png` });
const scrollInfo = await page.evaluate(() => {
  const s = document.querySelector(".scroll");
  s.scrollTop = s.scrollHeight;
  return { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight };
});
await sleep(400);
console.log("внутренний скролл карточки:", JSON.stringify(scrollInfo));
await page.screenshot({ path: `${OUT}/18-detail-bottom-actions.png` });
const actions = await page.evaluate(() => [...document.querySelectorAll(".actions-col .btn")].map(b => {
  const r = b.getBoundingClientRect();
  return { label: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), visible: r.top >= 0 && r.bottom <= innerHeight };
}));
console.log("кнопки действий:", JSON.stringify(actions, null, 1));

// «Сегодня» — проверим просроченное/повтор и вид пилюль
await page.click('.bar [data-go="shelves"]');
await sleep(400);
await page.click('[data-shelf-tab="today"]');
await sleep(350);
await page.screenshot({ path: `${OUT}/19-shelf-today.png` });

console.log("\nошибки за проход:", errs.length ? JSON.stringify(errs, null, 1) : "нет");
await browser.close();
