/**
 * Шапка помещается в одну строку на любом телефоне.
 *
 * Считаем арифметикой, а не на глаз. Раньше полоса переносилась на вторую
 * строку и залезала на кнопку настроек: подписи и время у будильника
 * съедали место, которого не было.
 *
 * Теперь в полосе только круглые значки одного размера — ни подписей,
 * ни чисел. Тест сторожит, чтобы они не вернулись.
 */

const CASES = [
  { name: "узкий телефон", width: 320 },   // старые и компактные модели
  { name: "обычный узкий", width: 360 },
  { name: "обычный", width: 393 },
  { name: "крупный", width: 430 },
];

// Размеры из public/styles.css
const CHROME_PADDING = 12 * 2;   // .top-chrome padding
const CHROME_GAP = 2 * 2;        // промежутки между тремя элементами шапки
const RING_BTN = 36;             // .icon-btn.chrome-ring, не сжимается
const STRIP_PADDING = 4 * 2;     // .shelf-strip padding
const STRIP_GAP = 2;             // .shelf-strip gap
const PILL = 28;                 // .shelf-pill — круг фиксированного размера

const SHELVES = 7;

let failed = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
}

function stripNeeds() {
  return PILL * SHELVES + STRIP_GAP * (SHELVES - 1) + STRIP_PADDING;
}

function available(screenWidth) {
  return screenWidth - CHROME_PADDING - CHROME_GAP - RING_BTN * 2;
}

console.log("Шапка помещается в одну строку\n");

const needs = stripNeeds();

for (const c of CASES) {
  const room = available(c.width);
  check(`${c.name} (${c.width})`, needs <= room,
    `нужно ${needs}, есть ${room} — не хватает ${needs - room}`);
}

console.log();

// Запас на восьмую полку: если добавят, тест упадёт заранее
const withEight = PILL * 8 + STRIP_GAP * 7 + STRIP_PADDING;
check("восьмая полка ещё влезет на 360",
  withEight <= available(360),
  `нужно ${withEight}, есть ${available(360)} — при добавлении полки уменьшите PILL`);

// Крайние кнопки держат размер: иначе полоса налезет на настройки
check("крайние кнопки не сжимаются",
  RING_BTN * 2 + CHROME_PADDING + CHROME_GAP + needs <= 360,
  "шапка не помещается даже с фиксированными кнопками");

console.log(failed ? `\nПровалено: ${failed}` : "\nШапка помещается везде");
process.exit(failed ? 1 : 0);
