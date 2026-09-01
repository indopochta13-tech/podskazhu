import { db, save, nextId, findUserByCode, isBlockedBy } from "./store.js";
import { sendTo } from "./push.js";
import { safeZone, zonedParts, zonedToUtc } from "./time.js";
import { normalizeTitle } from "./parse.js";
import { nickAliasForms } from "./shared-list-parse.js";
import { isPro } from "./billing.js";

export const PAIRS_PER_USER = 20;
export const PAIR_ITEMS_MAX = 200;

/**
 * Общие списки — платная функция, но не все действия одинаковы.
 *
 * Приглашение и добавление задач требуют подписки: это создание.
 * А выход из списка и отметка «сделал» — нет: человека уже пригласили,
 * и запирать его внутри нельзя. Уйти он должен мочь всегда.
 */
function proListsBlocked(user) {
  if (isPro(user)) return null;
  return { status: 403, body: { error: "Доступно по подписке ПРО", proRequired: true } };
}

function ensureListInvites() {
  if (!db.listInvites) db.listInvites = {};
}

function pairMembersKey(a, b) {
  return [a, b].sort().join(":");
}

export function findPairByMembers(a, b) {
  const key = pairMembersKey(a, b);
  return Object.values(db.lists || {}).find(l =>
    Array.isArray(l.members) && l.members.length === 2 && l.nicknames
    && pairMembersKey(l.members[0], l.members[1]) === key,
  ) || null;
}

export function pairsOf(userId) {
  return Object.values(db.lists || {}).filter(l =>
    Array.isArray(l.members) && l.members.includes(userId) && l.nicknames,
  );
}

function pendingInvitesTo(userId) {
  ensureListInvites();
  return Object.values(db.listInvites).filter(i => i.toId === userId && i.status === "pending");
}

function pendingInvitesFrom(userId) {
  ensureListInvites();
  return Object.values(db.listInvites).filter(i => i.fromId === userId && i.status === "pending");
}

function nicknameFor(viewer, pair, otherId) {
  return pair.nicknames?.[viewer.id]?.[otherId]
    || (viewer.contacts || []).find(c => c.userId === otherId)?.label
    || db.users[otherId]?.code
    || "—";
}

/** Реестр прозвищ для голоса и виджета: nickname ↔ pairId. */
export function nicknameRegistry(viewer) {
  return pairsOf(viewer.id).map(pair => {
    const otherId = pair.members.find(id => id !== viewer.id);
    const nickname = nicknameFor(viewer, pair, otherId);
    return {
      pairId: pair.id,
      nickname,
      otherId,
      otherCode: db.users[otherId]?.code || "",
      aliases: nickAliasForms(nickname),
    };
  });
}

export function resolveDefaultPairId(user) {
  const def = user.settings?.sharedListDefault;
  if (def && ownPair(user, def)) return def;
  const reg = nicknameRegistry(user);
  return reg.length === 1 ? reg[0].pairId : (reg[0]?.pairId || null);
}

/** Добавить строки в общий список на сегодня; возвращает { pair, duplicate, added }. */
export async function postItemsToPair(user, pairId, titles, dayKeyFromParts) {
  const pair = ownPair(user, pairId);
  if (!pair) return { error: "Список не найден", status: 404 };
  const tz = safeZone(user.settings?.tz);
  const dayKey = dayKeyFromParts(zonedParts(Date.now(), tz));
  const otherId = pair.members.find(id => id !== user.id);
  const added = [];
  let duplicate = false;

  for (const raw of titles) {
    const title = String(raw || "").trim().slice(0, 120);
    if (!title) continue;
    if ((pair.items || []).length >= PAIR_ITEMS_MAX) break;
    const twin = (pair.items || []).find(i =>
      i.dayKey === dayKey && normalizeTitle(i.title) === normalizeTitle(title) && !i.done,
    );
    if (twin) {
      duplicate = true;
      continue;
    }
    const item = {
      id: nextId("ls"),
      title,
      dayKey,
      done: false,
      addedBy: user.id,
      readBy: [user.id],
      at: Date.now(),
    };
    if (!pair.items) pair.items = [];
    pair.items.push(item);
    added.push(item);
  }

  if (!added.length && duplicate) {
    return { pair, duplicate: true, added: [] };
  }
  if (!added.length) {
    return { error: "Что добавить?", status: 400 };
  }

  pair.updatedAt = Date.now();
  save();
  for (const item of added) {
    await tellPair(pair, user, otherId, item.title);
  }
  return { pair, duplicate, added };
}

