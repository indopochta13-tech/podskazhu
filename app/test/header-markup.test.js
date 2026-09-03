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
  app.includes('class="shelf-strip shelf-strip--pro"')
    && app.includes('class="shelf-strip shelf-strip--free"'),
  "разметка полосы не переписана — вероятно, патч не накатан");

check("в кнопке полки только значок",
  !app.includes("shelf-pill-cap"),
  "осталась обёртка подписи — полоса будет шире и перенесётся");

check("замок PRO внутри обёртки значка",
  app.includes('class="shelf-pill-ico"') && app.includes('class="shelf-pill-lock"'),
  "замок не привязан к углу значка — обрежется overflow полосы");

check("подписей и времени в полосе нет",
  !app.includes("shelfStripCaption"),
  "функция подписи ещё вызывается — время вернётся в полосу");

check("у будильника с активными будильниками свой значок",
  app.includes("hasActiveAlarms()") && app.includes('"alarmsOn"') && icons.includes("alarmsOn:"),
  "звонящий колокольчик не подключён");

check("календарь не подсвечивает полку в полосе",
  app.includes("function stripShelfActive(shelf)")
    && app.includes('return state.screen === "daily" && state.shelf === shelf.id'),
  "на календаре остаётся подсветка полки");

check("облако на FAB монтируется после каждой полки",
  app.includes("mountShelfMicFab") && app.includes("requestAnimationFrame(mountFabSoul)"),
  "после смены полки облако на микрофоне не пересоздаётся");

// ── Полки и значки: соответствие один к одному ────────────────────────
//
// Полосу переработали: слева платные полки, справа бесплатные. Легко
// разъехаться — добавили полку в один список и забыли значок, или оставили
// значок от полки, которую убрали. Читаем оба списка прямо из кода.

function shelfList(name) {
  const at = app.indexOf(`const ${name} = [`);
  if (at < 0) return [];
  const body = app.slice(at, app.indexOf("];", at));
  return [...body.matchAll(/\{\s*id:\s*"([a-z]+)"/g)].map(m => m[1]);
}

const proStrip = shelfList("PRO_STRIP_SHELVES");
const freeStrip = shelfList("FREE_STRIP_SHELVES");
const strip = [...proStrip, ...freeStrip];
const shelfIcons = Object.fromEntries(
  [...icons.slice(icons.indexOf("export const SHELF_ICONS"))
    .slice(0, icons.slice(icons.indexOf("export const SHELF_ICONS")).indexOf("};"))
    .matchAll(/(\w+):\s*"(\w+)"/g)].map(m => [m[1], m[2]]),
);

check("оба списка полос прочитаны",
  proStrip.length > 0 && freeStrip.length > 0,
  `PRO ${proStrip.length}, free ${freeStrip.length} — разметка списков изменилась`);

check("полок без значка нет",
  strip.every(id => id === "shared" || Boolean(shelfIcons[id])),
  `нет значка у: ${strip.filter(id => id !== "shared" && !shelfIcons[id]).join(", ")}`);

check("значки в полосе рисуются из своего набора",
  strip.every(id => id === "shared" || icons.includes(`${shelfIcons[id]}:`)),
  "значок объявлен в SHELF_ICONS, но самого рисунка в наборе нет");

check("каждый значок открывает свою полку",
  app.includes('data-strip-shelf="${shelf.id}"')
    && app.includes("openShelfFromStrip(stripShelf.dataset.stripShelf)")
    && app.includes('return go("daily", { shelf: shelfId })'),
  "кнопка не передаёт свой id — все значки откроют одну полку");

check("общие списки уходят на свой экран, а не на полку",
  app.includes('data-strip-go="lists"') && app.includes('stripGo?.dataset.stripGo === "lists"'),
  "у общих списков нет своей полки — им нужен отдельный переход");

check("полки в полосе не повторяются",
  new Set(strip).size === strip.length,
  `дубли: ${strip.filter((id, i) => strip.indexOf(id) !== i).join(", ")}`);

// Списки платного и бесплатного должны сходиться с сервером: иначе полка
// либо под замком без причины, либо бесплатная только на вид.
const proShelves = readFileSync(new URL("../lib/pro-shelves.js", import.meta.url), "utf8");
const serverPro = [...proShelves.slice(proShelves.indexOf("PRO_SHELF_IDS"))
  .slice(0, proShelves.indexOf("]", proShelves.indexOf("PRO_SHELF_IDS")))
  .matchAll(/"([a-z]+)"/g)].map(m => m[1]);

check("платные полки полосы совпадают с серверными",
  [...proStrip].sort().join(",") === [...serverPro].sort().join(","),
  `полоса: ${proStrip.join(", ")} / сервер: ${serverPro.join(", ")}`);

check("бесплатные полки сервер платными не считает",
  freeStrip.every(id => !serverPro.includes(id)),
  `сервер закрывает: ${freeStrip.filter(id => serverPro.includes(id)).join(", ")}`);

// ── Замки ─────────────────────────────────────────────────────────────

check("замок висит только на платных полках без подписки",
  app.includes("const locked = !isPro();")
    && /PRO_STRIP_SHELVES\.map\(shelf => shelfStripPillHtml\(shelf, \{\s*locked,/.test(app)
    && /FREE_STRIP_SHELVES\.map\(shelf => shelfStripPillHtml\(shelf\)\)/.test(app),
  "замок ставится не по подписке или попал на бесплатные полки");

check("без подписки платная полка не открывается молча",
  app.includes("proShelfGated(shelfId)"),
  "полка под замком откроется как обычная");

// ── Выделение активной полки ──────────────────────────────────────────

check("активная полка помечена и для скринридера",
  app.includes('aria-current="${active ? "page" : "false"}"'),
  "выделение только цветом — на слух полку не отличить");

// ── Стили полосы ──────────────────────────────────────────────────────

const stripRule = rule(".shelf-strip");
check("полоса PRO не даёт overflow на календарь",
  !rule(".shelf-strip--pro").includes("overflow: visible")
    && rule(".shelf-strip").includes("overflow: hidden"),
  "overflow:visible на полосе PRO — замки уедут на даты");

const lockRule = rule(".shelf-pill-lock");
check("замок PRO — accent и внутри кнопки",
  lockRule.includes("color: var(--accent)")
    && css.includes(".shelf-pill-ico")
    && lockRule.includes("z-index"),
  "замок приглушён или обрезается полосой");

check("полоса не переносится",
  stripRule.includes("flex-wrap: nowrap"),
  "без nowrap значки уйдут на вторую строку");
check("полоса занимает только свободное место",
  stripRule.includes("flex: 1 1 0") && stripRule.includes("min-width: 0"),
  "с «flex: 1 1 auto» полоса выдавливает подписку и настройки за край");
check("значки выровнены по центру строки",
  stripRule.includes("align-items: center"),
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
