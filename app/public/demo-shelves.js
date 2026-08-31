/**
 * Клиентские образцы для PRO-полок без подписки.
 * Не пишутся в БД и не синхронизируются между устройствами.
 */
import {
  CARE_ROUTINE,
  CARE_ROUTINE_SOURCE,
  careDefaultTime,
} from "./lib/care-routine.js";
import {
  HEALTH_ROUTINE,
  HEALTH_ROUTINE_SOURCE,
  healthDefaultTime,
  healthItemTitle,
} from "./lib/health-routine.js";

export const DEMO_ITEM_PREFIX = "demo-";

export function isDemoItemId(id) {
  return String(id || "").startsWith(DEMO_ITEM_PREFIX);
}

function todayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

function demoItem(suffix, draft) {
  return {
    ...draft,
    id: `${DEMO_ITEM_PREFIX}${suffix}`,
    demo: true,
    cancelled: false,
    archived: false,
    done: false,
    enabled: draft.enabled !== false,
  };
}

function buildCareDemo() {
  return CARE_ROUTINE.map((step, i) => demoItem(`care-${i}`, {
    type: "care",
    shelf: "care",
    title: step.title,
    note: step.note || "",
    starred: Boolean(step.starred),
    carePart: step.carePart,
    careOrder: step.careOrder,
    date: todayParts(),
    time: careDefaultTime(step.carePart),
    repeat: { kind: "daily" },
    repeatLabel: "каждый день",
    remind: 0,
    push: false,
    source: CARE_ROUTINE_SOURCE,
  }));
}

function buildHealthDemo() {
  return HEALTH_ROUTINE.map((step, i) => demoItem(`health-${i}`, {
    type: "health",
    shelf: "health",
    title: healthItemTitle(step),
    note: step.note || "",
    asNeeded: Boolean(step.asNeeded),
    weekendPause: Boolean(step.weekendPause),
    healthPart: step.healthPart,
    healthOrder: step.healthOrder,
    date: todayParts(),
    time: healthDefaultTime(step.healthPart),
    repeat: { kind: "weekly", days: Array.isArray(step.days) ? step.days : [0, 1, 2, 3, 4, 5, 6] },
    repeatLabel: step.weekendPause ? "по будням" : "каждый день",
    remind: 0,
    push: false,
    source: HEALTH_ROUTINE_SOURCE,
  }));
}

function buildSportDemo() {
  const slots = [
    { title: "Силовая — ноги", days: [1], hour: 19, minute: 0 },
    { title: "Кардио — бег 5 км", days: [3], hour: 19, minute: 0 },
    { title: "Плавание — 40 мин", days: [5], hour: 18, minute: 30 },
    { title: "Йога — растяжка", days: [6], hour: 10, minute: 0 },
    { title: "Функциональная — всё тело", days: [2, 4], hour: 7, minute: 30 },
  ];
  return slots.map((s, i) => demoItem(`sport-${i}`, {
    type: "sport",
    shelf: "sport",
    title: s.title,
    date: todayParts(),
    time: { hour: s.hour, minute: s.minute },
    repeat: { kind: "weekly", days: s.days },
    repeatLabel: s.days.length > 1 ? "вт, чт" : ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][s.days[0]],
    remind: 0,
    push: false,
  }));
}

function buildAlarmsDemo() {
  const rows = [
    { title: "Подъём", hour: 6, minute: 30, repeat: { kind: "daily" }, label: "Ежедневно" },
    { title: "Дети в школу", hour: 7, minute: 15, repeat: { kind: "weekdays" }, label: "По будням" },
    { title: "Обед — перерыв", hour: 13, minute: 0, repeat: { kind: "weekdays" }, label: "По будням" },
    { title: "Тренировка", hour: 18, minute: 45, repeat: { kind: "weekly", days: [1, 3, 5] }, label: "пн, ср, пт" },
    { title: "Отбой", hour: 22, minute: 30, repeat: { kind: "daily" }, label: "Ежедневно" },
    { title: "Выходной — не спешить", hour: 9, minute: 0, repeat: { kind: "weekends" }, label: "По выходным" },
  ];
  return rows.map((r, i) => demoItem(`alarm-${i}`, {
    type: "alarm",
    shelf: "alarms",
    title: r.title,
    date: todayParts(),
    time: { hour: r.hour, minute: r.minute },
    repeat: r.repeat,
    repeatLabel: r.label,
    alarm: true,
    enabled: i !== 2,
    vibrate: true,
    melody: "default",
    remind: 0,
    push: false,
  }));
}

