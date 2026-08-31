// Браузерный прогон подключения по QR: собирающий открывает код,
// второй приходит по ссылке из камеры, третий набирает шесть цифр руками.
// QR не просто рисуется — снимок экрана распознаётся сторонним декодером.
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import jsQR from "/tmp/soulvoice_test/node_modules/jsqr/dist/jsQR.js";
import { PNG } from "/tmp/soulvoice_test/node_modules/pngjs/lib/png.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "screens");
fs.mkdirSync(OUT, { recursive: true });

const sleepMs = ms => new Promise(r => setTimeout(r, ms));

// Прогон заводит по три аккаунта, а сервер бережёт себя от частых регистраций,
// поэтому по умолчанию поднимаем свой чистый сервер на свободном порту.
async function ownServer() {
  const port = 8850 + Math.floor(Math.random() * 90);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-qa-"));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(HERE, "..", "app", "server.js")], {
    cwd: path.join(HERE, "..", "app"),
    env: { ...process.env, VC_PORT: String(port), VC_HOST: "127.0.0.1", VC_DATA_DIR: dir, VC_ORIGIN: base },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${base}/api/config`)).ok) return { base, stop: () => { child.kill("SIGKILL"); fs.rmSync(dir, { recursive: true, force: true }); } };
    } catch {}
    await sleepMs(100);
  }
  child.kill("SIGKILL");
  throw new Error("свой сервер не поднялся");
}

const own = process.argv[2] ? null : await ownServer();
const BASE = process.argv[2] || own.base;

const results = [];
const jsErrors = [];
const consoleErrors = [];
const netErrors = [];
let CURRENT = "старт";

const sleep = ms => new Promise(r => setTimeout(r, ms));

function step(id, title) {
  const rec = { id, title, status: "не прошло", observed: [], shots: [] };
  results.push(rec);
  CURRENT = id;
  return {
    ok: m => { rec.status = "прошло"; if (m) rec.observed.push(m); },
    fail: m => { rec.status = "НЕ прошло"; if (m) rec.observed.push(m); },
    note: m => rec.observed.push(m),
    shot: p => rec.shots.push(path.basename(p)),
    rec,
  };
}

async function runStep(id, title, fn) {
  const s = step(id, title);
  try {
    await fn(s);
  } catch (err) {
    s.fail(`шаг прерван: ${err.message}`);
    s.rec.crash = String(err.stack || err).split("\n").slice(0, 3).join(" | ");
  }
  console.log(`${s.rec.status === "прошло" ? "✓" : "✗"} ${id} · ${title}`);
  for (const line of s.rec.observed) console.log(`    ${line}`);
  return s;
}

async function snap(page, name, s) {
  const file = path.join(OUT, `qr-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  if (s) s.shot(file);
  return file;
}

async function attach(page, session) {
  page.on("pageerror", e => jsErrors.push({ session, step: CURRENT, text: e.message }));
  page.on("console", m => {
    if (m.type() === "error" || m.type() === "warning") consoleErrors.push({ session, step: CURRENT, type: m.type(), text: m.text() });
  });
  page.on("requestfailed", r => netErrors.push({ session, step: CURRENT, kind: "requestfailed", url: r.url(), error: r.failure()?.errorText }));
  page.on("response", async r => {
    if (r.status() >= 400) {
      let body = "";
      try { body = (await r.text()).slice(0, 200); } catch {}
      netErrors.push({ session, step: CURRENT, kind: "http", status: r.status(), method: r.request().method(), url: r.url(), body });
    }
  });
}

async function clickText(page, text) {
  const el = page.locator(`button:has-text("${text}")`).first();
  await el.waitFor({ state: "visible", timeout: 8000 });
  await el.click();
  await sleep(400);
}

// Заводим аккаунт и доходим до экрана «Люди и группы».
async function freshUser(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#auth-start").waitFor({ timeout: 8000 });
  await page.click("#auth-start");
  await page.locator("#onb-done").waitFor({ timeout: 8000 });
  await page.click("#onb-done");
  await page.locator(".home").waitFor({ timeout: 8000 });
  return (await page.textContent(".home-hello strong")).trim();
}

