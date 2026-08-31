// Экран «Звуки» в браузере: список, названия и то, что файлы реально проигрываются.
// Запуск: node qa/sounds-run.mjs [базовый-url]
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:5173";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "sound-screens");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const errors = [];

function ok(label, condition, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition || !detail ? "" : ` → ${detail}`}`);
  if (!condition) problems.push(label);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

console.log(`Звуки: ${BASE}\n`);

await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(1200);
const consent = await page.$("#auth-consent, #consent-ok");
if (consent) await consent.check().catch(() => {});
const startBtn = await page.$("button:has-text('Начать'), #consent-accept");
if (startBtn) await startBtn.click().catch(() => {});
await sleep(1500);

await page.click("[aria-label='Настройки']");
await sleep(700);
const soundsRow = await page.$("[data-go='sounds']");
ok("в настройках есть строка «Звуки»", Boolean(soundsRow));
const rowText = soundsRow ? (await soundsRow.textContent()).replace(/\s+/g, " ") : "";
ok("в строке видно, что выбрано сейчас", /будильник .+ уведомления .+/i.test(rowText), rowText);

await soundsRow.click();
await sleep(800);
await page.screenshot({ path: path.join(OUT, "01-sounds.png") });

const rows = await page.$$eval(".sound-row", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
ok("на экране десять звуков", rows.length === 10, String(rows.length));
const names = rows.join(" | ");
ok("названия из нового набора",
  ["Рассвет", "Маяк", "Колокола", "Калимба", "Подъём", "Маримба", "Стекло", "Капля", "Вполголоса"].every(n => names.includes(n)),
  names);
ok("старых названий не осталось",
  !["Тревога", "Звоночек", "Пузырёк", "Аккорд", "Клик"].some(n => names.includes(n)),
  names);

// Главная проверка: браузер должен декодировать каждый файл, иначе кнопка «послушать» промолчит.
const decoded = await page.evaluate(async () => {
  const mod = await import("/sounds-catalog.js");
  const ids = [...mod.ALARM_SOUNDS, ...mod.NOTIFY_SOUNDS].map(s => s.id);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const out = [];
  for (const id of ids) {
    try {
      const res = await fetch(`/sounds/${id}.mp3`);
      const buf = await res.arrayBuffer();
      const audio = await ctx.decodeAudioData(buf);
      out.push({ id, ok: true, seconds: Number(audio.duration.toFixed(2)), bytes: buf.byteLength });
    } catch (err) {
      out.push({ id, ok: false, error: String(err) });
    }
  }
  return out;
});
for (const item of decoded) {
  ok(`${item.id} проигрывается браузером`, item.ok && item.seconds > 0.9,
    item.ok ? `${item.seconds} с, ${(item.bytes / 1024).toFixed(0)} КБ` : item.error);
}

// Выбор сохраняется и виден на экране будильника.
await page.click(".sound-row:has-text('Колокола')");
await sleep(900);
const chosen = await page.$eval(".sound-row.on, .sound-row:has-text('Колокола')", el => el.className);
ok("выбранный будильник отмечается", /on/.test(chosen), chosen);
await page.screenshot({ path: path.join(OUT, "02-picked.png") });

await page.click(".bar [data-go='settings'], .bar .icon-btn");
await sleep(700);
const after = await page.$eval("[data-go='sounds']", el => el.textContent.replace(/\s+/g, " "));
ok("настройки показывают новый выбор", /Колокола/.test(after), after);

ok("в консоли нет ошибок", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\nСнимки: ${OUT}`);
console.log(problems.length ? `\nПроблем: ${problems.length}` : "\nВсё прошло");
process.exit(problems.length ? 1 : 0);
