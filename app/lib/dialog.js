/**
 * Диалоговый слой поверх NLU (как у ассистентов):
 * контекст прошлого хода, эллипсис, подтверждение, откат «не то».
 */

const UNDO_WINDOW_MS = 2 * 60 * 1000;
const CONFIRM_WINDOW_MS = 2 * 60 * 1000;

const UNDO_RE = /^(?:не\s+то|не\s+так|ошиб(?:ка|лась|ся|очно)|отмени\s+(?:это|последн[а-яё]*)|верни(?:\s+(?:как\s+было|назад))?|откат|стоп\s+отмени)$/iu;
const YES_RE = /^(?:да|ага|угу|верно|точно|подтверждаю|ладно|именно(?:\s+(?:е[её]|его|эту|этот))?|эту|этот|её|ее|его|перв[а-яё]*|ок|окей|хорошо)$/iu;
const NO_RE = /^(?:нет|не\s+надо|не\s+эту|другую|отмена|неважно|потом|без\s+времени)$/iu;

export function isUndoPhrase(text) {
  return UNDO_RE.test(String(text || "").replace(/\s+/g, " ").trim());
}

export function isYesPhrase(text) {
  return YES_RE.test(String(text || "").replace(/\s+/g, " ").trim());
}

export function isNoPhrase(text) {
  return NO_RE.test(String(text || "").replace(/\s+/g, " ").trim());
}

function ensureNlu(user) {
  if (!user.nlu || typeof user.nlu !== "object") user.nlu = {};
  return user.nlu;
}

export function rememberDialog(user, payload) {
  const nlu = ensureNlu(user);
  if (payload.slots) nlu.lastSlots = payload.slots;
  if (payload.itemIds) nlu.lastItemIds = payload.itemIds;
  if (payload.action) {
    nlu.lastAction = { ...payload.action, at: Date.now() };
  }
  if ("pendingConfirm" in payload) nlu.pendingConfirm = payload.pendingConfirm;
}

export function clearPendingConfirm(user) {
  const nlu = ensureNlu(user);
  nlu.pendingConfirm = null;
}

export function getPendingConfirm(user) {
  const nlu = ensureNlu(user);
  const pending = nlu.pendingConfirm;
  if (!pending || !pending.at) return null;
  if (Date.now() - pending.at > CONFIRM_WINDOW_MS) {
    nlu.pendingConfirm = null;
    return null;
  }
  return pending;
}

export function getLastItemIds(user) {
  const ids = ensureNlu(user).lastItemIds;
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

export function getLastSlots(user) {
  return ensureNlu(user).lastSlots || null;
}

/** Откат последнего действия, если не прошло 2 минуты. */
export function undoLastAction(user, dbItems) {
  const nlu = ensureNlu(user);
  const action = nlu.lastAction;
  if (!action || !action.at || Date.now() - action.at > UNDO_WINDOW_MS) {
    return { ok: false, message: "Нечего отменять — скажите, что именно." };
  }

  const restored = [];
  if (action.kind === "created") {
    for (const id of action.itemIds || []) {
      const item = dbItems[id];
      if (!item || item.ownerId !== user.id) continue;
      item.cancelled = true;
      item.updatedAt = Date.now();
      restored.push(item);
    }
  } else if (action.kind === "moved" || action.kind === "cancelled") {
    for (const snap of action.snapshots || []) {
      const item = dbItems[snap.id];
      if (!item || item.ownerId !== user.id) continue;
      Object.assign(item, snap.before);
      item.updatedAt = Date.now();
      restored.push(item);
    }
  } else {
    return { ok: false, message: "Нечего отменять." };
  }

  nlu.lastAction = null;
  nlu.pendingConfirm = null;
  return {
    ok: true,
    message: restored.length ? "Вернула как было." : "Уже отменено.",
    items: restored,
  };
}

export function snapshotItem(item) {
  return {
    id: item.id,
    before: {
      title: item.title,
      place: item.place,
      who: item.who,
      date: item.date ? { ...item.date } : null,
      time: item.time ? { ...item.time } : null,
      remind: item.remind,
      alarm: item.alarm,
      push: item.push,
      timer: item.timer,
      type: item.type,
      shelf: item.shelf,
      needsTime: item.needsTime,
      cancelled: item.cancelled,
      done: item.done,
      repeat: item.repeat ? { ...item.repeat } : null,
    },
  };
}

/**
 * Эллипсис: короткая догонка к прошлой фразе.
 * «а на Тимирязевской», «на 11», «лучше завтра».
 */
export function looksLikeEllipsis(text, parseResult) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 72) return false;

  // Явная догонка («а на…», «лучше завтра»). \b с кириллицей в JS ненадёжен.
  if (/^(?:а|и|нет|хотя|лучше|точнее|вернее|тогда|ой)(?:\s|$)/iu.test(clean)) return true;
  if (/^давай\s+(?:на|в|к|лучше|завтра|сегодня)\s/iu.test(clean)) return true;

  // Чистый сдвиг: «пораньше», «на полчаса позже».
  if (/^(?:пораньше|попозже|позднее)$/iu.test(clean)) return true;
  if (/^на\s+.+\s+(?:позже|раньше|вперед|назад)$/iu.test(clean) && clean.split(/\s+/).length <= 6) return true;
  if (parseResult?.shift != null && clean.split(/\s+/).length <= 6
    && !/(?:встреч|созвон|купи|напомн|будильник|задач|заметк)/iu.test(clean)) {
    return true;
  }

  // Новая сущность словами — не эллипсис, даже если title слабый («Встреча»).
  if (/(?:встреч|созвон|митинг|купи(?:ть)?|напомн|будильник|тренир|задач|заметк|день\s+рожден|запиш|добав|запланир|назнач)/iu.test(clean)) {
    return false;
  }

  if (parseResult?.intent !== "create" || !parseResult.drafts?.length) return false;
  const d = parseResult.drafts[0];
  const title = String(d.title || "").trim();
  const titleNorm = title.toLowerCase();
  const placeNorm = String(d.place || "").toLowerCase();
  const weakTitle = !title
    || titleNorm.length < 3
    || /^(встреча|созвон|дело|задача|заметка|завтра|сегодня|послезавтра|без названия)$/iu.test(titleNorm)
    || (placeNorm && (titleNorm === placeNorm || titleNorm === `на ${placeNorm}`));

  const words = clean.split(/\s+/).length;
  // Короткая фраза только со слотами: «на 11», «на Тимирязевской», «завтра в 15».
  if (weakTitle && words <= 6 && (d.time || d.place || d.who || (d.date && !d.needsTime) || parseResult.shift != null)) return true;
  return false;
}

/** Слить слоты эллипсиса в патч для applyMove / create. */
export function ellipsisPatch(parseResult) {
  const d = parseResult?.drafts?.[0] || {};
  const slots = parseResult?.slots || {};
  return {
    intent: "move",
    date: d.date || slots.date || null,
    time: d.time || slots.time || null,
    place: d.place || slots.place || "",
    who: d.who || slots.who || "",
    shift: parseResult?.shift ?? null,
    timer: Boolean(d.timer || slots.timer),
    alarm: d.alarm,
    push: d.push,
    query: d.title || slots.title || "",
    target: { last: true, saidLast: true, kind: null },
  };
}
