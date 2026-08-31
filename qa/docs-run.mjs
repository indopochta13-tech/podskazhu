// Ссылки на правила и политику: они должны открываться, а не гаснуть.
// Проверяем и веб (новая вкладка), и поведение приложения, где новых окон нет.
// Запуск: node qa/docs-run.mjs [базовый-url]
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import { readFile } from "node:fs/promises";

const BASE = process.argv[2] || "http://127.0.0.1:5173";
const problems = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Все документы из настроек: подпись строки, адрес и слово из заголовка страницы.
const DOCS = [
  ["Правила пересылки записей", "/rules.html", "правил"],
  ["Что мы храним", "/privacy.html", "конфиденциальн"],
];

function ok(label, condition, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition || !detail ? "" : ` → ${detail}`}`);
  if (!condition) problems.push(label);
}

console.log(`Документы: ${BASE}\n`);

/* —— Сами файлы: без них любая ссылка ведёт в пустоту —— */

for (const [label, path] of DOCS) {
  const res = await fetch(`${BASE}${path}`).catch(() => null);
  const type = res?.headers.get("content-type") || "";
  ok(`сервер отдаёт «${label}»`, Boolean(res?.ok) && type.includes("html"), `${res?.status ?? "нет ответа"} ${type}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(1200);

// Согласие на первом экране: ссылка не должна заодно ставить галочку.
const box = await page.$("#auth-consent");
const consentLink = await page.$("a[data-doc='/privacy.html']");
ok("на первом экране ссылка размечена", Boolean(consentLink));
const [firstTab] = await Promise.all([
  ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null),
  consentLink.click(),
]);
ok("политика открывается с первого экрана", Boolean(firstTab), firstTab ? await firstTab.url() : "вкладка не открылась");
if (firstTab) {
  await firstTab.waitForLoadState("domcontentloaded");
  ok("это действительно политика", (await firstTab.title()).toLowerCase().includes("конфиденциальн"), await firstTab.title());
  await firstTab.close();
}
ok("галочка согласия при этом не ставится", (await box.isChecked()) === false);

await box.check();
await page.click("#auth-start");
await sleep(1500);

await page.click("[aria-label='Настройки']");
await sleep(800);

for (const [label, path, expect] of DOCS) {
  const row = await page.$(`a.setting[data-doc='${path}']`);
  ok(`строка «${label}» на месте`, Boolean(row));
  const [tab] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null),
    row.click(),
  ]);
  ok(`«${label}» открывается`, Boolean(tab), tab ? await tab.url() : "ничего не открылось");
  if (tab) {
    await tab.waitForLoadState("domcontentloaded");
    ok(`открылась нужная страница: ${label}`, (await tab.title()).toLowerCase().includes(expect), await tab.title());
    await tab.close();
  }
}

// Список настроек не должен прыгать наверх после возвращения в приложение.
await page.evaluate(() => { document.querySelector(".scroll").scrollTop = 400; });
await sleep(300);
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await sleep(1200);
const top = await page.evaluate(() => document.querySelector(".scroll")?.scrollTop ?? -1);
ok("настройки остаются на том же месте после обновления", top > 200, String(top));

ok("в консоли нет ошибок", errors.length === 0, errors.slice(0, 3).join(" | "));

/* —— Приложение для телефона: окон там нет, адрес должен уходить в системный браузер —— */

const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
// Мост подменяем до загрузки приложения: оно запоминает его один раз при старте.
await phone.addInitScript(() => {
  window.__opened = [];
  window.__windows = 0;
  window.open = () => { window.__windows += 1; return null; };
  window.VC_NATIVE = new Proxy({}, {
    get(_t, prop) {
      if (prop === "openUrl") return url => { window.__opened.push(url); return true; };
      if (prop === "permissionState") return () => "granted";
      if (prop === "billing" || prop === "speech" || prop === "pinWidget") return undefined;
      return () => Promise.resolve(true);
    },
  });
});
const phonePage = await phone.newPage();
await phonePage.goto(BASE, { waitUntil: "networkidle" });
await sleep(1200);
const phoneLink = await phonePage.$("a[data-doc='/privacy.html']");
ok("в приложении ссылка на месте", Boolean(phoneLink));
await phoneLink.click();
await sleep(500);
const phoneResult = await phonePage.evaluate(() => ({ opened: window.__opened, windows: window.__windows, path: location.pathname }));
ok("адрес уходит в системный браузер", phoneResult.opened.length === 1 && phoneResult.opened[0].endsWith("/privacy.html"),
  JSON.stringify(phoneResult.opened));
ok("окно в приложении не запрашивается", phoneResult.windows === 0, String(phoneResult.windows));
ok("приложение остаётся на своём экране", phoneResult.path === "/", phoneResult.path);

// Жалуются обычно не на первый экран, а на настройки — проходим каждую строку и там.
await phonePage.check("#auth-consent");
await phonePage.click("#auth-start");
await sleep(1500);
await phonePage.click("[aria-label='Настройки']");
await sleep(800);

for (const [label, path] of DOCS) {
  await phonePage.evaluate(() => { window.__opened.length = 0; });
  const row = await phonePage.$(`a.setting[data-doc='${path}']`);
  ok(`в приложении строка «${label}» на месте`, Boolean(row));
  await row.click();
  await sleep(400);
  const res = await phonePage.evaluate(() => ({ opened: window.__opened.slice(), path: location.pathname }));
  ok(`в приложении «${label}» уходит наружу`, res.opened.length === 1 && res.opened[0].endsWith(path), JSON.stringify(res.opened));
  ok(`приложение остаётся в настройках: ${label}`, res.path === "/", res.path);
}

/* —— Фильтр ссылок Android: из-за него документы возвращались в приложение —— */

// Приложение подтверждено владельцем домена, поэтому система отдаёт ему все адреса,
// которые попадают под фильтр. Стоит расширить путь дальше приглашения «Подключить рядом» —
// и «Правила» с «Что мы храним» откроют не браузер, а нас же: человек нажмёт и не увидит ничего.
const manifest = await readFile(new URL("../mobile/android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const linkFilter = manifest.match(/<intent-filter[^>]*autoVerify="true"[^>]*>[\s\S]*?<\/intent-filter>/)?.[0] || "";
ok("в приложении объявлен фильтр ссылок", Boolean(linkFilter));
const claims = [...linkFilter.matchAll(/android:(path|pathPrefix|pathPattern|pathSuffix|pathAdvancedPattern)="([^"]*)"/g)]
  .map(m => `${m[1]}="${m[2]}"`);
ok("приложение забирает себе только приглашение, а не весь сайт",
  claims.length === 1 && claims[0] === 'path="/"', claims.join(", ") || "путь не ограничен");
for (const [label, path] of DOCS) {
  ok(`адрес «${label}» остаётся браузеру`, !claims.some(c => c === `path="${path}"` || c === 'pathPrefix="/"'), claims.join(", "));
}

await browser.close();
console.log(problems.length ? `\nПроблем: ${problems.length}` : "\nВсё прошло");
process.exit(problems.length ? 1 : 0);
