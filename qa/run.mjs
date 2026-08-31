import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8791";
const QA_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(QA_DIR, "screens");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const jsErrors = [];
const consoleErrors = [];
const netErrors = [];
const logEntries = [];
const shots = [];
let shotN = 0;

function step(id, title) {
  const rec = { id, title, status: "не прошло", observed: [], defects: [], shots: [] };
  results.push(rec);
  return {
    ok: (m) => { rec.status = "прошло"; if (m) rec.observed.push(m); },
    partial: (m) => { rec.status = "частично"; if (m) rec.observed.push(m); },
    fail: (m) => { rec.status = "не прошло"; if (m) rec.observed.push(m); },
    note: (m) => rec.observed.push(m),
    defect: (m) => rec.defects.push(m),
    shot: (p) => rec.shots.push(p),
    rec,
  };
}

let page;
async function snap(name, rec) {
  shotN += 1;
  const file = path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
  if (rec) rec.shot(file);
  return file;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function clearToast() {
  await page.evaluate(() => {
    const t = document.getElementById("toast");
    if (t) { t.classList.remove("show"); t.textContent = ""; }
  });
}

async function grabToast(timeout = 9000) {
  try {
    await page.waitForFunction(
      () => { const t = document.getElementById("toast"); return t && t.classList.contains("show") && t.textContent.trim().length > 0; },
      null, { timeout });
    return (await page.textContent("#toast")).trim();
  } catch {
    return null;
  }
}

async function screenName() {
  return page.evaluate(() => {
    const h = document.querySelector(".bar h2");
    if (h) return h.textContent.trim();
    if (document.querySelector(".auth")) return "AUTH";
    if (document.querySelector(".home")) return "HOME";
    return "?";
  });
}

async function aiBubbles() {
  return page.evaluate(() => [...document.querySelectorAll(".bubble.ai")].map(b => ({
    title: b.querySelector("strong")?.textContent ?? "",
    lines: [...b.querySelectorAll(".ai-line")].map(e => e.textContent),
    bell: b.querySelector(".ai-bell")?.textContent ?? "",
    chips: [...b.querySelectorAll(".chip")].map(e => ({ label: e.textContent, action: e.dataset.chip, id: e.dataset.id })),
    text: b.innerText.replace(/\n+/g, " | "),
  })));
}

async function sendChat(text) {
  const before = (await aiBubbles()).length;
  await page.fill("#chat-input", text);
  await page.click("#chat-send");
  await page.waitForFunction((prev) => {
    const bs = [...document.querySelectorAll(".bubble.ai")];
    if (bs.some(b => b.textContent.includes("Разбираю"))) return false;
    return bs.length > prev;
  }, before, { timeout: 20000 });
  await sleep(150);
  const all = await aiBubbles();
  return all[all.length - 1];
}

async function itemsSnapshot() {
  return page.evaluate(() => (window.__vcItems || []));
}

// Общий визуальный аудит: горизонтальный вылет, обрезанный текст, наложения.
async function visualAudit(label) {
  return page.evaluate((label) => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const se = document.scrollingElement;
    if (se && se.scrollWidth > vw + 1) out.push(`горизонтальный вылет страницы: scrollWidth=${se.scrollWidth} > ширина ${vw}`);
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1) clipped.push(`вылет за правый край: <${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").join(".") : ""}> right=${Math.round(r.right)} > ${vw}`);
      const scrollable = /auto|scroll/.test(cs.overflow + cs.overflowX + cs.overflowY);
      if (!scrollable && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        const t = (el.textContent || "").trim().slice(0, 40);
        clipped.push(`обрезано по ширине: <${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}> scrollW=${el.scrollWidth} clientW=${el.clientWidth} текст="${t}"`);
      }
      if (!scrollable && el.scrollHeight > el.clientHeight + 2 && el.children.length === 0) {
        const t = (el.textContent || "").trim().slice(0, 40);
        clipped.push(`обрезано по высоте: <${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}> scrollH=${el.scrollHeight} clientH=${el.clientHeight} текст="${t}"`);
      }
    }
    return { label, findings: [...out, ...[...new Set(clipped)].slice(0, 12)] };
  }, label);
}