function sharedItemView(item, viewer, pair) {
  const otherId = pair.members.find(id => id !== viewer.id);
  const fromMe = item.addedBy === viewer.id;
  const readByOther = Array.isArray(item.readBy) && item.readBy.includes(otherId);
  return {
    id: item.id,
    title: item.title,
    done: Boolean(item.done),
    by: fromMe ? "вы" : nicknameFor(viewer, pair, item.addedBy),
    fromMe,
    read: fromMe ? readByOther : true,
    laterAt: item.laterAt || null,
    at: item.at,
  };
}

export function pairView(pair, viewer, dayKey, dayKeyFromParts) {
  const otherId = pair.members.find(id => id !== viewer.id);
  const tz = safeZone(viewer.settings?.tz);
  const todayKey = dayKey || dayKeyFromParts(zonedParts(Date.now(), tz));
  const items = (pair.items || [])
    .filter(i => i.dayKey === todayKey)
    .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || a.at - b.at)
    .map(i => sharedItemView(i, viewer, pair));
  return {
    id: pair.id,
    nickname: nicknameFor(viewer, pair, otherId),
    otherCode: db.users[otherId]?.code || "—",
    unread: pair.unread?.[viewer.id] || 0,
    items,
    dayKey: todayKey,
    updatedAt: pair.updatedAt,
    pending: false,
  };
}

function inviteView(invite) {
  const from = db.users[invite.fromId];
  return {
    id: invite.id,
    fromCode: from?.code || "—",
    fromNickname: invite.fromNickname || from?.code || "—",
    at: invite.at,
  };
}

function outgoingInviteView(invite) {
  const to = db.users[invite.toId];
  return {
    id: invite.id,
    toCode: to?.code || "—",
    nickname: invite.fromNickname || to?.code || "—",
    at: invite.at,
    pending: true,
  };
}

export function sharedListsPayload(viewer, dayKeyFromParts, opts = {}) {
  const tz = safeZone(viewer.settings?.tz);
  const dayKey = opts.dayKey || dayKeyFromParts(zonedParts(Date.now(), tz));
  const pairs = pairsOf(viewer.id).map(p => pairView(p, viewer, dayKey, dayKeyFromParts));
  const incoming = pendingInvitesTo(viewer.id).map(inviteView);
  const outgoing = pendingInvitesFrom(viewer.id).map(outgoingInviteView);
  const unreadTotal = pairs.reduce((s, p) => s + (p.unread || 0), 0) + incoming.length;
  return {
    pairs,
    lists: pairs,
    incoming,
    outgoing,
    unreadTotal,
    dayKey,
    widgetPeek: viewer.sharedWidgetPeek || null,
  };
}

function ownPair(user, id) {
  const pair = db.lists?.[id];
  if (!pair || !pair.members?.includes(user.id) || !pair.nicknames) return null;
  return pair;
}

async function tellPair(pair, actor, recipientId, text) {
  const recipient = db.users[recipientId];
  if (!recipient || isBlockedBy(recipient, actor.id, actor.code)) return;
  const nick = nicknameFor(recipient, pair, actor.id);
  if (!pair.unread) pair.unread = {};
  pair.unread[recipientId] = (pair.unread[recipientId] || 0) + 1;
  recipient.sharedWidgetPeek = {
    title: `Общие списки от ${nick}`,
    body: text,
    pairId: pair.id,
    at: Date.now(),
  };
  save();
  await sendTo(recipientId, {
    title: `Общие списки от ${nick}`,
    body: text,
    tag: `shared-${pair.id}`,
    url: `/?go=lists&pair=${pair.id}`,
  });
}

async function tellInvite(toId, from, nickname) {
  const recipient = db.users[toId];
  if (!recipient || isBlockedBy(recipient, from.id, from.code)) return;
  await sendTo(toId, {
    title: "Приглашение в общие списки",
    body: `${nickname} (${from.code}) хочет делиться списками`,
    tag: `list-invite-${from.id}`,
    url: "/?go=lists",
  });
}

