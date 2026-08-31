// Проверка новой навигации: закладка «Наборы», иконки тренажёра и общего списка,
// боковое меню только про подписку. Запуск: node qa/nav-run.mjs [базовый-url]
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:5173";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "nav-screens");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const errors = [];
let shotN = 0;

function ok(label, condition, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition || !detail ? "" : ` → ${detail}`}`);
  if (!condition) problems.push(label);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

async function snap(name) {
  shotN += 1;
  const file = path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

const text = sel => page.$eval(sel, el => el.textContent.trim()).catch(() => "");
const tabs = () => page.$$eval(".tabs .tab", els => els.map(e => e.textContent.trim()));

console.log(`Навигация: ${BASE}\n`);

await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(1200);
// Первый экран — согласие и «Начать»: доходим до полок.
const consent = await page.$("#auth-consent, #consent-ok");
if (consent) await consent.check().catch(() => {});
const startBtn = await page.$("button:has-text('Начать'), #consent-accept");
if (startBtn) await startBtn.click().catch(() => {});
await sleep(1500);
await snap("boot");

// После входа открывается чат — уходим на полки, там живут закладки.
const toShelves = await page.$(".bar [data-go='shelves']");
if (toShelves) await toShelves.click();
await sleep(600);
await snap("shelves");

// 1. Верхняя панель: подписка слева, тренажёр, общий список и настройки справа.
const chrome = await page.$$eval(".top-chrome button", els => els.map(e => e.getAttribute("aria-label")));
ok("в верхней панели четыре кнопки", chrome.length === 4, JSON.stringify(chrome));
ok("порядок: подписка · тренажёр · общий список · настройки",
  JSON.stringify(chrome) === JSON.stringify(["Подписка", "Тренажёр разговоров", "Общий список", "Настройки"]),
  JSON.stringify(chrome));

// 2. Закладка «Наборы» стоит в общем ряду.
const tabList = await tabs();
ok("закладка «Наборы» в ряду закладок", tabList.includes("Наборы"), JSON.stringify(tabList));

await page.click(".tabs .tab:has-text('Наборы')");
await sleep(500);
await snap("tab-nabory");
ok("на «Наборах» ряд закладок остаётся", (await tabs()).includes("Наборы"));
const kitBody = await page.textContent(".scroll");
ok("наборы загрузились", /Дети|Питомцы|Счётчики|Здоровье/.test(kitBody), kitBody.slice(0, 80));

const firstKit = await page.$("[data-template]");
await firstKit.click();
await sleep(400);
await snap("nabor-detail");
ok("внутри набора закладки не пропали", (await tabs()).includes("Наборы"));
ok("в наборе есть кнопка возврата", Boolean(await page.$("#template-back")));
ok("в наборе есть кнопка «Добавить»", (await text("#template-apply")).startsWith("Добавить"));

await page.click("#template-back");
await sleep(300);
ok("возврат к списку наборов работает", Boolean(await page.$("[data-template]")));

// 3. Боковое меню — только подписка.
await page.click("#extras-open");
await sleep(600);
await snap("drawer");
const drawer = await page.textContent(".extras-drawer");
ok("шторка называется «Подписка»", /Подписка/.test(drawer), drawer.slice(0, 60));
ok("в шторке нет входа в наборы", !/Готовые наборы/.test(drawer));
ok("в шторке видны тренажёр и общий список как подписка",
  /Тренажёр разговоров/.test(drawer) && /Общий список/.test(drawer) && /тестовый режим/.test(drawer),
  drawer.replace(/\s+/g, " ").slice(0, 160));
ok("из шторки нельзя провалиться в функции",
  (await page.$$("aside.extras-drawer [data-go='sim'], aside.extras-drawer [data-go='lists']")).length === 0);

await page.click("aside.extras-drawer [data-go='billing']");
await sleep(800);
await snap("billing");
ok("из шторки открываются тарифы", /Подписка|тариф/i.test(await page.textContent(".screen")));
ok("шторка при этом закрылась", (await page.$("aside.extras-drawer")) === null);
await page.click(".bar [data-go='settings'], .bar .icon-btn");
await sleep(500);

// 4. Иконки верхней панели открывают свои экраны.
await page.click("[aria-label='Общий список']");
await sleep(700);
await snap("lists");
ok("иконка открывает общий список", /Общий список|список/i.test(await page.textContent(".screen")));

await page.click("[aria-label='Тренажёр разговоров']");
await sleep(900);
await snap("sim");
ok("иконка открывает тренажёр", /тренаж|разговор/i.test(await page.textContent(".screen")));

// 5. Настройки: порядок строк и то, чего в них быть не должно.
await page.click("[aria-label='Настройки']");
await sleep(700);
// «Поддержка» стоит сразу под виджетом — до закладок, чтобы за ответом не листать весь экран.
const rowNames = await page.$$eval(".screen .scroll .setting .name", els => els.map(e => e.textContent.trim()));
ok("«Поддержка» — первая строка настроек", rowNames[0] === "Поддержка", JSON.stringify(rowNames.slice(0, 3)));
ok("подписка в настройках не дублирует шторку", !rowNames.includes("Подписка"), JSON.stringify(rowNames));
ok("строки «Выйти» больше нет", !rowNames.includes("Выйти"), JSON.stringify(rowNames));
ok("удаление аккаунта осталось", Boolean(await page.$("#wipe-account")));

const kitRow = await page.$("[data-shelf-row='templates']");
ok("в настройках есть строка «Наборы»", Boolean(kitRow));
if (kitRow) {
  await kitRow.scrollIntoViewIfNeeded();
  await snap("settings-shelves");
  const rowText = await kitRow.textContent();
  ok("строка объясняет, что внутри", /дети|питомцы|счётчик/i.test(rowText), rowText.replace(/\s+/g, " "));
  ok("у строки есть выключатель", Boolean(await kitRow.$("[data-shelf-vis='templates']")));

  await page.click("[data-shelf-vis='templates']");
  await sleep(700);
  await page.click("[aria-label='Настройки']");
  await sleep(300);
  await page.click(".bar [data-go='shelves'], .bar .icon-btn");
  await sleep(600);
  const afterOff = await tabs();
  ok("выключенная закладка пропадает из ряда", !afterOff.includes("Наборы"), JSON.stringify(afterOff));

  await page.click("[aria-label='Настройки']");
  await sleep(600);
  await page.click("[data-shelf-vis='templates']");
  await sleep(700);
  await page.click(".bar [data-go='shelves'], .bar .icon-btn");
  await sleep(600);
  const afterOn = await tabs();
  ok("включённая закладка возвращается", afterOn.includes("Наборы"), JSON.stringify(afterOn));
  await snap("tabs-back");
}

// 6. Добавление из набора кладёт записи на обычные полки.
await page.click(".tabs .tab:has-text('Наборы')");
await sleep(500);
await page.click("[data-template]");
await sleep(400);
await page.click("#template-apply");
await sleep(1200);
await snap("after-apply");
const shelfAfter = await tabs();
ok("после добавления возвращает на «Сегодня»", Boolean(await page.$(".tabs .tab.on:has-text('Сегодня')")), JSON.stringify(shelfAfter));

ok("в консоли нет ошибок", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\nСнимки: ${OUT}`);
console.log(problems.length ? `\nПроблем: ${problems.length}` : "\nВсё прошло");
process.exit(problems.length ? 1 : 0);