/* ——— запуск ——— */

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 400, height: 860 },
  deviceScaleFactor: 2,
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
  permissions: ["clipboard-read", "clipboard-write"],
});
page = await context.newPage();

page.on("pageerror", err => jsErrors.push({ source: "pageerror", text: err.message, stack: err.stack }));
page.on("console", msg => {
  if (msg.type() === "error" || msg.type() === "warning") {
    consoleErrors.push({ type: msg.type(), text: msg.text(), location: msg.location() });
  }
});
page.on("requestfailed", r => netErrors.push({ kind: "requestfailed", url: r.url(), method: r.method(), error: r.failure()?.errorText }));
page.on("response", async r => {
  if (r.status() >= 400) {
    let body = "";
    try { body = (await r.text()).slice(0, 400); } catch {}
    netErrors.push({ kind: "http", status: r.status(), method: r.request().method(), url: r.url(), body });
  }
});

const cdp = await context.newCDPSession(page);
await cdp.send("Runtime.enable");
await cdp.send("Log.enable");
await cdp.send("Network.enable");
await cdp.send("Page.enable");
cdp.on("Runtime.exceptionThrown", e => {
  const d = e.exceptionDetails;
  jsErrors.push({
    source: "CDP Runtime.exceptionThrown",
    text: d.exception?.description || d.text,
    url: d.url,
    line: d.lineNumber,
    column: d.columnNumber,
    stack: (d.stackTrace?.callFrames || []).map(f => `  at ${f.functionName || "<anon>"} (${f.url}:${f.lineNumber}:${f.columnNumber})`).join("\n"),
  });
});
cdp.on("Runtime.consoleAPICalled", e => {
  if (e.type === "error" || e.type === "warning" || e.type === "assert") {
    consoleErrors.push({
      source: "CDP Runtime.consoleAPICalled",
      type: e.type,
      text: e.args.map(a => a.description ?? (a.value !== undefined ? String(a.value) : a.type)).join(" "),
      stack: (e.stackTrace?.callFrames || []).slice(0, 4).map(f => `  at ${f.functionName || "<anon>"} (${f.url}:${f.lineNumber})`).join("\n"),
    });
  }
});
cdp.on("Log.entryAdded", e => {
  logEntries.push({ level: e.entry.level, source: e.entry.source, text: e.entry.text, url: e.entry.url, line: e.entry.lineNumber });
});
cdp.on("Network.responseReceived", e => {
  if (e.response.status >= 400) {
    netErrors.push({ kind: "CDP Network.responseReceived", status: e.response.status, url: e.response.url });
  }
});
cdp.on("Network.loadingFailed", e => {
  netErrors.push({ kind: "CDP Network.loadingFailed", url: "(requestId " + e.requestId + ")", error: e.errorText, type: e.type, canceled: e.canceled });
});

let CODE = null;

