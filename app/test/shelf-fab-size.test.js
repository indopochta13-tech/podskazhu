/**
 * Кнопки + и микрофон на полке — одинаковый размер, + сверху.
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

let failed = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
}

console.log("Размер FAB на полке\n");

check("--shelf-fab-size = 62px",
  /--shelf-fab-size:\s*62px/.test(css),
  "ожидали 62px для обеих кнопок");

check("#shelf-mic и #shelf-add явно 62px",
  css.includes("#shelf-mic") && css.includes("#shelf-add")
    && css.includes("max-width: var(--shelf-fab-size)"),
  "нет явных правил для обеих кнопок");

check("canvas без фиксированного width/height в разметке",
  app.includes('id="fab-soul-canvas" aria-hidden="true"></canvas>')
    && !app.includes('fab-soul-canvas" id="fab-soul-canvas" width='),
  "canvas с жёстким размером в HTML");

check("mountFabSoul берёт размер кнопки",
  app.includes("shelfMicCanvasPixels") && app.includes("getBoundingClientRect"),
  "нет синхронизации canvas с кнопкой");

check("+ выше микрофона в DOM",
  /shelfFabStack[\s\S]{0,400}id="shelf-add"[\s\S]{0,400}id="shelf-mic"/.test(app),
  "порядок кнопок в стеке");

check("нет дублирующего mic fallback на полке",
  !/shelfFabStack[\s\S]{0,500}fab-soul-fallback/.test(app),
  "fab-soul-fallback в shelfFabStack");

check("shelf-mic без белого фона",
  css.includes("background: transparent")
    && css.includes(".fab-stack #shelf-mic")
    && !css.match(/\.fab-stack[\s\S]{0,500}#shelf-mic[\s\S]{0,300}var\(--surface\)/),
  "ожидали transparent без --surface");

console.log(failed ? `\nПровалено: ${failed}` : "\nFAB на полке выровнен");
process.exit(failed ? 1 : 0);
