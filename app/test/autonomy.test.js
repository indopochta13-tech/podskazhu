/**
 * Автономность разбора: какая доля фраз не справляется без YandexGPT.
 *
 * Зачем тест: вызов модели стоит денег, добавляет до 2,8 секунды ожидания и требует сети.
 * Для навыка Алисы он вообще недопустим — Диалоги ждут ответ 3 секунды вместе с сетью.
 * Поэтому доля обращений к модели — это показатель, за которым нужно следить так же,
 * как за правильностью разбора.
 *
 * Тест падает, если доля выросла: значит правка парсера ослабила правила.
 */
import { parse } from "../lib/parse.js";
import { needsAlice } from "../lib/alice-nlu.js";

const ctx = { now: Date.UTC(2026, 7, 2, 6, 0), tz: "Europe/Moscow", settings: {} };

// Потолок. Опускайте по мере улучшения правил — но никогда не поднимайте,
// чтобы «починить» упавший тест: это возврат к платному разбору.
const MAX_PERCENT = 12;

// Фразы без слова полки: раньше все они уходили в модель.
// Правила должны узнавать глагол действия и не сомневаться.
const SHOULD_BE_AUTONOMOUS = [
  "напомни через 2 часа позвонить маме",
  "завтра вечером забрать заказ",
  "после обеда заехать в банк",
  "до обеда отправить документы",
  "поздно вечером выкинуть мусор",
  "на выходных помыть машину",
  "в конце недели забрать справку",
  "в начале месяца сдать отчет",
  "через месяц продлить страховку",
  "послезавтра забрать документы",
  "восьмого марта поздравить маму",
  "в следующем году поменять права",
];

// Приёмы и услуги: должны попадать во «встречи», а не в общую кучу.
const SHOULD_BE_MEETING = [
  "первого сентября к врачу в 9",
  "послезавтра в 8 утра поликлиника",
  "в следующую пятницу стрижка",
  "на следующей неделе сходить к стоматологу",
];

// Проверка, что новый словарь не перетянул чужие полки на себя.
const SHOULD_KEEP_SHELF = [
  ["заехать в магазин за молоком", "buy"],
  ["оплатить квартиру до 10 числа", "bills"],
  ["выпить таблетки в 9 утра", "health"],
  ["записать в заметки позвонить маме", "note"],
  ["поставь будильник на 7", "alarm"],
  ["созвон с клиентом в 15", "meeting"],
];

let failed = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label} → ${detail}`);
  }
}

console.log("Автономность разбора речи\n");

for (const text of SHOULD_BE_AUTONOMOUS) {
  const result = parse(text, ctx);
  const draft = result.drafts?.[0];
  check(`без модели: «${text}»`, draft && !needsAlice(result),
    `тип ${draft?.type}, оценка ${draft?.kindScore}`);
}

console.log();
for (const text of SHOULD_BE_MEETING) {
  const draft = parse(text, ctx).drafts?.[0];
  check(`встреча: «${text}»`, draft?.type === "meeting", `получилось ${draft?.type}`);
}

console.log();
for (const [text, expected] of SHOULD_KEEP_SHELF) {
  const draft = parse(text, ctx).drafts?.[0];
  check(`полка не уехала: «${text}» → ${expected}`, draft?.type === expected,
    `получилось ${draft?.type}`);
}

// Доля по всему корпусу из parse.test.js: считаем по тем же фразам, что и основной тест.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = readFileSync(path.join(here, "parse.test.js"), "utf8");
const texts = [...corpus.matchAll(/text:\s*"((?:[^"\\]|\\.)*)"/g)]
  .map(m => m[1].replace(/\\"/g, '"'));

let creates = 0;
let calls = 0;
for (const text of texts) {
  let result;
  try {
    result = parse(text, ctx);
  } catch {
    continue;
  }
  if (result.intent !== "create") continue;
  creates += 1;
  if (needsAlice(result)) calls += 1;
}

const percent = Math.round((calls / creates) * 100);
console.log(`\nКорпус: ${creates} фраз, обращений к модели ${calls} (${percent}%)`);
check(`доля обращений не выше ${MAX_PERCENT}%`, percent <= MAX_PERCENT, `${percent}%`);

console.log(failed ? `\nПровалено: ${failed}` : "\nВсе проверки автономности прошли");
process.exit(failed ? 1 : 0);
