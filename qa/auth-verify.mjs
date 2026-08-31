// Точная проверка двух найденных дефектов: неверный ключ переноса и «от кого» во входящем.
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import path from "node:path";

const BASE = "http://127.0.0.1:8791";
const QA_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(QA_DIR, "screens");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctxOpts = { viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow" };

/* А. Неверный ключ: что именно видит человек */
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.click("#auth-toggle");
await page.fill('[data-auth-form="restore"] input[name="key"]', "AAAAA-BBBBB-CCCCC-DDDDD");
const before = await page.evaluate(() => ({
  mode: document.querySelector('[data-auth-form="restore"]').classList.contains("hidden") ? "start" : "restore",
  value: document.querySelector('input[name="key"]').value,
  toggle: document.querySelector("#auth-toggle").textContent.trim(),
}));
await page.click("#auth-restore");
for (const ms of [150, 400, 900, 2000]) {
  await sleep(ms === 150 ? 150 : 300);
  const snap = await page.evaluate(() => ({
    err: document.querySelector("[data-auth-error]")?.textContent.trim(),
    toast: document.getElementById("toast")?.textContent.trim(),
    toastShown: document.getElementById("toast")?.classList.contains("show"),
    restoreVisible: !document.querySelector('[data-auth-form="restore"]')?.classList.contains("hidden"),
    value: document.querySelector('input[name="key"]')?.value,
    toggle: document.querySelector("#auth-toggle")?.textContent.trim(),
    token: localStorage.getItem("vc.token"),
  }));
  console.log(`через ~${ms}мс:`, JSON.stringify(snap));
}
console.log("до нажатия:", JSON.stringify(before));
await page.screenshot({ path: `${OUT}/auth-14-bad-key-after.png`, fullPage: true });

/* Б. Правильный ключ после неудачной попытки — можно ли повторить */
const retry = await page.evaluate(() => ({
  restoreFormVisible: !document.querySelector('[data-auth-form="restore"]')?.classList.contains("hidden"),
  startFormVisible: !document.querySelector('[data-auth-form="start"]')?.classList.contains("hidden"),
}));
console.log("состояние формы после отказа:", JSON.stringify(retry));

/* В. «от кого» во входящем: что приходит с сервера и что рисуется */
const c1 = await browser.newContext(ctxOpts);
const p1 = await c1.newPage();
await p1.goto(BASE + "/", { waitUntil: "networkidle" });
await p1.click("#auth-start");
await p1.waitForSelector("#onb-done");
const id1 = await p1.evaluate(() => document.querySelector(".step .code").textContent.trim());
await p1.click("#onb-done");
await sleep(400);

const c2 = await browser.newContext(ctxOpts);
const p2 = await c2.newPage();
await p2.goto(BASE + "/", { waitUntil: "networkidle" });
await p2.click("#auth-start");
await p2.waitForSelector("#onb-done");
const id2 = await p2.evaluate(() => document.querySelector(".step .code").textContent.trim());
await p2.click("#onb-done");
await sleep(400);

await p1.click('.widget [data-go="chat"]');
await p1.fill("#chat-input", "позвонить в банк завтра в 12");
await p1.click("#chat-send");
await p1.waitForFunction(() => [...document.querySelectorAll(".bubble.ai")].some(b => !b.textContent.includes("Разбираю")), null, { timeout: 20000 });
await sleep(500);
const shared = await p1.evaluate(async id2 => {
  const token = localStorage.getItem("vc.token");
  const h = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  await fetch("/api/contacts", { method: "POST", headers: h, body: JSON.stringify({ code: id2, label: "" }) });
  const st = await (await fetch("/api/state", { headers: h })).json();
  const item = st.items.find(i => /банк/i.test(i.title));
  const contact = st.contacts[0];
  const r = await fetch(`/api/items/${item.id}/share`, { method: "POST", headers: h, body: JSON.stringify({ contacts: [contact.id], groups: [] }) });
  return { status: r.status, sent: (await r.json()).sent };
}, id2);
console.log("отправка без пометки:", JSON.stringify(shared), "от", id1, "к", id2);

await p2.reload({ waitUntil: "networkidle" });
await sleep(800);
await p2.evaluate(() => document.querySelector(".incoming-banner")?.click());
await sleep(700);
const card = await p2.evaluate(() => {
  const c = [...document.querySelectorAll(".card")].find(x => x.querySelector(".pill.warn"));
  return c ? { meta: c.querySelector(".meta")?.textContent.trim(), html: c.querySelector(".meta")?.innerHTML } : null;
});
const raw = await p2.evaluate(async () => {
  const d = await (await fetch("/api/state", { headers: { Authorization: "Bearer " + localStorage.getItem("vc.token") } })).json();
  return JSON.stringify(d.incoming.map(i => ({ title: i.title, from: i.from })));
});
console.log("карточка входящего:", JSON.stringify(card));
console.log("с сервера:", raw);
await p2.screenshot({ path: `${OUT}/auth-15-incoming-from.png`, fullPage: true });

await browser.close();
