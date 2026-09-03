/**
 * Шапка помещается в одну строку на любом телефоне.
 *
 * Считаем арифметикой, а не на глаз. Раньше полоса переносилась на вторую
 * строку и залезала на кнопку настроек: подписи и время у будильника
 * съедали место, которого не было.
 *
 * Числа не переписываем руками. Прошлая версия теста хранила их списком
 * констант — полосу переработали (две группы вместо одной, одна боковая
 * кнопка вместо двух, восемь значков вместо семи), а константы остались
 * от старой вёрстки. Тест проходил, но мерил не ту шапку. Теперь размеры
 * читаются из styles.css, а число значков — из списков в app.js: разойтись
 * с настоящей вёрсткой уже нельзя.
 */
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

let failed = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
}

function rule(name) {
  const at = css.indexOf(`\n${name} {`);
  if (at < 0) throw new Error(`нет правила ${name}`);
  return css.slice(at, css.indexOf("}", at));
}

/** Число из объявления правила: px(".shelf-pill", "width") → 28. */
function px(name, prop) {
  const m = rule(name).match(new RegExp(`${prop}:[^;]*?(\\d+)px`));
  if (!m) throw new Error(`нет ${prop} в ${name}`);
  return Number(m[1]);
}

/** Боковой отступ из сокращённой записи padding: верх право низ. */
function padX(name) {
  const raw = rule(name).match(/padding:\s*([^;]+)/);
  if (!raw) throw new Error(`нет padding в ${name}`);
  // calc(...) схлопываем в один токен: внутри него свои px, и они не наши.
  // Скобки считаем на уровень вглубь — там сидит var(--safe-top).
  const parts = raw[1].replace(/calc\((?:[^()]|\([^()]*\))*\)/g, "calc").trim().split(/\s+/);
  const side = parts.length >= 2 ? parts[1] : parts[0];
  const m = side.match(/(\d+)px/);
  if (!m) throw new Error(`боковой padding в ${name} не в px: ${side}`);
  return Number(m[1]);
}

function shelfCount(name) {
  const at = app.indexOf(`const ${name} = [`);
  if (at < 0) throw new Error(`нет списка ${name}`);
  return [...app.slice(at, app.indexOf("];", at)).matchAll(/\{\s*id:\s*"/g)].length;
}

// Размеры берём из styles.css, количество значков — из app.js.
const PILL = px(".shelf-pill", "width");
const RING = px(".icon-btn.chrome-ring", "width");
const CHROME_PAD = padX(".top-chrome");            // боковой отступ шапки
const CHROME_GAP = px(".top-chrome", "gap");
const FREE_GAP = px(".shelf-strip--free", "gap");
const FREE_MARGIN = px(".shelf-strip--free", "margin-left");
const PRO_GAP = 0;                                  // .shelf-strip: gap: 0

const PRO_N = shelfCount("PRO_STRIP_SHELVES");
const FREE_N = shelfCount("FREE_STRIP_SHELVES");

const CASES = [
  { name: "узкий телефон", width: 320 },   // старые и компактные модели
  { name: "обычный узкий", width: 360 },
  { name: "обычный", width: 393 },
  { name: "крупный", width: 430 },
];

// Шапка — три элемента в ряд: полоса платных полок, полоса бесплатных,
// кнопка настроек. Бесплатная полоса и кнопка не сжимаются (flex: 0 0 auto
// и flex-shrink: 0), место остаётся платной полосе.
function proNeeds() {
  return PILL * PRO_N + PRO_GAP * (PRO_N - 1);
}

function freeNeeds() {
  return PILL * FREE_N + FREE_GAP * (FREE_N - 1) + FREE_MARGIN;
}

function proRoom(screenWidth) {
  return screenWidth - CHROME_PAD * 2 - CHROME_GAP * 2 - RING - freeNeeds();
}

console.log("Шапка помещается в одну строку\n");
console.log(`  полоса: ${PRO_N} платных + ${FREE_N} бесплатных значков по ${PILL}px\n`);

const needs = proNeeds();

for (const c of CASES) {
  const room = proRoom(c.width);
  check(`${c.name} (${c.width})`, needs <= room,
    `нужно ${needs}, есть ${room} — не хватает ${needs - room}`);
}

console.log();

// Запас на ещё одну платную полку: если добавят, тест упадёт заранее,
// а не на телефоне пользователя. На 320 запаса уже нет — там сойдётся
// впритык, поэтому порог держим по 360, а остаток на 320 просто печатаем.
const withOneMore = PILL * (PRO_N + 1) + PRO_GAP * PRO_N;
console.log(`  запас на 320: ${proRoom(320) - needs}px, на седьмую полку не хватит ${withOneMore - proRoom(320)}px\n`);
check("ещё одна платная полка влезет на 360",
  withOneMore <= proRoom(360),
  `нужно ${withOneMore}, есть ${proRoom(360)} — при добавлении полки уменьшите .shelf-pill`);

// Крайние элементы держат размер: иначе полоса налезет на настройки.
check("кнопка настроек не сжимается",
  rule(".icon-btn.chrome-ring").includes("flex-shrink: 0"),
  "полоса выдавит кнопку настроек за край");
check("бесплатная полоса не сжимается",
  rule(".shelf-strip--free").includes("flex: 0 0 auto"),
  "будильник и ДР ужмутся и значки станут овалами");
check("платная полоса отдаёт место, а не забирает",
  rule(".shelf-strip--pro").includes("flex: 1 1 0")
    && rule(".shelf-strip--pro").includes("min-width: 0"),
  "полоса вытолкнет соседей за край экрана");

console.log(failed ? `\nПровалено: ${failed}` : "\nШапка помещается везде");
process.exit(failed ? 1 : 0);
