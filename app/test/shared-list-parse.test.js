import { parseSharedList, pickRecipient, nickAliasForms } from "../lib/shared-list-parse.js";

const registry = [
  { pairId: "l1", nickname: "Муж", aliases: nickAliasForms("Муж") },
  { pairId: "l2", nickname: "Катя", aliases: nickAliasForms("Катя") },
];

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const direct = parseSharedList("отправь мужу купить хлеб", registry);
check("отправь [ник] …", direct?.pairId === "l1" && direct?.title === "хлеб", JSON.stringify(direct));

const classic = parseSharedList("отправь общий список мужу молоко", registry);
check("отправь общий список [ник] …", classic?.pairId === "l1", JSON.stringify(classic));

const nickFirst = parseSharedList("мужу масло", registry);
check("мужу … без глагола", nickFirst?.pairId === "l1", JSON.stringify(nickFirst));

const employee = parseSharedList("отправь Кате подготовить отчёт", registry);
check("задача сотруднику", employee?.pairId === "l2" && /отч/i.test(employee?.title || ""), JSON.stringify(employee));

const miss = parseSharedList("завтра к врачу", registry);
check("обычная фраза не уходит в списки", miss === null);

const momReg = [
  { pairId: "l3", nickname: "Мама", aliases: nickAliasForms("Мама") },
  ...registry,
];

const trailing = parseSharedList("купи хлеб маме", momReg);
check("купи хлеб маме → маме", trailing?.pairId === "l3" && trailing?.title === "хлеб", JSON.stringify(trailing));

const sharedMode = parseSharedList("купи хлеб маме", [{ pairId: "l3", nickname: "Мама", aliases: nickAliasForms("Мама") }]);
check("дательный в конце без глагола", sharedMode?.pairId === "l3" && /хлеб/i.test(sharedMode?.title || ""), JSON.stringify(sharedMode));

const pick = pickRecipient("мужу", registry);
check("pickRecipient находит пару", pick?.pairId === "l1");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nshared-list-parse: ok");
