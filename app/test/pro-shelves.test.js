/**
 * PRO-полки и очистка серверных образцов.
 */
import { isProShelf, ROUTINE_SOURCES, itemOnProShelf } from "../lib/pro-shelves.js";
import { stripFreeUserRoutineSeed, clearProShelfData } from "../lib/pro-cleanup.js";
import { createUser } from "../lib/store.js";
import { CARE_ROUTINE_SOURCE } from "../lib/care-routine.js";
import { loadDemoShelf } from "../public/demo-shelves.js";

let failed = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

console.log("PRO-полки и демо\n");

check("общие списки — PRO", isProShelf("shared"));
check("заметки — не PRO", !isProShelf("notes"));
check("дела — не PRO", !isProShelf("tasks"));

const sportDemo = loadDemoShelf("sport");
check("демо спорт ≥ 4", sportDemo.length >= 4, String(sportDemo.length));
check("демо спорт помечено demo", sportDemo.every(i => i.demo && String(i.id).startsWith("demo-")));

const alarmsDemo = loadDemoShelf("alarms");
check("демо будильники ≥ 5", alarmsDemo.length >= 5, String(alarmsDemo.length));

const bdayDemo = loadDemoShelf("bday");
check("демо ДР ≈ 10", bdayDemo.length >= 10, String(bdayDemo.length));

const user = createUser("Europe/Moscow");
const items = {
  a: {
    id: "i1",
    ownerId: user.id,
    type: "care",
    shelf: "care",
    source: CARE_ROUTINE_SOURCE,
    cancelled: false,
    deleted: false,
  },
  b: {
    id: "i2",
    ownerId: user.id,
    type: "task",
    shelf: "tasks",
    source: "voice",
    cancelled: false,
    deleted: false,
  },
};
const stripped = stripFreeUserRoutineSeed(user, items);
check("free: снят серверный уход", stripped === 1, String(stripped));
check("free: дела остались", !items.b.cancelled);
check("free: флаг careRoutineV2 сброшен", user.settings.careRoutineV2 === false);

user.billing = { plan: "pro", until: Date.now() + 86400000 };
items.a.cancelled = false;
const cleared = clearProShelfData(user, items);
check("pro: очистка PRO-полок", cleared >= 1, String(cleared));
check("источники рутин известны", ROUTINE_SOURCES.has(CARE_ROUTINE_SOURCE));
check("bills на PRO-полке", itemOnProShelf({ type: "bills", shelf: "bills" }));

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки pro-shelves прошли");
