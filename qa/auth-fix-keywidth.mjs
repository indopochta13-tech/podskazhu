// Худший случай для ключа: самые широкие буквы алфавита. Проверяем, что даже тогда
// перенос встаёт по дефису, а не посреди группы.
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import path from "node:path";

const BASE = "http://127.0.0.1:8791";
const QA_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(QA_DIR, "screens");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow" });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.click("#auth-start");
await page.waitForSelector("#onb-done", { timeout: 20000 });
await sleep(400);

const probe = await page.evaluate(() => {
  const el = document.querySelector(".code.key");
  const original = el.textContent;
  const alphabet = "ACDEFGHJKLMNPQRTUVWXYZ2346789".split("");
  // ширина каждого символа в этом же стиле
  const widths = alphabet.map(ch => {
    el.textContent = ch.repeat(20);
    return { ch, w: el.getBoundingClientRect().width / 20 };
  }).sort((a, b) => b.w - a.w);
  const widest = widths[0].ch;
  const worst = [0, 1, 2, 3].map(() => widest.repeat(5)).join("-");
  el.textContent = worst;
  const node = el.firstChild;
  const lines = [];
  let cur = null;
  for (let i = 0; i < worst.length; i++) {
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + 1);
    const rect = r.getBoundingClientRect();
    if (!cur || Math.abs(rect.top - cur.top) > 2) { cur = { top: rect.top, text: "" }; lines.push(cur); }
    cur.text += worst[i];
  }
  const box = el.closest(".code-box").getBoundingClientRect();
  const out = {
    widestChars: widths.slice(0, 3).map(w => `${w.ch}=${w.w.toFixed(1)}px`),
    worstKey: worst,
    worstWidth: Math.round(el.getBoundingClientRect().width),
    boxWidth: Math.round(box.width),
    lines: lines.map(l => l.text),
    clipped: el.scrollWidth > el.clientWidth + 2,
  };
  el.textContent = original;
  return out;
});

console.log(JSON.stringify(probe, null, 1));
const groupSafe = probe.lines.every(l => /^-?[A-Z0-9]{5}(-[A-Z0-9]{5})*-?$/.test(l));
console.log("перенос только по дефисам:", groupSafe ? "ДА" : "НЕТ");
await page.screenshot({ path: `${OUT}/auth-fix-14-key-worst-case.png`, fullPage: true });
await browser.close();
