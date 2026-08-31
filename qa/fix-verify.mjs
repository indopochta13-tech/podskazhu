// Проверка трёх косметических правок: подсказка прокрутки у полок, положение тоста, ровные пузыри чата.
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import path from "node:path";

const BASE = "http://127.0.0.1:8791";
const QA_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(QA_DIR, "screens");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const problems = [];
const check = (ok, message) => {
  console.log(`  ${ok ? "✓" : "✗"} ${message}`);
  if (!ok) problems.push(message);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 400, height: 860 },
  deviceScaleFactor: 2,
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
});
const page = await context.newPage();
const errs = [];
page.on("pageerror", e => errs.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
page.on("response", r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });

const shot = name => page.screenshot({ path: `${OUT}/fix-${name}.png` });

// Пересечение прямоугольников — так ловим наложение тоста на элементы управления.
const overlapProbe = async (toastSel, targets) => page.evaluate(({ toastSel, targets }) => {
  const hit = (a, b) => !(a.right <= b.left + 0.5 || a.left >= b.right - 0.5 || a.bottom <= b.top + 0.5 || a.top >= b.bottom - 0.5);
  const t = document.querySelector(toastSel);
  if (!t) return { toast: null, hits: [] };
  const tr = t.getBoundingClientRect();
  const out = [];
  for (const { sel, name } of targets) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({
        name: `${name}${el.textContent.trim() ? ` «${el.textContent.trim().slice(0, 22)}»` : ""}`,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
        overlaps: hit(tr, r),
      });
    }
  }
  return {
    toast: { top: Math.round(tr.top), bottom: Math.round(tr.bottom), text: t.textContent.trim(), visible: t.classList.contains("show") },
    hits: out,
  };
}, { toastSel, targets });

const BOTTOM_TARGETS = [
  { sel: ".bar", name: "шапка" },
  { sel: ".offline-bar", name: "плашка офлайна" },
  { sel: "#detail-save", name: "кнопка" },
  { sel: ".seg", name: "переключатель Тип" },
  { sel: ".composer", name: "строка ввода" },
  { sel: ".widget", name: "виджет" },
];

async function toastReport(label) {
  const info = await overlapProbe("#toast", BOTTOM_TARGETS);
  const bad = info.hits.filter(h => h.overlaps);
  console.log(`   тост «${info.toast?.text}» top=${info.toast?.top} bottom=${info.toast?.bottom}`);
  check(info.toast?.visible === true, `${label}: тост показан`);
  check(bad.length === 0, `${label}: тост не перекрывает элементы управления${bad.length ? ` — задеты: ${bad.map(b => b.name).join(", ")}` : ""}`);
  return info;
}

/* ——— вход ——— */
await page.goto(BASE, { waitUntil: "networkidle" });
await page.click('[data-auth-tab="login"]');
await page.fill('[data-auth-form="login"] input[name="code"]', "RHRYPL");
await page.fill('[data-auth-form="login"] input[name="pin"]', "5566");
await page.click('[data-auth-form="login"] button[type="submit"]');
await page.waitForFunction(() => !document.querySelector(".auth"), null, { timeout: 15000 });
await sleep(600);
if (await page.locator("#onb-done").count()) {
  await page.click("#onb-done");
  await sleep(500);
}
const assetVersion = await page.evaluate(() => ({
  css: document.querySelector('link[rel="stylesheet"]')?.getAttribute("href"),
  js: document.querySelector('script[src*="app.js"]')?.getAttribute("src"),
}));
console.log("версия ассетов:", JSON.stringify(assetVersion));

