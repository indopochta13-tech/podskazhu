/**
 * Щелчок барабана календаря: Web Audio, один клик на ±1 день.
 */
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/ui-sounds.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

let failed = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
}

console.log("Звук барабана календаря\n");

check("ui-sounds экспортирует playCalDrumRatchet",
  /export (async )?function playCalDrumRatchet/.test(ui),
  "нет синтезированного щелчка");

check("ui-sounds экспортирует unlockUiSounds",
  /export function unlockUiSounds/.test(ui),
  "нет разблокировки AudioContext");

check("app.js импортирует playCalDrumRatchet и unlockUiSounds",
  app.includes('from "./ui-sounds.js"') && app.includes("playCalDrumRatchet") && app.includes("unlockUiSounds"),
  "импорт не подключён");

check("звук только при шаге ±1 день",
  /step === 1 \|\| step === -1/.test(app) && app.includes("playCalDrumRatchet()"),
  "нет проверки шага дня");

check("не играет при первом монтировании",
  app.includes("calDrumSoundReady = false") && app.includes("calDrumSoundReady = true"),
  "флаг готовности не выставляется");

check("кнопка «Сегодня» подключена",
  app.includes('getElementById("cal-jump-today-b")') && app.includes("jumpCalendarToToday"),
  "прыжок на сегодня без обработчика");

check("барабан горизонтальный (scrollLeft)",
  app.includes("drum.scrollLeft") && !app.includes("drum.scrollTop"),
  "вертикальный scrollTop вместо scrollLeft");

check("CSS: горизонтальный snap",
  css.includes("scroll-snap-type: x mandatory") && css.includes(".cal-drum {"),
  "нет scroll-snap-type: x в .cal-drum");

check("формат дня: число + месяц с точкой",
  app.includes("function fmtCalDrumDay") && app.includes('MONTHS_SHORT[parts.month]}.'),
  "нет fmtCalDrumDay с точкой после месяца");

check("одна подпись на день в карусели",
  app.includes('class="cal-drum-label"') && app.includes("fmtCalDrumDay(it.parts)"),
  "подпись дня не в одном label");

check("отдельная строка месяца убрана",
  !app.includes('id="cal-drum-month"') && !app.includes("cal-drum-oval") && !app.includes("cal-drum-mon"),
  "остался отдельный месяц или овал");

check("верхний strip убран",
  !app.includes('id="cal-jump-today"') && !css.includes(".cal-jump-top"),
  "остался верхний strip");

check("CSS: нижний strip (прыжок на сегодня)",
  css.includes(".cal-jump-bottom") && css.includes("width: 34px"),
  "нет нижнего strip");

check("CSS: прямоугольное окно под «31 дек.»",
  css.includes(".cal-drum-window")
    && css.includes("min-width: 72px")
    && css.includes("8.5ch")
    && css.includes("border-radius: 10px")
    && !css.includes(".cal-drum-oval"),
  "окно не прямоугольное или не под полную подпись");

check("CSS: подпись дня в одной строке",
  css.includes(".cal-drum-label") && css.includes("white-space: nowrap"),
  "подпись не в одной строке");

check("sw кэширует ui-sounds.js",
  sw.includes("/ui-sounds.js"),
  "service worker не кэширует модуль звука");

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки пройдены");
