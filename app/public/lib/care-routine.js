/** Базовый протокол ухода: утро / вечер, одно общее время на колонку. */
export const CARE_ROUTINE_SOURCE = "care-routine-v1";

export const CARE_ROUTINE = [
  {
    carePart: "morning",
    careOrder: 1,
    title: "Очищение — CeraVe Foaming Cleanser",
    note: "",
    starred: false,
  },
  {
    carePart: "morning",
    careOrder: 2,
    title: "Витамин С — La Roche-Posay Pure Vitamin C12",
    note: "",
    starred: false,
  },
  {
    carePart: "morning",
    careOrder: 3,
    title: "Увлажнение — CeraVe Moisturising Lotion",
    note: "Ceramides + HA · лёгкая",
    starred: false,
  },
  {
    carePart: "morning",
    careOrder: 4,
    title: "Санскрин — LRP Anthelios UVMune 400 Oil Control",
    note: "SPF 50+ / PA++++",
    starred: true,
  },
  {
    carePart: "evening",
    careOrder: 1,
    title: "Очищение — CeraVe Foaming Cleanser",
    note: "",
    starred: false,
  },
  {
    carePart: "evening",
    careOrder: 2,
    title: "Ниацинамид — The Ordinary Niacinamide 10% + Zinc 1%",
    note: "",
    starred: false,
  },
  {
    carePart: "evening",
    careOrder: 3,
    title: "Ретиноид — твой текущий → апгрейд The Ordinary Retinal 0.2%",
    note: "",
    starred: true,
  },
  {
    carePart: "evening",
    careOrder: 4,
    title: "Увлажнение — CeraVe Moisturising Lotion",
    note: "",
    starred: false,
  },
];

export function careDefaultTime(part) {
  return part === "evening" ? { hour: 21, minute: 0 } : { hour: 8, minute: 0 };
}
