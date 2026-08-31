/** Полки и функции, доступные только по подписке ПРО. */
export const PRO_SHELF_IDS = new Set([
  "shared",
  "care",
  "sport",
  "health",
  "meters",
  "bills",
]);

/** Источники серверного автозаполнения — не должны жить в аккаунте free. */
export const ROUTINE_SOURCES = new Set([
  "care-routine-v1",
  "health-routine-v2",
]);

const PRO_TYPES = new Set(["care", "sport", "health", "bills"]);

export function isProShelf(id) {
  return PRO_SHELF_IDS.has(String(id || ""));
}

export function itemOnProShelf(item) {
  if (!item) return false;
  if (item.shelf === "meters") return true;
  // Будильники и дни рождения остаются бесплатными.
  //
  // Будильник — базовая функция напоминалки: его даёт любой конкурент и сам
  // телефон. Человек за него не заплатит, а вот доверие потеряет: он не сможет
  // проверить главное — что приложение вообще будит вовремя.
  //
  // Дни рождения нужны пару раз в год: ценность низкая, раздражение от
  // блокировки — сразу.
  //
  // Платить люди готовы за ведение: курсы лекарств с подсчётом дней,
  // routines косметики, счётчики с историей, общие списки. Там ручной труд,
  // который приложение снимает, и от которого трудно отказаться.
  if (item.shelf && isProShelf(item.shelf)) return true;
  if (item.type && PRO_TYPES.has(item.type)) return true;
  return false;
}
