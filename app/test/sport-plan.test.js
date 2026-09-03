/**
 * План тренировок и экран спорта.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  normalizeSportPlan,
  normalizeSportNotify,
  seedSportPlan,
  sportDayHasWorkout,
  sportExerciseMeta,
  sportVisibleWeekdays,
  SPORT_DAY_LABELS,
  SPORT_MUSCLE_GROUPS,
  defaultSportNotify,
} from "../public/sport-plan.js";
import { SPORT_MUSCLE_ICONS } from "../public/sport-icons.js";

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

console.log("Sport plan\n");

const plan = seedSportPlan();
check("seed: понедельник с упражнениями", sportDayHasWorkout(plan.days[1]));
check("seed: воскресенье отдых", plan.days[0].restDay === true);

const norm = normalizeSportPlan({ days: { 1: { title: "Push", exercises: [{ name: "Жим", sets: 4, reps: "8" }] } } });
check("normalize: упражнение сохраняется", norm.days[1].exercises[0].name === "Жим");

const notify = normalizeSportNotify([{ enabled: true, hour: 18, minute: 30 }]);
check("normalize notify", notify[0].hour === 18 && notify[0].minute === 30);

check("meta упражнения", sportExerciseMeta({ sets: 3, reps: "10", weight: "50 кг", rest: "90 сек" }).includes("3×10"));

check("renderSportShelf", /function renderSportShelf/.test(appJs));
check("renderSportDay", /function renderSportDay/.test(appJs));
check("sport notify modal", /sport-notify-open/.test(appJs) && /sport-notify-row/.test(appJs));

const sportNotifyRowFn = appJs.match(/function sportNotifyRow\([\s\S]*?\n\}/)?.[0] || "";
const togglesInRowFn = (sportNotifyRowFn.match(/data-sport-notify-toggle/g) || []).length;
check("sport notify one toggle per row fn", togglesInRowFn === 1);
check("sport notify no nested toggle button", !/<button[^>]*sport-notify-toggle/.test(sportNotifyRowFn));

const sportNotifyModalFn = appJs.match(/function sportNotifyModal\([\s\S]*?\n\}/)?.[0] || "";
const weekdayRows = (sportNotifyModalFn.match(/sportNotifyRow\(/g) || []).length;
check("sport notify seven weekday rows", weekdayRows === 1 && /SPORT_WEEK_ORDER\.map\(d => sportNotifyRow/.test(sportNotifyModalFn));

const OVERLAY_PAD = 16 * 2;
const MODAL_PAD = 16 * 2;
const ROW_PAD = 10 * 2;
const COL_GAP = 8 * 2;
const TOGGLE_W = 44;
const TIME_W = 52;
const MODAL_W = 360 - OVERLAY_PAD - MODAL_PAD;
const DAY_BUDGET = MODAL_W - ROW_PAD - COL_GAP - TOGGLE_W - TIME_W;
const longestDay = SPORT_DAY_LABELS.reduce((a, b) => (a.length > b.length ? a : b), "");
const dayPxEst = longestDay.length * 7.5;
check(
  `sport notify row fits ${MODAL_W}px modal (360 phone)`,
  dayPxEst <= DAY_BUDGET,
  `«${longestDay}» ~${Math.round(dayPxEst)}px, бюджет ${DAY_BUDGET}px`,
);
check("sport day no rest label", !/День отдыха/.test(appJs) && !/sport-rest-row/.test(appJs));
check("sport day add on sportDay screen", /state\.screen === "sportDay"[\s\S]{0,200}sportExerciseDraft/.test(appJs));
check("no mic on manual shelves", /NO_MIC_SHELF_IDS/.test(appJs) && /"sport"/.test(appJs));
check("sport plan section title", /План тренировок/.test(appJs) && /sport-section-head/.test(appJs));
check("sport day card header above card", /sport-day-head/.test(appJs) && /sport-day-block/.test(appJs) && !/sport-day-card-head/.test(appJs));
check("sport shelf filtered by notify", /sportVisibleWeekdays/.test(appJs));
check("sport muscle picker modal", /sport-muscle-pick-row/.test(appJs) && /sport-ex-muscle-open/.test(appJs));
check("sport muscle chips", /sport-muscle-chip/.test(appJs));
check("sport muscle groups expanded", SPORT_MUSCLE_GROUPS.length >= 20);
check("sport muscle icons for all groups", SPORT_MUSCLE_GROUPS.every(g => SPORT_MUSCLE_ICONS[g]));
check("sport visible weekdays helper", sportVisibleWeekdays(defaultSportNotify()).length === 5);
check("sport notify sync plan", /sportPlanSyncedWithNotify/.test(appJs));
check("sport plan import", /from "\/sport-plan\.js"/.test(appJs));
check("old sport list removed from daily", /if \(state\.shelf === "sport"\) return renderSportShelf/.test(appJs));
check("bday empty placeholder", /placeholder=""/.test(appJs) && !/isBday \? "Иван Петров"/.test(appJs));

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки sport-plan прошли");