async function toPeople(page) {
  if (!(await page.locator(".home").count())) {
    for (let i = 0; i < 4 && !(await page.locator(".home").count()); i += 1) {
      const back = page.locator(".bar [data-back]");
      if (!(await back.count())) break;
      await back.first().click();
      await sleep(350);
    }
  }
  await page.click('[data-go="settings"]');
  await sleep(300);
  await page.click('[data-go="people"]');
  await page.locator("#add-contact").waitFor({ timeout: 8000 });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctxOpts = {
  viewport: { width: 400, height: 860 },
  deviceScaleFactor: 2,
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
};

// Три чистых профиля: собирающий, тот кто по камере, тот кто набирает код.
const ctxA = await browser.newContext(ctxOpts);
const pageA = await ctxA.newPage();
await attach(pageA, "собирающий");
const ctxB = await browser.newContext(ctxOpts);
const pageB = await ctxB.newPage();
await attach(pageB, "по камере");
const ctxC = await browser.newContext(ctxOpts);
const pageC = await ctxC.newPage();
await attach(pageC, "по коду");

let codeA = "";
let codeB = "";
let codeC = "";
let roomCode = "";
let qrLink = "";

await runStep("A1", "собирающий открывает код на группу «Работа»", async s => {
  codeA = await freshUser(pageA);
  s.note(`ID собирающего: ${codeA}`);
  await toPeople(pageA);
  await clickText(pageA, "Подключить рядом");
  await pageA.fill("#nearby-name", "Работа");
  await clickText(pageA, "Открыть код");
  await pageA.locator(".qr-box svg").waitFor({ timeout: 8000 });
  roomCode = (await pageA.textContent(".room-code")).replace(/\D/g, "");
  const hint = (await pageA.textContent(".code-box .hint")).trim();
  s.note(`код на экране: ${roomCode} · ${hint}`);
  await snap(pageA, "room", s);
  if (/^\d{6}$/.test(roomCode) && /живёт ещё \d+ мин/.test(hint)) s.ok();
  else s.fail(`код «${roomCode}», подпись «${hint}»`);
});

await runStep("A2", "QR со снимка экрана распознаётся сторонним декодером", async s => {
  const buf = await pageA.locator(".qr-box svg").screenshot();
  fs.writeFileSync(path.join(OUT, "qr-code.png"), buf);
  s.shot(path.join(OUT, "qr-code.png"));
  const png = PNG.sync.read(buf);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  qrLink = decoded?.data || "";
  s.note(`распознано: ${qrLink || "ничего"}`);
  if (qrLink === `${BASE}/?join=${roomCode}`) s.ok();
  else s.fail(`ожидали ${BASE}/?join=${roomCode}`);
});

await runStep("B1", "по ссылке из камеры открывается экран подтверждения", async s => {
  await pageB.goto(qrLink || `${BASE}/?join=${roomCode}`, { waitUntil: "domcontentloaded" });
  await pageB.locator("#join-yes").waitFor({ timeout: 10000 });
  const title = (await pageB.textContent(".card .title")).trim();
  s.note(`заголовок: ${title}`);
  await snap(pageB, "join-confirm", s);
  if (title.includes("Работа")) s.ok();
  else s.fail(title);
});

await runStep("B2", "подтверждение подключает и заводит группу", async s => {
  await pageB.click("#join-yes");
  await pageB.locator("#join-done").waitFor({ timeout: 10000 });
  const title = (await pageB.textContent(".card .title")).trim();
  s.note(`итог: ${title}`);
  await snap(pageB, "join-done", s);
  if (title.includes("Работа")) s.ok();
  else s.fail(title);
});

await runStep("C1", "третий подключается, набрав шесть цифр руками", async s => {
  codeC = await freshUser(pageC);
  s.note(`ID третьего: ${codeC}`);
  await toPeople(pageC);
  await clickText(pageC, "Подключить рядом");
  await pageC.fill("#nearby-code", roomCode);
  await clickText(pageC, "Войти");
  await pageC.locator("#join-yes").waitFor({ timeout: 10000 });
  await snap(pageC, "code-entry", s);
  await pageC.click("#join-yes");
  await pageC.locator("#join-done").waitFor({ timeout: 10000 });
  const title = (await pageC.textContent(".card .title")).trim();
  s.note(`итог: ${title}`);
  if (title.includes("Работа")) s.ok();
  else s.fail(title);
});

await runStep("A3", "список подключившихся оживает сам, без перезагрузки", async s => {
  let joined = [];
  for (let i = 0; i < 12; i += 1) {
    joined = await pageA.locator(".person .who b").allTextContents();
    if (joined.length >= 2) break;
    await sleep(1000);
  }
  s.note(`в списке: ${joined.join(", ") || "пусто"}`);
  await snap(pageA, "room-joined", s);
  if (joined.length === 2) s.ok();
  else s.fail(`подключившихся видно ${joined.length}`);
});

await runStep("A4", "«Готово» закрывает код и возвращает к людям", async s => {
  await clickText(pageA, "Готово");
  await pageA.locator("#add-contact").waitFor({ timeout: 8000 });
  // Тост «Код закрыт» висит поверх шапки — снимок делаем после него.
  await pageA.evaluate(() => {
    const t = document.getElementById("toast");
    if (t) { t.classList.remove("show"); t.textContent = ""; }
  });
  const people = await pageA.locator(".person.col .who b").allTextContents();
  const groups = await pageA.locator(".person.col .chip:not(.ghost):not(.danger)").allTextContents();
  s.note(`люди у собирающего: ${people.join(", ")}`);
  s.note(`отмеченные группы на карточках: ${groups.join(", ")}`);
  await snap(pageA, "people-host", s);
  if (people.length === 2 && groups.filter(g => g.trim() === "Работа").length === 2) s.ok();
  else s.fail(`людей ${people.length}, групп «Работа» ${groups.filter(g => g.trim() === "Работа").length}`);

  const closed = await pageA.evaluate(async code => {
    const res = await fetch(`/api/rooms/${code}`, { headers: { Authorization: `Bearer ${localStorage.getItem("vc.token")}` } });
    return (await res.json())?.room?.closed;
  }, roomCode);
  s.note(`комната закрыта на сервере: ${closed}`);
  if (closed !== true) s.fail("комната осталась открытой");
});

await runStep("B3", "у пришедшего по камере те же двое в группе «Работа»", async s => {
  // Аккаунт завёлся сам по ссылке, поэтому после подключения показываем четыре шага.
  await pageB.click("#join-done");
  await pageB.locator("#onb-done").waitFor({ timeout: 8000 });
  await pageB.click("#onb-done");
  await pageB.locator(".home").waitFor({ timeout: 8000 });
  codeB = (await pageB.textContent(".home-hello strong")).trim();
  s.note(`ID пришедшего по камере: ${codeB}`);
  await toPeople(pageB);
  const people = await pageB.locator(".person.col .who b").allTextContents();
  const groups = await pageB.locator(".person.col .chip:not(.ghost):not(.danger)").allTextContents();
  s.note(`люди: ${people.join(", ")}`);
  s.note(`отмеченные группы: ${groups.join(", ")}`);
  await snap(pageB, "people-guest", s);
  if (people.length === 2 && people.includes(codeA) && people.includes(codeC)
    && groups.filter(g => g.trim() === "Работа").length === 2) s.ok();
  else s.fail(`видно ${people.join(", ")}, ждали ${codeA} и ${codeC}`);
});

await runStep("D1", "просроченный или чужой код объясняет себя человеку", async s => {
  await pageC.goto(`${BASE}/?join=000000`, { waitUntil: "domcontentloaded" });
  await pageC.locator("#join-retry").waitFor({ timeout: 10000 });
  const title = (await pageC.textContent(".card .title")).trim();
  s.note(`сообщение: ${title}`);
  await snap(pageC, "wrong-code", s);
  if (/нет|не работает|закрыт/i.test(title)) s.ok();
  else s.fail(title);
});

const report = {
  когда: new Date().toISOString(),
  сервер: BASE,
  комната: roomCode,
  ссылкаИзQR: qrLink,
  шаги: results,
  ошибкиJS: jsErrors,
  консоль: consoleErrors,
  сетевыеОтветы4xx5xx: netErrors,
};
fs.writeFileSync(path.join(HERE, "qr-report.json"), JSON.stringify(report, null, 2));

await browser.close();
if (own) own.stop();

const bad = results.filter(r => r.status !== "прошло");
console.log(`\nШагов: ${results.length}, не прошло: ${bad.length}`);
console.log(`Ошибок JS: ${jsErrors.length}, предупреждений консоли: ${consoleErrors.length}, ответов 4xx/5xx: ${netErrors.length}`);
for (const e of jsErrors) console.log(`  JS · ${e.step} · ${e.text}`);
for (const e of netErrors) console.log(`  СЕТЬ · ${e.step} · ${e.status || e.error} ${e.url}`);
console.log(`Снимки: ${fs.readdirSync(OUT).filter(f => f.startsWith("qr-")).sort().join(", ")}`);
process.exit(bad.length ? 1 : 0);