function buildBdayDemo() {
  const people = [
    { title: "Мама — ДР", month: 2, day: 14, who: "Мама" },
    { title: "Папа — ДР", month: 5, day: 3, who: "Папа" },
    { title: "Жена — ДР", month: 7, day: 22, who: "Аня" },
    { title: "Сын — ДР", month: 9, day: 8, who: "Саша" },
    { title: "Дочь — ДР", month: 11, day: 30, who: "Маша" },
    { title: "Бабушка — ДР", month: 1, day: 18, who: "Бабушка" },
    { title: "Коллега Игорь — ДР", month: 4, day: 12, who: "Игорь" },
    { title: "Лучший друг — ДР", month: 6, day: 27, who: "Дима" },
    { title: "Сестра — ДР", month: 10, day: 5, who: "Катя" },
    { title: "Тёща — ДР", month: 12, day: 15, who: "Тёща" },
  ];
  const y = todayParts().year;
  return people.map((p, i) => demoItem(`bday-${i}`, {
    type: "bday",
    shelf: "bday",
    title: p.title,
    who: p.who,
    date: { year: y, month: p.month, day: p.day },
    time: { hour: 9, minute: 0 },
    yearly: true,
    repeat: { kind: "yearly" },
    repeatLabel: "каждый год",
    remind: 1440,
    push: true,
  }));
}

function buildMetersDemo() {
  const rows = [
    { title: "Холодная вода — передать показания", note: "до 25-го числа · л/счётчик 01234567" },
    { title: "Горячая вода — передать показания", note: "до 25-го числа · л/счётчик 07654321" },
    { title: "Электричество — передать показания", note: "до 25-го · день 12345 · ночь 6789" },
    { title: "Газ — передать показания", note: "до 25-го · м³ 456,789" },
    { title: "Капремонт — квитанция", note: "оплата по ЕПД до 10-го" },
  ];
  const d = todayParts();
  return rows.map((r, i) => demoItem(`meters-${i}`, {
    type: "bills",
    shelf: "meters",
    title: r.title,
    note: r.note,
    date: { year: d.year, month: d.month, day: Math.min(25, d.day) },
    remind: 1440,
    repeat: { kind: "monthly" },
    repeatLabel: "каждый месяц",
    push: true,
  }));
}

function buildBillsDemo() {
  const rows = [
    { title: "Плавание — Маша", who: "Маша", note: "4500 ₽ · карта · до 5-го", repeatLabel: "каждый месяц" },
    { title: "Футбол — Саша", who: "Саша", note: "3200 ₽ · перевод тренеру · до 10-го", repeatLabel: "каждый месяц" },
    { title: "Английский — Саша", who: "Саша", note: "5500 ₽ · СБП · до 15-го", repeatLabel: "каждый месяц" },
    { title: "Робототехника — Маша", who: "Маша", note: "6000 ₽ · наличные · до 1-го", repeatLabel: "каждый месяц" },
    { title: "Школьное питание", who: "Саша", note: "2800 ₽ · карта школьного кафе", repeatLabel: "каждый месяц" },
    { title: "Кружок рисования — Маша", who: "Маша", note: "3800 ₽ · перевод", repeatLabel: "каждый месяц" },
    { title: "Продлёнка — оба", who: "Дети", note: "7200 ₽ · до 20-го", repeatLabel: "каждый месяц" },
  ];
  const d = todayParts();
  return rows.map((r, i) => demoItem(`bills-${i}`, {
    type: "bills",
    shelf: "bills",
    title: r.title,
    who: r.who,
    note: r.note,
    date: { year: d.year, month: d.month, day: 5 + i },
    remind: 1440,
    repeat: { kind: "monthly" },
    repeatLabel: r.repeatLabel,
    push: true,
  }));
}

const BUILDERS = {
  care: buildCareDemo,
  health: buildHealthDemo,
  sport: buildSportDemo,
  alarms: buildAlarmsDemo,
  bday: buildBdayDemo,
  meters: buildMetersDemo,
  bills: buildBillsDemo,
};

/** Локальные записи полки для режима «только просмотр». */
export function loadDemoShelf(shelfId) {
  const fn = BUILDERS[shelfId];
  return fn ? fn() : [];
}

/** Образец общего списка — одна вкладка «Семья». */
export function loadDemoSharedList() {
  const items = [
    { id: `${DEMO_ITEM_PREFIX}shared-1`, title: "Молоко и хлеб", done: false, fromMe: true },
    { id: `${DEMO_ITEM_PREFIX}shared-2`, title: "Позвонить сантехнику", done: true, fromMe: true },
    { id: `${DEMO_ITEM_PREFIX}shared-3`, title: "Забрать посылку", done: false, fromMe: false },
    { id: `${DEMO_ITEM_PREFIX}shared-4`, title: "Купить батарейки AA", done: false, fromMe: true },
    { id: `${DEMO_ITEM_PREFIX}shared-5`, title: "Записать к стоматологу", done: false, fromMe: false },
  ];
  return {
    id: `${DEMO_ITEM_PREFIX}pair-family`,
    nickname: "Семья",
    demo: true,
    items: items.map(it => ({ ...it, demo: true })),
  };
}

export function isDemoItem(item) {
  return Boolean(item?.demo) || isDemoItemId(item?.id);
}