/* ——— 1. Строка полок ——— */
console.log("\n1. Строка полок");
await page.click('.widget .w-btn[data-go="shelves"]');
await sleep(500);
const tabsStart = await page.evaluate(() => {
  const t = document.querySelector(".tabs");
  const cs = getComputedStyle(t);
  const last = [...t.querySelectorAll(".tab")].pop();
  return {
    clientWidth: t.clientWidth,
    scrollWidth: t.scrollWidth,
    scrollLeft: Math.round(t.scrollLeft),
    scrollbarPx: t.offsetHeight - t.clientHeight,
    layers: cs.backgroundImage.split(/,(?![^()]*\))/).length,
    attachment: cs.backgroundAttachment,
    lastLabel: last.textContent,
    lastFullyVisible: last.getBoundingClientRect().right <= t.getBoundingClientRect().right + 0.5,
  };
});
console.log("   ", JSON.stringify(tabsStart));
check(tabsStart.scrollWidth > tabsStart.clientWidth, "строка вкладок шире экрана (прокрутка нужна)");
check(tabsStart.layers >= 4 && /local/.test(tabsStart.attachment), "у строки есть слои-затухания, привязанные к прокрутке");
check(tabsStart.scrollbarPx === 0, "полоса прокрутки скрыта");
await shot("01-tabs-start");

// Затухание должно быть именно у правого края в начале и у левого — после прокрутки.
const edgePixels = async () => page.evaluate(() => {
  const t = document.querySelector(".tabs");
  const r = t.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), height: Math.round(r.height), scrollLeft: Math.round(t.scrollLeft) };
});
console.log("   геометрия строки:", JSON.stringify(await edgePixels()));

await page.evaluate(() => { document.querySelector(".tabs").scrollLeft = 999; });
await sleep(350);
const tabsEnd = await page.evaluate(() => {
  const t = document.querySelector(".tabs");
  const last = [...t.querySelectorAll(".tab")].pop();
  const lr = last.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  return {
    scrollLeft: Math.round(t.scrollLeft),
    lastLabel: last.textContent,
    lastFullyVisible: lr.left >= tr.left - 0.5 && lr.right <= tr.right + 0.5,
  };
});
console.log("   ", JSON.stringify(tabsEnd));
check(tabsEnd.lastFullyVisible, `«${tabsEnd.lastLabel}» полностью видна после прокрутки`);
await shot("02-tabs-scrolled-right");

// После выбора крайней полки строка сама возвращает активную вкладку в поле зрения.
await page.click('[data-shelf-tab="bday"]');
await sleep(450);
const afterPick = await page.evaluate(() => {
  const t = document.querySelector(".tabs");
  const on = t.querySelector(".tab.on");
  const orr = on.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  return {
    active: on.textContent,
    scrollLeft: Math.round(t.scrollLeft),
    visible: orr.left >= tr.left - 0.5 && orr.right <= tr.right + 0.5,
  };
});
console.log("   ", JSON.stringify(afterPick));
check(afterPick.active === "Дни рождения" && afterPick.visible, "после выбора «Дни рождения» вкладка видна целиком");
await shot("03-tabs-bday-selected");

await page.click('[data-shelf-tab="today"]');
await sleep(400);
await shot("04-tabs-today-selected");

/* ——— 2. Тост на карточке ——— */
console.log("\n2. Тост");
await page.click('[data-shelf-tab="notes"]');
await sleep(350);
if (!(await page.locator(".card-row").count())) {
  await page.click('[data-shelf-tab="tasks"]');
  await sleep(350);
}
await page.locator(".card-row").first().locator(".card-main").click();
await sleep(600);
await page.evaluate(() => { const s = document.querySelector(".scroll"); s.scrollTop = s.scrollHeight; });
await sleep(400);
await shot("05-detail-bottom-before-toast");

// «Поставить будильник» оставляет нас на карточке — как раз тот случай, где тост мешал.
await page.click("#detail-alarm");
await page.waitForFunction(() => document.getElementById("toast").classList.contains("show"), null, { timeout: 10000 });
await sleep(350);
const detailToast = await toastReport("карточка");
await shot("06-detail-toast");
await page.click("#detail-alarm"); // возвращаем будильник в исходное состояние
await sleep(700);

// Тост на остальных экранах: полки, чат, домашний экран.
await page.click('.bar [data-go="shelves"]');
await sleep(500);
await page.locator(".card-row .tick").first().click();
await page.waitForFunction(() => document.getElementById("toast").classList.contains("show"), null, { timeout: 10000 });
await sleep(300);
await toastReport("полки");
await shot("07-shelves-toast");
await sleep(2200);
await page.locator(".card-row .tick").first().click(); // возвращаем как было
await sleep(1200);

