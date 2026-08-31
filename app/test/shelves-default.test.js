/**
 * Полки по умолчанию для новых аккаунтов (раздел 4).
 */
import { defaultSettings } from "../lib/store.js";
import { BUILTIN_SHELF_IDS } from "../lib/parse.js";

let failed = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

console.log("Полки по умолчанию\n");

const settings = defaultSettings("Europe/Moscow");
const hidden = new Set(settings.hiddenShelves || []);
const visible = BUILTIN_SHELF_IDS.filter(id => id !== "today" && id !== "chat" && id !== "templates" && !hidden.has(id));

// Скрыты платные полки. Будильники и дни рождения бесплатные и видны сразу:
// будильник — базовая функция, без неё человек не проверит главное.
check("скрыты платные полки", ["care", "sport", "health", "bills", "meters"].every(id => hidden.has(id)));
check("будильники и ДР не скрыты", !hidden.has("alarms") && !hidden.has("bday"));
check("видно 6 полок + «Сегодня»", visible.length === 6, JSON.stringify(visible));
check("видимые: дела, встречи, покупки, заметки, будильники", [
  "tasks", "meetings", "buy", "notes", "alarms",
].every(id => visible.includes(id)));
check("виджет без косметики", !settings.widgetConfig.tabs.includes("care"),
  JSON.stringify(settings.widgetConfig));

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки shelves-default прошли");
