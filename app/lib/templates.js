// Готовые наборы записей: человек выбирает «Собака» — и весь уход уже расписан.
// Даты считаются от сегодняшнего дня в поясе человека, ничего не остаётся в прошлом.
import { addDays, addMonths, weekdayOf } from "./time.js";

export const TEMPLATE_GROUPS = [
  { id: "kids", label: "Дети", sub: "школа, кружки, здоровье" },
  { id: "pets", label: "Питомцы", sub: "корм, прогулки, прививки" },
  { id: "home", label: "Дом и платежи", sub: "счётчики, ЖКХ, подписки" },
  { id: "health", label: "Здоровье", sub: "проверки раз в год" },
];

// day — число месяца, weekdays — дни недели (0 — воскресенье), yearly — раз в год.
export const TEMPLATES = [
  {
    id: "school",
    group: "kids",
    label: "Школа",
    sub: "портфель, дневник, оплата питания",
    items: [
      { title: "Собрать портфель", type: "task", time: [20, 0], repeat: { kind: "weekdays" } },
      { title: "Проверить дневник и домашку", type: "task", time: [19, 0], repeat: { kind: "weekdays" } },
      { title: "Оплатить школьное питание", type: "bills", day: 5, repeat: { kind: "monthly" } },
      { title: "Родительское собрание", type: "meeting", optional: true },
    ],
  },
  {
    id: "circles",
    group: "kids",
    label: "Кружки и секции",
    sub: "отвезти, забрать, оплатить",
    items: [
      { title: "Отвезти на секцию", type: "task", time: [17, 0], repeat: { kind: "weekly", days: [2, 4] } },
      { title: "Забрать с секции", type: "task", time: [19, 0], repeat: { kind: "weekly", days: [2, 4] } },
      { title: "Оплатить занятия", type: "bills", day: 1, repeat: { kind: "monthly" } },
    ],
  },
  {
    id: "kid_health",
    group: "kids",
    label: "Здоровье ребёнка",
    sub: "витамины, педиатр, прививки",
    items: [
      { title: "Витамин D ребёнку", type: "health", time: [9, 0], repeat: { kind: "daily" } },
      { title: "Плановый приём у педиатра", type: "meeting", optional: true },
      { title: "Прививка по календарю", type: "health", optional: true },
    ],
  },
  {
    id: "dog",
    group: "pets",
    label: "Собака",
    sub: "прогулки, корм, обработка",
    items: [
      { title: "Утренняя прогулка", type: "task", time: [7, 30], repeat: { kind: "daily" } },
      { title: "Вечерняя прогулка", type: "task", time: [21, 0], repeat: { kind: "daily" } },
      { title: "Насыпать корм", type: "task", time: [8, 0], repeat: { kind: "daily" } },
      { title: "Обработка от блох и клещей", type: "health", day: 1, repeat: { kind: "monthly" } },
      { title: "Прививка у ветеринара", type: "health", yearly: true, inDays: 30 },
      { title: "Подстричь когти", type: "care", day: 15, repeat: { kind: "monthly" } },
    ],
  },
  {
    id: "cat",
    group: "pets",
    label: "Кошка",
    sub: "корм, лоток, ветеринар",
    items: [
      { title: "Насыпать корм", type: "task", time: [8, 0], repeat: { kind: "daily" } },
      { title: "Поменять наполнитель", type: "task", time: [20, 0], repeat: { kind: "weekly", days: [0] } },
      { title: "Обработка от паразитов", type: "health", day: 1, repeat: { kind: "monthly" } },
      { title: "Прививка у ветеринара", type: "health", yearly: true, inDays: 30 },
    ],
  },
  {
    id: "meters",
    group: "home",
    label: "Счётчики и ЖКХ",
    sub: "показания и квитанции",
    items: [
      { title: "Передать показания счётчиков", type: "bills", day: 20, repeat: { kind: "monthly" } },
      { title: "Оплатить квартиру", type: "bills", day: 25, repeat: { kind: "monthly" } },
      { title: "Оплатить интернет", type: "bills", day: 5, repeat: { kind: "monthly" } },
    ],
  },
  {
    id: "subs",
    group: "home",
    label: "Подписки и аренда",
    sub: "чтобы не списалось внезапно",
    items: [
      { title: "Оплатить аренду", type: "bills", day: 1, repeat: { kind: "monthly" } },
      { title: "Проверить подписки на телефоне", type: "bills", day: 10, repeat: { kind: "monthly" } },
      { title: "Продлить страховку", type: "bills", yearly: true, inDays: 30 },
    ],
  },
  {
    id: "checkup",
    group: "health",
    label: "Проверка здоровья",
    sub: "раз в год, чтобы не откладывать",
    items: [
      { title: "Сдать анализ крови", type: "health", yearly: true, inDays: 14 },
      { title: "Стоматолог", type: "meeting", yearly: true, inDays: 30 },
      { title: "Диспансеризация", type: "meeting", yearly: true, inDays: 60 },
    ],
  },
];

