// Проверка новой модели входа: «Начать» вместо имени/PIN, ID + ключ переноса, свои группы.
// Три чистые сессии (изолированные контексты, каждый со своим localStorage).
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
  CURRENT = `шаг ${id}`;
  return {
    ok: m => { rec.status = "прошло"; if (m) rec.observed.push(m); },
    partial: m => { rec.status = "частично"; if (m) rec.observed.push(m); },
    fail: m => { rec.status = "не прошло"; if (m) rec.observed.push(m); },
    note: m => rec.observed.push(m),
    defect: m => rec.defects.push(m),
    shot: p => rec.shots.push(p),
    rec,
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function snap(page, name, rec) {
  const file = path.join(OUT, `auth-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  if (rec) rec.shot(file);
  return file;
}

// Падение одного шага не должно ронять весь прогон.
async function runStep(id, title, fn) {
  const s = step(id, title);
  try {
    await fn(s);
  } catch (err) {
    s.fail(`шаг прерван ошибкой сценария: ${err.message}`);
    s.rec.crash = String(err.stack || err).split("\n").slice(0, 3).join(" | ");
    try { if (globalThis.__lastPage) await snap(globalThis.__lastPage, `err-${id}`, s); } catch {}
  }
  return s;
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

async function attach(page, session) {
  globalThis.__lastPage = page;
  page.on("pageerror", e => jsErrors.push({ session, step: CURRENT, source: "pageerror", text: e.message, stack: (e.stack || "").split("\n").slice(0, 4).join(" | ") }));
  page.on("console", m => {
    if (m.type() === "error" || m.type() === "warning") {
      consoleErrors.push({ session, step: CURRENT, type: m.type(), text: m.text(), location: m.location() });
    }
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
  cdp.on("Runtime.exceptionThrown", e => jsErrors.push({
    session, step: CURRENT, source: "CDP.exceptionThrown",
    text: e.exceptionDetails.exception?.description || e.exceptionDetails.text,
  }));
  cdp.on("Runtime.consoleAPICalled", e => {
    if (e.type === "error" || e.type === "warning") {
      consoleErrors.push({ session, step: CURRENT, type: "CDP." + e.type, text: e.args.map(a => a.description ?? a.value).join(" ") });
    }
  });
  cdp.on("Log.entryAdded", e => {
    if (e.entry.level === "error" || e.entry.level === "warning") {
      logEntries.push({ session, step: CURRENT, level: e.entry.level, source: e.entry.source, text: e.entry.text, url: e.entry.url });
    }
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
  await page.evaluate(() => {
    const t = document.getElementById("toast");
    if (t) { t.classList.remove("show"); t.textContent = ""; }
  });
}

async function visualAudit(page, label) {
  return page.evaluate(label => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const se = document.scrollingElement;
    if (se && se.scrollWidth > vw + 1) out.push(`горизонтальный вылет страницы: scrollWidth=${se.scrollWidth} > ширина ${vw}`);
    const found = [];
    const boxes = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const tag = `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}>`;
      if (r.right > vw + 1) found.push(`вылет за правый край: ${tag} right=${Math.round(r.right)} > ${vw}`);
      if (r.left < -1) found.push(`вылет за левый край: ${tag} left=${Math.round(r.left)}`);
      const scrollable = /auto|scroll/.test(cs.overflow + cs.overflowX + cs.overflowY);
      if (!scrollable && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        found.push(`обрезано по ширине: ${tag} scrollW=${el.scrollWidth} clientW=${el.clientWidth} текст="${(el.textContent || "").trim().slice(0, 40)}"`);
      }
      if (!scrollable && el.scrollHeight > el.clientHeight + 2 && el.children.length === 0) {
        found.push(`обрезано по высоте: ${tag} scrollH=${el.scrollHeight} clientH=${el.clientHeight} текст="${(el.textContent || "").trim().slice(0, 40)}"`);
      }
      if (el.matches(".btn, .chip, .field, .code-box, .setting, .person, .step")) {
        boxes.push({ tag, r: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, parent: el.parentElement });
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.parent !== b.parent) continue;
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 2 && oy > 2) found.push(`наложение: ${a.tag} и ${b.tag} перекрываются на ${Math.round(ox)}x${Math.round(oy)}px`);
      }
    }
    return { label, findings: [...out, ...new Set(found)].slice(0, 15) };
  }, label);
}

async function keyBoxMetrics(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".code.key");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const box = el.closest(".code-box");
    const br = box?.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      text: el.textContent.trim(),
      fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, whiteSpace: cs.whiteSpace, overflowWrap: cs.overflowWrap,
      rect: { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) },
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      boxRect: br ? { left: Math.round(br.left), right: Math.round(br.right), width: Math.round(br.width) } : null,
      viewport: document.documentElement.clientWidth,
      clippedHoriz: el.scrollWidth > el.clientWidth + 2,
      outsideBox: br ? r.right > br.right + 1 || r.left < br.left - 1 : null,
      lines: Math.round(r.height / parseFloat(cs.lineHeight || cs.fontSize)),
    };
  });
}

async function screenName(page) {
  return page.evaluate(() => {
    const h = document.querySelector(".bar h2");
    if (h) return h.textContent.trim();
    if (document.querySelector(".auth")) return "AUTH";
    if (document.querySelector(".home")) return "HOME";
    return "?";
  });
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

let code1 = "", key1 = "", code2 = "";
let pageB = null;

/* 1 — экран входа */
await runStep(1, "Экран входа: кнопка «Начать», пояснение, ссылка на ключ переноса, нет полей Имя/PIN", async s => {
  await pageA.goto(BASE + "/", { waitUntil: "networkidle" });
  await pageA.waitForSelector(".auth", { timeout: 15000 });
  const info = await pageA.evaluate(() => {
    const vis = el => el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    const startForm = document.querySelector('[data-auth-form="start"]');
    const restoreForm = document.querySelector('[data-auth-form="restore"]');
    return {
      title: document.querySelector(".brand h1")?.textContent.trim(),
      startBtn: document.querySelector("#auth-start")?.textContent.trim(),
      note: startForm?.querySelector(".note")?.textContent.trim(),
      toggle: document.querySelector("#auth-toggle")?.textContent.trim(),
      startVisible: vis(startForm),
      restoreVisible: vis(restoreForm),
      visibleInputs: [...document.querySelectorAll("input")].filter(i => i.offsetParent !== null).map(i => i.name || i.type),
      allInputs: [...document.querySelectorAll("input")].map(i => i.name),
      bodyText: document.body.innerText,
      tabs: [...document.querySelectorAll("[data-auth-tab]")].map(t => t.textContent.trim()),
    };
  });
  s.note(`кнопка: «${info.startBtn}», переключатель: «${info.toggle}»`);
  s.note(`пояснение: «${info.note}»`);
  s.note(`видимых полей ввода: ${info.visibleInputs.length ? info.visibleInputs.join(", ") : "нет"}; все input в DOM: ${info.allInputs.join(", ") || "нет"}`);
  const hasNamePin = /\bИмя\b/i.test(info.bodyText) || /PIN|ПИН/i.test(info.bodyText) || info.allInputs.includes("name") || info.allInputs.includes("pin");
  const okStart = info.startBtn === "Начать";
  const okNote = /ничего заполнять не нужно/i.test(info.note || "");
  const okToggle = info.toggle === "У меня есть ключ переноса";
  if (okStart && okNote && okToggle && !hasNamePin && info.startVisible && !info.restoreVisible) s.ok("экран входа соответствует ожиданию");
  else {
    s.fail("расхождения: " + [
      okStart ? null : "кнопка не «Начать»",
      okNote ? null : "нет пояснения «ничего заполнять не нужно»",
      okToggle ? null : "переключатель с другим текстом",
      hasNamePin ? "на экране есть Имя/PIN" : null,
      info.restoreVisible ? "форма ключа видна сразу" : null,
    ].filter(Boolean).join("; "));
  }
  if (info.tabs.length) s.defect(`остались старые вкладки регистрации/входа: ${info.tabs.join(", ")}`);
  await snap(pageA, "01-login", s);
  const va = await visualAudit(pageA, "вход");
  va.findings.forEach(f => s.defect("вход: " + f));
});

/* 2 — переключатель формы ключа */
await runStep(2, "Переключение «У меня есть ключ переноса» ↔ «Начать заново»", async s => {
  await pageA.click("#auth-toggle");
  await sleep(250);
  const on = await pageA.evaluate(() => {
    const vis = el => el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    const f = document.querySelector('[data-auth-form="restore"]');
    return {
      restoreVisible: vis(f),
      startVisible: vis(document.querySelector('[data-auth-form="start"]')),
      label: f?.querySelector(".field span")?.textContent.trim(),
      placeholder: f?.querySelector('input[name="key"]')?.placeholder,
      btn: document.querySelector("#auth-restore")?.textContent.trim(),
      toggle: document.querySelector("#auth-toggle")?.textContent.trim(),
    };
  });
  s.note(`после первого нажатия: поле «${on.label}» (подсказка ${on.placeholder}), кнопка «${on.btn}», переключатель «${on.toggle}»`);
  await snap(pageA, "02-restore-form", s);
  await pageA.click("#auth-toggle");
  await sleep(250);
  const back = await pageA.evaluate(() => {
    const vis = el => el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    return {
      restoreVisible: vis(document.querySelector('[data-auth-form="restore"]')),
      startVisible: vis(document.querySelector('[data-auth-form="start"]')),
      toggle: document.querySelector("#auth-toggle")?.textContent.trim(),
    };
  });
  s.note(`после второго нажатия: видна форма «Начать» = ${back.startVisible}, переключатель «${back.toggle}»`);
  const good = on.restoreVisible && !on.startVisible && on.label === "Ключ переноса" && on.btn === "Забрать свои записи"
    && on.toggle === "Начать заново" && back.startVisible && !back.restoreVisible && back.toggle === "У меня есть ключ переноса";
  good ? s.ok("переключение работает в обе стороны") : s.fail("переключение отработало не полностью");
});

/* 3 — «Начать» → четыре шага */
await runStep(3, "«Начать» → экран «Четыре шага», выдача ID и ключа переноса", async s => {
  await pageA.click("#auth-start");
  await pageA.waitForFunction(() => !document.querySelector(".auth"), null, { timeout: 20000 });
  await sleep(500);
  const name = await screenName(pageA);
  const steps = await pageA.evaluate(() => [...document.querySelectorAll(".step")].map(st => ({
    num: st.querySelector(".step-num")?.textContent.trim(),
    done: st.classList.contains("done"),
    name: st.querySelector(".name")?.textContent.trim(),
    sub: st.querySelector(".sub")?.textContent.trim(),
    code: st.querySelector(".code")?.textContent.trim() || null,
    btn: st.querySelector("button")?.textContent.trim() || null,
  })));
  code1 = steps[0]?.code || "";
  key1 = steps[1]?.code || "";
  s.note(`заголовок экрана: «${name}»`);
  steps.forEach(st => s.note(`шаг ${st.num}: «${st.name}»${st.code ? ` код «${st.code}»` : ""}${st.btn ? ` кнопка «${st.btn}»` : ""}${st.done ? " (отмечен выполненным)" : ""}`));
  s.note(`ID = ${code1}, ключ = ${key1}`);
  const idOk = /^[A-Z0-9]{6}$/.test(code1);
  const keyOk = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key1);
  s.note(`формат ID ${idOk ? "верный" : "НЕВЕРНЫЙ"}, формат ключа ${keyOk ? "верный" : "НЕВЕРНЫЙ"}`);
  const okAll = name === "Четыре шага" && steps.length === 4 && idOk && keyOk
    && steps[0].name === "Ваш ID" && steps[0].btn === "Скопировать ID"
    && /Сохраните ключ переноса/.test(steps[1].name || "") && steps[1].btn === "Скопировать ключ"
    && /Домой|установлено/i.test(steps[2].name || "") && /Разрешите уведомления/.test(steps[3].name || "");
  okAll ? s.ok("все четыре шага на месте, ID и ключ выданы в нужном формате") : s.fail("экран не совпал с ожиданием");
  await snap(pageA, "03-four-steps", s);
  const km = await keyBoxMetrics(pageA);
  s.note(`ключ в блоке: ширина ${km?.rect.width}px в блоке ${km?.boxRect?.width}px, строк ${km?.lines}, обрезка по ширине: ${km?.clippedHoriz}`);
  if (km?.clippedHoriz || km?.outsideBox) s.defect(`ключ переноса не помещается в блок: scrollW=${km.scrollW} clientW=${km.clientW}`);
  const va = await visualAudit(pageA, "четыре шага");
  va.findings.forEach(f => s.defect("четыре шага: " + f));
});

/* 4 — копирование ключа */
await runStep(4, "«Скопировать ключ» → всплывающее сообщение и отметка шага 2", async s => {
  await pageA.bringToFront();
  const before = await pageA.evaluate(() => [...document.querySelectorAll(".step")].map(st => st.classList.contains("done")));
  await clearToast(pageA);
  await pageA.click("#copy-key");
  const toast = await grabToast(pageA);
  await sleep(400);
  const after = await pageA.evaluate(() => [...document.querySelectorAll(".step")].map(st => st.classList.contains("done")));
  let clip = null;
  try { clip = await pageA.evaluate(() => navigator.clipboard.readText()); } catch (e) { clip = "не прочитать: " + e.message; }
  s.note(`всплывающее: «${toast}»`);
  s.note(`шаг 2 «выполнен» до нажатия: ${before[1]}, после: ${after[1]}`);
  s.note(`в буфере обмена: «${clip}»`);
  const toastOk = toast === "Ключ скопирован — сохраните его у себя";
  if (toastOk && after[1] === true) s.ok("сообщение показано, шаг 2 отмечен выполненным");
  else s.fail(`ожидалось «Ключ скопирован — сохраните его у себя» и отметка шага 2; получено «${toast}», отметка=${after[1]}`);
  if (clip && clip !== key1 && !String(clip).startsWith("не прочитать")) s.defect(`в буфере не тот ключ: «${clip}» вместо «${key1}»`);
  await snap(pageA, "04-key-copied", s);
});

/* 5 — домашний экран */
await runStep(5, "«Всё, начинаем» → домашний экран с «Ваш ID»", async s => {
  await pageA.click("#onb-done");
  await sleep(600);
  const home = await pageA.evaluate(() => ({
    isHome: Boolean(document.querySelector(".home")),
    hello: document.querySelector(".home-hello")?.innerText.replace(/\n+/g, " ").trim(),
    strong: document.querySelector(".home-hello strong")?.textContent.trim(),
  }));
  s.note(`шапка домашнего экрана: «${home.hello}»`);
  const good = home.isHome && /Ваш ID/.test(home.hello || "") && home.strong === code1 && !/Привет|Здравствуй/i.test(home.hello || "");
  good ? s.ok("вверху «Ваш ID» и код, приветствия по имени нет") : s.fail("шапка не соответствует ожиданию");
  await snap(pageA, "05-home", s);
});

/* 6 — настройки */
await runStep(6, "Настройки: ID, блок ключа переноса, «Показать»/«Скопировать», «Люди и группы», «Выйти»", async s => {
  await pageA.click('.home-top [data-go="settings"]');
  await sleep(500);
  const before = await pageA.evaluate(() => ({
    screen: document.querySelector(".bar h2")?.textContent.trim(),
    firstCode: document.querySelector(".code-box .code")?.textContent.trim(),
    copyCode: document.querySelector("#copy-code")?.textContent.trim(),
    labels: [...document.querySelectorAll(".group-label")].map(g => g.textContent.trim()),
    keyShown: document.querySelector(".code.key")?.textContent.trim(),
    showBtn: document.querySelector("#show-key")?.textContent.trim(),
    copyKeyBtn: document.querySelector("#copy-key")?.textContent.trim(),
    settings: [...document.querySelectorAll(".setting")].map(el => ({
      name: el.querySelector(".name")?.textContent.trim(),
      sub: el.querySelector(".sub")?.textContent.trim(),
    })),
  }));
  s.note(`экран «${before.screen}», ID вверху «${before.firstCode}», кнопка «${before.copyCode}»`);
  s.note(`блок ключа: «${before.keyShown}», кнопки «${before.showBtn}» / «${before.copyKeyBtn}»`);
  await snap(pageA, "06a-settings-key-hidden", s);
  await pageA.click("#show-key");
  await sleep(350);
  const after = await pageA.evaluate(() => ({
    keyShown: document.querySelector(".code.key")?.textContent.trim(),
    showBtn: document.querySelector("#show-key")?.textContent.trim(),
  }));
  s.note(`после «Показать»: ключ «${after.keyShown}», кнопка «${after.showBtn}»`);
  const people = before.settings.find(x => x.name === "Люди и группы");
  const logout = before.settings.find(x => x.name === "Выйти");
  s.note(`пункт «Люди и группы»: ${people ? "есть" : "НЕТ"}; «Выйти» подпись: «${logout?.sub}»`);
  const good = before.firstCode === code1 && before.copyCode === "Скопировать ID"
    && before.labels.includes("Ключ переноса") && /^[•\-]+$/.test((before.keyShown || "").replace(/\s/g, ""))
    && before.showBtn === "Показать" && before.copyKeyBtn === "Скопировать"
    && after.keyShown === key1 && after.showBtn === "Скрыть"
    && Boolean(people) && logout?.sub === "вернуться можно только по ключу переноса";
  good ? s.ok("всё на месте: ID, скрытый ключ, раскрытие, «Люди и группы», подпись у «Выйти»") : s.fail("часть ожиданий не сошлась");
  await snap(pageA, "06b-settings-key-shown", s);
  const km = await keyBoxMetrics(pageA);
  s.note(`ключ в настройках: ширина ${km?.rect.width}px в блоке ${km?.boxRect?.width}px, строк ${km?.lines}, шрифт ${km?.fontSize}, обрезка: ${km?.clippedHoriz}`);
  if (km?.clippedHoriz || km?.outsideBox) s.defect(`ключ переноса в настройках не помещается: scrollW=${km.scrollW} clientW=${km.clientW}, правый край ${km.rect.right} при блоке до ${km.boxRect?.right}`);
  const va = await visualAudit(pageA, "настройки");
  va.findings.forEach(f => s.defect("настройки: " + f));
});

/* 7 — люди и группы */
await runStep(7, "«Люди и группы»: формы добавления человека и групп, создание «Работа» и «Семья»", async s => {
  await pageA.click('.setting[data-go="people"]');
  await sleep(450);
  const form = await pageA.evaluate(() => ({
    screen: document.querySelector(".bar h2")?.textContent.trim(),
    labels: [...document.querySelectorAll("#add-contact .field span")].map(e => e.textContent.trim()),
    placeholders: [...document.querySelectorAll("#add-contact input")].map(i => `${i.name}:${i.placeholder}`),
    addBtn: document.querySelector('#add-contact button[type="submit"]')?.textContent.trim(),
    groupLabels: [...document.querySelectorAll(".group-label")].map(e => e.textContent.trim()),
    groupInput: document.querySelector('#add-group input[name="name"]')?.placeholder,
    groupBtn: document.querySelector('#add-group button[type="submit"]')?.textContent.trim(),
  }));
  s.note(`экран «${form.screen}», поля формы человека: ${form.labels.join(" | ")}`);
  s.note(`блоки: ${form.groupLabels.join(" | ")}; поле группы «${form.groupInput}», кнопка «${form.groupBtn}»`);
  for (const gname of ["Работа", "Семья"]) {
    await clearToast(pageA);
    await pageA.fill('#add-group input[name="name"]', gname);
    await pageA.click('#add-group button[type="submit"]');
    const t = await grabToast(pageA, 6000);
    await sleep(400);
    s.note(`создание группы «${gname}»: ${t || "без сообщения"}`);
  }
  const groups = await pageA.evaluate(() => [...document.querySelectorAll(".person")].map(p => p.querySelector("b")?.textContent.trim()));
  s.note(`группы в списке: ${groups.join(", ")}`);
  const good = form.screen === "Люди и группы" && form.labels[0] === "Его ID" && /Пометка для себя/.test(form.labels[1] || "")
    && form.groupLabels.includes("Группы") && form.groupBtn === "Создать"
    && groups.includes("Работа") && groups.includes("Семья");
  good ? s.ok("формы на месте, обе группы созданы") : s.fail("экран или создание групп не сошлись с ожиданием");
  await snap(pageA, "07-people-groups", s);
  const va = await visualAudit(pageA, "люди и группы");
  va.findings.forEach(f => s.defect("люди и группы: " + f));
});

/* 8 — повторная группа */
await runStep(8, "Повторное создание группы «работа» — ожидается отказ", async s => {
  const before = await pageA.evaluate(() => [...document.querySelectorAll(".person b")].map(b => b.textContent.trim()));
  await clearToast(pageA);
  await pageA.fill('#add-group input[name="name"]', "работа");
  await pageA.click('#add-group button[type="submit"]');
  const t = await grabToast(pageA, 6000);
  await sleep(450);
  const after = await pageA.evaluate(() => [...document.querySelectorAll(".person b")].map(b => b.textContent.trim()));
  s.note(`сообщение: «${t}»`);
  s.note(`список групп до: [${before.join(", ")}], после: [${after.join(", ")}]`);
  const dup = after.filter(x => x.toLowerCase() === "работа").length;
  if (/уже есть/i.test(t || "") && dup === 1) s.ok("показано «Такая группа уже есть», вторая не создана");
  else s.fail(`ожидался отказ; сообщение «${t}», групп «работа» в списке: ${dup}`);
  await snap(pageA, "08-duplicate-group", s);
});

/* 9 — добавление человека */
await runStep(9, "Добавление человека: свой ID отклоняется, второй ID добавляется как «Коллега» в «Работа»", async s => {
  await clearToast(pageA);
  await pageA.fill('#add-contact input[name="code"]', code1);
  await pageA.click('#add-contact button[type="submit"]');
  const selfToast = await grabToast(pageA, 6000);
  s.note(`попытка добавить свой ID (${code1}): «${selfToast}»`);
  await sleep(300);
  await snap(pageA, "09a-own-id-rejected", s);

  const ctxB = await browser.newContext(ctxOpts);
  pageB = await ctxB.newPage();
  await attach(pageB, "B");
  await pageB.goto(BASE + "/", { waitUntil: "networkidle" });
  await pageB.waitForSelector("#auth-start", { timeout: 15000 });
  await pageB.click("#auth-start");
  await pageB.waitForFunction(() => !document.querySelector(".auth"), null, { timeout: 20000 });
  await sleep(500);
  code2 = await pageB.evaluate(() => document.querySelector(".step .code")?.textContent.trim() || "");
  await pageB.click("#onb-done");
  await sleep(500);
  s.note(`вторая сессия получила ID ${code2}`);

  await pageA.bringToFront();
  await clearToast(pageA);
  await pageA.fill('#add-contact input[name="code"]', code2);
  await pageA.fill('#add-contact input[name="label"]', "Коллега");
  const chips = await pageA.evaluate(() => [...document.querySelectorAll("[data-newgroup]")].map(c => c.textContent.trim()));
  s.note(`чипы групп в форме добавления: ${chips.join(", ")}`);
  await pageA.evaluate(() => [...document.querySelectorAll("[data-newgroup]")].find(c => c.textContent.trim() === "Работа")?.click());
  await sleep(250);
  const chipState = await pageA.evaluate(() => [...document.querySelectorAll("[data-newgroup]")].map(c => ({ label: c.textContent.trim(), on: !c.classList.contains("ghost") })));
  s.note(`выбор группы перед добавлением: ${JSON.stringify(chipState)}`);
  await pageA.click('#add-contact button[type="submit"]');
  const addToast = await grabToast(pageA, 8000);
  await sleep(600);
  const contacts = await pageA.evaluate(() => [...document.querySelectorAll(".person.col")].map(p => ({
    name: p.querySelector("b")?.textContent.trim(),
    sub: p.querySelector("small")?.textContent.trim(),
    chips: [...p.querySelectorAll("[data-contact-group]")].map(c => ({ label: c.textContent.trim(), on: !c.classList.contains("ghost") })),
  })));
  s.note(`после добавления: «${addToast}»; список людей: ${JSON.stringify(contacts)}`);
  const c = contacts[0];
  const good = /Это ваш ID/i.test(selfToast || "") && c && c.name === "Коллега" && c.sub === `ID ${code2}`
    && c.chips.find(x => x.label === "Работа")?.on === true && c.chips.find(x => x.label === "Семья")?.on === false;
  good ? s.ok("свой ID отклонён, второй добавлен как «Коллега» с активной группой «Работа»") : s.fail("часть ожиданий не сошлась");
  await snap(pageA, "09b-contact-added", s);
});

/* 10 — переключение групп у человека */
await runStep(10, "Переключение групп у контакта чипами", async s => {
  const read = () => pageA.evaluate(() => [...document.querySelectorAll(".person.col [data-contact-group]")].map(c => ({ label: c.textContent.trim(), on: !c.classList.contains("ghost") })));
  const before = await read();
  await pageA.evaluate(() => [...document.querySelectorAll(".person.col [data-contact-group]")].find(c => c.textContent.trim() === "Семья")?.click());
  await sleep(800);
  const on = await read();
  await snap(pageA, "10a-family-on", s);
  await pageA.evaluate(() => [...document.querySelectorAll(".person.col [data-contact-group]")].find(c => c.textContent.trim() === "Семья")?.click());
  await sleep(800);
  const off = await read();
  s.note(`до: ${JSON.stringify(before)}`);
  s.note(`после первого нажатия «Семья»: ${JSON.stringify(on)}`);
  s.note(`после второго нажатия: ${JSON.stringify(off)}`);
  const good = on.find(x => x.label === "Семья")?.on === true && off.find(x => x.label === "Семья")?.on === false
    && off.find(x => x.label === "Работа")?.on === true;
  good ? s.ok("чип «Семья» включается и выключается, «Работа» осталась включённой") : s.fail("переключение групп отработало не так");
  await snap(pageA, "10b-contact-groups", s);
});

/* 11 — запись и отправка */
await runStep(11, "Создание записи и отправка группе «Работа»", async s => {
  const atHome = await goHome(pageA);
  s.note(`возврат на главный экран: ${atHome ? "да" : "НЕТ, экран " + await screenName(pageA)}`);
  await pageA.click('.widget [data-go="chat"]');
  await pageA.waitForSelector("#chat-input", { timeout: 10000 });
  await pageA.fill("#chat-input", "совещание завтра в 10");
  await pageA.click("#chat-send");
  await pageA.waitForFunction(() => {
    const bs = [...document.querySelectorAll(".bubble.ai")];
    return bs.length > 0 && !bs.some(b => b.textContent.includes("Разбираю"));
  }, null, { timeout: 25000 });
  await sleep(500);
  const bubble = await pageA.evaluate(() => {
    const b = [...document.querySelectorAll(".bubble.ai")].pop();
    return b ? b.innerText.replace(/\n+/g, " | ") : null;
  });
  s.note(`ответ в чате: «${bubble}»`);

  await goHome(pageA);
  await pageA.click('.widget [data-go="shelves"]');
  await pageA.waitForSelector("[data-shelf-tab]", { timeout: 10000 });
  await sleep(400);
  const tabs = await pageA.evaluate(() => [...document.querySelectorAll("[data-shelf-tab]")].map(t => t.dataset.shelfTab));
  let opened = null;
  for (const t of tabs) {
    await pageA.click(`[data-shelf-tab="${t}"]`);
    await sleep(350);
    const found = await pageA.locator(".card-main", { hasText: /овещание/i }).count();
    if (found) {
      await pageA.locator(".card-main", { hasText: /овещание/i }).first().click();
      opened = t;
      break;
    }
  }
  s.note(`карточка «Совещание» найдена на полке: ${opened || "НЕ НАЙДЕНА"}`);
  await pageA.waitForSelector("#detail-share", { timeout: 10000 });
  await sleep(300);
  await pageA.click("#detail-share");
  await pageA.waitForSelector("#share-confirm", { timeout: 10000 });
  await sleep(400);
  const share = await pageA.evaluate(() => ({
    screen: document.querySelector(".bar h2")?.textContent.trim(),
    labels: [...document.querySelectorAll(".group-label")].map(e => e.textContent.trim()),
    groupChips: [...document.querySelectorAll("[data-send-group]")].map(c => ({ label: c.textContent.trim(), on: !c.classList.contains("ghost") })),
    people: [...document.querySelectorAll("[data-person]")].map(p => ({
      text: p.innerText.replace(/\n+/g, " | ").trim(),
      on: p.classList.contains("on"),
      check: p.querySelector(".check")?.textContent.trim(),
    })),
    confirm: document.querySelector("#share-confirm")?.textContent.trim(),
  }));
  s.note(`экран «${share.screen}», блоки: ${share.labels.join(" | ")}`);
  s.note(`чипы групп: ${JSON.stringify(share.groupChips)}`);
  s.note(`люди: ${JSON.stringify(share.people)}; кнопка «${share.confirm}»`);
  await snap(pageA, "11a-share-before", s);
  await pageA.evaluate(() => [...document.querySelectorAll("[data-send-group]")].find(c => /Работа/.test(c.textContent))?.click());
  await sleep(450);
  const afterChip = await pageA.evaluate(() => ({
    groupChips: [...document.querySelectorAll("[data-send-group]")].map(c => ({ label: c.textContent.trim(), on: !c.classList.contains("ghost") })),
    people: [...document.querySelectorAll("[data-person]")].map(p => ({ text: p.innerText.replace(/\n+/g, " | ").trim(), on: p.classList.contains("on"), check: p.querySelector(".check")?.textContent.trim() })),
    confirm: document.querySelector("#share-confirm")?.textContent.trim(),
  }));
  s.note(`после нажатия чипа «Работа»: человек отмечен = ${afterChip.people[0]?.on} (галочка «${afterChip.people[0]?.check}»), кнопка «${afterChip.confirm}»`);
  await snap(pageA, "11b-share-group-selected", s);
  const va = await visualAudit(pageA, "отправить");
  va.findings.forEach(f => s.defect("отправить: " + f));
  await clearToast(pageA);
  await pageA.click("#share-confirm");
  const sendToast = await grabToast(pageA, 10000);
  await sleep(400);
  s.note(`после отправки: «${sendToast}»`);
  await snap(pageA, "11c-after-send", s);
  const chipWork = share.groupChips.find(c => /Работа/.test(c.label))?.label;
  const chipFam = share.groupChips.find(c => /Семья/.test(c.label))?.label;
  const good = share.screen === "Отправить" && /Группы/.test(share.labels.join(" "))
    && chipWork === "Работа · 1 чел." && chipFam === "Семья · пока никого"
    && afterChip.people[0]?.on === true && afterChip.confirm === "Отправить · 1" && sendToast === "Отправлено · 1";
  good ? s.ok("группы и люди показаны, выбор группы отметил человека, отправка прошла") : s.fail("часть ожиданий не сошлась");
});

/* 12 — вторая сессия видит входящее */
await runStep(12, "Вторая сессия: плашка «Вам отправили 1» и происхождение записи", async s => {
  await pageB.bringToFront();
  await pageB.reload({ waitUntil: "networkidle" });
  await sleep(1000);
  const home = await pageB.evaluate(() => ({
    banner: document.querySelector(".incoming-banner")?.textContent.trim(),
    hello: document.querySelector(".home-hello")?.innerText.replace(/\n+/g, " ").trim(),
  }));
  s.note(`плашка на главной: «${home.banner}»`);
  await snap(pageB, "12a-second-session-home", s);
  await pageB.evaluate(() => document.querySelector(".incoming-banner")?.click());
  await sleep(800);
  const inc = await pageB.evaluate(() => {
    const card = [...document.querySelectorAll(".card")].find(c => c.querySelector(".pill.warn"));
    return card ? {
      title: card.querySelector(".title")?.textContent.trim(),
      meta: card.querySelector(".meta")?.textContent.trim(),
      pill: card.querySelector(".pill.warn")?.textContent.trim(),
      full: card.innerText.replace(/\n+/g, " | ").trim(),
    } : null;
  });
  s.note(`карточка входящего: ${JSON.stringify(inc)}`);
  const apiFrom = await pageB.evaluate(async () => {
    try {
      const r = await fetch("/api/state", { headers: { Authorization: "Bearer " + localStorage.getItem("vc.token") } });
      const d = await r.json();
      return JSON.stringify((d.incoming || []).map(i => ({ title: i.title, from: i.from })));
    } catch (e) { return "не получить: " + e.message; }
  });
  s.note(`данные об отправителе с сервера: ${apiFrom}`);
  await snap(pageB, "12b-second-session-incoming", s);
  const bannerOk = home.banner === "Вам отправили 1 — посмотреть";
  const fromOk = inc && inc.meta.includes(code1);
  if (bannerOk && fromOk) s.ok("плашка показана, в записи виден ID отправителя");
  else if (bannerOk) s.fail(`плашка есть, но происхождение записи показано неверно: «${inc?.meta}» (ожидался ID ${code1})`);
  else s.fail(`плашка не совпала: «${home.banner}»`);
  if (inc && /undefined/.test(inc.full)) s.defect(`в карточке входящего выводится «undefined»: «${inc.meta}»`);
});

/* 13 — перенос по ключу */
await runStep(13, "Ключ переноса: вход по ключу (нижний регистр) и отказ по неверному ключу", async s => {
  const ctxC = await browser.newContext(ctxOpts);
  const pageC = await ctxC.newPage();
  await attach(pageC, "C");
  await pageC.goto(BASE + "/", { waitUntil: "networkidle" });
  await pageC.waitForSelector("#auth-start", { timeout: 15000 });
  await pageC.click("#auth-toggle");
  await sleep(250);
  await pageC.fill('[data-auth-form="restore"] input[name="key"]', key1.toLowerCase());
  s.note(`ввожу ключ в нижнем регистре: ${key1.toLowerCase()}`);
  await pageC.click("#auth-restore");
  await sleep(1800);
  const afterRestore = await pageC.evaluate(() => ({
    screen: document.querySelector(".bar h2")?.textContent.trim() || (document.querySelector(".auth") ? "AUTH" : document.querySelector(".home") ? "HOME" : "?"),
    code: document.querySelector(".step .code")?.textContent.trim() || document.querySelector(".home-hello strong")?.textContent.trim(),
    error: document.querySelector("[data-auth-error]")?.textContent.trim(),
  }));
  s.note(`после «Забрать свои записи»: экран «${afterRestore.screen}», ID «${afterRestore.code}»${afterRestore.error ? `, ошибка «${afterRestore.error}»` : ""}`);
  if (afterRestore.screen === "Четыре шага") {
    await pageC.click("#onb-done");
    await sleep(700);
  }
  let items = [];
  if (await pageC.locator('.widget [data-go="shelves"]').count()) {
    await pageC.click('.widget [data-go="shelves"]');
    await pageC.waitForSelector("[data-shelf-tab]", { timeout: 10000 });
    const tabs = await pageC.evaluate(() => [...document.querySelectorAll("[data-shelf-tab]")].map(t => t.dataset.shelfTab));
    for (const t of tabs) {
      await pageC.click(`[data-shelf-tab="${t}"]`);
      await sleep(250);
      const titles = await pageC.evaluate(() => [...document.querySelectorAll(".card-main .title")].map(e => e.textContent.trim()));
      items.push(...titles);
    }
    items = [...new Set(items)];
  }
  const homeCode = await pageC.evaluate(() => document.querySelector(".home-hello strong")?.textContent.trim() || null);
  s.note(`записи в перенесённой сессии: ${items.join(" | ") || "нет"}`);
  await snap(pageC, "13a-restored-session", s);
  await goHome(pageC);
  await snap(pageC, "13b-restored-home", s);

  const ctxD = await browser.newContext(ctxOpts);
  const pageD = await ctxD.newPage();
  await attach(pageD, "D");
  await pageD.goto(BASE + "/", { waitUntil: "networkidle" });
  await pageD.waitForSelector("#auth-start", { timeout: 15000 });
  await pageD.click("#auth-toggle");
  await sleep(250);
  await pageD.fill('[data-auth-form="restore"] input[name="key"]', "AAAAA-BBBBB-CCCCC-DDDDD");
  await pageD.click("#auth-restore");
  await sleep(1800);
  const bad = await pageD.evaluate(() => ({
    stillAuth: Boolean(document.querySelector(".auth")),
    error: document.querySelector("[data-auth-error]")?.textContent.trim(),
  }));
  s.note(`неверный ключ: остались на экране входа = ${bad.stillAuth}, сообщение «${bad.error}»`);
  await snap(pageD, "13c-bad-key", s);

  const restoredOk = (afterRestore.code === code1 || homeCode === code1) && items.some(t => /овещание/i.test(t));
  const badOk = bad.stillAuth && /Ключ не подходит/i.test(bad.error || "");
  if (restoredOk && badOk) s.ok("по ключу вернулись к тому же ID и записи, неверный ключ отклонён");
  else s.fail([
    restoredOk ? null : `перенос: ID «${afterRestore.code || homeCode}» (ожидался ${code1}), записи: ${items.join(", ") || "нет"}`,
    badOk ? null : `неверный ключ: «${bad.error}», остались на входе = ${bad.stillAuth}`,
  ].filter(Boolean).join("; "));
  globalThis.__lastPage = pageA;
  await ctxC.close();
  await ctxD.close();
});

/* 15 — визуальный контроль */
await runStep(15, "Визуальный контроль новых экранов", async s => {
  const all = results.filter(r => r.id !== 15).flatMap(r => r.defects.map(d => `шаг ${r.id}: ${d}`));
  if (all.length) { s.fail("найдены визуальные замечания"); all.forEach(d => s.note(d)); }
  else s.ok("наложений, обрезанного текста и вылетов за края не обнаружено");
});

/* 14 — ошибки */
await runStep(14, "Ошибки JS и сети за весь прогон", async s => {
  const expected = netErrors.filter(e =>
    (e.status === 400 && /\/api\/groups|\/api\/contacts/.test(e.url || "")) ||
    (e.status === 401 && /\/api\/restore/.test(e.url || "")) ||
    (e.status === 404 && /\/api\/contacts/.test(e.url || ""))
  );
  const real = netErrors.filter(e => !expected.includes(e));
  s.note(`ожидаемых отказов (шаги 8, 9, 13): ${expected.length}`);
  s.note(`прочих сетевых ошибок: ${real.length}`);
  s.note(`исключений JS: ${jsErrors.length}, console.error/warning: ${consoleErrors.length}, записей Log: ${logEntries.length}`);
  if (!jsErrors.length && !real.length) s.ok("настоящих ошибок JS и сети нет");
  else s.fail("есть ошибки — см. списки ниже");
  s.rec.expected = expected;
  s.rec.realNet = real;
});

results.sort((a, b) => a.id - b.id);

const report = {
  base: BASE,
  when: new Date().toISOString(),
  ids: { first: code1, transferKey: key1, second: code2 },
  steps: results,
  jsErrors,
  consoleErrors,
  netErrors,
  logEntries,
};
fs.writeFileSync("path.join(QA_DIR, "auth-report.json")", JSON.stringify(report, null, 2));

console.log("=== ИТОГ ПО ШАГАМ ===");
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
console.log("\nID1=" + code1 + " KEY1=" + key1 + " ID2=" + code2);

await browser.close();
