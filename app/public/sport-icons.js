/**
 * Иконки групп мышц для полки «Спорт» — PNG line-art (OpenAI), чёрный контур без заливки.
 * <img src="*.png"> работает в Android WebView; inline SVG и <img src="*.svg"> — нет.
 */

/** @type {Record<string, string>} */
export const SPORT_MUSCLE_ICON_IDS = {
  "Грудь": "grud",
  "Спина": "spina",
  "Верх спины": "verh-spiny",
  "Широчайшие": "shirochayshie",
  "Поясница": "poyasnitsa",
  "Трапеции": "trapecii",
  "Плечи": "plechi",
  "Бицепс": "biceps",
  "Трицепс": "triceps",
  "Предплечья": "predplechya",
  "Шея": "sheya",
  "Ноги": "nogi",
  "Квадрицепс": "kvadriceps",
  "Бёдра": "bedra",
  "Ягодицы": "yagoditsy",
  "Икры": "ikry",
  "Пресс": "press",
  "Косые": "kosye",
  "Руки": "ruki",
  "Кардио": "kardio",
  "Всё тело": "vse-telo",
  "Олимпийские": "olimpiyskie",
  "Разминка": "razminka",
  "Растяжка": "rastyazhka",
  "Функциональное": "funktsionalnoe",
};

/** @type {Record<string, string>} */
export const SPORT_MUSCLE_ICONS = Object.fromEntries(
  Object.entries(SPORT_MUSCLE_ICON_IDS).map(([name, id]) => [name, `/icons/sport/${id}.png`]),
);

/** Обратная совместимость и синонимы. */
const SPORT_MUSCLE_ICON_ALIASES = {
  "ноги": "Ноги",
  "спина": "Спина",
  "грудь": "Грудь",
  "плечи": "Плечи",
  "руки": "Руки",
  "пресс": "Пресс",
  "кардио": "Кардио",
  "всё тело": "Всё тело",
  "верх тела": "Всё тело",
};

function sportMuscleIconId(name) {
  const key = String(name || "").trim();
  if (!key) return "";
  if (SPORT_MUSCLE_ICON_IDS[key]) return SPORT_MUSCLE_ICON_IDS[key];
  const alias = SPORT_MUSCLE_ICON_ALIASES[key.toLowerCase()];
  if (alias && SPORT_MUSCLE_ICON_IDS[alias]) return SPORT_MUSCLE_ICON_IDS[alias];
  return SPORT_MUSCLE_ICON_IDS["Всё тело"] || "";
}

export function sportMuscleIconPath(name) {
  const id = sportMuscleIconId(name) || "vse-telo";
  return `/icons/sport/${id}.png`;
}

/** @deprecated используйте sportMuscleIcon */
export function sportMuscleIconSvg(name) {
  const id = sportMuscleIconId(name);
  if (!id) return "";
  return `<img class="sport-muscle-ico-img" src="/icons/sport/${id}.png" alt="" aria-hidden="true">`;
}

/**
 * @param {string} name
 * @param {number} [size=30]
 */
export function sportMuscleIcon(name, size = 30) {
  const id = sportMuscleIconId(name);
  if (!id) return "";
  return `<img class="sport-muscle-ico-img" src="/icons/sport/${id}.png" width="${size}" height="${size}" alt="" aria-hidden="true">`;
}