export function templateById(id) {
  return TEMPLATES.find(t => t.id === id) || null;
}

export function templatesPublic() {
  return {
    groups: TEMPLATE_GROUPS,
    templates: TEMPLATES.map(t => ({
      id: t.id,
      group: t.group,
      label: t.label,
      sub: t.sub,
      items: t.items.map(i => ({
        title: i.title,
        type: i.type,
        when: describeWhen(i),
        optional: Boolean(i.optional),
      })),
    })),
  };
}

function two(value) {
  return String(value).padStart(2, "0");
}

function describeWhen(entry) {
  const at = entry.time ? ` в ${two(entry.time[0])}:${two(entry.time[1])}` : "";
  if (entry.repeat?.kind === "daily") return `каждый день${at}`;
  if (entry.repeat?.kind === "weekdays") return `по будням${at}`;
  if (entry.repeat?.kind === "weekly") {
    const names = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    return `по ${(entry.repeat.days || []).map(d => names[d]).join(" и ")}${at}`;
  }
  if (entry.repeat?.kind === "monthly") return `${entry.day} числа каждый месяц`;
  if (entry.yearly) return "раз в год";
  return "без срока — поставите сами";
}

// Первая дата записи: сегодня, если час ещё не прошёл, иначе ближайший подходящий день.
export function firstDate(entry, nowParts) {
  if (entry.day) {
    const base = { year: nowParts.year, month: nowParts.month, day: entry.day };
    return entry.day >= nowParts.day ? base : addMonths(base, 1);
  }
  if (entry.inDays) return addDays(nowParts, entry.inDays);
  if (!entry.time) return null;

  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const due = entry.time[0] * 60 + entry.time[1];
  let date = due > nowMinutes ? { year: nowParts.year, month: nowParts.month, day: nowParts.day } : addDays(nowParts, 1);

  const kind = entry.repeat?.kind;
  if (kind === "weekdays") {
    while (weekdayOf(date) === 0 || weekdayOf(date) === 6) date = addDays(date, 1);
  } else if (kind === "weekends") {
    while (weekdayOf(date) !== 0 && weekdayOf(date) !== 6) date = addDays(date, 1);
  } else if (kind === "weekly" && entry.repeat.days?.length) {
    for (let guard = 0; guard < 8 && !entry.repeat.days.includes(weekdayOf(date)); guard += 1) {
      date = addDays(date, 1);
    }
  }
  return date;
}

/** Черновики записей шаблона: то, что уйдёт в обычное создание записи. */
export function templateDrafts(template, nowParts, picked = null) {
  const drafts = [];
  template.items.forEach((entry, index) => {
    if (picked && !picked.includes(index)) return;
    const date = firstDate(entry, nowParts);
    drafts.push({
      type: entry.type,
      title: entry.title,
      date,
      time: entry.time ? { hour: entry.time[0], minute: entry.time[1] } : null,
      repeat: entry.repeat || null,
      yearly: Boolean(entry.yearly),
      needsTime: false,
      source: `шаблон · ${template.label}`,
    });
  });
  return drafts;
}
