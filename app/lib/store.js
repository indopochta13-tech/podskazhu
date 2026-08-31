import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_ALARM_SOUND, DEFAULT_NOTIFY_SOUND, alarmSoundId, notifySoundId } from "../public/sounds-catalog.js";

const DATA_DIR = process.env.VC_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "db.json");

export function dataDir() {
  return DATA_DIR;
}

const EMPTY = () => ({
  users: {},
  items: {},
  subs: {},
  tokens: {},
  rooms: {},
  // Жалобы на присланные записи: их обязана видеть модерация,
  // поэтому они живут отдельно от пользователей и переживают удаление записи.
  reports: {},
  // Переписка с поддержкой: ветка на человека, ключ — его id.
  support: {},
  // Какое сообщение в телеграм-боте к кому относится: по нему ответ оператора находит адресата.
  supportTg: {},
  // Запросы оценки идей: сообщение → userId.
  ideaQuotesTg: {},
  // Проекты мастерской идей по userId.
  ideas: {},
  tgOffset: 0,
  // Общие списки: парный режим — два человека, заметки по дням, прозвища.
  lists: {},
  // Ожидающие приглашения в общие списки: fromId → toId + прозвище.
  listInvites: {},
  // Ожидающие оплаты Prodamus: paymentId → userId, productId, сумма.
  billingPending: {},
  // Семейные подписки: subId → payer, beneficiaries, срок.
  familySubs: {},
  vapid: null,
  seq: 1,
});

export const db = EMPTY();

let saveTimer = null;
let saving = false;
let pendingSave = false;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    Object.assign(db, EMPTY(), parsed);
    migrateSounds();
    migrateSupport();
    migrateRoutineRemindAtEvent();
  } catch (err) {
    const backup = `${FILE}.broken-${Date.now()}`;
    fs.copyFileSync(FILE, backup);
    console.error(`[store] не смог прочитать базу, копия в ${backup}:`, err.message);
    // Раньше сервис поднимался с пустой базой и первым же save() затирал оригинал.
    // Лучше не стартовать: файл на месте, человек чинит его руками.
    console.error("[store] запуск отменён, чтобы не потерять данные. Проверьте", FILE);
    process.exit(1);
  }
}

/**
 * Срок жизни токена. Без него db.tokens растёт бесконечно, а сессия не заканчивается никогда.
 * Год — чтобы человек, открывающий приложение раз в месяц, не терял доступ.
 */
const TOKEN_TTL_MS = Math.max(1, Number(process.env.VC_TOKEN_TTL_DAYS || 365)) * 86400000;

export function pruneTokens(now = Date.now()) {
  let changed = false;
  for (const [token, rec] of Object.entries(db.tokens || {})) {
    if (now - (rec?.createdAt || 0) > TOKEN_TTL_MS) {
      delete db.tokens[token];
      changed = true;
    }
  }
  return changed;
}

/** Витамины / уход: пуш должен совпадать с временем на полке (старый сид ставил remind=60). */
function migrateRoutineRemindAtEvent() {
  let changed = false;
  for (const item of Object.values(db.items || {})) {
    if (!item || item.deleted) continue;
    const shelf = item.shelf || item.type;
    const routine = shelf === "health" || shelf === "care"
      || item.type === "health" || item.type === "care";
    if (!routine) continue;
    if (Number(item.remind) !== 0) {
      item.remind = 0;
      item.updatedAt = Date.now();
      changed = true;
    }
  }
  for (const user of Object.values(db.users || {})) {
    const prefs = user?.settings?.shelfPrefs;
    if (!prefs || typeof prefs !== "object") continue;
    for (const id of ["health", "care"]) {
      const raw = prefs[id];
      if (!raw || typeof raw !== "object") continue;
      if (Number(raw.remind) !== 0) {
        raw.remind = 0;
        changed = true;
      }
    }
  }
  if (changed) save();
}

// Набор звуков заменён целиком: старый выбор переводим на ближайший новый один раз при старте,
// иначе человек увидит в настройках пустую строку и звук по умолчанию.
function migrateSounds() {
  let changed = false;
  for (const user of Object.values(db.users || {})) {
    const s = user.settings;
    if (!s) continue;
    const alarm = alarmSoundId(s.alarmSound);
    const notify = notifySoundId(s.notifySound);
    if (alarm !== s.alarmSound || notify !== s.notifySound) {
      s.alarmSound = alarm;
      s.notifySound = notify;
      changed = true;
    }
  }
  if (changed) save();
}

// Раньше поддержка была списком одиночных обращений, теперь это переписка на человека.
// Старые обращения переносим в ветки, чтобы ничего не потерялось и разговор читался целиком.
function migrateSupport() {
  const old = Object.entries(db.support || {}).filter(([, v]) => v && !Array.isArray(v.messages));
  if (!old.length) return;
  for (const [key, ticket] of old) {
    delete db.support[key];
    const userId = ticket.userId;
    if (!userId || !db.users?.[userId]) continue;
    const thread = db.support[userId] || {
      userId,
      code: ticket.userCode || db.users[userId].code,
      at: ticket.at || Date.now(),
      updatedAt: ticket.at || Date.now(),
      unread: 0,
      platform: ticket.platform || "",
      appVersion: ticket.appVersion || "",
      messages: [],
    };
    thread.messages.push({ id: key, at: ticket.at || Date.now(), from: "user", text: ticket.text || "", delivered: true, tries: 1 });
    thread.messages.sort((a, b) => a.at - b.at);
    thread.updatedAt = Math.max(thread.updatedAt, ticket.at || 0);
    db.support[userId] = thread;
  }
  save();
}

