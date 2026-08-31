/**
 * Реакция приложения: лицо и символ на каждое событие.
 *
 * Два независимых слоя. Символ отвечает на «о чём запись» — берётся с полки.
 * Лицо отвечает на «как прошло» — берётся из события.
 *
 * Поэтому сочетаний не нужно рисовать: усталое лицо с тележкой получается
 * само, когда человек записывает хлеб в три часа ночи.
 *
 * ── Главное правило ─────────────────────────────────────────────────────
 *
 * При isHeavy(text) === true допустимы только спокойное лицо и символы
 * hands, clock, dots, question. Никаких улыбок, сердец, звёзд и тортов.
 *
 * Проверка та же, что глушит шутки в репликах — одна функция на текст
 * и на картинку. Улыбающееся лицо в ответ на «завтра похороны бабушки» —
 * то, за что удаляют навсегда.
 */

/** Символ по полке: о чём запись. */
const SHELF_SYMBOL = {
  buy: "cart",
  meetings: "meeting",
  tasks: "checklist",
  notes: "note",
  bday: "cake",
  bills: "bill",
  health: "pill",
  alarms: "alarm",
  sport: "dumbbell",
  care: "droplet",
  meters: "gauge",
};

/** Символ по событию, когда полка ничего не говорит. */
const EVENT_SYMBOL = {
  reminded: "clock",
  unheard: "question",
  thinking: "dots",
  overdue: "exclaim",
  goodday: "star",
  night: "moon",
  morning: "sun",
  heavy: "hands",
};

/** Лицо по событию. */
const EVENT_FACE = {
  saved: "saved",
  reminded: "reminded",
  unheard: "unheard",
  thinking: "thinking",
  heavy: "calm",
  goodday: "happy",
  birthday: "warm",
  funny: "laugh",
  hint: "wink",
  done: "proud",
  night: "tired",
  latenight: "sleep",
  cancelled: "sad",
  overdue: "worried",
  unexpected: "surprised",
  noticed: "sly",
};

/** Что можно показывать на тяжёлой теме. */
const CALM_FACES = new Set(["calm"]);
const CALM_SYMBOLS = new Set(["hands", "clock", "dots", "question", "document", "pin"]);

/** Сколько вариантов каждого лица лежит в данных. */
const VARIANTS = 5;

/**
 * Выбрать реакцию на событие.
 *
 * @param {object} opts
 * @param {string} opts.event   — что произошло: saved, reminded, unheard, …
 * @param {string} [opts.shelf] — полка записи, если есть
 * @param {boolean} [opts.heavy] — результат isHeavy() по тексту записи
 * @param {number} [opts.hour]  — час создания, для ночных записей
 * @returns {{face: string, symbol: string|null}}
 */
export function reactionFor({ event = "saved", shelf = "", heavy = false, hour = null } = {}) {
  // Тяжёлая тема перебивает всё остальное: ни радости, ни поздравлений.
  if (heavy) {
    return { face: pickVariant("calm"), symbol: "hands" };
  }

  // Ночная запись: человек не спит, и приложение это замечает.
  let faceKey = EVENT_FACE[event] || "saved";
  if (hour !== null && (hour >= 1 && hour < 5) && event === "saved") {
    faceKey = hour < 3 ? "tired" : "sleep";
  }

  // Символ: сначала полка, потом событие. Полка конкретнее.
  const symbol = SHELF_SYMBOL[shelf] || EVENT_SYMBOL[event] || null;

  return { face: pickVariant(faceKey), symbol };
}

/**
 * Случайный вариант выражения. Человек видит новое лицо каждый раз —
 * ради этого и генерировали по пять штук.
 */
function pickVariant(name) {
  const n = 1 + Math.floor(Math.random() * VARIANTS);
  return `${name}-${n}`;
}

/**
 * Проверка перед показом. Возвращает исправленную пару, если сочетание
 * недопустимо — на случай, если событие определилось неверно.
 */
export function guard(reaction, heavy) {
  if (!heavy) return reaction;
  const face = CALM_FACES.has(reaction.face.split("-")[0])
    ? reaction.face
    : pickVariant("calm");
  const symbol = CALM_SYMBOLS.has(reaction.symbol) ? reaction.symbol : "hands";
  return { face, symbol };
}

export { SHELF_SYMBOL, EVENT_SYMBOL, EVENT_FACE, CALM_FACES, CALM_SYMBOLS };
