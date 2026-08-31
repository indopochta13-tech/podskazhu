import { itemOnProShelf, ROUTINE_SOURCES } from "./pro-shelves.js";
import { save } from "./store.js";

function userIsPro(user) {
  const billing = user?.billing || {};
  return billing.plan === "pro" && Number(billing.until || 0) > Date.now();
}

function activeItems(userId, dbItems) {
  return Object.values(dbItems || {}).filter(i =>
    i.ownerId === userId && !i.deleted && !i.cancelled);
}

/** У free-пользователя убираем серверные образцы ухода/витаминов — только клиентское демо. */
/**
 * Вернуть записи шаблона, отменённые при потере подписки.
 *
 * Человек не платил месяц, записи витаминов и косметики скрылись. Оплатил
 * снова — они должны вернуться. Без этого он платит и не находит того,
 * что вёл полгода: для него это выглядит как потеря данных.
 *
 * Возвращаем только отменённые автоматически: если человек убрал запись сам,
 * она была помечена и удалена вручную — такие не трогаем.
 */
export function restoreRoutineSeed(user, dbItems) {
  if (!userIsPro(user)) return 0;
  let n = 0;
  for (const item of Object.values(dbItems || {})) {
    if (item.ownerId !== user.id) continue;
    if (!ROUTINE_SOURCES.has(item.source)) continue;
    if (!item.cancelled || item.deleted) continue;
    item.cancelled = false;
    item.updatedAt = Date.now();
    n += 1;
  }
  if (n) save();
  return n;
}

export function stripFreeUserRoutineSeed(user, dbItems) {
  if (userIsPro(user)) return restoreRoutineSeed(user, dbItems);
  let n = 0;
  for (const item of activeItems(user.id, dbItems)) {
    if (!ROUTINE_SOURCES.has(item.source)) continue;
    item.cancelled = true;
    item.updatedAt = Date.now();
    n += 1;
  }
  if (n) {
    resetRoutineFlags(user);
    save();
  }
  return n;
}

function resetRoutineFlags(user) {
  const s = user.settings || {};
  s.careRoutineV1 = false;
  s.careRoutineV2 = false;
  s.healthRoutineV1 = false;
  s.healthRoutineV2 = false;
  s.healthRoutineV3 = false;
  user.settings = s;
}

/** После активации ПРО — чистые полки для своих данных. */
export function clearProShelfData(user, dbItems) {
  let n = 0;
  for (const item of Object.values(dbItems || {})) {
    if (item.ownerId !== user.id || item.deleted) continue;
    if (item.cancelled) continue;
    if (!itemOnProShelf(item) && !ROUTINE_SOURCES.has(item.source)) continue;
    item.cancelled = true;
    item.updatedAt = Date.now();
    n += 1;
  }
  resetRoutineFlags(user);
  user.settings = user.settings || {};
  user.settings.proShelfClearedAt = Date.now();
  save();
  return n;
}
