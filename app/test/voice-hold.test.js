/**
 * Удержание микрофона: не обрывается от pointerleave, идёт через облако.
 */
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

let failed = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
}

console.log("Удержание микрофона\n");

// Проверяем именно микрофон: pointerleave на других кнопках (например, долгое
// нажатие на вкладку общего списка) удержание записи не трогает.
const micHold = app.slice(app.indexOf("dataset.holdBound"), app.indexOf("dataset.holdBound") + 3000);
check("shelf-mic не отменяет запись по pointerleave",
  app.indexOf("dataset.holdBound") >= 0 && !micHold.includes('addEventListener("pointerleave"'),
  "pointerleave на кнопке микрофона обрывает удержание");

check("чат-mic на схеме удержания, полка — click",
  app.includes('#shelf-mic, #chat-mic') && app.includes("dataset.holdBound")
    && app.includes("onShelfMicTap") && app.includes("onChatMicPointerDown"),
  "разные обработчики — полка tap, чат hold");

check("полка — один тап, Google без облака до результата",
  app.includes("function startShelfVoiceWithCloud")
    && (app.includes("startWidgetStyleRecord") || app.includes("startRecord"))
    && /if \(shelf\)[\s\S]{0,200}addEventListener\("click", onShelfMicTap\)/.test(app)
    && !/function startShelfVoiceWithCloud[\s\S]{0,2500}mountChatVoiceOverlay/.test(app),
  "shelf-mic: WidgetRecordActivity, облако не до Google");

check("shelf-widget — broadcast, без resume-cancel",
  app.includes('chatVoiceMode = "shelf-widget"')
    && /function startShelfVoiceWithCloud[\s\S]{0,3500}onSpeechDone/.test(app)
    && !/function startShelfVoiceWithCloud[\s\S]{0,3500}shelfVisHandler/.test(app)
    && app.includes("SHELF_GOOGLE_MAX_MS = 60000")
    && app.includes("captureFinaleBusy"),
  "broadcast + защита finale от softRender");

check("лицо только после успешного capture с текстом",
  app.includes("playCenterFinale") && app.includes("capture-confirm")
    && app.includes('source === "voice" && trimmed')
    && !app.includes('playCenterFinale("ask"'),
  "playCenterFinale не на пустой текст");

console.log(failed ? `\nПровалено: ${failed}` : "\nУдержание настроено");
process.exit(failed ? 1 : 0);