try {
  /* ——— 1 ——— */
  {
    const s = step(1, "Открыть / и при необходимости выйти на экран входа");
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await sleep(400);
    let scr = await screenName();
    s.note(`после загрузки экран: ${scr}`);
    if (scr !== "AUTH") {
      s.note("сессия была активна — иду Настройки → Выйти");
      const gear = page.locator('[data-go="settings"]').first();
      if (await gear.count()) { await gear.click(); await sleep(300); }
      const logout = page.locator("#logout");
      if (await logout.count()) { await logout.click(); await sleep(600); }
      scr = await screenName();
    }
    const hasTabs = await page.locator('[data-auth-tab="register"]').count();
    if (scr === "AUTH" && hasTabs) s.ok(`экран входа отрисован, вкладки «Новый вход» / «У меня есть код» на месте`);
    else s.fail(`ожидался экран входа, получено «${scr}»`);
    const va = await visualAudit("auth");
    va.findings.forEach(f => s.defect(f));
    await snap("auth", s);
  }

  /* ——— 2 ——— */
  {
    const s = step(2, "Регистрация: Имя=Проба, PIN=5566, «Начать»");
    await page.click('[data-auth-tab="register"]');
    await page.fill('[data-auth-form="register"] input[name="name"]', "Проба");
    await page.fill('[data-auth-form="register"] input[name="pin"]', "5566");
    const btn = page.locator('[data-auth-form="register"] button[type="submit"]');
    s.note(`подпись кнопки: «${(await btn.textContent()).trim()}»`);
    await btn.click();
    await page.waitForFunction(() => !document.querySelector(".auth"), null, { timeout: 15000 });
    await sleep(600);
    const err = await page.locator("[data-auth-error]").count() ? await page.textContent("[data-auth-error]") : "";
    if (err && err.trim()) s.fail(`ошибка формы: ${err.trim()}`);
    else s.ok(`регистрация прошла, приложение ушло с экрана входа (экран «${await screenName()}»)`);
  }

  /* ——— 3 ——— */
  {
    const s = step(3, "Сразу после регистрации — экран «Три шага» (код+копировать, экран Домой, уведомления)");
    const title = await screenName();
    s.note(`заголовок экрана: «${title}»`);
    const steps = await page.evaluate(() => [...document.querySelectorAll(".step")].map(el => ({
      num: el.querySelector(".step-num")?.textContent.trim(),
      name: el.querySelector(".name")?.textContent.trim(),
      sub: el.querySelector(".sub")?.textContent.trim(),
      done: el.classList.contains("done"),
    })));
    const code = await page.locator(".code-box .code").first().textContent().catch(() => null);
    CODE = code ? code.trim() : null;
    const copyBtn = await page.locator("#copy-code").count();
    const copyLabel = copyBtn ? (await page.textContent("#copy-code")).trim() : "";
    const doneBtn = await page.locator("#onb-done").count() ? (await page.textContent("#onb-done")).trim() : "";
    const pushBtn = await page.locator("#onb-push").count() ? (await page.textContent("#onb-push")).trim() : "";
    s.note(`пункты: ${steps.map(x => `${x.num}) ${x.name}`).join("; ")}`);
    s.note(`код: ${CODE}; кнопка копирования: «${copyLabel}»; кнопка 3-го шага: «${pushBtn}»; нижняя кнопка: «${doneBtn}»`);
    const okTitle = title === "Три шага";
    const ok1 = /Сохраните код/.test(steps[0]?.name || "") && CODE && copyLabel === "Скопировать код";
    const ok2 = /Поставьте на экран/.test(steps[1]?.name || "");
    const ok3 = /Разрешите уведомления/.test(steps[2]?.name || "");
    if (okTitle && ok1 && ok2 && ok3 && steps.length === 3) s.ok("все три пункта на месте, код показан, кнопка «Скопировать код» есть");
    else s.fail(`несоответствие: title=${okTitle} шаг1=${ok1} шаг2=${ok2} шаг3=${ok3} кол-во=${steps.length}`);
    // проверим саму кнопку копирования
    await clearToast();
    await page.click("#copy-code");
    const t = await grabToast(4000);
    s.note(`«Скопировать код» → тост: ${t ? `«${t}»` : "тоста не было"}`);
    const va = await visualAudit("onboarding");
    va.findings.forEach(f => s.defect(f));
    await snap("tri-shaga-after-register", s);
  }

  /* ——— 4 ——— */
  {
    const s = step(4, "«Всё, начинаем» → домашний экран с виджетом из трёх кнопок");
    await page.click("#onb-done");
    await sleep(500);
    const home = await page.locator(".home").count();
    const w = await page.evaluate(() => [...document.querySelectorAll(".widget .w-cap")].map(c => ({
      label: c.querySelector("span")?.textContent.trim(),
      go: c.querySelector(".w-btn")?.dataset.go,
    })));
    s.note(`виджет: ${JSON.stringify(w, null, 0)}`);
    if (home && w.length === 3) s.ok(`домашний экран, три кнопки: ${w.map(x => x.label).join(" / ")}`);
    else s.fail(`home=${home}, кнопок в виджете: ${w.length}`);
    const va = await visualAudit("home");
    va.findings.forEach(f => s.defect(f));
    await snap("home-widget", s);
  }

  /* ——— 5а ——— */
  let vitaminId = null, parcelId = null;
  {
    const s = step("5а", "Чат: «каждый день в 8 утра витамины» → карточка «Записала» + «каждый день» + «Напомню»");
    await page.click('.widget .w-btn[data-go="chat"]');
    await sleep(400);
    s.note(`экран: «${await screenName()}»`);
    const b = await sendChat("каждый день в 8 утра витамины");
    s.note(`ответ: ${b.text}`);
    s.note(`заголовок=«${b.title}» строки=${JSON.stringify(b.lines)} колокольчик=«${b.bell}»`);
    s.note(`чипы: ${b.chips.map(c => c.label).join(" / ")}`);
    vitaminId = b.chips.find(c => c.id)?.id || null;
    const okT = b.title === "Записала";
    const okRep = b.lines.some(l => l.includes("каждый день"));
    const okBell = b.bell.includes("Напомню");
    if (okT && okRep && okBell) s.ok("карточка «Записала», в строке «каждый день», строка «Напомню» присутствует");
    else s.fail(`title=${okT} «каждый день»=${okRep} «Напомню»=${okBell}`);
    await snap("chat-5a-vitamins", s);
  }

  /* ——— 5б ——— */
  {
    const s = step("5б", "Повтор той же фразы → «Уже стоит», новая запись не создаётся");
    const before = await page.evaluate(() => document.querySelectorAll(".bubble.ai").length);
    const b = await sendChat("каждый день в 8 утра витамины");
    s.note(`ответ: ${b.text}`);
    s.note(`заголовок=«${b.title}»`);
    const okT = /Уже стоит/i.test(b.title);
    // сколько «Витамины» лежит на полках
    const cnt = await page.evaluate(async () => {
      const tok = localStorage.getItem("vc.token");
      const r = await fetch("/api/state", { headers: { Authorization: "Bearer " + tok } });
      const d = await r.json();
      return d.items.filter(i => /витамин/i.test(i.title)).length;
    });
    s.note(`записей «Витамины» в состоянии сервера: ${cnt}`);
    if (okT && cnt === 1) s.ok("получено «Уже стоит», дубликат не создан (ровно 1 запись)");
    else s.fail(`title=«${b.title}» (ожидалось «Уже стоит»), записей=${cnt} (ожидалась 1)`);
    await snap("chat-5b-duplicate", s);
  }

  /* ——— 5в ——— */
  {
    const s = step("5в", "«в субботу забрать посылку» → без времени + 3 чипа + «Другое время»");
    const b = await sendChat("в субботу забрать посылку");
    s.note(`ответ: ${b.text}`);
    s.note(`заголовок=«${b.title}» строки=${JSON.stringify(b.lines)} колокольчик=«${b.bell}»`);
    const labels = b.chips.map(c => c.label);
    s.note(`чипы: ${labels.join(" / ")}`);
    parcelId = b.chips.find(c => c.id)?.id || null;
    const want = ["утром 9:00", "в обед 13:00", "вечером 19:00"];
    const okChips = want.every(w => labels.includes(w));
    const okOther = labels.includes("Другое время");
    const noTime = b.lines.some(l => l.includes("без времени")) || !/\d{2}:\d{2}/.test(b.lines.join(" "));
    if (okChips && okOther && noTime) s.ok("карточка без времени, три чипа быстрого времени и «Другое время» на месте");
    else s.fail(`чипы=${okChips} «Другое время»=${okOther} безВремени=${noTime}`);
    await snap("chat-5v-parcel-chips", s);
  }

  /* ——— 5г ——— */
  {
    const s = step("5г", "Чип «в обед 13:00» → карточка «Время поставила» с 13:00");
    const before = await page.evaluate(() => document.querySelectorAll(".bubble.ai").length);
    await page.locator('.chip', { hasText: "в обед 13:00" }).last().click();
    await page.waitForFunction((prev) => document.querySelectorAll(".bubble.ai").length > prev, before, { timeout: 15000 });
    await sleep(250);
    const all = await aiBubbles();
    const b = all[all.length - 1];
    s.note(`ответ: ${b.text}`);
    const okT = b.title === "Время поставила";
    const ok13 = b.text.includes("13:00");
    if (okT && ok13) s.ok("карточка «Время поставила», время 13:00");
    else s.fail(`title=«${b.title}» содержит13:00=${ok13}`);
    const va = await visualAudit("chat");
    va.findings.forEach(f => s.defect(f));
    await snap("chat-5g-time-set", s);
  }

  /* ——— 6 ——— */
  {
    const s = step(6, "Полки → «Дела»: квадратная кнопка-галочка, отметка «Готово» и возврат в работу");
    await page.click('.bar [data-go="shelves"]');
    await sleep(400);
    s.note(`экран: «${await screenName()}»`);
    await page.click('[data-shelf-tab="tasks"]');
    await sleep(300);
    const cards = await page.evaluate(() => [...document.querySelectorAll(".card-row")].map(r => {
      const tick = r.querySelector(".tick");
      const tb = tick?.getBoundingClientRect();
      return {
        title: r.querySelector(".title")?.textContent.trim(),
        meta: r.querySelector(".meta")?.innerText.replace(/\n/g, " | "),
        pill: r.querySelector(".pill")?.textContent.trim(),
        tickTag: tick?.tagName,
        tickBox: tb ? { w: Math.round(tb.width), h: Math.round(tb.height) } : null,
        tickSeparate: tick ? !tick.closest("[data-open]") : false,
        innerSquare: (() => { const i = tick?.querySelector("i"); if (!i) return null; const b = i.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), radius: getComputedStyle(i).borderRadius }; })(),
      };
    }));
    s.note(`карточки на «Дела»: ${JSON.stringify(cards)}`);
    const parcel = cards.find(c => /посылк/i.test(c.title || ""));
    const tickOk = parcel && parcel.tickTag === "BUTTON" && parcel.tickSeparate && parcel.innerSquare && Math.abs(parcel.innerSquare.w - parcel.innerSquare.h) <= 1;
    if (tickOk) s.note(`галочка — отдельная кнопка ${parcel.tickBox.w}×${parcel.tickBox.h}px, внутри квадрат ${parcel.innerSquare.w}×${parcel.innerSquare.h} (radius ${parcel.innerSquare.radius})`);
    else s.note("галочка не опознана как отдельная квадратная кнопка");

    const row = page.locator(".card-row", { hasText: "Забрать посылку" }).first();
    await clearToast();
    await row.locator(".tick").click();
    const t1 = await grabToast();
    await sleep(400);
    const scrAfter = await screenName();
    const st1 = await page.evaluate(() => {
      const r = [...document.querySelectorAll(".card-row")].find(x => /посылк/i.test(x.textContent));
      if (!r) return null;
      const title = r.querySelector(".title");
      return { done: r.classList.contains("done"), deco: getComputedStyle(title).textDecorationLine, tickOn: !!r.querySelector(".tick.on") };
    });
    s.note(`после 1-го тапа: тост=${t1 ? `«${t1}»` : "нет"}, экран=«${scrAfter}», класс done=${st1?.done}, text-decoration=${st1?.deco}, галочка активна=${st1?.tickOn}`);
    await snap("shelf-tasks-done", s);

    await clearToast();
    await row.locator(".tick").click();
    const t2 = await grabToast();
    await sleep(400);
    const st2 = await page.evaluate(() => {
      const r = [...document.querySelectorAll(".card-row")].find(x => /посылк/i.test(x.textContent));
      if (!r) return null;
      return { done: r.classList.contains("done"), deco: getComputedStyle(r.querySelector(".title")).textDecorationLine, tickOn: !!r.querySelector(".tick.on") };
    });
    s.note(`после 2-го тапа: тост=${t2 ? `«${t2}»` : "нет"}, класс done=${st2?.done}, text-decoration=${st2?.deco}`);
    await snap("shelf-tasks-undone", s);

    const okDone = t1 === "Готово" && st1?.done === true && st1?.deco.includes("line-through");
    const okBack = st2?.done === false && !st2?.deco.includes("line-through");
    if (tickOk && okDone && okBack) s.ok("галочка отдельная, тост «Готово», название зачёркнуто, повторный тап вернул в работу");
    else if (tickOk && st1?.done && okBack) s.partial(`отметка/возврат работают, но тост при отметке = ${t1 ? `«${t1}»` : "нет"} (ожидалось «Готово»)`);
    else s.fail(`галочка=${tickOk} отметка=${okDone} возврат=${okBack}`);
    const va = await visualAudit("shelves");
    va.findings.forEach(f => s.defect(f));
  }

  /* ——— 7 ——— */
  {
    const s = step(7, "Карточка «Витамины» тапом по тексту: 4 блока Когда/Время/Пуш/Повтор + «Место» + «Тип»");
    await page.locator(".card-row", { hasText: "Витамины" }).first().locator(".card-main").click();
    await sleep(500);
    s.note(`экран: «${await screenName()}»`);
    const blocks = await page.evaluate(() => [...document.querySelectorAll(".pick-block")].map(b => ({
      key: b.querySelector(".pick-head")?.dataset.pick,
      lab: b.querySelector(".lab")?.textContent.trim(),
      val: b.querySelector(".val")?.textContent.trim(),
      open: b.classList.contains("open"),
    })));
    const place = await page.evaluate(() => {
      const inp = document.getElementById("f-place");
      if (!inp) return null;
      return { label: inp.closest(".field")?.querySelector("span")?.textContent.trim(), placeholder: inp.placeholder, value: inp.value };
    });
    const types = await page.evaluate(() => {
      const seg = [...document.querySelectorAll(".field")].find(f => f.querySelector("span")?.textContent.trim() === "Тип");
      if (!seg) return null;
      return [...seg.querySelectorAll("[data-type-set]")].map(b => ({ id: b.dataset.typeSet, label: b.textContent.trim(), on: b.classList.contains("on") }));
    });
    s.note(`блоки: ${blocks.map(b => `${b.lab}=«${b.val}»`).join("; ")}`);
    s.note(`поле «Место»: ${JSON.stringify(place)}`);
    s.note(`переключатель «Тип»: ${types ? types.map(t => t.label + (t.on ? "*" : "")).join(" / ") : "не найден"}`);
    const wantLabs = ["Когда", "Время", "Пуш", "Повтор"];
    const okBlocks = blocks.length === 4 && wantLabs.every((l, i) => blocks[i]?.lab === l);
    const okPlace = place && place.label === "Место";
    const okTypes = types && types.length === 4 && ["Встреча", "Дело", "Заметка", "Др"].every((l, i) => types[i]?.label === l);
    if (okBlocks && okPlace && okTypes) s.ok("четыре блока Когда/Время/Пуш/Повтор, поле «Место», переключатель Встреча/Дело/Заметка/Др");
    else s.fail(`блоки=${okBlocks} место=${okPlace} тип=${okTypes}`);
    const va = await visualAudit("detail");
    va.findings.forEach(f => s.defect(f));
    await snap("detail-vitamins-4blocks", s);
  }

  /* ——— 8 ——— */
  {
    const s = step(8, "Блок «Повтор»: колесо со 6 значениями, прокрутка через CDP Runtime.evaluate меняет заголовок");
    const valBefore = await page.textContent("#val-repeat");
    await page.click('[data-pick="repeat"]');
    await sleep(500);
    const wheelInfo = await page.evaluate(() => {
      const w = document.querySelector('.wheel[data-wheel="repeat"]');
      if (!w) return null;
      const cs = getComputedStyle(w);
      return {
        values: [...w.querySelectorAll(".wheel-item")].map(i => i.textContent),
        index: w.dataset.index,
        scrollTop: w.scrollTop,
        scrollHeight: w.scrollHeight,
        clientHeight: w.clientHeight,
        overflowY: cs.overflowY,
        open: !!document.querySelector('.pick-block.open [data-pick="repeat"]'),
      };
    });
    s.note(`заголовок «Повтор» до прокрутки: «${valBefore.trim()}»`);
    s.note(`колесо: ${JSON.stringify(wheelInfo)}`);
    const want = ["без повтора", "каждый день", "по будням", "по выходным", "каждую неделю", "каждый месяц"];
    const okVals = wheelInfo && want.length === wheelInfo.values.length && want.every((v, i) => wheelInfo.values[i] === v);

    const ev = await cdp.send("Runtime.evaluate", {
      expression: `(() => { const w = document.querySelector('.wheel[data-wheel="repeat"]'); if (!w) return 'нет колеса'; w.scrollTop = 2 * 40; return 'scrollTop=' + w.scrollTop; })()`,
      returnByValue: true,
    });
    s.note(`CDP Runtime.evaluate → ${JSON.stringify(ev.result?.value ?? ev)}`);
    await sleep(250);
    const after = await page.evaluate(() => ({
      val: document.getElementById("val-repeat")?.textContent.trim(),
      index: document.querySelector('.wheel[data-wheel="repeat"]')?.dataset.index,
      onItem: document.querySelector('.wheel[data-wheel="repeat"] .wheel-item.on')?.textContent,
    }));
    s.note(`после прокрутки: заголовок=«${after.val}», data-index=${after.index}, подсвечено=«${after.onItem}»`);
    const okChanged = after.val && after.val !== valBefore.trim() && after.val === "по будням";
    if (okVals && okChanged) s.ok("шесть значений в колесе, прокрутка на 2 позиции сменила заголовок на «по будням»");
    else s.fail(`значения=${okVals} сменаЗаголовка=${okChanged} (было «${valBefore.trim()}», стало «${after.val}»)`);
    const va = await visualAudit("repeat-wheel");
    va.findings.forEach(f => s.defect(f));
    await snap("detail-repeat-wheel", s);
  }

  /* ——— 9 ——— */
  {
    const s = step(9, "Автосохранение → назад на Полки, запись на месте");
    await clearToast();
    await page.locator('.bar [data-go="shelves"]').click();
    await sleep(700);
    const scr = await screenName();
    const meta = await page.evaluate(() => {
      const r = [...document.querySelectorAll(".card-row")].find(x => /витамин/i.test(x.textContent));
      return r ? r.querySelector(".meta")?.innerText.replace(/\n/g, " | ") : null;
    });
    s.note(`экран: «${scr}», мета «Витамины»: ${meta || "нет"}`);
    if (scr === "Полки" && meta) s.ok("вернулись на «Полки», запись сохранилась без кнопки «Сохранить»");
    else s.fail(`экран=«${scr}» мета=${meta ? "есть" : "нет"}`);
    await snap("saved-back-to-shelves", s);
  }

  /* ——— 10 ——— */
  {
    const s = step(10, "Тип «Заметка» → запись переезжает на полку «Заметки»");
    await page.locator(".card-row", { hasText: "Витамины" }).first().locator(".card-main").click();
    await sleep(450);
    await page.click('[data-type-set="note"]');
    await sleep(600);
    const typeState = await page.evaluate(() => [...document.querySelectorAll("[data-type-set]")].map(b => b.textContent.trim() + (b.classList.contains("on") ? "*" : "")).join(" / "));
    s.note(`после нажатия «Заметка» переключатель: ${typeState}`);
    await page.click('.bar [data-go="shelves"]');
    await sleep(400);
    await page.click('[data-shelf-tab="notes"]');
    await sleep(400);
    const onNotes = await page.evaluate(() => [...document.querySelectorAll(".card-row")].map(r => ({ title: r.querySelector(".title")?.textContent.trim(), pill: r.querySelector(".pill")?.textContent.trim() })));
    s.note(`полка «Заметки»: ${JSON.stringify(onNotes)}`);
    await page.click('[data-shelf-tab="tasks"]');
    await sleep(350);
    const onTasks = await page.evaluate(() => [...document.querySelectorAll(".card-row")].map(r => r.querySelector(".title")?.textContent.trim()));
    s.note(`полка «Дела» после переноса: ${JSON.stringify(onTasks)}`);
    await page.click('[data-shelf-tab="notes"]');
    await sleep(300);
    const okNotes = onNotes.some(c => /витамин/i.test(c.title || ""));
    const goneFromTasks = !onTasks.some(t => /витамин/i.test(t || ""));
    if (okNotes && goneFromTasks) s.ok("«Витамины» теперь на полке «Заметки» и исчезли с «Дел»");
    else if (okNotes) s.partial("запись появилась на «Заметки», но всё ещё видна на «Дела»");
    else s.fail("на полке «Заметки» записи нет");
    await snap("shelf-notes", s);
  }

  /* ——— 11 ——— */
  {
    const s = step(11, "Настройки → «Как поставить на экран телефона» открывает «Три шага»");
    await page.click('.bar [data-go="settings"]');
    await sleep(450);
    s.note(`экран: «${await screenName()}»`);
    const settings = await page.evaluate(() => [...document.querySelectorAll(".setting .name")].map(n => n.textContent.trim()));
    s.note(`пункты настроек: ${JSON.stringify(settings)}`);
    const target = page.locator(".setting", { hasText: "Как поставить на экран телефона" });
    const present = await target.count();
    if (!present) { s.fail("пункт «Как поставить на экран телефона» не найден"); }
    else {
      const sub = await target.first().locator(".sub").textContent();
      s.note(`подпись пункта: «${sub.trim()}»`);
      await snap("settings-list", s);
      await target.first().click();
      await sleep(500);
      const scr = await screenName();
      const stepsCount = await page.locator(".step").count();
      const backTo = await page.evaluate(() => document.querySelector(".bar [data-go]")?.dataset.go);
      s.note(`после нажатия: экран=«${scr}», пунктов=${stepsCount}, кнопка «назад» ведёт на «${backTo}»`);
      if (scr === "Три шага" && stepsCount === 3) s.ok("пункт есть и открывает экран «Три шага» с тремя пунктами");
      else s.fail(`экран=«${scr}» пунктов=${stepsCount}`);
      const va = await visualAudit("onboarding-from-settings");
      va.findings.forEach(f => s.defect(f));
      await snap("tri-shaga-from-settings", s);
    }
  }

  /* ——— 12 ——— */
  {
    const s = step(12, "Сбор ошибок JS и сетевых ответов 4xx/5xx");
    // добираем всё, что могло прийти с задержкой
    await sleep(1200);
    s.note(`JS-исключений: ${jsErrors.length}; console error/warning: ${consoleErrors.length}; сетевых 4xx/5xx и сбоев: ${netErrors.length}; записей Log: ${logEntries.length}`);
    s.ok("сбор выполнен (Log.enable + Runtime.consoleAPICalled + Runtime.exceptionThrown + Network.enable)");
  }
} catch (err) {
  results.push({ id: "FATAL", title: "Сценарий прерван", status: "не прошло", observed: [String(err && err.stack || err)], defects: [], shots: [] });
  try { await snap("fatal"); } catch {}
}

