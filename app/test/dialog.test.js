import {
  isUndoPhrase,
  isYesPhrase,
  isNoPhrase,
  rememberDialog,
  getPendingConfirm,
  clearPendingConfirm,
  undoLastAction,
  snapshotItem,
  looksLikeEllipsis,
  ellipsisPatch,
} from "../lib/dialog.js";
import { parse, extractWho } from "../lib/parse.js";

const tz = "Europe/Moscow";
const now = Date.UTC(2026, 7, 2, 6, 0);
const ctx = { now, tz, settings: {} };

let failed = 0;
function check(label, condition, detail) {
  if (!condition) {
    failed += 1;
    console.log(`  ✗ ${label} → ${detail}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("Диалог 1–6 (без голоса ИИ и тихих часов)\n");

check("undo: не то", isUndoPhrase("не то"));
check("undo: отмени это", isUndoPhrase("отмени это"));
check("undo: отмени последнее", isUndoPhrase("отмени последнее"));
check("undo: верни назад", isUndoPhrase("верни назад"));
check("undo: ошибочно", isUndoPhrase("ошибочно"));
check("yes", isYesPhrase("да"));
check("yes: подтверждаю", isYesPhrase("подтверждаю"));
check("yes: ладно", isYesPhrase("ладно"));
check("no", isNoPhrase("нет"));
check("no: неважно", isNoPhrase("неважно"));
check("no: без времени", isNoPhrase("без времени"));
check("не undo обычная отмена", !isUndoPhrase("отмени встречу на Таганке"));

const who = extractWho("встреча с Андреем завтра в 10");
check("who: с Андреем → Андрей", who && /^Андре/i.test(who.value), JSON.stringify(who));

const client = extractWho("созвон клиент Иван Петров в 15");
check("who: клиент Иван", client && /Иван/i.test(client.value), JSON.stringify(client));

const meet = parse("встреча с Андреем завтра в 10 на Таганке", ctx);
check(
  "create who + place",
  meet.drafts[0]?.who && /^Андре/i.test(meet.drafts[0].who)
    && /Таган/i.test(meet.drafts[0].place || "")
    && meet.drafts[0].time?.hour === 10,
  JSON.stringify(meet.drafts[0]),
);

const syn = parse("созвонимся с банком завтра в 11", ctx);
check(
  "синоним созвонимся → встреча/созвон",
  syn.intent === "create" && syn.drafts[0]?.type === "meeting" && syn.drafts[0].time?.hour === 11,
  JSON.stringify(syn.drafts[0]),
);

const alarmOff = parse("перенеси встречу на 12 без будильника", ctx);
check(
  "move: без будильника → alarm false",
  alarmOff.intent === "move" && alarmOff.alarm === false && alarmOff.time?.hour === 12,
  JSON.stringify({ intent: alarmOff.intent, alarm: alarmOff.alarm, time: alarmOff.time }),
);

const shift = parse("перенеси встречу на час позже", ctx);
check(
  "относительный сдвиг +60",
  shift.intent === "move" && shift.shift === 60,
  JSON.stringify({ shift: shift.shift }),
);

const ellipsisTime = parse("на 11", ctx);
check(
  "эллипсис «на 11»",
  looksLikeEllipsis("на 11", ellipsisTime)
    && ellipsisPatch(ellipsisTime).time?.hour === 11,
  JSON.stringify({ ellipsis: looksLikeEllipsis("на 11", ellipsisTime), patch: ellipsisPatch(ellipsisTime) }),
);

const ellipsisPlace = parse("а на Тимирязевской", ctx);
check(
  "эллипсис «а на Тимирязевской»",
  looksLikeEllipsis("а на Тимирязевской", ellipsisPlace),
  JSON.stringify(ellipsisPlace.drafts[0]),
);

const fullCreate = parse("встреча завтра в 10 на Таганке", ctx);
check(
  "полная фраза не эллипсис",
  !looksLikeEllipsis("встреча завтра в 10 на Таганке", fullCreate),
);

const ellipsisShift = parse("на полчаса позже", ctx);
check(
  "эллипсис сдвиг «на полчаса позже»",
  looksLikeEllipsis("на полчаса позже", ellipsisShift)
    && ellipsisPatch(ellipsisShift).shift === 30,
  JSON.stringify({ shift: ellipsisShift.shift, ellipsis: looksLikeEllipsis("на полчаса позже", ellipsisShift) }),
);
check(
  "эллипсис «пораньше»",
  looksLikeEllipsis("пораньше", parse("пораньше", ctx))
    && ellipsisPatch(parse("пораньше", ctx)).shift === -30,
);

const user = { id: "u1", nlu: {} };
const item = {
  id: "i1",
  ownerId: "u1",
  title: "Встреча",
  place: "Таганке",
  who: "",
  date: { year: 2026, month: 7, day: 3 },
  time: { hour: 10, minute: 0 },
  remind: 15,
  alarm: true,
  push: true,
  timer: false,
  type: "meeting",
  shelf: "meetings",
  needsTime: false,
  cancelled: false,
  done: false,
  repeat: null,
};
const items = { i1: item };
const snap = snapshotItem(item);
item.time = { hour: 11, minute: 0 };
rememberDialog(user, {
  action: { kind: "moved", itemIds: ["i1"], snapshots: [snap] },
  itemIds: ["i1"],
  slots: { time: { hour: 11, minute: 0 } },
});
const undone = undoLastAction(user, items);
check(
  "undo restore time 10:00",
  undone.ok && items.i1.time.hour === 10,
  JSON.stringify({ ok: undone.ok, time: items.i1.time }),
);

rememberDialog(user, {
  pendingConfirm: { at: Date.now(), intent: "cancel", itemId: "i1", patch: {} },
});
check("pending confirm alive", !!getPendingConfirm(user));
clearPendingConfirm(user);
check("pending cleared", !getPendingConfirm(user));

process.exit(failed ? 1 : 0);