function writeNow() {
  saving = true;
  pendingSave = false;
  try {
    const tmp = `${FILE}.tmp`;
    // Без fsync переименование может оказаться на диске раньше самих данных:
    // после внезапного выключения на месте базы остаётся пустой файл.
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, JSON.stringify(db), "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error("[store] ошибка записи:", err.message);
  } finally {
    saving = false;
    // Пока писали — пришли новые изменения: догоняем, иначе тихий пропуск.
    if (pendingSave) save();
  }
}

export function save() {
  if (saving) {
    pendingSave = true;
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (saving) pendingSave = true;
    else writeNow();
  }, 250);
}

export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saving) {
    pendingSave = true;
    return;
  }
  writeNow();
}

export function nextId(prefix) {
  db.seq = (db.seq || 1) + 1;
  return `${prefix}${db.seq.toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

const CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXYZ2346789";

/**
 * Случайные символы алфавита без перекоса: 256 не делится на 29,
 * поэтому при простом `байт % 29` первые буквы выпадали бы чаще остальных.
 */
function randomChars(count) {
  const out = [];
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  while (out.length < count) {
    for (const b of crypto.randomBytes(count * 2)) {
      if (b >= limit) continue;
      out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
      if (out.length === count) break;
    }
  }
  return out;
}

export function makeCode() {
  let code;
  do {
    code = randomChars(6).join("");
  } while (findUserByCode(code));
  return code;
}

// Ключ переноса — единственный способ забрать записи на другой телефон.
// Показывается только владельцу, по нему же и восстанавливается доступ.
export function makeTransferKey() {
  let key;
  do {
    const chars = randomChars(20);
    key = [0, 5, 10, 15].map(i => chars.slice(i, i + 5).join("")).join("-");
  } while (findUserByTransferKey(key));
  return key;
}

export function normalizeTransferKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function findUserByTransferKey(key) {
  const wanted = normalizeTransferKey(key);
  if (wanted.length !== 20) return null;
  return Object.values(db.users).find(u => normalizeTransferKey(u.transferKey) === wanted) || null;
}

// Аккаунт создаётся сам при первом открытии: ни имени, ни почты, ни телефона.
export function createUser(tz) {
  const user = {
    id: nextId("u"),
    code: makeCode(),
    transferKey: makeTransferKey(),
    settings: defaultSettings(tz),
    groups: [],
    contacts: [],
    // Кого этот человек заблокировал: от них не приходят ни записи, ни подключения.
    blocked: [],
    createdAt: Date.now(),
  };
  db.users[user.id] = user;
  return user;
}

// Комната «рядом»: шесть цифр, которые живут считаные минуты.
// Цифры, а не буквы — их проще продиктовать вслух и набрать одной рукой.
export function makeRoomCode() {
  let code;
  do {
    code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  } while (findRoom(code));
  return code;
}

export function findRoom(code) {
  const wanted = String(code || "").trim();
  if (!/^\d{6}$/.test(wanted)) return null;
  return Object.values(db.rooms || {}).find(r => r.code === wanted) || null;
}

export function findUserByCode(code) {
  const wanted = String(code || "").trim().toUpperCase();
  if (!wanted) return null;
  return Object.values(db.users).find(u => u.code === wanted) || null;
}

// Код общего списка: шесть цифр, как у комнаты «рядом» — проще продиктовать и набрать.
export function makeListCode() {
  let code;
  do {
    code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  } while (findListByCode(code));
  return code;
}

export function findListByCode(code) {
  const wanted = String(code || "").trim();
  if (!/^\d{6}$/.test(wanted)) return null;
  return Object.values(db.lists || {}).find(l => l.code === wanted) || null;
}

export function ensureListCode(list) {
  if (list.code && /^\d{6}$/.test(list.code)) return list.code;
  list.code = makeListCode();
  save();
  return list.code;
}

export function issueToken(userId) {
  const token = crypto.randomBytes(24).toString("base64url");
  db.tokens[token] = { userId, createdAt: Date.now() };
  save();
  return token;
}

export function userByToken(token) {
  const rec = token && Object.prototype.hasOwnProperty.call(db.tokens, token) ? db.tokens[token] : null;
  if (!rec || typeof rec !== "object") return null;
  if (Date.now() - (rec.createdAt || 0) > TOKEN_TTL_MS) {
    delete db.tokens[token];
    save();
    return null;
  }
  return db.users[rec.userId] || null;
}

export function itemsOf(userId) {
  return Object.values(db.items).filter(i => i.ownerId === userId && !i.deleted);
}

export function defaultSettings(tz) {
  return {
    tz: tz || "Europe/Moscow",
    // Голос помощника: «she» | «he». Выбор при первом входе, меняется в настройках.
    voice: "he",
    remindMeeting: 15,
    remindTask: 0,
    remindBirthday: 1440,
    alarmMeetings: true,
    eveningReview: false,
    eveningHour: 20,
    // Утренний брифинг: один пуш с планом дня.
    morningBrief: false,
    morningHour: 8,
    quietFrom: 23,
    quietTo: 7,
    // Выбранные звуки: id из public/sounds-catalog.js.
    alarmSound: DEFAULT_ALARM_SOUND,
    notifySound: DEFAULT_NOTIFY_SOUND,
    keepAudio: false,
    widgetShortcut: "",
    // Конструктор виджета: левая/правая кнопки (полки и общие списки).
    widgetConfig: { tabs: ["today"], leftBtn: "shared", rightBtn: "none" },
    // Какие встроенные полки скрыты. «Сегодня» всегда на месте.
    hiddenShelves: ["care", "sport", "health", "bills", "meters"],
    // Порядок закладок (без «Сегодня»): влияет на вкладки и список в настройках.
    shelfOrder: [],
    // Свои полки: название и слова, по которым сюда попадает голос.
    customShelves: [],
    // Настройки каждой закладки: напоминание, пуш, будильник, отложить.
    shelfPrefs: {},
    // Согласие на обработку данных: редакция и когда приняли.
    consent: { version: "", at: 0 },
    // Базовый протокол косметики (утро/вечер) уже засеян.
    careRoutineV1: false,
    careRoutineV2: false,
    // План витаминов уже засеян.
    healthRoutineV1: false,
    healthRoutineV2: false,
    healthRoutineV3: false,
    // Выключенные дни в «Витамины»: свёрнуты в списке, без пушей в этот день.
    healthDaysOff: [],
  };
}

/** Заблокирован ли отправитель — проверяем и по внутреннему id, и по видимому коду. */
export function isBlockedBy(owner, senderId, senderCode) {
  const list = Array.isArray(owner?.blocked) ? owner.blocked : [];
  if (!list.length) return false;
  const code = String(senderCode || "").toUpperCase();
  return list.some(b => b.userId === senderId || (code && String(b.code || "").toUpperCase() === code));
}

/** Настройки закладки с запасными значениями из старых глобальных полей. */
export function shelfPrefsFor(shelfId, settings = {}) {
  const stored = settings.shelfPrefs?.[shelfId];
  if (stored && typeof stored === "object") {
    return normalizeShelfPref(stored, shelfId, settings);
  }
  return defaultShelfPref(shelfId, settings);
}

function defaultShelfPref(shelfId, settings = {}) {
  if (shelfId === "meetings") {
    return {
      remind: Number.isFinite(settings.remindMeeting) ? settings.remindMeeting : 15,
      push: true,
      alarm: settings.alarmMeetings !== false,
      snooze: 1,
    };
  }
  if (shelfId === "tasks") {
    return {
      remind: Number.isFinite(settings.remindTask) ? settings.remindTask : 0,
      push: true,
      alarm: false,
      snooze: 1,
    };
  }
  if (shelfId === "bday") {
    return {
      remind: Number.isFinite(settings.remindBirthday) ? settings.remindBirthday : 1440,
      push: true,
      alarm: false,
      snooze: 1,
    };
  }
  if (shelfId === "alarms") {
    return { remind: 0, push: false, alarm: true, snooze: 1 };
  }
  // Платёж напоминает за сутки: за минуту до срока платить уже поздно.
  if (shelfId === "bills") {
    return { remind: 1440, push: true, alarm: false, snooze: 60 };
  }
  // Лекарство — ровно в час приёма, без запаса.
  if (shelfId === "health") {
    return { remind: 0, push: true, alarm: false, snooze: 15 };
  }
  if (shelfId === "care" || shelfId === "sport") {
    return { remind: 0, push: true, alarm: false, snooze: 1 };
  }
  return { remind: 0, push: true, alarm: false, snooze: 1 };
}

function normalizeShelfPref(raw, shelfId, settings) {
  const base = defaultShelfPref(shelfId, settings);
  const remind = Number.isFinite(raw.remind) ? Math.max(0, Math.min(Number(raw.remind), 7 * 1440)) : base.remind;
  const snooze = Number.isFinite(raw.snooze) ? Math.max(1, Math.min(Number(raw.snooze), 180)) : base.snooze;
  return {
    remind,
    push: typeof raw.push === "boolean" ? raw.push : base.push,
    alarm: typeof raw.alarm === "boolean" ? raw.alarm : base.alarm,
    snooze,
  };
}

export function normalizeShelfPrefs(map, settings = {}) {
  if (!map || typeof map !== "object") return {};
  const out = {};
  for (const [id, raw] of Object.entries(map)) {
    const key = String(id || "").trim().slice(0, 32);
    if (!key || !raw || typeof raw !== "object") continue;
    out[key] = normalizeShelfPref(raw, key, settings);
  }
  return out;
}
