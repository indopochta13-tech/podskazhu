// Насколько часто ключ не влезает в одну строку на экране «Четыре шага»
// и всегда ли перенос встаёт по дефису.
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:8791";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, locale: "ru-RU" });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.click("#auth-start");
await page.waitForSelector("#onb-done", { timeout: 20000 });
await sleep(400);

const stats = await page.evaluate(() => {
  const el = document.querySelector(".code.key");
  const original = el.textContent;
  const alphabet = "ACDEFGHJKLMNPQRTUVWXYZ2346789";
  const lineCount = () => {
    const node = el.firstChild;
    const t = node.textContent;
    const tops = new Set();
    const breaks = [];
    let prevTop = null;
    for (let i = 0; i < t.length; i++) {
      const r = document.createRange();
      r.setStart(node, i); r.setEnd(node, i + 1);
      const top = Math.round(r.getBoundingClientRect().top);
      tops.add(top);
      if (prevTop !== null && top !== prevTop) breaks.push(t.slice(Math.max(0, i - 1), i + 1));
      prevTop = top;
    }
    return { lines: tops.size, breakContext: breaks };
  };
  let two = 0, badBreak = 0;
  const examples = [];
  for (let n = 0; n < 200; n++) {
    const key = [0, 1, 2, 3].map(() => Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")).join("-");
    el.textContent = key;
    const { lines, breakContext } = lineCount();
    if (lines > 1) {
      two++;
      // перенос корректен, если символ перед разрывом — дефис
      const ok = breakContext.every(ctxs => ctxs[0] === "-");
      if (!ok) { badBreak++; if (examples.length < 5) examples.push({ key, breakContext }); }
      else if (examples.length < 3) examples.push({ key, lines, breakAfterHyphen: true });
    }
  }
  el.textContent = original;
  return { total: 200, twoLines: two, brokenInsideGroup: badBreak, examples };
});

console.log(JSON.stringify(stats, null, 1));
await browser.close();
