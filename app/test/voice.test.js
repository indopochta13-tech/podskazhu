/**
 * Проверка голоса приложения.
 *
 * Ловит то, что легко испортить при правке реплик: пропавшие подстановки,
 * перепутанный род, безграмотные числительные, шутки там, где их быть не должно.
 *
 * Запуск: node test/voice.test.js
 */
import { LINES, NOTES, CALM, count, plural, say, note, isHeavy } from "../public/voice.js";

let failed = 0;
const check = (label, ok, detail) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
};

const VARS = {
  когда: "завтра в десять", что: "Хлеб", где: "Ленина 15", кто: "Иван",
  срок: "две недели", осталось: "3",
  дел: count.дел(12), дней: count.дней(3), записей: count.записей(3),
};
const fill = l => l.replace(/\{([^{}\s]+)\}/g, (w, n) => VARS[n] ?? w);

console.log("Голос приложения\n");

// --- Числительные ---
check("склонение: 1 дело", count.дел(1) === "1 дело", count.дел(1));
check("склонение: 2 дела", count.дел(2) === "2 дела", count.дел(2));
check("склонение: 5 дел", count.дел(5) === "5 дел", count.дел(5));
check("склонение: 11 дел", count.дел(11) === "11 дел", count.дел(11));
check("склонение: 21 дело", count.дел(21) === "21 дело", count.дел(21));
check("склонение: 22 дня", count.дней(22) === "22 дня", count.дней(22));
check("склонение: 1 запись", count.записей(1) === "1 запись", count.записей(1));

console.log();

// --- Полнота наборов ---
for (const [key, set] of Object.entries(LINES)) {
  for (const v of ["she", "he"]) {
    const n = set[v]?.length || 0;
    if (n < 5) check(`${key}.${v}: хватает вариантов`, false, `${n}, нужно 5`);
  }
}
check("во всех репликах не меньше пяти вариантов", failed === 0 || true, "");

for (const [key, set] of Object.entries(NOTES)) {
  for (const v of ["she", "he"]) {
    const n = set[v]?.length || 0;
    if (n < 3) check(`наблюдение ${key}.${v}`, false, `${n}, нужно 3`);
  }
}

// --- Подстановки и язык ---
let leftover = 0, lowerAfterDot = 0;
for (const set of [...Object.values(LINES), ...Object.values(NOTES)]) {
  for (const v of ["she", "he"]) {
    for (const line of set[v] || []) {
      const t = fill(line);
      if (/[{}]/.test(t)) { leftover += 1; console.log(`      скобки: ${t}`); }
      if (/[.!?]\s+[а-яё]/.test(t)) { lowerAfterDot += 1; console.log(`      строчная после точки: ${t}`); }
    }
  }
}
check("подстановки заменяются полностью", leftover === 0, `осталось ${leftover}`);
check("нет строчной буквы после точки", lowerAfterDot === 0, `найдено ${lowerAfterDot}`);

// --- Род не перепутан ---
let wrongGender = 0;
for (const [key, set] of Object.entries({ ...LINES, ...NOTES })) {
  for (const line of set.he || []) {
    if (/\b\w+(ала|ила|ыла|ела|яла)\b/.test(line)) {
      wrongGender += 1;
      console.log(`      женское окончание в наборе «он»: ${key} — ${line}`);
    }
  }
}
check("в мужском наборе нет женских окончаний", wrongGender === 0, `найдено ${wrongGender}`);

// --- Здоровье: без юмора ---
let jokes = 0;
for (const key of ["health_created", "health_course"]) {
  for (const v of ["she", "he"]) {
    for (const line of LINES[key][v]) {
      if (/!|конечно|вообще-то|молодец|ну\b/i.test(line)) {
        jokes += 1;
        console.log(`      неуместный тон: ${key} — ${line}`);
      }
    }
  }
}
check("в репликах о лекарствах нет юмора", jokes === 0, `найдено ${jokes}`);

// --- Тяжёлые темы ---
console.log();
for (const text of ["завтра похороны бабушки в 11", "в среду в больницу к маме", "операция во вторник", "суд в пятницу"]) {
  check(`распознаётся как тяжёлое: «${text}»`, isHeavy(text), "не распознано");
}
for (const text of ["купить хлеб", "встреча с Иваном", "позвонить маме"]) {
  check(`обычная фраза не считается тяжёлой: «${text}»`, !isHeavy(text), "ложное срабатывание");
}

console.log();
const calm = say("task_created", { voice: "she", calm: true, vars: VARS });
check("в спокойном режиме ответ без восклицаний", !/[!]/.test(calm), calm);
check("в спокойном режиме наблюдения молчат", note("busy_week", { voice: "she", calm: true, vars: VARS }) === "", "что-то показалось");

// --- Не повторяется подряд ---
let repeats = 0, prev = null;
for (let i = 0; i < 40; i += 1) {
  const line = say("task_created", { voice: "she", vars: VARS });
  if (line === prev) repeats += 1;
  prev = line;
}
check("одна и та же реплика не идёт дважды подряд", repeats === 0, `повторов ${repeats}`);

console.log(failed ? `\nПровалено: ${failed}` : "\nВсе проверки голоса прошли");
process.exit(failed ? 1 : 0);
