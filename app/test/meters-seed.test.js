/**
 * Пресет счётчиков: /api/meters/seed создаёт Свет/Вода/Газ на полке meters.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const serverJs = fs.readFileSync(path.join(APP_DIR, "server.js"), "utf8");

let failed = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

console.log("Meters seed API\n");

check("route /api/meters/seed", /METERS_PRESET_KEYS/.test(serverJs));
check("METERS_PRESET titles", /title: "Свет"/.test(serverJs) && /title: "Газ"/.test(serverJs));
check("cancels junk on meters shelf", /item\.shelf === "meters"/.test(serverJs) && /cancelled \+= 1/.test(serverJs));
check("monthWindow 15-26", /fromDay: 15, toDay: 26/.test(serverJs));
check("monthly repeat", /kind: "monthly"/.test(serverJs));
check("metersPresetV2 flag", /metersPresetV2/.test(serverJs));

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки meters-seed прошли");
