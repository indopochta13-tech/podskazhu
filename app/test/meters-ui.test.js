/**
 * Счётчики: навигация назад, окно уведомлений, кнопка «показания внесены», поля «с/по».
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(APP_DIR, "public/app.js"), "utf8");

let failed = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

console.log("Meters UI\n");

check("back to meters shelf", /back: isMeter \? "daily" : "shelves", backShelf: isMeter \? "meters"/.test(appJs));
check("meterReadingsPending", /function meterReadingsPending/.test(appJs));
check("markMeterReadingsDone", /function markMeterReadingsDone/.test(appJs));
check("shelf meters-done button", /data-meters-done/.test(appJs) && /meterReadingsPending\(item\)/.test(appJs));
check("when label без «сделать»", !/Когда сделать/.test(appJs));
check("meter-from picker", /data-pick="meter-from"/.test(appJs) && /meter-from/.test(appJs));
check("meter-to picker", /data-pick="meter-to"/.test(appJs) && /meter-to/.test(appJs));
check("bday: empty placeholder", /isBday \? "Именинник" : "Название"/.test(appJs) && !/isBday \? "Иван Петров"/.test(appJs));
check("bday: no participant field", !/\(isBday \|\| show\?\.who\)/.test(appJs));
check("bday: who cleared on save", /item\.type === "bday" \? "" : \(whoEl/.test(appJs));

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки meters-ui прошли");