function makePair(fromId, toId, nickFrom, nickTo) {
  const now = Date.now();
  const pair = {
    id: nextId("l"),
    members: [fromId, toId],
    nicknames: {
      [fromId]: { [toId]: nickFrom },
      [toId]: { [fromId]: nickTo },
    },
    items: [],
    unread: { [fromId]: 0, [toId]: 0 },
    createdAt: now,
    updatedAt: now,
  };
  db.lists[pair.id] = pair;
  return pair;
}

export function registerSharedListRoutes(route, dayKeyFromParts) {
  route("GET", /^\/api\/lists$/, async (ctx) => ({
    status: 200,
    body: sharedListsPayload(ctx.user, dayKeyFromParts),
  }));

  route("POST", /^\/api\/lists\/invite$/, async (ctx) => {
    const blocked = proListsBlocked(ctx.user);
    if (blocked) return blocked;
    const code = String(ctx.body?.code || "").trim().toUpperCase();
    const nickname = String(ctx.body?.nickname || "").trim().slice(0, 30);
    if (!nickname) return { status: 400, body: { error: "Как подписать этого человека?" } };
    const target = findUserByCode(code);
    if (!target) return { status: 404, body: { error: "Такой ID не найден" } };
    if (target.id === ctx.user.id) return { status: 400, body: { error: "Это ваш ID" } };
    if (pairsOf(ctx.user.id).length + pendingInvitesFrom(ctx.user.id).length >= PAIRS_PER_USER) {
      return { status: 400, body: { error: "Больше 20 человек не нужно" } };
    }
    if (findPairByMembers(ctx.user.id, target.id)) {
      return { status: 400, body: { error: "Вы уже делитесь списками" } };
    }
    ensureListInvites();
    const existing = Object.values(db.listInvites).find(i =>
      i.status === "pending" && (
        (i.fromId === ctx.user.id && i.toId === target.id)
        || (i.fromId === target.id && i.toId === ctx.user.id)
      ),
    );
    if (existing) {
      if (existing.fromId === ctx.user.id) existing.fromNickname = nickname;
      save();
      return { status: 200, body: sharedListsPayload(ctx.user, dayKeyFromParts) };
    }
    if (isBlockedBy(target, ctx.user.id, ctx.user.code)) {
      return { status: 200, body: sharedListsPayload(ctx.user, dayKeyFromParts) };
    }
    const invite = {
      id: nextId("li"),
      fromId: ctx.user.id,
      toId: target.id,
      fromNickname: nickname,
      status: "pending",
      at: Date.now(),
    };
    db.listInvites[invite.id] = invite;
    save();
    await tellInvite(target.id, ctx.user, nickname);
    return { status: 200, body: sharedListsPayload(ctx.user, dayKeyFromParts) };
  });

  route("POST", /^\/api\/lists\/invites\/([\w-]+)\/accept$/, async (ctx) => {
    const blocked = proListsBlocked(ctx.user);
    if (blocked) return blocked;
    ensureListInvites();
    const invite = db.listInvites[ctx.params[0]];
    if (!invite || invite.status !== "pending") return { status: 404, body: { error: "Приглашение не найдено" } };
    if (invite.toId !== ctx.user.id) return { status: 403, body: { error: "Это не ваше приглашение" } };
    const nickname = String(ctx.body?.nickname || "").trim().slice(0, 30);
    if (!nickname) return { status: 400, body: { error: "Как подписать пригласившего?" } };
    const from = db.users[invite.fromId];
    if (!from) return { status: 404, body: { error: "Пригласивший не найден" } };
    let pair = findPairByMembers(invite.fromId, invite.toId);
    if (!pair) pair = makePair(invite.fromId, invite.toId, invite.fromNickname, nickname);
    invite.status = "accepted";
    save();
    await tellPair(pair, ctx.user, invite.fromId, `${nickname} принял приглашение`);
    return {
      status: 200,
      body: { ...sharedListsPayload(ctx.user, dayKeyFromParts), pair: pairView(pair, ctx.user, null, dayKeyFromParts) },
    };
  });

  route("POST", /^\/api\/lists\/invites\/([\w-]+)\/decline$/, async (ctx) => {
    ensureListInvites();
    const invite = db.listInvites[ctx.params[0]];
    if (!invite || invite.status !== "pending") return { status: 404, body: { error: "Приглашение не найдено" } };
    if (invite.toId !== ctx.user.id) return { status: 403, body: { error: "Это не ваше приглашение" } };
    invite.status = "declined";

    // Отказ с блокировкой: иначе человек отказывается, а приглашения
    // приходят снова и снова — отказаться от навязчивого было нельзя.
    if (ctx.body?.block) {
      const from = db.users[invite.fromId];
      // Формат тот же, что у блокировки из карточки записи: userId и code.
      const list = Array.isArray(ctx.user.blocked) ? ctx.user.blocked : [];
      if (!isBlockedBy(ctx.user, invite.fromId, from?.code) && list.length < 200) {
        list.push({ userId: invite.fromId, code: from?.code || "", at: Date.now() });
        ctx.user.blocked = list;
      }
    }

    save();
    return { status: 200, body: sharedListsPayload(ctx.user, dayKeyFromParts) };
  });

  route("POST", /^\/api\/lists\/([\w-]+)\/read$/, async (ctx) => {
    const pair = ownPair(ctx.user, ctx.params[0]);
    if (!pair) return { status: 404, body: { error: "Список не найден" } };
    for (const item of pair.items || []) {
      if (!item.readBy) item.readBy = [];
      if (!item.readBy.includes(ctx.user.id)) item.readBy.push(ctx.user.id);
    }
    if (!pair.unread) pair.unread = {};
    pair.unread[ctx.user.id] = 0;
    ctx.user.sharedWidgetPeek = null;
    pair.updatedAt = Date.now();
    save();
    return {
      status: 200,
      body: { pair: pairView(pair, ctx.user, null, dayKeyFromParts), ...sharedListsPayload(ctx.user, dayKeyFromParts) },
    };
  });

  route("POST", /^\/api\/lists\/([\w-]+)\/items$/, async (ctx) => {
    const blocked = proListsBlocked(ctx.user);
    if (blocked) return blocked;
    const pair = ownPair(ctx.user, ctx.params[0]);
    if (!pair) return { status: 404, body: { error: "Список не найден" } };
    const title = String(ctx.body?.title || "").trim().slice(0, 120);
    if (!title) return { status: 400, body: { error: "Что добавить?" } };
    const tz = safeZone(ctx.user.settings?.tz);
    const dayKey = String(ctx.body?.dayKey || "").trim() || dayKeyFromParts(zonedParts(Date.now(), tz));
    if ((pair.items || []).length >= PAIR_ITEMS_MAX) {
      return { status: 400, body: { error: "Слишком много строк" } };
    }
    const twin = (pair.items || []).find(i =>
      i.dayKey === dayKey && normalizeTitle(i.title) === normalizeTitle(title) && !i.done,
    );
    if (twin) {
      return {
        status: 200,
        body: { pair: pairView(pair, ctx.user, dayKey, dayKeyFromParts), duplicate: true, ...sharedListsPayload(ctx.user, dayKeyFromParts) },
      };
    }

    const otherId = pair.members.find(id => id !== ctx.user.id);
    const item = {
      id: nextId("ls"),
      title,
      dayKey,
      done: false,
      addedBy: ctx.user.id,
      readBy: [ctx.user.id],
      at: Date.now(),
    };
    if (!pair.items) pair.items = [];
    pair.items.push(item);
    pair.updatedAt = Date.now();
    save();
    await tellPair(pair, ctx.user, otherId, title);
    return {
      status: 200,
      body: { pair: pairView(pair, ctx.user, dayKey, dayKeyFromParts), ...sharedListsPayload(ctx.user, dayKeyFromParts) },
    };
  });

  route("POST", /^\/api\/lists\/([\w-]+)\/items\/([\w-]+)\/done$/, async (ctx) => {
    const blocked = proListsBlocked(ctx.user);
    if (blocked) return blocked;
    const pair = ownPair(ctx.user, ctx.params[0]);
    if (!pair) return { status: 404, body: { error: "Список не найден" } };
    const entry = (pair.items || []).find(i => i.id === ctx.params[1]);
    if (!entry) return { status: 404, body: { error: "Строка не найдена" } };
    entry.done = ctx.body?.done !== false;
    entry.doneBy = entry.done ? ctx.user.id : null;
    if (!entry.readBy) entry.readBy = [];
    if (!entry.readBy.includes(ctx.user.id)) entry.readBy.push(ctx.user.id);
    pair.updatedAt = Date.now();
    save();
    if (entry.done && entry.addedBy !== ctx.user.id) {
      await tellPair(pair, ctx.user, entry.addedBy, `сделал: ${entry.title}`);
    }
    return {
      status: 200,
      body: { pair: pairView(pair, ctx.user, null, dayKeyFromParts), ...sharedListsPayload(ctx.user, dayKeyFromParts) },
    };
  });

  route("POST", /^\/api\/lists\/([\w-]+)\/items\/([\w-]+)\/later$/, async (ctx) => {
    const blocked = proListsBlocked(ctx.user);
    if (blocked) return blocked;
    const pair = ownPair(ctx.user, ctx.params[0]);
    if (!pair) return { status: 404, body: { error: "Список не найден" } };
    const entry = (pair.items || []).find(i => i.id === ctx.params[1]);
    if (!entry) return { status: 404, body: { error: "Строка не найдена" } };
    const tz = safeZone(ctx.user.settings?.tz);
    const hour = Number(ctx.body?.hour);
    const minute = Number(ctx.body?.minute);
    let laterAt = Number(ctx.body?.at);
    if (!Number.isFinite(laterAt)) {
      // Без часа считать нечего: zonedToUtc с NaN роняет запрос пятисотой,
      // и человек видит «внутреннюю ошибку» вместо понятного ответа.
      if (!Number.isFinite(hour)) {
        return { status: 400, body: { error: "Во сколько напомнить?" } };
      }
      const now = zonedParts(Date.now(), tz);
      laterAt = zonedToUtc({ year: now.year, month: now.month, day: now.day, hour, minute: minute || 0 }, tz);
    }
    if (!Number.isFinite(laterAt) || laterAt <= Date.now()) {
      return { status: 400, body: { error: "Выберите время в будущем" } };
    }
    entry.laterAt = laterAt;
    entry.laterReminded = false;
    pair.updatedAt = Date.now();
    save();
    return {
      status: 200,
      body: { pair: pairView(pair, ctx.user, null, dayKeyFromParts), ...sharedListsPayload(ctx.user, dayKeyFromParts) },
    };
  });

  route("DELETE", /^\/api\/lists\/([\w-]+)\/items\/([\w-]+)$/, async (ctx) => {
    const blocked = proListsBlocked(ctx.user);
    if (blocked) return blocked;
    const pair = ownPair(ctx.user, ctx.params[0]);
    if (!pair) return { status: 404, body: { error: "Список не найден" } };
    pair.items = (pair.items || []).filter(i => i.id !== ctx.params[1]);
    pair.updatedAt = Date.now();
    save();
    return {
      status: 200,
      body: { pair: pairView(pair, ctx.user, null, dayKeyFromParts), ...sharedListsPayload(ctx.user, dayKeyFromParts) },
    };
  });

  route("POST", /^\/api\/lists\/([\w-]+)\/leave$/, async (ctx) => {
    // Уйти из списка можно без подписки: запирать человека нельзя.

    const pair = ownPair(ctx.user, ctx.params[0]);
    if (!pair) return { status: 404, body: { error: "Список не найден" } };
    delete db.lists[pair.id];
    save();
    return { status: 200, body: sharedListsPayload(ctx.user, dayKeyFromParts) };
  });
}

/** Напоминания «Позже» по общим спискам — вызывается из tick сервера. */
export async function tickSharedLaterReminders(now) {
  let dirty = false;
  for (const pair of Object.values(db.lists || {})) {
    if (!pair.nicknames || !Array.isArray(pair.items)) continue;
    for (const item of pair.items) {
      if (!item.laterAt || item.laterReminded || item.done) continue;
      if (item.laterAt > now) continue;
      item.laterReminded = true;
      dirty = true;
      const ownerId = item.addedBy;
      const actor = db.users[pair.members.find(id => id !== ownerId) || ownerId];
      if (actor && ownerId) {
        await tellPair(pair, actor, ownerId, `напоминание: ${item.title}`);
      }
    }
  }
  if (dirty) save();
}

export function purgeSharedForUser(userId) {
  for (const [id, pair] of Object.entries(db.lists || {})) {
    if (!pair.members?.includes(userId)) continue;
    delete db.lists[id];
  }
  ensureListInvites();
  for (const [id, invite] of Object.entries(db.listInvites)) {
    if (invite.fromId === userId || invite.toId === userId) delete db.listInvites[id];
  }
}
