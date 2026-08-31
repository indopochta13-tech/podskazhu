// Перепроверка исправлений: «от кого» во входящем, отказ по неверному ключу,
// сброс сессии по настоящему протухшему токену, вид ключа переноса.
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8791";
const QA_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(QA_DIR, "screens");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const jsErrors = [];
const consoleErrors = [];
const netErrors = [];
const logEntries = [];
let CURRENT = "старт";

function step(id, title) {
  const rec = { id, title, status: "не прошло", observed: [], defects: [], shots: [] };
  results.push(rec);
  CURRENT = id;
  return {
    ok: m => { rec.status = "исправлено"; if (m) rec.observed.push(m); },
    partial: m => { rec.status = "частично"; if (m) rec.observed.push(m); },
    fail: m => { rec.status = "НЕ исправлено"; if (m) rec.observed.push(m); },
    note: m => rec.observed.push(m),
    defect: m => rec.defects.push(m),
    shot: p => rec.shots.push(p),
    rec,
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function snap(page, name, rec) {
  const file = path.join(OUT, `auth-fix-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  if (rec) rec.shot(file);
  return file;
}

async function runStep(id, title, fn) {
  const s = step(id, title);
  try { await fn(s); }
  catch (err) {
    s.fail(`шаг прерван ошибкой сценария: ${err.message}`);
    s.rec.crash = String(err.stack || err).split("\n").slice(0, 3).join(" | ");
    try { if (globalThis.__lastPage) await snap(globalThis.__lastPage, `err-${id}`, s); } catch {}
  }
  return s;
}

async function attach(page, session) {
  globalThis.__lastPage = page;
  page.on("pageerror", e => jsErrors.push({ session, step: CURRENT, source: "pageerror", text: e.message, stack: (e.stack || "").split("\n").slice(0, 4).join(" | ") }));
  page.on("console", m => {
    if (m.type() === "error" || m.type() === "warning") consoleErrors.push({ session, step: CURRENT, type: m.type(), text: m.text(), location: m.location() });
  });
  page.on("requestfailed", r => netErrors.push({ session, step: CURRENT, kind: "requestfailed", method: r.method(), url: r.url(), error: r.failure()?.errorText }));
  page.on("response", async r => {
    if (r.status() >= 400) {
      let body = "";
      try { body = (await r.text()).slice(0, 300); } catch {}
      netErrors.push({ session, step: CURRENT, kind: "http", status: r.status(), method: r.request().method(), url: r.url(), body });
    }
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  cdp.on("Runtime.exceptionThrown", e => jsErrors.push({ session, step: CURRENT, source: "CDP.exceptionThrown", text: e.exceptionDetails.exception?.description || e.exceptionDetails.text }));
  cdp.on("Runtime.consoleAPICalled", e => {
    if (e.type === "error" || e.type === "warning") consoleErrors.push({ session, step: CURRENT, type: "CDP." + e.type, text: e.args.map(a => a.description ?? a.value).join(" ") });
  });
  cdp.on("Log.entryAdded", e => {
    if (e.entry.level === "error" || e.entry.level === "warning") logEntries.push({ session, step: CURRENT, level: e.entry.level, source: e.entry.source, text: e.entry.text, url: e.entry.url });
  });
  cdp.on("Network.responseReceived", e => {
    if (e.response.status >= 400) netErrors.push({ session, step: CURRENT, kind: "cdp", status: e.response.status, url: e.response.url });
  });
}

async function grabToast(page, timeout = 8000) {
  try {
    await page.waitForFunction(() => {
      const t = document.getElementById("toast");
      return t && t.classList.contains("show") && t.textContent.trim().length > 0;
    }, null, { timeout });
    return (await page.textContent("#toast")).trim();
  } catch { return null; }
}
async function clearToast(page) {
  await page.evaluate(() => { const t = document.getElementById("toast"); if (t) { t.classList.remove("show"); t.textContent = ""; } });
}

async function goHome(page) {
  for (let i = 0; i < 5; i++) {
    if (await page.locator(".home").count()) return true;
    const back = page.locator(".bar [data-back]");
    if (await back.count()) { await back.first().click(); await sleep(450); continue; }
    break;
  }
  return (await page.locator(".home").count()) > 0;
}

// Реальные строки, на которые браузер разложил текст ключа.
async function keyVisualLines(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".code.key");
    if (!el) return null;
    const node = el.firstChild;
    const text = node.textContent;
    const lines = [];
    let cur = null;
    for (let i = 0; i < text.length; i++) {
      const r = document.createRange();
      r.setStart(node, i); r.setEnd(node, i + 1);
      const rect = r.getBoundingClientRect();
      if (!cur || Math.abs(rect.top - cur.top) > 2) { cur = { top: rect.top, text: "" }; lines.push(cur); }
      cur.text += text[i];
    }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const box = el.closest(".code-box")?.getBoundingClientRect();
    return {
      full: text,
      lines: lines.map(l => l.text),
      fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, wordBreak: cs.wordBreak, overflowWrap: cs.overflowWrap,
      width: Math.round(r.width), boxWidth: box ? Math.round(box.width) : null,
      clipped: el.scrollWidth > el.clientWidth + 2,
      outsideBox: box ? r.right > box.right + 1 : null,
    };
  });
}

async function visualAudit(page, label) {
  return page.evaluate(label => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const se = document.scrollingElement;
    if (se && se.scrollWidth > vw + 1) out.push(`горизонтальный вылет страницы: scrollWidth=${se.scrollWidth} > ширина ${vw}`);
    const found = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const tag = `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}>`;
      if (r.right > vw + 1) found.push(`вылет за правый край: ${tag} right=${Math.round(r.right)} > ${vw}`);
      const scrollable = /auto|scroll/.test(cs.overflow + cs.overflowX + cs.overflowY);
      if (!scrollable && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        found.push(`обрезано по ширине: ${tag} scrollW=${el.scrollWidth} clientW=${el.clientWidth} текст="${(el.textContent || "").trim().slice(0, 40)}"`);
      }
      if (!scrollable && el.scrollHeight > el.clientHeight + 2 && el.children.length === 0) {
        found.push(`обрезано по высоте: ${tag} scrollH=${el.scrollHeight} clientH=${el.clientHeight} текст="${(el.textContent || "").trim().slice(0, 40)}"`);
      }
    }
    return { label, findings: [...out, ...new Set(found)].slice(0, 12) };
  }, label);
}

/* ——— запуск ——— */

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctxOpts = {
  viewport: { width: 400, height: 860 },
  deviceScaleFactor: 2,
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
  permissions: ["clipboard-read", "clipboard-write"],
};

const ctxA = await browser.newContext(ctxOpts);
const pageA = await ctxA.newPage();
await attach(pageA, "A");
const ctxB = await browser.newContext(ctxOpts);
const pageB = await ctxB.newPage();
await attach(pageB, "B");

let codeA = "", keyA = "", codeB = "";

/* 0 — свежий профиль и актуальные ассеты */
await runStep("0-загрузка", "Чистый профиль, отдаётся код v6", async s => {
  const resp = await pageA.goto(BASE + "/", { waitUntil: "networkidle" });
  s.note(`главная: HTTP ${resp.status()}`);
  const assets = await pageA.evaluate(() => ({
    script: document.querySelector('script[src*="app.js"]')?.getAttribute("src"),
    css: document.querySelector('link[href*="styles.css"]')?.getAttribute("href"),
    storage: Object.keys(localStorage).length,
    hasSenderName: typeof window.__vcHasSenderName,
  }));
  s.note(`подключено: ${assets.script}, ${assets.css}; записей в localStorage: ${assets.storage}`);
  const codeVersion = await pageA.evaluate(async () => {
    const t = await (await fetch("/app.js?v=6")).text();
    return { senderName: t.includes("function senderName"), guard401: t.includes("res.status === 401 && store.token") };
  });
  s.note(`в отданном app.js: senderName = ${codeVersion.senderName}, защита 401 = ${codeVersion.guard401}`);
  const css = await pageA.evaluate(async () => {
    const t = await (await fetch("/styles.css?v=6")).text();
    return { breakAll: /\.code\.key[^}]*word-break:\s*break-all/s.test(t) };
  });
  s.note(`в отданном styles.css остался word-break: break-all у ключа: ${css.breakAll}`);
  (assets.script.includes("v=6") && codeVersion.senderName && codeVersion.guard401 && !css.breakAll)
    ? s.ok("сервер отдаёт исправленный код, профиль пустой")
    : s.fail("сервер отдаёт не тот код");
  await snap(pageA, "01-login", s);
});

/* А — первая сессия и вид ключа на «Четырёх шагах» */
await runStep("4-ключ", "Экран «Четыре шага»: ключ переноса читается целиком", async s => {
  await pageA.click("#auth-start");
  await pageA.waitForSelector("#onb-done", { timeout: 20000 });
  await sleep(500);
  const steps = await pageA.evaluate(() => [...document.querySelectorAll(".step")].map(st => st.querySelector(".code")?.textContent.trim() || null));
  codeA = steps[0] || "";
  keyA = steps[1] || "";
  s.note(`ID первой сессии ${codeA}, ключ ${keyA}`);
  const km = await keyVisualLines(pageA);
  s.note(`шрифт ${km.fontSize}, межбуквенный ${km.letterSpacing}, word-break: ${km.wordBreak}, overflow-wrap: ${km.overflowWrap}`);
  s.note(`ключ шириной ${km.width}px в блоке ${km.boxWidth}px, строк ${km.lines.length}: ${JSON.stringify(km.lines)}`);
  const groups = keyA.split("-");
  const brokenGroup = km.lines.length > 1 && !km.lines.every(l => {
    const t = l.replace(/^-/, "").replace(/-$/, "");
    return t === "" || t.split("-").every(part => groups.includes(part));
  });
  s.note(`разрыв посреди группы: ${brokenGroup ? "ЕСТЬ" : "нет"}; обрезка: ${km.clipped}, вылет за блок: ${km.outsideBox}`);
  await snap(pageA, "02-four-steps", s);
  (km.lines.length === 1 || !brokenGroup) && !km.clipped && !km.outsideBox
    ? s.ok(km.lines.length === 1 ? "ключ помещается в одну строку" : "ключ переносится только по дефисам")
    : s.fail("ключ по-прежнему рвётся или обрезается");
  const va = await visualAudit(pageA, "четыре шага");
  va.findings.forEach(f => s.defect("четыре шага: " + f));
});

/* Б — отправка записи из первой сессии во вторую */
await runStep("12а-id", "Входящее у незнакомого отправителя: после «от» стоит ID", async s => {
  await pageA.click("#onb-done");
  await sleep(500);

  await pageB.goto(BASE + "/", { waitUntil: "networkidle" });
  await pageB.click("#auth-start");
  await pageB.waitForSelector("#onb-done", { timeout: 20000 });
  await sleep(400);
  codeB = await pageB.evaluate(() => document.querySelector(".step .code")?.textContent.trim() || "");
  await pageB.click("#onb-done");
  await sleep(400);
  s.note(`ID второй сессии ${codeB}`);

  await pageA.bringToFront();
  await goHome(pageA);
  await pageA.click('.home-top [data-go="settings"]');
  await sleep(400);
  await pageA.click('.setting[data-go="people"]');
  await sleep(400);
  await clearToast(pageA);
  await pageA.fill('#add-contact input[name="code"]', codeB);
  await pageA.fill('#add-contact input[name="label"]', "Коллега");
  await pageA.click('#add-contact button[type="submit"]');
  s.note(`первая сессия добавила второго: ${await grabToast(pageA, 8000)}`);
  await sleep(400);

  await goHome(pageA);
  await pageA.click('.widget [data-go="chat"]');
  await pageA.waitForSelector("#chat-input", { timeout: 10000 });
  await pageA.fill("#chat-input", "совещание завтра в 10");
  await pageA.click("#chat-send");
  await pageA.waitForFunction(() => {
    const bs = [...document.querySelectorAll(".bubble.ai")];
    return bs.length > 0 && !bs.some(b => b.textContent.includes("Разбираю"));
  }, null, { timeout: 25000 });
  await sleep(400);

  await goHome(pageA);
  await pageA.click('.widget [data-go="shelves"]');
  await pageA.waitForSelector("[data-shelf-tab]", { timeout: 10000 });
  const tabs = await pageA.evaluate(() => [...document.querySelectorAll("[data-shelf-tab]")].map(t => t.dataset.shelfTab));
  for (const t of tabs) {
    await pageA.click(`[data-shelf-tab="${t}"]`);
    await sleep(300);
    if (await pageA.locator(".card-main", { hasText: /овещание/i }).count()) {
      await pageA.locator(".card-main", { hasText: /овещание/i }).first().click();
      break;
    }
  }
  await pageA.waitForSelector("#detail-share", { timeout: 10000 });
  await pageA.click("#detail-share");
  await pageA.waitForSelector("#share-confirm", { timeout: 10000 });
  await sleep(300);
  await pageA.evaluate(() => document.querySelector("[data-person]")?.click());
  await sleep(300);
  await clearToast(pageA);
  await pageA.click("#share-confirm");
  s.note(`отправка: ${await grabToast(pageA, 10000)}`);
  await sleep(400);

  await pageB.bringToFront();
  await pageB.reload({ waitUntil: "networkidle" });
  await sleep(900);
  const banner = await pageB.evaluate(() => document.querySelector(".incoming-banner")?.textContent.trim());
  s.note(`плашка во второй сессии: «${banner}»`);
  await pageB.evaluate(() => document.querySelector(".incoming-banner")?.click());
  await sleep(700);
  const card = await pageB.evaluate(() => {
    const c = [...document.querySelectorAll(".card")].find(x => x.querySelector(".pill.warn"));
    return c ? { title: c.querySelector(".title")?.textContent.trim(), meta: c.querySelector(".meta")?.textContent.trim() } : null;
  });
  const contacts = await pageB.evaluate(async () => {
    const d = await (await fetch("/api/state", { headers: { Authorization: "Bearer " + localStorage.getItem("vc.token") } })).json();
    return { contacts: d.contacts.length, from: JSON.stringify(d.incoming.map(i => i.from)) };
  });
  s.note(`карточка входящего: «${card?.title}» / «${card?.meta}»`);
  s.note(`в списке второй сессии людей: ${contacts.contacts}; отправитель с сервера: ${contacts.from}`);
  await snap(pageB, "03-incoming-shows-id", s);
  const good = card && card.meta.includes(`от ${codeA}`) && !/undefined/.test(card.meta);
  good ? s.ok(`после «от» стоит ID отправителя ${codeA}`) : s.fail(`ожидалось «от ${codeA}», получено «${card?.meta}»`);
});

/* В — тот же отправитель, но уже с пометкой в своём списке */
await runStep("12б-пометка", "Входящее от человека из своего списка: показывается пометка", async s => {
  await pageB.bringToFront();
  await goHome(pageB);
  await pageB.click('.home-top [data-go="settings"]');
  await sleep(400);
  await pageB.click('.setting[data-go="people"]');
  await sleep(400);
  await clearToast(pageB);
  await pageB.fill('#add-contact input[name="code"]', codeA);
  await pageB.fill('#add-contact input[name="label"]', "Начальник");
  await pageB.click('#add-contact button[type="submit"]');
  s.note(`вторая сессия добавила первого с пометкой «Начальник»: ${await grabToast(pageB, 8000)}`);
  await sleep(500);
  await goHome(pageB);
  await pageB.click('.widget [data-go="shelves"]');
  await pageB.waitForSelector("[data-shelf-tab]", { timeout: 10000 });
  await pageB.click('[data-shelf-tab="today"]');
  await sleep(500);
  const card = await pageB.evaluate(() => {
    const c = [...document.querySelectorAll(".card")].find(x => x.querySelector(".pill.warn"));
    return c ? { title: c.querySelector(".title")?.textContent.trim(), meta: c.querySelector(".meta")?.textContent.trim() } : null;
  });
  s.note(`карточка входящего теперь: «${card?.meta}»`);
  await snap(pageB, "04-incoming-shows-label", s);

  // и вторая запись, отправленная уже после добавления
  await pageA.bringToFront();
  await goHome(pageA);
  await pageA.click('.widget [data-go="chat"]');
  await pageA.waitForSelector("#chat-input", { timeout: 10000 });
  await pageA.fill("#chat-input", "позвонить в банк завтра в 12");
  await pageA.click("#chat-send");
  await pageA.waitForFunction(() => [...document.querySelectorAll(".bubble.ai")].filter(b => !b.textContent.includes("Разбираю")).length >= 2, null, { timeout: 25000 });
  await sleep(400);
  await goHome(pageA);
  await pageA.click('.widget [data-go="shelves"]');
  await pageA.waitForSelector("[data-shelf-tab]", { timeout: 10000 });
  const tabs = await pageA.evaluate(() => [...document.querySelectorAll("[data-shelf-tab]")].map(t => t.dataset.shelfTab));
  for (const t of tabs) {
    await pageA.click(`[data-shelf-tab="${t}"]`);
    await sleep(300);
    if (await pageA.locator(".card-main", { hasText: /банк/i }).count()) {
      await pageA.locator(".card-main", { hasText: /банк/i }).first().click();
      break;
    }
  }
  await pageA.waitForSelector("#detail-share", { timeout: 10000 });
  await pageA.click("#detail-share");
  await pageA.waitForSelector("#share-confirm", { timeout: 10000 });
  await sleep(300);
  await pageA.evaluate(() => document.querySelector("[data-person]")?.click());
  await sleep(300);
  await clearToast(pageA);
  await pageA.click("#share-confirm");
  s.note(`вторая отправка: ${await grabToast(pageA, 10000)}`);

  await pageB.bringToFront();
  await pageB.reload({ waitUntil: "networkidle" });
  await sleep(900);
  await pageB.evaluate(() => document.querySelector(".incoming-banner")?.click());
  await sleep(700);
  const cards = await pageB.evaluate(() => [...document.querySelectorAll(".card")].filter(c => c.querySelector(".pill.warn")).map(c => ({
    title: c.querySelector(".title")?.textContent.trim(),
    meta: c.querySelector(".meta")?.textContent.trim(),
  })));
  s.note(`оба входящих: ${JSON.stringify(cards)}`);
  await snap(pageB, "05-incoming-both-labeled", s);
  const good = card && card.meta.includes("от Начальник") && cards.length === 2 && cards.every(c => c.meta.includes("от Начальник"));
  good ? s.ok("вместо ID показывается пометка «Начальник» и для старой, и для новой записи") : s.fail(`ожидалось «от Начальник» в обеих карточках, получено ${JSON.stringify(cards)}`);
});

/* Г — неверный ключ переноса */
await runStep("13а-ключ", "Неверный ключ: видимое «Ключ не подходит», форма и текст сохраняются", async s => {
  const ctxC = await browser.newContext(ctxOpts);
  const pageC = await ctxC.newPage();
  await attach(pageC, "C");
  globalThis.__pageC = pageC;
  globalThis.__ctxC = ctxC;
  await pageC.goto(BASE + "/", { waitUntil: "networkidle" });
  await pageC.click("#auth-toggle");
  await sleep(250);
  await pageC.fill('[data-auth-form="restore"] input[name="key"]', "AAAAA-BBBBB-CCCCC-DDDDD");
  await pageC.click("#auth-restore");
  await sleep(1500);
  const after = await pageC.evaluate(() => ({
    error: document.querySelector("[data-auth-error]")?.textContent.trim(),
    errorVisible: (() => {
      const e = document.querySelector("[data-auth-error]");
      if (!e) return false;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    })(),
    restoreVisible: !document.querySelector('[data-auth-form="restore"]')?.classList.contains("hidden"),
    value: document.querySelector('input[name="key"]')?.value,
    toggle: document.querySelector("#auth-toggle")?.textContent.trim(),
    buttonDisabled: document.querySelector("#auth-restore")?.disabled,
    token: localStorage.getItem("vc.token"),
  }));
  s.note(`сообщение: «${after.error}» (видно на экране: ${after.errorVisible})`);
  s.note(`форма ключа осталась открытой: ${after.restoreVisible}, в поле: «${after.value}», переключатель «${after.toggle}», кнопка активна: ${!after.buttonDisabled}`);
  await snap(pageC, "06-bad-key-error", s);
  const good = after.error === "Ключ не подходит" && after.errorVisible && after.restoreVisible
    && after.value === "AAAAA-BBBBB-CCCCC-DDDDD" && after.toggle === "Начать заново" && !after.buttonDisabled;
  good ? s.ok("показано «Ключ не подходит», форма и набранный текст на месте") : s.fail("поведение при неверном ключе всё ещё не то");
});

/* Д — верный ключ в нижнем регистре в той же форме */
await runStep("13б-верный", "Верный ключ в нижнем регистре после неудачной попытки", async s => {
  const pageC = globalThis.__pageC;
  await pageC.fill('[data-auth-form="restore"] input[name="key"]', keyA.toLowerCase());
  s.note(`ввожу ${keyA.toLowerCase()} в ту же форму, не перезагружая страницу`);
  await pageC.click("#auth-restore");
  await sleep(2000);
  const scr = await pageC.evaluate(() => ({
    screen: document.querySelector(".bar h2")?.textContent.trim() || (document.querySelector(".auth") ? "AUTH" : document.querySelector(".home") ? "HOME" : "?"),
    code: document.querySelector(".step .code")?.textContent.trim() || document.querySelector(".home-hello strong")?.textContent.trim(),
    error: document.querySelector("[data-auth-error]")?.textContent.trim(),
  }));
  s.note(`после входа: экран «${scr.screen}», ID «${scr.code}»`);
  if (scr.screen === "Четыре шага") { await pageC.click("#onb-done"); await sleep(700); }
  let items = [];
  if (await pageC.locator('.widget [data-go="shelves"]').count()) {
    await pageC.click('.widget [data-go="shelves"]');
    await pageC.waitForSelector("[data-shelf-tab]", { timeout: 10000 });
    const tabs = await pageC.evaluate(() => [...document.querySelectorAll("[data-shelf-tab]")].map(t => t.dataset.shelfTab));
    for (const t of tabs) {
      await pageC.click(`[data-shelf-tab="${t}"]`);
      await sleep(250);
      items.push(...await pageC.evaluate(() => [...document.querySelectorAll(".card-main .title")].map(e => e.textContent.trim())));
    }
    items = [...new Set(items)];
  }
  const homeCode = await pageC.evaluate(() => { document.querySelector('.bar [data-back]')?.click(); return null; });
  await sleep(500);
  const code = await pageC.evaluate(() => document.querySelector(".home-hello strong")?.textContent.trim());
  s.note(`записи в перенесённой сессии: ${items.join(" | ") || "нет"}; ID на главной: ${code}`);
  await snap(pageC, "07-restored-after-retry", s);
  const good = code === codeA && items.some(t => /овещание/i.test(t));
  good ? s.ok("ключ в нижнем регистре пускает в ту же учётку с её записями") : s.fail(`ожидался ID ${codeA} и запись «Совещание», получено ID ${code}, записи: ${items.join(", ")}`);
  await globalThis.__ctxC.close();
  globalThis.__lastPage = pageA;
});

/* Е — настоящий протухший токен */
await runStep("сессия", "Испорченный токен: сессия сбрасывается и возвращает на экран входа", async s => {
  const ctxE = await browser.newContext(ctxOpts);
  const pageE = await ctxE.newPage();
  await attach(pageE, "E");
  await pageE.goto(BASE + "/", { waitUntil: "networkidle" });
  await pageE.click("#auth-start");
  await pageE.waitForSelector("#onb-done", { timeout: 20000 });
  await pageE.click("#onb-done");
  await sleep(500);
  const before = await pageE.evaluate(() => ({ home: Boolean(document.querySelector(".home")), token: (localStorage.getItem("vc.token") || "").slice(0, 8) }));
  s.note(`до порчи токена: домашний экран = ${before.home}, токен начинается на ${before.token}…`);

  // 1) запрос из работающего приложения
  await pageE.evaluate(() => localStorage.setItem("vc.token", "ИСПОРЧЕННЫЙ-ТОКЕН-123"));
  await pageE.click('.home-top [data-go="settings"]');
  await sleep(400);
  await pageE.evaluate(() => document.querySelector('[data-toggle="alarmMeetings"]')?.click());
  await sleep(1200);
  const afterCall = await pageE.evaluate(() => ({
    auth: Boolean(document.querySelector(".auth")),
    startBtn: document.querySelector("#auth-start")?.textContent.trim(),
    token: localStorage.getItem("vc.token"),
  }));
  s.note(`после запроса с испорченным токеном: экран входа = ${afterCall.auth}, кнопка «${afterCall.startBtn}», токен в localStorage: ${JSON.stringify(afterCall.token)}`);
  await snap(pageE, "08-expired-token-auth", s);

  // 2) перезагрузка с испорченным токеном
  await pageE.evaluate(() => localStorage.setItem("vc.token", "ЕЩЁ-ОДИН-ПЛОХОЙ-ТОКЕН"));
  await pageE.reload({ waitUntil: "networkidle" });
  await sleep(1000);
  const afterReload = await pageE.evaluate(() => ({
    auth: Boolean(document.querySelector(".auth")),
    home: Boolean(document.querySelector(".home")),
  }));
  s.note(`после перезагрузки с испорченным токеном: экран входа = ${afterReload.auth}, домашний = ${afterReload.home}`);
  await snap(pageE, "09-expired-token-reload", s);
  const good = afterCall.auth && !afterCall.token && afterReload.auth && !afterReload.home;
  good ? s.ok("протухший токен по-прежнему выкидывает на экран входа и чистится") : s.fail("сброс сессии сломался");
  await ctxE.close();
  globalThis.__lastPage = pageA;
});

/* Ж — настройки: ключ в блоке и вход в целом не сломан */
await runStep("регрессия", "Настройки и вид ключа там же, вход и основные экраны работают", async s => {
  await pageA.bringToFront();
  await goHome(pageA);
  await pageA.click('.home-top [data-go="settings"]');
  await sleep(450);
  await pageA.click("#show-key");
  await sleep(350);
  const km = await keyVisualLines(pageA);
  s.note(`ключ в настройках: строк ${km.lines.length}: ${JSON.stringify(km.lines)}, ширина ${km.width}px в блоке ${km.boxWidth}px`);
  const settings = await pageA.evaluate(() => ({
    screen: document.querySelector(".bar h2")?.textContent.trim(),
    id: document.querySelector(".code-box .code")?.textContent.trim(),
    key: document.querySelector(".code.key")?.textContent.trim(),
    showBtn: document.querySelector("#show-key")?.textContent.trim(),
    people: [...document.querySelectorAll(".setting .name")].map(e => e.textContent.trim()).includes("Люди и группы"),
  }));
  s.note(`экран «${settings.screen}», ID «${settings.id}», ключ «${settings.key}», кнопка «${settings.showBtn}», пункт «Люди и группы»: ${settings.people}`);
  await snap(pageA, "10-settings-key", s);
  const va = await visualAudit(pageA, "настройки");
  va.findings.forEach(f => s.defect("настройки: " + f));
  const good = settings.id === codeA && settings.key === keyA && settings.showBtn === "Скрыть" && settings.people && !km.clipped;
  good ? s.ok("настройки в порядке, ключ виден целиком") : s.fail("в настройках что-то не так");
});

/* Ошибки */
await runStep("ошибки", "Ошибки JS и ответы 4xx/5xx", async s => {
  const expected = netErrors.filter(e =>
    (e.status === 401 && /\/api\/restore/.test(e.url || "")) ||
    (e.status === 401 && /\/api\/(settings|state|items|contacts|groups)/.test(e.url || ""))
  );
  const real = netErrors.filter(e => !expected.includes(e));
  s.note(`ожидаемых отказов (неверный ключ, испорченный токен): ${expected.length}`);
  s.note(`прочих сетевых ошибок: ${real.length}`);
  s.note(`исключений JS: ${jsErrors.length}, console error/warning: ${consoleErrors.length}`);
  (!jsErrors.length && !real.length) ? s.ok("настоящих ошибок JS и сети нет") : s.fail("есть ошибки — см. списки");
  s.rec.expected = expected;
  s.rec.realNet = real;
});

const report = { base: BASE, when: new Date().toISOString(), ids: { A: codeA, keyA, B: codeB }, steps: results, jsErrors, consoleErrors, netErrors, logEntries };
fs.writeFileSync("path.join(QA_DIR, "auth-fix-report.json")", JSON.stringify(report, null, 2));

console.log("=== ИТОГ ===");
for (const r of results) {
  console.log(`\n[${r.id}] ${r.status.toUpperCase()} — ${r.title}`);
  r.observed.forEach(o => console.log("   · " + o));
  r.defects.forEach(d => console.log("   ! " + d));
  r.shots.forEach(p => console.log("   [скрин] " + p));
  if (r.crash) console.log("   [сбой сценария] " + r.crash);
}
console.log("\n=== JS ===\n" + JSON.stringify(jsErrors, null, 1));
console.log("\n=== CONSOLE ===\n" + JSON.stringify(consoleErrors, null, 1));
console.log("\n=== NET ===\n" + JSON.stringify(netErrors, null, 1));
console.log("\n=== LOG ===\n" + JSON.stringify(logEntries, null, 1));
console.log(`\nID_A=${codeA} KEY_A=${keyA} ID_B=${codeB}`);

await browser.close();
