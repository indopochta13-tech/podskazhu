/** План тренировок на неделю — поля по образцу Strong / Hevy / Jefit. */

export const SPORT_WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const SPORT_DAY_LABELS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
export const SPORT_DAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
/** Группы мышц — сводка Strong / Hevy / Jefit / FitNotes. */
export const SPORT_MUSCLE_GROUPS = [
  "Грудь",
  "Спина",
  "Верх спины",
  "Широчайшие",
  "Поясница",
  "Трапеции",
  "Плечи",
  "Бицепс",
  "Трицепс",
  "Предплечья",
  "Шея",
  "Ноги",
  "Квадрицепс",
  "Бёдра",
  "Ягодицы",
  "Икры",
  "Пресс",
  "Косые",
  "Руки",
  "Кардио",
  "Всё тело",
  "Олимпийские",
  "Разминка",
  "Растяжка",
  "Функциональное",
];

/** Дни недели, включённые в напоминания — только они на полке. */
export function sportVisibleWeekdays(notify) {
  return SPORT_WEEK_ORDER.filter(d => Boolean(notify?.[d]?.enabled));
}

export function defaultSportExercise(overrides = {}) {
  return {
    name: "",
    muscleGroup: "",
    sets: 3,
    reps: "10",
    weight: "",
    rest: "90 сек",
    notes: "",
    ...overrides,
  };
}

export function defaultSportDay(weekday = 1) {
  return {
    title: "",
    muscleGroups: [],
    exercises: [],
    restDay: weekday === 0,
  };
}

export function defaultSportPlan() {
  const days = {};
  for (let d = 0; d < 7; d += 1) days[d] = defaultSportDay(d);
  return { days };
}

export function defaultSportNotify() {
  return Array.from({ length: 7 }, (_, d) => ({
    enabled: d >= 1 && d <= 5,
    hour: 19,
    minute: 0,
  }));
}

export function seedSportPlan() {
  const plan = defaultSportPlan();
  plan.days[1] = {
    title: "Ноги",
    muscleGroups: ["Ноги", "Пресс"],
    restDay: false,
    exercises: [
      defaultSportExercise({ name: "Приседания", muscleGroup: "Ноги", sets: 4, reps: "8-10", weight: "60 кг", rest: "2 мин" }),
      defaultSportExercise({ name: "Румынская тяга", muscleGroup: "Ноги", sets: 3, reps: "10", weight: "50 кг" }),
      defaultSportExercise({ name: "Планка", muscleGroup: "Пресс", sets: 3, reps: "45 сек", rest: "60 сек" }),
    ],
  };
  plan.days[3] = {
    title: "Верх тела",
    muscleGroups: ["Грудь", "Спина", "Плечи"],
    restDay: false,
    exercises: [
      defaultSportExercise({ name: "Жим лёжа", muscleGroup: "Грудь", sets: 4, reps: "8", weight: "70 кг", rest: "2 мин" }),
      defaultSportExercise({ name: "Тяга блока", muscleGroup: "Спина", sets: 3, reps: "12", weight: "45 кг" }),
      defaultSportExercise({ name: "Жим гантелей", muscleGroup: "Плечи", sets: 3, reps: "10", weight: "14 кг" }),
    ],
  };
  plan.days[5] = {
    title: "Кардио",
    muscleGroups: ["Кардио"],
    restDay: false,
    exercises: [
      defaultSportExercise({ name: "Бег", muscleGroup: "Кардио", sets: 1, reps: "5 км", notes: "лёгкий темп" }),
    ],
  };
  return plan;
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function normExercise(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  return {
    name,
    muscleGroup: String(raw.muscleGroup || "").trim(),
    sets: clampInt(raw.sets, 1, 20, 3),
    reps: String(raw.reps || "10").trim().slice(0, 24),
    weight: String(raw.weight || "").trim().slice(0, 32),
    rest: String(raw.rest || "").trim().slice(0, 24),
    notes: String(raw.notes || "").trim().slice(0, 240),
  };
}

function normDay(raw, weekday) {
  const base = defaultSportDay(weekday);
  if (!raw || typeof raw !== "object") return base;
  const exercises = Array.isArray(raw.exercises)
    ? raw.exercises.map(normExercise).filter(Boolean).slice(0, 24)
    : [];
  const muscleGroups = Array.isArray(raw.muscleGroups)
    ? [...new Set(raw.muscleGroups.map(g => String(g || "").trim()).filter(Boolean))].slice(0, 8)
    : [];
  return {
    title: String(raw.title || "").trim().slice(0, 80),
    muscleGroups,
    exercises,
    restDay: Boolean(raw.restDay),
  };
}

export function normalizeSportPlan(raw) {
  const days = {};
  for (let d = 0; d < 7; d += 1) {
    const src = raw?.days?.[d] ?? raw?.days?.[String(d)];
    days[d] = normDay(src, d);
  }
  return { days };
}

export function normalizeSportNotify(raw) {
  const base = defaultSportNotify();
  if (!Array.isArray(raw)) return base;
  return base.map((slot, d) => {
    const src = raw[d];
    if (!src || typeof src !== "object") return slot;
    return {
      enabled: Boolean(src.enabled),
      hour: clampInt(src.hour, 0, 23, slot.hour),
      minute: clampInt(src.minute, 0, 59, slot.minute),
    };
  });
}

export function sportDayHasWorkout(day) {
  if (!day || day.restDay) return false;
  return Array.isArray(day.exercises)
    && day.exercises.some(e => String(e?.name || "").trim());
}

export function sportPlanFilled(plan) {
  return Object.values(plan?.days || {}).some(sportDayHasWorkout);
}

export function sportDaySummary(day) {
  if (!day) return "Отдых";
  if (day.restDay) return "Отдых";
  if (day.title) return day.title;
  if (day.muscleGroups?.length) return day.muscleGroups.join(" · ");
  const n = day.exercises?.length || 0;
  return n ? `${n} упражн.` : "Пусто";
}

export function sportExerciseMeta(ex) {
  const parts = [];
  if (Number.isFinite(ex.sets) && ex.sets > 0) parts.push(`${ex.sets}×${ex.reps || "?"}`);
  if (ex.weight) parts.push(ex.weight);
  if (ex.rest) parts.push(`отдых ${ex.rest}`);
  return parts.join(" · ");
}
