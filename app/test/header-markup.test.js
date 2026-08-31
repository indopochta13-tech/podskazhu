/**
 * Проверка вёрстки шапки по коду, а не по арифметике.
 *
 * Прошлый тест считал размеры и проходил даже тогда, когда сами правки
 * в файл не попали. Этот читает разметку и стили и сверяет то, что там
 * написано — так видно, применены изменения или нет.
 *
 * Запускать перед каждой сборкой: он ловит случай «патч не накатили,
 * а APK уже собрали».
 */
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const icons = readFileSync(new URL("../public/icons.js", import.meta.url), "utf8");

let failed = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
}

function rule(name) {
  const at = css.indexOf(`\n${name} {`);
  if (at < 0) return "";
  return css.slice(at, css.indexOf("}", at));
}

console.log("Вёрстка шапки соответствует задуманному\n");

// ── Разметка ──────────────────────────────────────────────────────────

check("полоса рисуется как nav без обёрток",
  /return `<nav class="shelf-strip"/.test(app),
  "разметка полосы не переписана — вероятно, патч не накатан");

check("в кнопке полки только значок",
  !app.includes("shelf-pill-cap") && !app.includes("shelf-pill-ico"),
  "остались обёртки подписи или значка: полоса будет шире и перенесётся");

check("подписей и времени в полосе нет",
  !app.includes("shelfStripCaption"),
  "функция подписи ещё вызывается — время вернётся в полосу");

check("у будильника с активными будильниками свой значок",
  app.includes("hasActiveAlarms()") && app.includes('"alarmsOn"') && icons.includes("alarmsOn:"),
  "звонящий колокольчик не подключён");

check("календарь не подсвечивает полку в полосе",
  /activeShelf = state\.screen === "daily" \? state\.shelf : ""/.test(app),
  "на календаре остаётся подсветка полки");

check("облако на FAB монтируется после каждой полки",
  app.includes("mountShelfMicFab") && app.includes("requestAnimationFrame(mountFabSoul)"),
  "после смены полки облако на микрофоне не пересоздаётся");

// ── Стили полосы ──────────────────────────────────────────────────────

const strip = rule(".shelf-strip");
check("полоса не переносится",
  strip.includes("flex-wrap: nowrap"),
  "без nowrap значки уйдут на вторую строку");
check("полоса занимает только свободное место",
  strip.includes("flex: 1 1 0") && strip.includes("min-width: 0"),
  "с «flex: 1 1 auto» полоса выдавливает подписку и настройки за край");
check("значки выровнены по центру строки",
  strip.includes("align-items: center"),
  "без этого полоса поедет вверх относительно боковых кнопок");

const pill = rule(".shelf-pill");
check("кнопка полки — круг фиксированного размера",
  /width: \d+px/.test(pill) && /height: \d+px/.test(pill) && pill.includes("border-radius: 50%"),
  "овал вместо круга: размер задаётся содержимым");
check("кнопка полки не растягивается",
  pill.includes("flex: 0 0") && pill.includes("max-height"),
  "кнопка будет тянуться и станет овальной");
check("WebView не раздувает кнопку",
  pill.includes("aspect-ratio") && pill.includes("max-width"),
  "Android WebView min-height превращает круг в вертикальный овал");
check("пустая и открытая полка одного размера",
  !/\.shelf-pill\.empty\s*\{[^}]*(padding|height|width)/.test(css.replace(/\s+/g, " "))
    || (css.includes(".shelf-pill.empty") && rule(".shelf-pill.empty").includes("opacity")),
  "пустая полка меняет размер и прыгает по строке");

check("открытая полка — темнее значок, без кольца",
  css.includes(".shelf-pill.on svg")
    && !/\.shelf-pill\.on\s*\{[^}]*border-color:\s*var/.test(css)
    && !/\.shelf-pill\.on\s*\{[^}]*background:\s*var\(--accent\)/.test(css),
  "выделение — кольцо или заливка вместо темного значка");

check("неактивные полки одинаково приглушены",
  rule(".shelf-pill").includes("opacity: .5")
    && !/\.shelf-pill\.empty\s*\{[^}]*opacity:\s*[^.;]+/.test(css.replace(/\s+/g, " ")),
  "пустые и заполненные полки выглядят по-разному без .on");

check("заполненная полка без .on не подсвечивается",
  rule(".shelf-pill").includes("background: transparent")
    && !/\.shelf-pill\s*\{[^}]*background:\s*var\(--accent-soft\)/.test(css),
  "полки с записями выглядят выбранными без .on");

check(".on только при явном выборе полки, не из-за filled",
  /if \(active\) cls\.push\("on"\)/.test(app)
    && !/if \(filled\) cls\.push\("on"\)/.test(app)
    && !/hasItems.*\.on|\.on.*hasItems|hasActiveAlarms.*\.on|\.on.*hasActiveAlarms/.test(app),
  "наличие записей или активных будильников не должно давать .on");

check("кнопка полки без нативного оформления WebView",
  rule(".shelf-pill").includes("appearance: none"),
  "Android WebView раздувает кнопку в овал");

// ── Залипание выделения ───────────────────────────────────────────────

check("отклик только на нажатие, не на фокус",
  css.includes(".shelf-pill:active") && !/\.shelf-pill:focus\s*\{[^}]*background/.test(css),
  "подсветка залипнет после касания");
check("обводка только для клавиатуры",
  css.includes(".shelf-pill:focus-visible"),
  "нет доступной обводки при управлении с клавиатуры");

// ── Шапка целиком ─────────────────────────────────────────────────────

const chrome = rule(".top-chrome");
check("шапка не переносится",
  chrome.includes("flex-wrap: nowrap"),
  "элементы шапки уйдут на вторую строку");
check("шапка ничего не обрезает",
  !chrome.includes("overflow: hidden"),
  "overflow: hidden срезал боковые кнопки, когда полоса претендовала на всю ширину");

const ring = rule(".icon-btn.chrome-ring");
check("боковые кнопки не сжимаются",
  ring.includes("flex-shrink: 0"),
  "полоса налезет на подписку и настройки");

// ── Экран не двигается ────────────────────────────────────────────────

check("страница не тянется вбок",
  css.includes("overflow-x: hidden") && css.includes("overscroll-behavior: none"),
  "экран можно утащить пальцем");

// ── Кнопка записи ─────────────────────────────────────────────────────

check("удержание записывает голосом",
  app.includes('startChatVoice({ mode: "hold" })'),
  "удержание не запускает запись");
check("системного окна ввода нет",
  !app.includes("window.prompt"),
  "при удержании откроется окно «Что записать?»");
check("удержание идёт через своё облако",
  app.includes('mode !== "hold" && typeof NATIVE'),
  "на Android откроется диалог Google вместо облака");

// ── Целостность CSS ───────────────────────────────────────────────────
//
// Обрывок комментария посреди правила заставляет браузер отбросить весь блок
// до закрывающей скобки. Файл при этом выглядит нормально, все нужные строки
// на месте — а половина стилей молча не работает. Так мы потеряли вечер.

const cssLines = css.split("\n");
let inComment = false;
const orphans = [];
for (let i = 0; i < cssLines.length; i += 1) {
  const line = cssLines[i];
  let j = 0;
  while (j < line.length) {
    if (!inComment && line.slice(j, j + 2) === "/*") { inComment = true; j += 2; continue; }
    if (inComment && line.slice(j, j + 2) === "*/") { inComment = false; j += 2; continue; }
    j += 1;
  }
  // Обрывок — это «*/» вне комментария, до которого не было открывающей «/*»
  // с начала файла. Проверять две строки назад мало: несколько многострочных
  // комментариев подряд давали ложные срабатывания.
  if (!inComment && line.trimEnd().endsWith("*/") && !line.includes("/*")) {
    const before = cssLines.slice(0, i).join("\n");
    const opens = (before.match(/\/\*/g) || []).length;
    const closes = (before.match(/\*\//g) || []).length;
    if (opens <= closes) orphans.push(i + 1);
  }
}

check("в стилях нет обрывков комментариев",
  orphans.length === 0,
  `строки ${orphans.join(", ")} — браузер отбросит правило целиком`);

check("комментарии закрыты",
  !inComment,
  "остался незакрытый комментарий — всё после него не применится");

console.log(failed ? `\nПровалено: ${failed}` : "\nВёрстка соответствует");
process.exit(failed ? 1 : 0);