/* ——— 3. Пузыри чата ——— */
console.log("\n3. Пузыри чата");
await page.click('.bar [data-go="chat"]');
await sleep(400);
await page.evaluate(() => { localStorage.removeItem("vc.chat"); });
await page.reload({ waitUntil: "networkidle" });
await sleep(900);
if (!(await page.locator("#chat-input").count())) {
  await page.click('.widget .w-btn[data-go="chat"]');
  await sleep(500);
}

async function sendChat(text) {
  const before = await page.evaluate(() => document.querySelectorAll(".bubble.ai").length);
  await page.fill("#chat-input", text);
  await page.click("#chat-send");
  await page.waitForFunction(prev => {
    const bs = [...document.querySelectorAll(".bubble.ai")];
    if (bs.some(b => b.textContent.includes("Разбираю"))) return false;
    return bs.length > prev;
  }, before, { timeout: 25000 });
  await sleep(250);
}

await sendChat("записать идею про упаковку");
// Чип «утром 9:00» добавляет ответ без чипов — именно на нём лента и «прыгала».
await page.click('#chat-log .chip[data-chip^="time-"]');
await page.waitForFunction(() => [...document.querySelectorAll(".bubble.ai strong")].some(s => s.textContent === "Время поставила"), null, { timeout: 15000 });
await sleep(250);
await sendChat("записать идею про упаковку");

const bubbles = await page.evaluate(() => {
  const log = document.querySelector(".chat-log");
  const logW = log.getBoundingClientRect().width;
  return [...document.querySelectorAll(".bubble")].map(b => {
    const r = b.getBoundingClientRect();
    return {
      role: b.classList.contains("me") ? "я" : "ИИ",
      chips: b.querySelectorAll(".chip").length,
      width: Math.round(r.width),
      left: Math.round(r.left),
      right: Math.round(r.right),
      logWidth: Math.round(logW),
      text: b.innerText.replace(/\n+/g, " | ").slice(0, 40),
    };
  });
});
console.log(JSON.stringify(bubbles, null, 1));
const ai = bubbles.filter(b => b.role === "ИИ");
const me = bubbles.filter(b => b.role === "я");
const widths = [...new Set(ai.map(b => b.width))];
const lefts = [...new Set(ai.map(b => b.left))];
check(ai.some(b => b.chips > 0) && ai.some(b => b.chips === 0), "в ленте есть ответы и с чипами, и без них");
check(widths.length === 1, `ширина всех пузырей ИИ одинакова (${widths.join(" / ")} px)`);
check(lefts.length === 1, "все пузыри ИИ прижаты к левому краю");
check(me.every(b => b.right >= Math.max(...ai.map(a => a.right)) - 1), "сообщения пользователя прижаты к правому краю");
await shot("08-chat-even-bubbles");

// Тост на экране чата — не должен ложиться на строку ввода и шапку.
await sendChat("позвонить маме завтра в 15:00");
await page.evaluate(() => { document.querySelector(".chat-log").scrollTop = 1e6; });
await page.locator('#chat-log .chip[data-chip="alarm"]').last().click();
await page.waitForFunction(() => document.getElementById("toast").classList.contains("show"), null, { timeout: 10000 });
await sleep(300);
await toastReport("чат");
await shot("09-chat-toast");
await sleep(2300);

// Убираем за собой созданные в проверке записи.
for (const sel of ['#chat-log .chip[data-chip="cancel"]']) {
  while (await page.locator(sel).count()) {
    await page.locator(sel).first().click();
    await sleep(700);
  }
}

// Домашний экран: тост и здесь остаётся выше виджета с кнопками.
await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(1000);
await shot("10-home");

console.log("\nошибки в консоли/сети:", errs.length ? JSON.stringify([...new Set(errs)], null, 1) : "нет");
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}):\n - ${problems.join("\n - ")}` : "\nВсе проверки прошли");
await browser.close();
process.exit(problems.length ? 1 : 0);
