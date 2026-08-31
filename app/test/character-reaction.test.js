/**
 * Персонаж: лица и символы через reaction.js + face-data.js.
 * Главная проверка — тяжёлая тема: только calm + hands.
 */
import { readFileSync } from "node:fs";
import { isHeavy } from "../public/voice.js";
import { reactionFor, guard } from "../public/reaction.js";
import { FACES, SYMBOLS, PLACEMENT } from "../public/face-data.js";

let failed = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
}

function resolveLikeApp(event, sourceText, shelf = "") {
  const heavy = isHeavy(sourceText || "");
  const map = {
    waiting: "thinking",
    ask: "unheard",
    saved: "saved",
    timed: "reminded",
    celebrate: "goodday",
    birthday: "birthday",
    heavy: "heavy",
  };
  const reactionEvent = heavy ? "saved" : (map[event] || "saved");
  return guard(reactionFor({
    event: reactionEvent,
    shelf,
    heavy,
    hour: new Date().getHours(),
  }), heavy);
}

console.log("Реакции персонажа\n");

check("face-data и reaction подключены",
  Object.keys(FACES).length >= 80 && Object.keys(SYMBOLS).length >= 20,
  "файлы не скопированы в public/");

const pohorony = "завтра похороны бабушки в 11";
check("похороны — isHeavy",
  isHeavy(pohorony),
  "isHeavy не срабатывает на тестовой фразе");

const heavyR = resolveLikeApp("timed", pohorony, "meetings");
check("похороны + полка встреч → calm",
  heavyR.face.startsWith("calm-"),
  `лицо ${heavyR.face}, нужно calm-*`);
check("похороны → hands, не meeting",
  heavyR.symbol === "hands",
  `символ ${heavyR.symbol}, нужны hands`);
check("нет улыбки на тяжёлой теме",
  !heavyR.face.startsWith("happy-") && !heavyR.face.startsWith("laugh-"),
  `лицо ${heavyR.face}`);

const bread = resolveLikeApp("saved", "купить хлеб", "buy");
check("хлеб → тележка",
  bread.symbol === "cart" && bread.face.startsWith("saved-"),
  `${bread.face} + ${bread.symbol}`);

const meeting = resolveLikeApp("timed", "встреча завтра в 10", "meetings");
check("встреча → часы на лице reminded",
  meeting.face.startsWith("reminded-") && meeting.symbol === "meeting",
  `${meeting.face} + ${meeting.symbol}`);

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
check("app.js вызывает guard(reactionFor",
  app.includes("guard(reactionFor") && app.includes("showPoints") && app.includes("playCenterFinale"),
  "слой реакции не подключён к облаку");
check("полка-widget передаёт reply.items в reactionForCapture",
  app.includes("replyFromSpeechDone") && app.includes("reply?.items?.[0]?.shelf"),
  "broadcast без items/shelf — всегда saved");
check("playCenterFinale только для in-app voice с текстом, не widget",
  /else if \(source === "voice" && trimmed && opts\.voiceHeard !== false\)/.test(app)
    && !/source === "voice" \|\| source === "widget"/.test(app)
    && !app.includes('playCenterFinale("ask"'),
  "виджет/пустой текст не должны показывать лицо после capture");
check("PLACEMENT используется для символа",
  app.includes("PLACEMENT[reaction.face]"),
  "символ садится на глаза без PLACEMENT");

check("cloud.js покрывает символ, не только лицо",
  readFileSync(new URL("../public/cloud.js", import.meta.url), "utf8").includes("targetPoint")
    && readFileSync(new URL("../public/cloud.js", import.meta.url), "utf8").includes("ensureParticles"),
  "частицы должны доходить до точек символа");

console.log(failed ? `\nПровалено: ${failed}` : "\nРеакции персонажа в порядке");
process.exit(failed ? 1 : 0);