const report = { base: BASE, code: CODE, results, jsErrors, consoleErrors, netErrors, logEntries, shots };
fs.writeFileSync("path.join(QA_DIR, "report.json")", JSON.stringify(report, null, 2), "utf8");

console.log("\n================ РЕЗУЛЬТАТЫ ================");
for (const r of results) {
  console.log(`\n[${r.id}] ${r.status.toUpperCase()} — ${r.title}`);
  r.observed.forEach(o => console.log("   · " + o));
  if (r.defects?.length) r.defects.forEach(d => console.log("   ! ВИЗУАЛ: " + d));
  if (r.shots?.length) r.shots.forEach(p => console.log("   ▸ " + p));
}
console.log("\n================ JS-ОШИБКИ ================");
console.log(jsErrors.length ? JSON.stringify(jsErrors, null, 2) : "нет");
console.log("\n================ CONSOLE error/warning ================");
console.log(consoleErrors.length ? JSON.stringify(consoleErrors, null, 2) : "нет");
console.log("\n================ СЕТЬ 4xx/5xx и сбои ================");
console.log(netErrors.length ? JSON.stringify(netErrors, null, 2) : "нет");
console.log("\n================ CDP Log.entryAdded ================");
console.log(logEntries.length ? JSON.stringify(logEntries, null, 2) : "нет");
console.log("\nКОД ПОЛЬЗОВАТЕЛЯ: " + CODE);

await browser.close();
