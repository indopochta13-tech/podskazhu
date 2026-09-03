/**
 * Дым по умолчанию, «ежегодно» в повторах, пресет счётчиков.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(APP_DIR, "public/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(APP_DIR, "public/index.html"), "utf8");

let failed = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

console.log("UI defaults: smoke palette, yearly repeat, meters preset\n");

check("index.html: smoke fallback", /p = "smoke"/.test(indexHtml));
check("app.js: smoke palette default", /PALETTE_IDS\.includes\(v\) \? v : "smoke"/.test(appJs));
check("REPEATS: ежегодно первым", /label: "ежегодно"/.test(appJs));
check("meters preset titles", /METERS_PRESET/.test(appJs) && /Свет/.test(appJs) && /Газ/.test(appJs));
check("perm dot hint removed", !/perm-dot-hint/.test(appJs));
check("alarm repeat carousel", /repeat-carousel/.test(appJs));
check("meters server seed", /METERS_PRESET_KEYS/.test(fs.readFileSync(path.join(APP_DIR, "server.js"), "utf8")));
check("shell 155", /SW_VERSION = 155/.test(appJs));
check("meters preset via seed", /\/meters\/seed/.test(appJs));
check("meters seed only on meters shelf", /state\.shelf !== "meters"/.test(appJs));
check("no boot meters seed", !/async function loadAppState[\s\S]*?scheduleMetersPreset/.test(appJs));
check("bday repeat hidden", /isHealth \|\| isMeter \|\| isBday \? "" :/.test(appJs));

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки ui-defaults прошли");
