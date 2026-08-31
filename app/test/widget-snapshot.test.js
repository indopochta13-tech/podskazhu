/**
 * Контракт снимка виджета (зеркало WidgetSnapshotBuilder).
 * Заметки не должны вытесняться десятками дел.
 */

function isWidgetNote(item) {
  return Boolean(item && (item.type === "note" || item.shelf === "notes"));
}

function itemStamp(item) {
  if (!item.date) return Number.MAX_SAFE_INTEGER;
  const t = item.time || { hour: 0, minute: 0 };
  return new Date(item.date.year, item.date.month, item.date.day, t.hour, t.minute).getTime();
}

function itemMatchesWidgetTab(item, tabId) {
  if (!item || item.cancelled || item.done) return false;
  if (tabId === "today") {
    if (!item.date || isWidgetNote(item)) return true;
    return false;
  }
  if (tabId === "notes") return isWidgetNote(item);
  if (tabId === "buy") return item.type === "buy" || item.shelf === "buy";
  return (item.shelf || "tasks") === tabId;
}

function buildSnapshot(pool, tabIds = ["today", "notes", "buy"]) {
  const notes = [];
  const rest = [];
  for (const item of pool) {
    if (!tabIds.some(tab => itemMatchesWidgetTab(item, tab))) continue;
    if (isWidgetNote(item)) notes.push(item);
    else rest.push(item);
  }
  notes.sort((a, b) => itemStamp(a) - itemStamp(b));
  rest.sort((a, b) => itemStamp(a) - itemStamp(b));
  return [...notes, ...rest].slice(0, 80);
}

let failed = 0;
function check(label, cond, detail) {
  if (!cond) {
    failed += 1;
    console.log(`  ✗ ${label} → ${detail}`);
  } else console.log(`  ✓ ${label}`);
}

console.log("Widget snapshot contract\n");

const pool = [];
for (let i = 0; i < 60; i += 1) {
  pool.push({
    id: `t${i}`,
    type: "task",
    shelf: "tasks",
    title: `Дело ${i}`,
    date: { year: 2026, month: 7, day: 1 + (i % 28) },
    time: { hour: 10, minute: 0 },
  });
}
for (let i = 0; i < 12; i += 1) {
  pool.push({ id: `n${i}`, type: "note", shelf: "notes", title: `Заметка ${i}` });
}

const picked = buildSnapshot(pool);
const noteIds = picked.filter(i => i.id.startsWith("n"));
check("12 заметок в снимке при 60 делах", noteIds.length === 12, noteIds.length);
check("заметки первыми", picked[0].id.startsWith("n"), picked[0]?.id);
check("лимит 80", picked.length <= 80, picked.length);

const onlyTasksTab = buildSnapshot(pool, ["buy"]);
check("без today/notes заметки не на покупках", onlyTasksTab.every(i => !i.id.startsWith("n")), onlyTasksTab.length);

process.exit(failed ? 1 : 0);
