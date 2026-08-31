/** План витаминов: день недели → утро / день / вечер. */
export const HEALTH_ROUTINE_SOURCE = "health-routine-v2";

/** JS weekday: 0 вс … 6 сб */
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];

export const HEALTH_DAY_LABELS = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

/** Порядок отображения: пн → вс */
export const HEALTH_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const HEALTH_PARTS = [
  { id: "morning", label: "Утро", summary: "Утро Витамины", hint: "завтрак с жиром" },
  { id: "midday", label: "День", summary: "День Витамины", hint: "обед" },
  { id: "evening", label: "Вечер", summary: "Вечер Витамины", hint: "ужин / сон" },
];

/**
 * Один набор шагов; days — в какие дни недели стоит приём.
 * Ашваганда только по будням; на выходных в UI — «перерыв».
 */
export const HEALTH_ROUTINE = [
  // Утро 08:00
  { healthPart: "morning", healthOrder: 1, title: "Витамин D3+K2", dose: "2000 ME", asNeeded: false, days: ALL_DAYS },
  { healthPart: "morning", healthOrder: 2, title: "Омега-3", dose: "1–2 г", asNeeded: false, days: ALL_DAYS },
  { healthPart: "morning", healthOrder: 3, title: "B12", dose: "500–1000 мкг", asNeeded: false, days: ALL_DAYS },
  { healthPart: "morning", healthOrder: 4, title: "Селен", dose: "100–200 мкг", asNeeded: false, days: ALL_DAYS },
  { healthPart: "morning", healthOrder: 5, title: "CoQ10", dose: "100–200 мг", asNeeded: false, days: ALL_DAYS },
  { healthPart: "morning", healthOrder: 6, title: "Бета-ситостерол", dose: "", note: "простата (после уролога)", asNeeded: true, days: ALL_DAYS },
  { healthPart: "morning", healthOrder: 7, title: "Расторопша", dose: "", note: "печень", asNeeded: true, days: ALL_DAYS },

  // День 13:00
  { healthPart: "midday", healthOrder: 1, title: "Креатин", dose: "3–5 г", asNeeded: false, days: ALL_DAYS },
  { healthPart: "midday", healthOrder: 2, title: "Бор", dose: "6 мг", asNeeded: false, days: ALL_DAYS },
  { healthPart: "midday", healthOrder: 3, title: "Куркумин + пиперин", dose: "", note: "суставы", asNeeded: true, days: ALL_DAYS },
  { healthPart: "midday", healthOrder: 4, title: "Глюкозамин + хондроитин", dose: "", note: "суставы", asNeeded: true, days: ALL_DAYS },

  // Вечер 21:00
  { healthPart: "evening", healthOrder: 1, title: "Магний", dose: "300–400 мг", asNeeded: false, days: ALL_DAYS },
  { healthPart: "evening", healthOrder: 2, title: "Цинк", dose: "15–25 мг", asNeeded: false, days: ALL_DAYS },
  { healthPart: "evening", healthOrder: 3, title: "Ашваганда", dose: "600 мг", asNeeded: false, days: WEEKDAYS, weekendPause: true },
  { healthPart: "evening", healthOrder: 4, title: "NAC", dose: "", note: "лёгкие (при бронхите / сезон)", asNeeded: true, days: ALL_DAYS },
];

export function healthDefaultTime(part) {
  if (part === "midday") return { hour: 13, minute: 0 };
  if (part === "evening") return { hour: 21, minute: 0 };
  return { hour: 8, minute: 0 };
}

export function healthItemTitle(step) {
  const name = String(step.title || "").trim();
  const dose = String(step.dose || "").trim();
  if (name && dose) return `${name} — ${dose}`;
  return name || "Витамин";
}

export function healthPartLabel(part) {
  return HEALTH_PARTS.find(p => p.id === part)?.label || part;
}

export function healthSummaryTitle(part) {
  return HEALTH_PARTS.find(p => p.id === part)?.summary || "Витамины";
}
