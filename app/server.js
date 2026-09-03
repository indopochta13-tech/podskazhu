import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { db, load, save, flush, nextId, createUser, findUserByCode, findUserByTransferKey, issueToken, userByToken, pruneTokens, itemsOf, defaultSettings, shelfPrefsFor, normalizeShelfPrefs, isBlockedBy } from "./lib/store.js";
import { parse, shelfFor, scoreMatch, normalizeTitle, matchCustomShelf, courseHours, resolveCaptureTarget, BUILTIN_SHELF_IDS, TAB_ONLY_SHELF_IDS, SHELF_PROFILES } from "./lib/parse.js";
import { refineWithAlice } from "./lib/alice-nlu.js";
import {
  isUndoPhrase,
  isYesPhrase,
  isNoPhrase,
  rememberDialog,
  clearPendingConfirm,
  getPendingConfirm,
  getLastItemIds,
  getLastSlots,
  undoLastAction,
  snapshotItem,
  looksLikeEllipsis,
  ellipsisPatch,
} from "./lib/dialog.js";
import { safeZone, zonedParts, itemUtc, remindUtc, addDays, addMonths, weekdayOf, compareDates, zonedToUtc } from "./lib/time.js";
import { initPush, publicKey, addSubscription, removeSubscription, sendTo } from "./lib/push.js";
import { initFcm, addFcmToken, removeFcmToken, sendFcmTo, fcmReady } from "./lib/fcm.js";
import { templateById, templateDrafts, templatesPublic } from "./lib/templates.js";
import { CARE_ROUTINE, CARE_ROUTINE_SOURCE, careDefaultTime } from "./lib/care-routine.js";
import {
  HEALTH_ROUTINE,
  HEALTH_ROUTINE_SOURCE,
  healthDefaultTime,
  healthItemTitle,
  healthSummaryTitle,
} from "./lib/health-routine.js";
import { registerSharedListRoutes, sharedListsPayload, tickSharedLaterReminders, purgeSharedForUser, nicknameRegistry, postItemsToPair, resolveDefaultPairId, pairView, pairsOf } from "./lib/shared-lists.js";
import { parseSharedList, taskFromWidgetSpeech } from "./lib/shared-list-parse.js";
import { isHeavy } from "./public/voice.js";
import {
  billingState,
  billingTestMode,
  cancelFamilySubscription,
  createFamilyPendingPayment,
  createPendingPayment,
  familyPriceBreakdown,
  familyTotalPrice,
  grantProdamusPaid,
  planFor,
  restorePurchasesForUser,
  validateBillingUserCode,
  verifyProdamusLocal,
  isPro,
} from "./lib/billing.js";
import { itemOnProShelf } from "./lib/pro-shelves.js";
import { clearProShelfData, stripFreeUserRoutineSeed } from "./lib/pro-cleanup.js";
import * as pdm from "./lib/prodamus.js";
import { alarmSoundId, notifySoundId } from "./public/sounds-catalog.js";
import { addUserMessage, markDelivered, markRead, pruneSupport, supportSummary, threadView } from "./lib/support.js";
import { flushQueue, sendTicket, startTelegram, stopTelegram, telegramReady } from "./lib/telegram.js";
import { validatePortfolioContact, savePortfolioLead } from "./lib/portfolio-contact.js";
import { say, note, count } from "./public/voice.js";

const PORT = Number(process.env.VC_PORT || 8790);
const HOST = process.env.VC_HOST || "127.0.0.1";
const ROOT = path.dirname(url.fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_BODY = 4 * 1024 * 1024;

// Редакция правил и согласия. Меняем дату — приложение снова спросит согласие.
// Дата редакции согласия. Меняется вместе с текстом: те, кто согласился
// на прежнюю редакцию, увидят новую и подтвердят заново.
export const CONSENT_VERSION = "2026-08-31";
// Жалобы и обращения храним ограниченный срок: дольше они модерации не нужны.
const MODERATION_KEEP_MS = 180 * 86400000;
// Удалённые записи держим месяц: этого хватает, чтобы вернуть стёртое сгоряча.
// Без срока помеченные «удалёнными» копились в базе вечно — человек нажимал
// «очистить архив», читал «Удалила 12», а записи оставались на диске навсегда.
const DELETED_KEEP_MS = 30 * 86400000;
const BLOCKED_MAX = 200;
// Потолки на человека: вся база живёт в памяти, и один аккаунт не должен её раздувать.
const ITEMS_PER_USER = Number(process.env.VC_ITEMS_PER_USER || 5000);
const REPORT_REASONS = new Set(["offense", "threat", "spam", "private", "illegal", "other"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".apk": "application/vnd.android.package-archive",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

load();
initPush();
initFcm();

const attempts = new Map();
// Нагрузочный прогон «пятьдесят человек» приходит с одного адреса: там счётчик мешает, а не защищает.
const RATE_OFF = process.env.VC_RATE_OFF === "1";

function rateLimited(key, limit = 12, windowMs = 10 * 60000) {
  if (RATE_OFF) return false;
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, reset: now + windowMs };
  if (now > rec.reset) {
    rec.count = 0;
    rec.reset = now + windowMs;
  }
  rec.count += 1;
  attempts.set(key, rec);
  return rec.count > limit;
}

function pruneRateLimits(now = Date.now()) {
  for (const [key, rec] of attempts) {
    if (now > rec.reset) attempts.delete(key);
  }
}

// Проверка без начисления: нужна там, где считаем только неудачные попытки.
function overLimit(key, limit) {
  const rec = attempts.get(key);
  if (!rec || Date.now() > rec.reset) return false;
  return rec.count >= limit;
}

function send(res, status, payload, extraHeaders = {}) {
  const body = payload == null ? "" : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(body);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)));
    req.on("error", reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  // Битый percent-encoding («/%») роняет decodeURIComponent. Без этого try процесс умирает целиком.
  try {
    rel = decodeURIComponent(rel);
  } catch {
    send(res, 400, { error: "bad path" });
    return;
  }
  // NUL в пути обрывает строку на уровне системного вызова — до fs он доходить не должен.
  if (rel.includes("\0")) {
    send(res, 400, { error: "bad path" });
    return;
  }
  if (rel.endsWith("/")) rel += "index.html";

  const deliver = (filePath, stat) => {
    const ext = path.extname(filePath).toLowerCase();
    const isVolatile = /(?:index\.html|app-version\.json|sw\.js|webmanifest|app\.js)$/.test(filePath);
    const contentType = MIME[ext] || "application/octet-stream";
    const cacheControl = isVolatile ? "no-cache" : "public, max-age=3600";
    const size = stat.size;
    const extra = ext === ".js" && /sw\.js$/.test(filePath) ? { "Service-Worker-Allowed": "/" } : {};

    // APK и крупные файлы — потоком, с Range/206: без этого Chrome на Android рвёт докачку.
    if (ext === ".apk" || size > 512 * 1024) {
      const baseHeaders = {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "Accept-Ranges": "bytes",
        ...extra,
      };
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(range));
        if (m) {
          let start = m[1] !== "" ? parseInt(m[1], 10) : 0;
          let end = m[2] !== "" ? parseInt(m[2], 10) : size - 1;
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
            res.writeHead(416, { "Content-Range": `bytes */${size}` });
            res.end();
            return;
          }
          end = Math.min(end, size - 1);
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            ...baseHeaders,
            "Content-Length": chunkSize,
            "Content-Range": `bytes ${start}-${end}/${size}`,
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
          return;
        }
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { ...baseHeaders, "Content-Length": size });
        res.end();
        return;
      }
      res.writeHead(200, { ...baseHeaders, "Content-Length": size });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    fs.readFile(filePath, (err2, buf) => {
      if (err2) return send(res, 500, { error: "read" });
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": buf.length,
        "Cache-Control": cacheControl,
        ...extra,
      });
      res.end(buf);
    });
  };

  const spaFallback = () => {
    fs.readFile(path.join(PUBLIC_DIR, "index.html"), (err2, buf) => {
      if (err2) return send(res, 404, { error: "not found" });
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
      res.end(buf);
    });
  };

  const target = path.join(PUBLIC_DIR, rel);
  // Сравнение с разделителем: иначе соседняя папка «public-old» проходит проверку.
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  fs.stat(target, (err, stat) => {
    if (!err && stat.isDirectory()) {
      const indexPath = path.join(target, "index.html");
      fs.stat(indexPath, (err2, indexStat) => {
        if (err2 || !indexStat.isFile()) return spaFallback();
        deliver(indexPath, indexStat);
      });
      return;
    }
    if (!err && stat.isFile()) {
      deliver(target, stat);
      return;
    }
    if (!path.extname(rel)) {
      const dirIndex = path.join(PUBLIC_DIR, rel, "index.html");
      fs.stat(dirIndex, (err2, stat2) => {
        if (!err2 && stat2.isFile()) deliver(dirIndex, stat2);
        else spaFallback();
      });
      return;
    }
    spaFallback();
  });
}

/**
 * Адрес клиента. Caddy дописывает настоящий IP в конец X-Forwarded-For,
 * поэтому берём последний элемент: первый прислал бы сам клиент и обошёл бы все лимиты.
 * Если прокси перед сервисом нет, ставьте VC_TRUST_PROXY=0.
 */
const TRUST_PROXY = process.env.VC_TRUST_PROXY !== "0";

function clientIp(req) {
  if (TRUST_PROXY) {
    const chain = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return req.socket.remoteAddress || "?";
}

function publicUser(user) {
  return {
    id: user.id,
    code: user.code,
    transferKey: user.transferKey,
    settings: user.settings,
  };
}

function normalizeDate(value) {
  if (!value) return null;
  const year = Number(value.year);
  const month = Number(value.month);
  const day = Number(value.day);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { year, month, day };
}

function normalizeTime(value) {
  if (!value) return null;
  const hour = Number(value.hour);
  const minute = Number(value.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const out = { hour, minute };
  // Таймеры «через N минут» хранят секунды — иначе пуш встаёт на границу минуты.
  const second = Number(value.second);
  if (Number.isInteger(second) && second >= 0 && second <= 59) out.second = second;
  return out;
}

const REPEAT_KINDS = ["daily", "weekdays", "weekends", "weekly", "monthly"];

function normalizeRepeat(value) {
  if (!value || !REPEAT_KINDS.includes(value.kind)) return null;
  const repeat = { kind: value.kind };
  // «каждые две недели» — шаг больше одного.
  const every = Number(value.every);
  if (Number.isFinite(every) && every > 1) repeat.every = Math.min(Math.round(every), 12);
  // «по вторникам и четвергам» — несколько дней недели в одном повторе.
  if (value.kind === "weekly" && Array.isArray(value.days)) {
    const days = [...new Set(value.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (days.length >= 1) {
      repeat.days = days;
      delete repeat.every;
    }
  }
  return repeat;
}

function stepRepeat(date, repeat) {
  const every = Number.isFinite(repeat.every) && repeat.every > 1 ? repeat.every : 1;
  if (repeat.kind === "weekly" && repeat.days?.length) {
    // Ближайший следующий день из списка: «по вторникам и четвергам» идёт вт → чт → вт.
    let next = addDays(date, 1);
    while (!repeat.days.includes(weekdayOf(next))) next = addDays(next, 1);
    return next;
  }
  if (repeat.kind === "weekly") return addDays(date, 7 * every);
  if (repeat.kind === "monthly") return addMonths(date, every);
  if (repeat.kind === "daily") return addDays(date, every);
  let next = addDays(date, 1);
  if (repeat.kind === "weekdays") {
    while (weekdayOf(next) === 0 || weekdayOf(next) === 6) next = addDays(next, 1);
  }
  if (repeat.kind === "weekends") {
    while (weekdayOf(next) !== 0 && weekdayOf(next) !== 6) next = addDays(next, 1);
  }
  return next;
}

function isTimerItem(item) {
  if (!item) return false;
  if (item.timer) return true;
  // Старые записи без флага: «Таймер на 1 час» и одноразовый сигнал в момент.
  return Boolean(
    item.alarm
    && !item.repeat
    && !item.yearly
    && item.time
    && /^таймер\b/i.test(String(item.title || ""))
  );
}

// Сдвигает повторяющуюся запись на следующий раз в будущем.
// У курса лечения есть последний день: дальше него запись не уезжает, а закрывается.
function advanceRepeat(item, tz) {
  if (!item.repeat || !item.date) return false;
  const now = zonedParts(Date.now(), tz);
  let date = item.date;
  for (let guard = 0; guard < 500; guard += 1) {
    date = stepRepeat(date, item.repeat);
    const diff = compareDates(date, now);
    if (diff > 0) break;
    if (diff === 0 && item.time && item.time.hour * 60 + item.time.minute > now.hour * 60 + now.minute) break;
  }
  if (item.until && compareDates(date, item.until) > 0) {
    item.courseDone = true;
    item.done = true;
    item.enabled = false;
    item.updatedAt = Date.now();
    return false;
  }
  item.date = date;
  item.done = false;
  item.remindedAt = null;
  item.alarmedAt = null;
  item.updatedAt = Date.now();
  return true;
}

const WEEKDAY_NAMES = ["воскресеньям", "понедельникам", "вторникам", "средам", "четвергам", "пятницам", "субботам"];

// «две» вместо «2» — так подпись читается как речь, а не как расписание автобуса.
const COUNT_WORDS = ["", "", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать"];

function fmtRepeat(item) {
  const repeat = item.repeat;
  if (!repeat) return "";
  const every = Number.isFinite(repeat.every) && repeat.every > 1 ? repeat.every : 1;
  const count = COUNT_WORDS[every] || String(every);
  switch (repeat.kind) {
    case "daily": return every > 1 ? `каждые ${count} дня` : "каждый день";
    case "weekdays": return "по будням";
    case "weekends": return "по выходным";
    case "weekly":
      if (repeat.days?.length) return `по ${repeat.days.map(d => WEEKDAY_NAMES[d]).join(" и ")}`;
      if (every > 1) return `каждые ${count} недели`;
      return item.date ? `по ${WEEKDAY_NAMES[weekdayOf(item.date)]}` : "каждую неделю";
    case "monthly": return every > 1 ? `каждые ${count} месяца` : "каждый месяц";
    default: return "";
  }
}

/** Сколько живых записей у человека — по нему решаем, пускать ли новые. */
function itemCountOf(ownerId) {
  let n = 0;
  for (const item of Object.values(db.items)) {
    if (item.ownerId === ownerId && !item.deleted) n += 1;
  }
  return n;
}

function itemsFull(ownerId) {
  return itemCountOf(ownerId) >= ITEMS_PER_USER;
}

function makeItem(ownerId, draft, settings = {}) {
  const now = Date.now();
  const item = {
    id: nextId("i"),
    ownerId,
    type: draft.type || "task",
    title: String(draft.title || "Без названия").slice(0, 200),
    place: String(draft.place || "").slice(0, 120),
    who: String(draft.who || "").slice(0, 80),
    phone: String(draft.phone || "").slice(0, 32),
    note: String(draft.note || "").slice(0, 2000),
    starred: Boolean(draft.starred),
    carePart: draft.carePart === "morning" || draft.carePart === "evening" ? draft.carePart : null,
    careOrder: Number.isFinite(draft.careOrder) ? Math.max(0, Math.min(Number(draft.careOrder), 99)) : 0,
    healthPart: draft.healthPart === "morning" || draft.healthPart === "midday" || draft.healthPart === "evening"
      ? draft.healthPart
      : null,
    healthOrder: Number.isFinite(draft.healthOrder) ? Math.max(0, Math.min(Number(draft.healthOrder), 99)) : 0,
    asNeeded: Boolean(draft.asNeeded),
    weekendPause: Boolean(draft.weekendPause),
    date: normalizeDate(draft.date),
    time: normalizeTime(draft.time),
    remind: Number.isFinite(draft.remind) ? Math.max(0, Math.min(draft.remind, 7 * 1440)) : 0,
    alarm: Boolean(draft.alarm),
    push: draft.push !== false,
    snooze: Number.isFinite(draft.snooze) ? Math.max(1, Math.min(Number(draft.snooze), 180)) : 1,
    enabled: draft.enabled !== false,
    vibrate: draft.vibrate !== false,
    melody: String(draft.melody || "default").slice(0, 40),
    yearly: Boolean(draft.yearly),
    birthYear: Number.isFinite(draft.birthYear) ? Math.max(1900, Math.min(Number(draft.birthYear), 2100)) : null,
    monthWindow: draft.monthWindow && Number.isFinite(draft.monthWindow.fromDay) && Number.isFinite(draft.monthWindow.toDay)
      ? { fromDay: Math.max(1, Math.min(28, Number(draft.monthWindow.fromDay))), toDay: Math.max(1, Math.min(31, Number(draft.monthWindow.toDay))) }
      : null,
    extraRemind: Number.isFinite(draft.extraRemind) ? Math.max(0, Math.min(Number(draft.extraRemind), 7 * 1440)) : null,
    repeat: normalizeRepeat(draft.repeat),
    // Курс лечения: до какого дня повторяется и сколько приёмов уже отмечено.
    until: normalizeDate(draft.until),
    courseId: draft.courseId ? String(draft.courseId).slice(0, 40) : null,
    courseTotal: Number.isFinite(draft.courseTotal) ? Math.max(1, Math.min(Number(draft.courseTotal), 180)) : 0,
    courseTaken: 0,
    courseDone: false,
    needsTime: Boolean(draft.needsTime),
    timer: Boolean(draft.timer),
    done: false,
    cancelled: false,
    archived: false,
    archivedAt: null,
    deleted: false,
    status: draft.status || "active",
    from: draft.from || null,
    source: String(draft.source || "").slice(0, 400),
    remindedAt: null,
    alarmedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  // Своя полка по словам из конструктора важнее вшитых (встречи, покупки, спорт…).
  // Если человек стоит на своей полке и говорит без ключевых слов — запись тоже сюда.
  const customs = settings.customShelves || [];
  const custom = matchCustomShelf(`${item.title} ${item.source}`, customs);
  const preferred = customs.find(c => c.id === draft.shelf);
  if (draft.type === "alarm" || draft.shelf === "alarms") {
    item.type = "alarm";
    item.shelf = "alarms";
    item.alarm = true;
    item.push = false;
    item.remind = 0;
  } else if (custom) {
    item.type = "custom";
    item.shelf = custom.id;
  } else if (preferred) {
    item.type = "custom";
    item.shelf = preferred.id;
  } else {
    item.shelf = shelfFor({ ...item, shelf: draft.shelf }, settings);
  }
  // Настройки закладки: напоминание / пуш / будильник / отложить — если голос сам не задал.
  if (item.type !== "alarm") {
    const prefs = shelfPrefsFor(item.shelf, settings);
    if (!draft.remindExplicit) item.remind = prefs.push ? prefs.remind : 0;
    else if (!prefs.push) item.remind = 0;
    if (draft.alarm == null) item.alarm = prefs.alarm;
    else item.alarm = Boolean(draft.alarm);
    item.push = typeof draft.push === "boolean" ? draft.push : prefs.push;
    item.snooze = prefs.snooze;
  }
  const DAILY_SHELVES = new Set(["care", "sport", "health", "alarms", "bday", "meters", "bills", "alarm"]);
  if (!item.date && !DAILY_SHELVES.has(item.shelf) && item.type !== "alarm") {
    const tz = safeZone(settings.tz);
    const nowParts = zonedParts(Date.now(), tz);
    item.date = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  }
  db.items[item.id] = item;
  return item;
}

function activeItems(userId) {
  return itemsOf(userId).filter(i => !i.cancelled && i.status === "active");
}

function describeItem(item, settings = {}) {
  return {
    ...item,
    shelf: shelfFor(item, settings),
    repeatLabel: fmtRepeat(item),
  };
}

function hhmm({ hour, minute }) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Стоит ли запись ровно на названные день и час. Что человек не назвал, то и не проверяем,
// а если он не назвал ничего, приметы нет и запись такой поиск не находит.
function standsAt(item, date, time) {
  if (!date && !time) return false;
  if (date && !(item.date && item.date.year === date.year && item.date.month === date.month && item.date.day === date.day)) return false;
  if (time && !(item.time && item.time.hour === time.hour && item.time.minute === time.minute)) return false;
  return true;
}

const ARCHIVE_AFTER_MS = 30 * 86400000;

/** Полки «на постоянку» (спорт, уход, ЖКХ…) — в архив не складываем. */
const NO_ARCHIVE_SHELVES = new Set(["sport", "care", "health", "bills", "alarms"]);
const NO_ARCHIVE_TYPES = new Set(["sport", "care", "health", "bills", "alarm"]);

function canArchiveItem(item) {
  if (!item || item.cancelled || item.deleted) return false;
  if (item.repeat || item.yearly) return false;
  if (NO_ARCHIVE_SHELVES.has(item.shelf)) return false;
  if (NO_ARCHIVE_TYPES.has(item.type)) return false;
  // Без даты — бессрочная заметка/покупка, не «прошедшая по времени».
  if (!item.date) return false;
  return true;
}

function archiveItem(item, now = Date.now()) {
  if (!item || item.archived) return false;
  item.archived = true;
  item.archivedAt = now;
  item.done = true;
  item.updatedAt = now;
  return true;
}

/** Просрочка / после пуша — пора в архив (не зачёркивать на полках). */
function shouldArchiveNow(item, now, tz) {
  if (!canArchiveItem(item) || item.archived) return false;
  // Без часа полночь не считаем «временем события» — иначе заметка/покупка
  // на сегодня уезжает в архив через 45 секунд после 00:00.
  if (!item.time) {
    if (!item.date) return false;
    const parts = zonedParts(now, tz);
    const todayKey = parts.year * 10000 + parts.month * 100 + parts.day;
    const itemKey = item.date.year * 10000 + item.date.month * 100 + item.date.day;
    return itemKey < todayKey;
  }
  const eventTs = itemUtc(item, tz);
  if (item.remindedAt || item.alarmedAt) {
    if (eventTs == null || eventTs <= now) return true;
  }
  if (eventTs != null && now - eventTs >= 45 * 1000) return true;
  return false;
}

function migrateDoneToArchive(item) {
  if (!item || item.archived || !item.done) return false;
  if (!canArchiveItem(item)) return false;
  item.archived = true;
  item.archivedAt = item.archivedAt || item.updatedAt || Date.now();
  return true;
}

/** Заметки без часа ошибочно архивировались в момент создания (полночь + 45с). */
function reviveInstantFalseArchive(item) {
  if (!item?.archived || item.cancelled || item.deleted || item.time) return false;
  if (item.remindedAt || item.alarmedAt) return false;
  const created = Number(item.createdAt) || 0;
  const archivedAt = Number(item.archivedAt) || 0;
  if (!created || !archivedAt || archivedAt - created > 15_000) return false;
  item.archived = false;
  item.archivedAt = null;
  item.done = false;
  item.updatedAt = Date.now();
  return true;
}

function stateFor(user) {
  stripFreeUserRoutineSeed(user, db.items);
  const now = Date.now();
  const settings = user.settings || {};
  const tz = safeZone(settings.tz);
  let dirty = false;
  for (const item of itemsOf(user.id)) {
    if (reviveInstantFalseArchive(item)) dirty = true;
    if (migrateDoneToArchive(item)) dirty = true;
    if (shouldArchiveNow(item, now, tz) && archiveItem(item, now)) dirty = true;
  }
  if (dirty) save();

  const items = itemsOf(user.id)
    .filter(i => !i.cancelled)
    // Старые done без архива (повторы и «постоянные» полки) — по-прежнему прячем через 30 дней.
    .filter(i => {
      if (i.archived) return true;
      return !(i.done && !i.repeat && now - (i.updatedAt || i.createdAt) > ARCHIVE_AFTER_MS);
    })
    .map(i => describeItem(i, settings));

  touchPresence(user);
  const observation = pickObservation(user);
  if (observation) dirty = true;
  if (dirty) save();

  return {
    user: publicUser(user),
    items: items.filter(i => i.status === "active"),
    incoming: items.filter(i => i.status === "pending"),
    contacts: user.contacts || [],
    groups: user.groups || [],
    blocked: user.blocked || [],
    ...sharedListsPayload(user, dayKeyFromParts),
    billing: billingState(user),
    // Счётчик непрочитанных ответов поддержки: он же зажигает точку на иконке настроек.
    support: supportSummary(user.id),
    consentVersion: CONSENT_VERSION,
    vapidPublicKey: publicKey(),
    observation: observation || undefined,
  };
}

function fmtTime(item) {
  if (!item.time) return "без времени";
  return `${String(item.time.hour).padStart(2, "0")}:${String(item.time.minute).padStart(2, "0")}`;
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** В пуше — сводка слота, не название одного витамина. */
function notifyDisplayTitle(item) {
  if (!item) return "SoulVoice";
  if (item.type === "health" || item.shelf === "health") {
    const part = item.healthPart === "midday" || item.healthPart === "evening" || item.healthPart === "morning"
      ? item.healthPart
      : (item.time && item.time.hour >= 17 ? "evening" : item.time && item.time.hour >= 11 ? "midday" : "morning");
    return healthSummaryTitle(part);
  }
  if (item.type === "care" || item.shelf === "care") {
    const part = item.carePart === "evening" || (item.time && item.time.hour >= 15) ? "evening" : "morning";
    return part === "evening" ? "Вечер Косметика" : "Утро Косметика";
  }
  return item.title || "SoulVoice";
}

function fmtWhen(item, tz) {
  if (!item.date) return "без срока";
  const now = zonedParts(Date.now(), tz);
  const today = `${now.year}-${now.month}-${now.day}`;
  const tomorrowParts = addDays(now, 1);
  const tomorrow = `${tomorrowParts.year}-${tomorrowParts.month}-${tomorrowParts.day}`;
  const key = `${item.date.year}-${item.date.month}-${item.date.day}`;
  const dayLabel = key === today ? "сегодня" : key === tomorrow ? "завтра" : `${item.date.day} ${MONTHS_SHORT[item.date.month]}`;
  return item.time ? `${dayLabel} · ${fmtTime(item)}` : `${dayLabel} · без времени`;
}

/* —— Голос: подстановки и наблюдения —— */

const HOUR_WORDS = [
  "двенадцать", "час", "два", "три", "четыре", "пять", "шесть",
  "семь", "восемь", "девять", "десять", "одиннадцать",
  "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать",
  "семнадцать", "восемнадцать", "девятнадцать", "двадцать", "двадцать один",
  "двадцать два", "двадцать три",
];
const MINUTE_WORDS = {
  0: "",
  5: "пять",
  10: "десять",
  15: "пятнадцать",
  20: "двадцать",
  25: "двадцать пять",
  30: "тридцать",
  35: "тридцать пять",
  40: "сорок",
  45: "сорок пять",
  50: "пятьдесят",
  55: "пятьдесят пять",
};
const WEEKDAY_PREP = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
const DAY_ORDINAL = [
  "", "первого", "второго", "третьего", "четвёртого", "пятого", "шестого", "седьмого",
  "восьмого", "девятого", "десятого", "одиннадцатого", "двенадцатого", "тринадцатого",
  "четырнадцатого", "пятнадцатого", "шестнадцатого", "семнадцатого", "восемнадцатого",
  "девятнадцатого", "двадцатого", "двадцать первого", "двадцать второго", "двадцать третьего",
  "двадцать четвёртого", "двадцать пятого", "двадцать шестого", "двадцать седьмого",
  "двадцать восьмого", "двадцать девятого", "тридцатого", "тридцать первого",
];

function voiceOf(user) {
  return user?.settings?.voice === "he" ? "he" : "she";
}

function voiceMeta(user) {
  if (!user.nlu || typeof user.nlu !== "object") user.nlu = {};
  if (!user.nlu.voice || typeof user.nlu.voice !== "object") user.nlu.voice = {};
  return user.nlu.voice;
}

function markCalmSession(user, text) {
  if (!isHeavy(text)) return false;
  voiceMeta(user).calm = true;
  return true;
}

function sessionCalm(user) {
  return Boolean(voiceMeta(user).calm);
}

/** {когда} для реплик: строчная фраза с предлогом внутри, без «·». */
function fmtWhenVoice(item, tz) {
  if (!item?.date) return item?.time ? `в ${spokenClock(item.time)}` : "без срока";
  const now = zonedParts(Date.now(), tz);
  const todayKey = `${now.year}-${now.month}-${now.day}`;
  const tomorrow = addDays(now, 1);
  const tomorrowKey = `${tomorrow.year}-${tomorrow.month}-${tomorrow.day}`;
  const key = `${item.date.year}-${item.date.month}-${item.date.day}`;
  let day;
  if (key === todayKey) day = "сегодня";
  else if (key === tomorrowKey) day = "завтра";
  else {
    const wd = weekdayOf(item.date);
    const within = (() => {
      for (let i = 0; i <= 6; i += 1) {
        const d = addDays(now, i);
        if (`${d.year}-${d.month}-${d.day}` === key) return true;
      }
      return false;
    })();
    day = within ? WEEKDAY_PREP[wd] : (DAY_ORDINAL[item.date.day] || `${item.date.day}`);
  }
  if (!item.time) return day;
  const clock = spokenClock(item.time);
  if (day.startsWith("в ") || day.startsWith("во ")) return `${day} в ${clock}`;
  return `${day} в ${clock}`;
}

function spokenClock(time) {
  if (!time || typeof time.hour !== "number") return "";
  const hour = ((time.hour % 24) + 24) % 24;
  const word = HOUR_WORDS[hour] || String(hour);
  const minute = Number(time.minute) || 0;
  if (!minute) return word;
  const nearest = Math.round(minute / 5) * 5;
  if (nearest === 60) return HOUR_WORDS[(hour + 1) % 24] || word;
  const mWord = MINUTE_WORDS[nearest];
  if (mWord) return `${word} ${mWord}`;
  return `${word} ${String(minute).padStart(2, "0")}`;
}

function fmtCourseTerm(days) {
  const n = Math.max(1, Math.round(Number(days) || 1));
  if (n % 7 === 0) return pluralWeeks(n / 7);
  return count.дней(n);
}

function pluralWeeks(n) {
  const abs = Math.abs(n);
  const t100 = abs % 100;
  const t10 = abs % 10;
  if (n === 1) return "одну неделю";
  if (n === 2) return "две недели";
  if (n === 3) return "три недели";
  if (n === 4) return "четыре недели";
  const word = (t100 >= 11 && t100 <= 14) ? "недель"
    : t10 === 1 ? "неделя"
    : t10 >= 2 && t10 <= 4 ? "недели"
    : "недель";
  return `${n} ${word}`;
}

function voiceOpts(user, vars = {}, calmKey) {
  const calm = sessionCalm(user);
  return {
    voice: voiceOf(user),
    vars,
    calm,
    ...(calm && calmKey ? { calmKey } : {}),
  };
}

function sayFor(user, key, vars = {}, calmKey) {
  return say(key, voiceOpts(user, vars, calmKey));
}

function createdVoiceKey(item, createdCount) {
  if (createdCount > 1) return "batch_created";
  const type = item?.type;
  const shelf = item?.shelf;
  if (item?.courseId || item?.courseTotal) return "health_course";
  if (type === "meeting" || shelf === "meetings") {
    if (item.place) return "meeting_created_place";
    if (item.who) return "meeting_created_who";
    return "meeting_created";
  }
  if (type === "buy" || shelf === "buy") return "buy_created";
  if (type === "note" || shelf === "notes") return "note_created";
  if (type === "bday" || shelf === "bday") return "bday_created";
  if (type === "bills" || shelf === "bills") return "bills_created";
  if (type === "health" || shelf === "health") return "health_created";
  if (type === "alarm" || shelf === "alarms") return "alarm_created";
  if (!item?.time) return "task_created_no_time";
  return "task_created";
}

function createdCalmKey(item, createdCount) {
  if (createdCount > 1) return "created";
  if (!item?.time) return "created_no_time";
  return "created";
}

function varsForItem(item, tz, extra = {}) {
  return {
    когда: fmtWhenVoice(item, tz),
    что: item?.title || "",
    где: item?.place || "",
    кто: item?.who || "",
    ...extra,
  };
}

function dayKeyFromParts(p) {
  return `${p.year}-${p.month}-${p.day}`;
}

function noteBlockedTwoDays(meta, key, todayKey, tz) {
  if (!meta.lastNoteKey || meta.lastNoteKey !== key || !meta.lastNoteDay) return false;
  if (meta.lastNoteDay === todayKey) return true;
  const [y, m, d] = String(meta.lastNoteDay).split("-").map(Number);
  if (!Number.isFinite(y)) return false;
  const next = addDays({ year: y, month: m, day: d }, 1);
  return dayKeyFromParts(next) === todayKey;
}

/** Наблюдение над списком: не чаще одного за сессию, ключ не два дня подряд. */
function pickObservation(user) {
  if (sessionCalm(user)) return null;
  const meta = voiceMeta(user);
  if (meta.sessionNote) return null;
  const tz = safeZone(user.settings?.tz);
  const now = zonedParts(Date.now(), tz);
  const todayKey = dayKeyFromParts(now);
  const voice = voiceOf(user);
  const active = activeItems(user.id).filter(i => !i.done && !i.archived);

  const candidates = [];

  if (active.some(i => (i.dateMoves || 0) >= 3)) {
    candidates.push({ key: "postponed_thrice", vars: {} });
  }

  const weekEnd = addDays(now, 7);
  const weekCount = active.filter(i => {
    if (!i.date) return false;
    return compareDates(i.date, { year: now.year, month: now.month, day: now.day }) >= 0
      && compareDates(i.date, weekEnd) <= 0;
  }).length;
  if (weekCount > 10) candidates.push({ key: "busy_week", vars: { дел: count.дел(weekCount) } });

  const overdueN = active.filter(i => {
    if (!i.date) return false;
    const due = itemUtc(i, tz);
    return due != null && due < Date.now();
  }).length;
  if (overdueN > 3) candidates.push({ key: "overdue", vars: { дел: count.дел(overdueN) } });

  if (meta.prevSeenAt && Date.now() - meta.prevSeenAt > 3 * 86400000) {
    const days = Math.max(4, Math.floor((Date.now() - meta.prevSeenAt) / 86400000));
    candidates.push({ key: "long_absence", vars: { дней: count.дней(days) } });
  }

  if (meta.pendingLateNight) {
    candidates.push({ key: "late_night", vars: {} });
  }

  const dayStart = zonedToUtc({ year: now.year, month: now.month, day: now.day, hour: 0, minute: 0 }, tz);
  const doneToday = itemsOf(user.id).filter(i =>
    i.done && !i.cancelled && (i.updatedAt || 0) >= dayStart
  ).length;
  if (doneToday >= 5) candidates.push({ key: "good_day", vars: { дел: count.дел(doneToday) } });

  const pick = candidates.find(c => !noteBlockedTwoDays(meta, c.key, todayKey, tz));
  if (!pick) return null;
  const text = note(pick.key, { voice, vars: pick.vars, calm: false });
  if (!text) return null;
  meta.sessionNote = pick.key;
  meta.lastNoteKey = pick.key;
  meta.lastNoteDay = todayKey;
  meta.pendingLateNight = false;
  return { key: pick.key, text };
}

function touchPresence(user) {
  const meta = voiceMeta(user);
  const now = Date.now();
  if (!meta.lastSeenAt) {
    meta.lastSeenAt = now;
    return;
  }
  // Новая сессия: больше получаса тишины.
  if (now - meta.lastSeenAt > 30 * 60000) {
    meta.prevSeenAt = meta.lastSeenAt;
    meta.sessionNote = null;
    meta.calm = false;
  }
  meta.lastSeenAt = now;
}

function previewShelf(draft, settings, shelfHint, sourceText) {
  const customs = settings.customShelves || [];
  const custom = matchCustomShelf(`${draft.title || ""} ${sourceText || ""}`, customs);
  const preferred = customs.find(c => c.id === shelfHint);
  if (draft.type === "alarm" || draft.shelf === "alarms" || shelfHint === "alarms") return "alarms";
  if (custom) return custom.id;
  if (preferred) return preferred.id;
  return shelfFor({
    type: draft.type || "task",
    title: draft.title,
    source: sourceText,
    shelf: draft.shelf || shelfHint,
    date: draft.date,
    time: draft.time,
  }, settings);
}

/**
 * Страховка для ответа на «Во сколько?». Отвечая одним словом, человек имеет в виду
 * дневное время: «в три» — это 15:00, а не ночь. Ночной час он называет явно.
 * Трогаем только 1–6 и только когда в ответе нет уточнения.
 */
function daytimeAnswer(time, text) {
  if (!time || typeof time.hour !== "number") return time;
  if (time.hour < 1 || time.hour > 6) return time;
  if (/ноч|утр|рано|am\b/i.test(String(text || ""))) return time;
  return { ...time, hour: time.hour + 12 };
}

function slotFromParse(parseResult, slot) {
  if (slot === "time") {
    return parseResult.drafts?.[0]?.time || parseResult.slots?.time || null;
  }
  return null;
}

/**
 * Что сказать, когда запись упёрлась в подписку.
 *
 * Называем функцию своими словами, а не «доступно по подписке ПРО»:
 * человек должен понять, чего лишается, а не прочитать канцелярит.
 */
const PRO_SHELF_WORDS = {
  health: "Курсы лекарств и витаминов",
  care: "Уход за собой",
  sport: "Тренировки",
  bills: "Платежи",
  meters: "Счётчики",
  shared: "Общие списки",
};

function proShelfMessage(shelf) {
  const what = PRO_SHELF_WORDS[shelf] || "Эта полка";
  return `${what} — в подписке. Записи там ведутся сами: напомнят, посчитают дни, покажут историю.`;
}

function createItemsFromDrafts(user, drafts, text, settings, shelfHint, pool, nowMs) {
  // Отсечённые подпиской черновики запоминаем, а не выбрасываем молча.
  //
  // Раньше они просто исчезали, и человек слышал «Не расслышала, повтори».
  // Он повторял, слышал то же самое и решал, что распознавание сломано —
  // так и не узнав, что функция платная. Терялся и пользователь, и продажа.
  const blockedByPro = [];
  if (!isPro(user)) {
    const allowed = [];
    for (const d of drafts || []) {
      if (itemOnProShelf({ type: d.type, shelf: d.shelf || shelfHint })) blockedByPro.push(d);
      else allowed.push(d);
    }
    drafts = allowed;
  }
  const created = [];
  const duplicates = [];
  const VOICE_TWIN_MS = 30 * 60 * 1000;

  const relatedText = (a, b) => {
    if (!a || !b) return false;
    return a === b || a.startsWith(b) || b.startsWith(a);
  };

  const isTimeless = (x) => !x?.time;
  const sameWhenLoose = (item, draft, age) => {
    if (sameDayAndTime(item, draft)) return true;
    if (age <= VOICE_TWIN_MS && isTimeless(item) && isTimeless(draft)
        && ((!item.date && draft.date) || (item.date && !draft.date)
          || (item.date && draft.date && compareDates(item.date, draft.date) === 0))) {
      return true;
    }
    return false;
  };

  const findTwin = (draft, draftTitle) => pool.find(i => {
    const age = nowMs - (i.createdAt || 0);
    if (!sameWhenLoose(i, draft, age)) return false;
    const t = normalizeTitle(i.title);
    const src = normalizeTitle(i.source || "");
    if (age > VOICE_TWIN_MS) {
      return Boolean(t && draftTitle && t === draftTitle && sameDayAndTime(i, draft));
    }
    if (relatedText(t, draftTitle)) return true;
    if (relatedText(src, normalizeTitle(text))) return true;
    return false;
  });

  const absorbRelated = (keeper, draft, draftTitle) => {
    let changed = false;
    const twinTitle = normalizeTitle(keeper.title);
    if (draftTitle && draftTitle.length > twinTitle.length && (!twinTitle || draftTitle.startsWith(twinTitle))) {
      keeper.title = String(draft.title || keeper.title).slice(0, 200);
      changed = true;
    }
    if (draft.type === "note" && keeper.type !== "note") {
      keeper.type = "note";
      keeper.needsTime = false;
      keeper.shelf = shelfFor(keeper, settings);
      changed = true;
    }
    if (draft.date && !keeper.date) {
      keeper.date = draft.date;
      changed = true;
    }
    if (text && String(text).length > String(keeper.source || "").length) {
      keeper.source = String(text).slice(0, 500);
      changed = true;
    }
    for (const i of pool) {
      if (!i || i.id === keeper.id || i.cancelled) continue;
      const age = nowMs - (i.createdAt || 0);
      if (age > VOICE_TWIN_MS) continue;
      if (!sameWhenLoose(i, draft, age) && !sameWhenLoose(i, keeper, age)) continue;
      const t = normalizeTitle(i.title);
      const k = normalizeTitle(keeper.title);
      const src = normalizeTitle(i.source || "");
      const ksrc = normalizeTitle(keeper.source || "");
      if (relatedText(t, k) || relatedText(t, draftTitle) || relatedText(src, ksrc) || relatedText(src, normalizeTitle(text))) {
        if ((t || "").length <= (k || "").length || relatedText(t, draftTitle)) {
          i.cancelled = true;
          i.updatedAt = nowMs;
          changed = true;
        }
      }
    }
    if (changed) keeper.updatedAt = nowMs;
  };

  for (const draft of drafts) {
    const draftTitle = normalizeTitle(draft.title);
    const twin = findTwin(draft, draftTitle);
    if (twin) {
      absorbRelated(twin, draft, draftTitle);
      duplicates.push(describeItem(twin, settings));
      continue;
    }
    if (draft.course) {
      created.push(...makeCourse(user, draft, text, shelfHint));
      continue;
    }
    const item = makeItem(user.id, { ...draft, source: text, shelf: shelfHint }, settings);
    created.push(item);
    pool.push(item);
    absorbRelated(item, draft, draftTitle);
  }

  revealShelvesFor(user, created);
  return { created, duplicates, blockedByPro };
}

/**
 * Полка, скрытая по умолчанию, показывается сама, как только в неё что-то попало.
 * Без этого «день рождения мамы» уезжает на скрытую полку `bday`, ассистент отвечает
 * «записала», а открыть её нельзя — закладки нет. Экрана «Сегодня» в приложении тоже
 * нет, так что запись становится недостижимой.
 */
function revealShelvesFor(user, items) {
  const hidden = user.settings?.hiddenShelves;
  if (!Array.isArray(hidden) || !hidden.length || !items?.length) return;
  const landed = new Set();
  for (const item of items) {
    const shelf = shelfFor(item, user.settings || {});
    if (shelf) landed.add(shelf);
  }
  const next = hidden.filter(id => !landed.has(id));
  if (next.length !== hidden.length) {
    user.settings.hiddenShelves = next;
  }
}

async function handleSharedListCapture(user, body, text) {
  const registry = nicknameRegistry(user);
  const explicitPair = body.pairId || body.sharedListPair;
  const sharedMode = body.sharedList === true || body.captureMode === "shared" || body.source === "shared";

  const parsed = parseSharedList(text, registry);
  const wantsShared = sharedMode || parsed || /общ(?:ие?|ий|ую|ем)?\s+списк/i.test(text);

  if (wantsShared && !isPro(user)) {
    return { kind: "pro_required", message: "Общие списки доступны по подписке ПРО." };
  }

  if (!wantsShared) return null;

  // Голосовой получатель («маме», «мужу») важнее явного pairId с экрана/виджета.
  let pairId = parsed?.pairId || explicitPair;
  if (!pairId && sharedMode) pairId = resolveDefaultPairId(user);
  if (!pairId && registry.length === 1) pairId = registry[0].pairId;

  if (!pairId) {
    if (registry.length > 1) {
      return {
        kind: "confirm",
        message: "Кому отправить? Скажите прозвище из карусели.",
        intent: "shared_pick",
      };
    }
    return {
      kind: "not_found",
      message: "Сначала пригласите человека в общие списки",
    };
  }

  let titles = parsed?.titles;
  if (!titles?.length) {
    const one = sharedMode ? taskFromWidgetSpeech(text, registry) : (parsed?.title || "");
    if (one) titles = [one];
  }
  if (!titles?.length && sharedMode) titles = [text.trim().slice(0, 120)];
  if (!titles?.length) {
    return { kind: "empty", message: sayFor(user, "empty") };
  }

  const nick = registry.find(r => r.pairId === pairId)?.nickname || "близкому";
  const result = await postItemsToPair(user, pairId, titles, dayKeyFromParts);
  if (result.error) {
    return { kind: "not_found", message: result.error };
  }

  const voice = voiceOf(user);
  const addedTitles = (result.added || []).map(i => i.title).join(", ");
  const msg = result.duplicate && !result.added?.length
    ? "Уже в списке"
    : (voice === "he"
      ? `Отправил ${nick}: ${addedTitles}`
      : `Отправила ${nick}: ${addedTitles}`);

  return {
    kind: "shared_list",
    message: msg,
    pairId,
    nickname: nick,
    sharedItems: (result.added || []).map(i => ({ id: i.id, title: i.title, done: false })),
    duplicate: Boolean(result.duplicate && !result.added?.length),
  };
}

async function handleCapture(user, body) {
  const tz = safeZone(user.settings?.tz);
  const text = String(body.text || "").slice(0, 1000);
  if (!text.trim()) {
    return { kind: "empty", message: sayFor(user, "empty") };
  }


  const sharedReply = await handleSharedListCapture(user, body, text);
  if (sharedReply) return sharedReply;

  const settings = user.settings || {};
  markCalmSession(user, text);

  // 6) «не то» / «отмени это» — откат последнего действия (2 минуты).
  if (isUndoPhrase(text)) {
    const undone = undoLastAction(user, db.items);
    save();
    return {
      kind: undone.ok ? "undone" : "not_found",
      message: undone.ok
        ? (voiceOf(user) === "he" ? "Вернул как было." : "Вернула как было.")
        : sayFor(user, "not_found"),
      items: (undone.items || []).map(i => describeItem(i, settings)),
    };
  }

  // 2) Ответ на короткий вопрос «эту?» / «на 11?» или «Во сколько?»
  let earlyCreated = [];
  const pending = getPendingConfirm(user);
  if (pending?.intent === "fill") {
    const savedDraft = pending.draft || {};
    const shelfHint = pending.shelfHint || "";
    const sourceText = pending.source || text;

    if (isNoPhrase(text)) {
      clearPendingConfirm(user);
      const pool = activeItems(user.id).filter(i => !i.done);
      const { created } = createItemsFromDrafts(
        user,
        [{ ...savedDraft, needsTime: false }],
        sourceText,
        settings,
        shelfHint,
        pool,
        Date.now(),
      );
      if (created.length) {
        rememberDialog(user, {
          action: { kind: "created", itemIds: created.map(i => i.id), snapshots: [] },
          itemIds: created.map(i => i.id),
          slots: pending.slots || null,
        });
        maybeLateNight(user, tz);
      }
      save();
      return {
        kind: "created",
        message: createdMessage(user, created, tz, sourceText),
        items: created.map(i => describeItem(i, settings)),
      };
    }

    // Ответ разбираем ВМЕСТЕ с исходной фразой, а не отдельно.
    // Иначе «в три» решается как ближайшее наступление трёх часов: после 15:00
    // это уже завтрашние 03:00, и встреча уезжает на ночь. С исходной фразой
    // («встреча с Иваном завтра» + «в три») дата известна и час встаёт верно.
    const combined = `${sourceText} ${text}`.trim().slice(0, 1000);
    const answer = parse(combined, { now: Date.now(), tz, settings });
    let filledTime = slotFromParse(answer, pending.slot || "time");
    if (!filledTime) {
      // Совмещённая фраза могла не разобраться — пробуем ответ сам по себе.
      filledTime = slotFromParse(parse(text, { now: Date.now(), tz, settings }), pending.slot || "time");
    }
    filledTime = daytimeAnswer(filledTime, text);
    if (filledTime) {
      clearPendingConfirm(user);
      const pool = activeItems(user.id).filter(i => !i.done);
      const { created } = createItemsFromDrafts(
        user,
        [{ ...savedDraft, time: filledTime, needsTime: false }],
        sourceText,
        settings,
        shelfHint,
        pool,
        Date.now(),
      );
      if (created.length) {
        rememberDialog(user, {
          action: { kind: "created", itemIds: created.map(i => i.id), snapshots: [] },
          itemIds: created.map(i => i.id),
          slots: { ...(pending.slots || {}), time: filledTime },
        });
        maybeLateNight(user, tz);
      }
      save();
      return {
        kind: "created",
        message: createdMessage(user, created, tz, sourceText),
        items: created.map(i => describeItem(i, settings)),
      };
    }

    // Ответ не по делу — записываем черновик без времени и разбираем фразу дальше.
    clearPendingConfirm(user);
    const poolEarly = activeItems(user.id).filter(i => !i.done);
    const early = createItemsFromDrafts(
      user,
      [{ ...savedDraft, needsTime: false }],
      sourceText,
      settings,
      shelfHint,
      poolEarly,
      Date.now(),
    );
    earlyCreated = early.created;
    if (earlyCreated.length) maybeLateNight(user, tz);
  } else if (pending) {
    if (isYesPhrase(text)) {
      clearPendingConfirm(user);
      const item = db.items[pending.itemId];
      if (!item || item.ownerId !== user.id) {
        save();
        return { kind: "not_found", message: sayFor(user, "not_found") };
      }
      const snap = snapshotItem(item);
      if (pending.intent === "cancel") {
        item.cancelled = true;
        item.updatedAt = Date.now();
        rememberDialog(user, {
          action: { kind: "cancelled", itemIds: [item.id], snapshots: [snap] },
          itemIds: [item.id],
          slots: pending.slots || null,
        });
        save();
        return { kind: "cancelled", message: sayFor(user, "cancelled", {}, "cancelled"), items: [describeItem(item, settings)] };
      }
      applyMove(item, pending.patch || {}, tz, settings);
      rememberDialog(user, {
        action: { kind: "moved", itemIds: [item.id], snapshots: [snap] },
        itemIds: [item.id],
        slots: pending.slots || null,
      });
      save();
      return {
        kind: "moved",
        message: sayFor(user, "moved", varsForItem(item, tz), "moved"),
        items: [describeItem(item, settings)],
      };
    }
    if (isNoPhrase(text)) {
      clearPendingConfirm(user);
      save();
      return { kind: "empty", message: sayFor(user, "declined") };
    }
    // Не да/нет — снимаем ожидание и разбираем фразу дальше.
    clearPendingConfirm(user);
  }

  let result = parse(text, { now: Date.now(), tz, settings });
  const voiceLike = body.source === "voice" || body.source === "widget";
  if (voiceLike && result.intent === "create") {
    try {
      result = await refineWithAlice(text, result, { now: Date.now(), tz, settings });
    } catch {
      // Правила parse.js уже разобрали — модель только уточняет.
    }
  }

  // 1) Эллипсис: «а на Тимирязевской» / «на 11» → правка последней записи.
  if (looksLikeEllipsis(text, result)) {
    const lastIds = getLastItemIds(user);
    const lastId = lastIds[0];
    const lastItem = lastId ? db.items[lastId] : null;
    if (lastItem && lastItem.ownerId === user.id && !lastItem.cancelled && !lastItem.done) {
      const patch = ellipsisPatch(result);
      const snap = snapshotItem(lastItem);
      applyMove(lastItem, patch, tz, settings);
      rememberDialog(user, {
        action: { kind: "moved", itemIds: [lastItem.id], snapshots: [snap] },
        itemIds: [lastItem.id],
        slots: { ...getLastSlots(user), ...patch, ...result.slots },
      });
      save();
      return {
        kind: "moved",
        message: sayFor(user, "moved", varsForItem(lastItem, tz), "moved"),
        items: [describeItem(lastItem, settings)],
      };
    }
  }

  if (result.intent === "cancel" || result.intent === "move") {
    const pool = activeItems(user.id).filter(i => !i.done);
    const askedTime = result.intent === "cancel" ? result.time : null;
    let scored = [];
    const marked = resolveCaptureTarget(pool, result);
    if (marked) {
      if (!marked.items.length) {
        scored = [];
      } else if (marked.items.length > 1 && (marked.mode === "query" || marked.mode === "exact")) {
        scored = marked.items.map(item => ({ item, score: 1 }));
      } else {
        scored = [{ item: marked.items[0], score: 1 }];
      }
    } else {
      scored = pool
        .map(i => ({ item: i, score: scoreMatch(i, result.query || result.rawQuery || "") }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (!scored.length) {
        scored = pool.filter(i => standsAt(i, result.date, askedTime)).map(i => ({ item: i, score: 0.5 }));
      } else if (scored.length > 1) {
        const narrowed = scored.filter(x => standsAt(x.item, result.date, askedTime));
        if (narrowed.length) scored = narrowed;
      }
    }

    // Если цель не названа — берём последнюю из контекста диалога.
    if (!scored.length && getLastItemIds(user).length) {
      const last = db.items[getLastItemIds(user)[0]];
      if (last && last.ownerId === user.id && !last.cancelled && !last.done) {
        scored = [{ item: last, score: 0.4 }];
      }
    }

    if (!scored.length) {
      return {
        kind: "not_found",
        message: sayFor(user, "not_found"),
        candidates: pool.slice(0, 4).map(i => describeItem(i, settings)),
        pending: result.intent === "move" ? { date: result.date, time: result.time, shift: result.shift, timer: result.timer } : null,
      };
    }

    let best = scored[0];
    let tie = scored.filter(x => x.score === best.score);
    if (tie.length > 1 && result.intent === "move") {
      tie = [...tie].sort((a, b) =>
        (b.item.createdAt || b.item.updatedAt || 0) - (a.item.createdAt || a.item.updatedAt || 0));
      best = tie[0];
      scored = [best];
      tie = [best];
    }

    // 2) При отмене нескольких — один короткий вопрос, не список на пол-экрана.
    if (tie.length > 1) {
      const top = tie[0].item;
      rememberDialog(user, {
        pendingConfirm: {
          at: Date.now(),
          intent: result.intent,
          itemId: top.id,
          patch: {
            date: result.date,
            time: result.time,
            shift: result.shift,
            timer: result.timer,
            place: result.place,
            who: result.who,
            alarm: result.alarm,
            push: result.push,
          },
          slots: result.slots,
        },
      });
      save();
      return {
        kind: "confirm",
        message: result.intent === "cancel"
          ? `Отменить «${top.title}»?`
          : `Исправить «${top.title}»?`,
        candidates: tie.slice(0, 3).map(x => describeItem(x.item, settings)),
        intent: result.intent,
      };
    }

    // Сомнение по слабому совпадению при cancel — спросим.
    if (result.intent === "cancel" && best.score > 0 && best.score < 0.5) {
      rememberDialog(user, {
        pendingConfirm: {
          at: Date.now(),
          intent: "cancel",
          itemId: best.item.id,
          patch: {},
          slots: result.slots,
        },
      });
      save();
      return {
        kind: "confirm",
        message: `Отменить «${best.item.title}»?`,
        candidates: [describeItem(best.item, settings)],
        intent: "cancel",
      };
    }

    const item = best.item;
    if (result.intent === "cancel") {
      const snap = snapshotItem(item);
      item.cancelled = true;
      item.updatedAt = Date.now();
      rememberDialog(user, {
        action: { kind: "cancelled", itemIds: [item.id], snapshots: [snap] },
        itemIds: [item.id],
        slots: result.slots,
      });
      save();
      return { kind: "cancelled", message: sayFor(user, "cancelled", {}, "cancelled"), items: [describeItem(item, settings)] };
    }

    const snap = snapshotItem(item);
    applyMove(item, result, tz, settings);
    rememberDialog(user, {
      action: { kind: "moved", itemIds: [item.id], snapshots: [snap] },
      itemIds: [item.id],
      slots: result.slots,
    });
    save();
    return {
      kind: "moved",
      message: sayFor(user, "moved", varsForItem(item, tz), "moved"),
      items: [describeItem(item, settings)],
    };
  }

  const pool = activeItems(user.id).filter(i => !i.done);
  const shelfHint = typeof body.shelf === "string" ? body.shelf : "";
  const nowMs = Date.now();

  if (
    voiceLike
    && result.intent === "create"
    && result.drafts.length === 1
    && !result.drafts[0].course
  ) {
    const draft = result.drafts[0];
    if (!draft.time) {
      const shelf = previewShelf(draft, settings, shelfHint, text);
      if (SHELF_PROFILES[shelf]?.needsTime) {
        rememberDialog(user, {
          pendingConfirm: {
            at: Date.now(),
            intent: "fill",
            slot: "time",
            draft: { ...draft },
            source: text,
            shelfHint,
            slots: result.slots,
          },
        });
        save();
        return {
          kind: "ask",
          message: sayFor(user, "ask_time"),
          slot: "time",
          draft: { ...draft },
        };
      }
    }
  }

  const batch = createItemsFromDrafts(user, result.drafts, text, settings, shelfHint, pool, nowMs);
  const created = [...earlyCreated, ...batch.created];
  const duplicates = batch.duplicates;

  if (created.length) {
    rememberDialog(user, {
      action: { kind: "created", itemIds: created.map(i => i.id), snapshots: [] },
      itemIds: created.map(i => i.id),
      slots: result.slots,
    });
    maybeLateNight(user, tz);
  }
  save();

  // Ничего не создалось, потому что всё упёрлось в подписку — говорим прямо.
  // Человек в этот момент хочет функцию и понимает зачем: лучшей точки
  // для предложения не будет.
  if (!created.length && batch.blockedByPro?.length) {
    const d = batch.blockedByPro[0];
    const shelf = d.shelf || shelfFor({ type: d.type }, settings);
    return {
      kind: "pro_required",
      proRequired: true,
      shelf,
      message: proShelfMessage(shelf),
      items: [],
    };
  }

  if (!created.length && duplicates.length) {
    const dup = duplicates[0];
    return {
      kind: "duplicate",
      message: sayFor(user, "duplicate", {
        когда: dup?.date ? fmtWhenVoice(dup, tz) : "раньше",
      }),
      items: duplicates,
    };
  }

  return {
    kind: "created",
    message: createdMessage(user, created, tz, text, result.drafts),
    items: created.map(i => describeItem(i, settings)),
  };
}

function maybeLateNight(user, tz) {
  const hour = zonedParts(Date.now(), tz).hour;
  if (hour >= 1 && hour < 5) voiceMeta(user).pendingLateNight = true;
}

function createdMessage(user, created, tz, sourceText, drafts = []) {
  if (!created.length) return sayFor(user, "empty");
  const item = created[0];
  const key = createdVoiceKey(item, created.length);
  const calmKey = createdCalmKey(item, created.length);
  const extra = {};
  if (key === "batch_created") extra.записей = count.записей(created.length);
  if (key === "health_course") {
    const days = drafts.find(d => d?.course)?.course?.days
      || (item.until && item.date
        ? Math.max(1, Math.round((itemUtc({ date: item.until, time: { hour: 0, minute: 0 } }, tz)
          - itemUtc({ date: item.date, time: { hour: 0, minute: 0 } }, tz)) / 86400000) + 1)
        : item.courseTotal || 1);
    extra.срок = fmtCourseTerm(days);
  }
  return sayFor(user, key, varsForItem(item, tz, extra), calmKey);
}

// Курс лечения: на каждый приём своя запись, у всех общий номер курса и последний день.
// Так работают и отметка «выпил», и напоминание на каждый час приёма.
function makeCourse(user, draft, text, shelfHint) {
  const tz = safeZone(user.settings?.tz);
  const start = draft.date || zonedParts(Date.now(), tz);
  const hours = courseHours(draft.course.perDay);
  const until = addDays(start, Math.max(0, draft.course.days - 1));
  const courseId = nextId("crs");
  const named = draft.time ? [draft.time.hour, ...hours.slice(1)] : hours;

  return named.map((hour, index) => makeItem(user.id, {
    ...draft,
    time: index === 0 && draft.time ? draft.time : { hour, minute: 0 },
    date: { year: start.year, month: start.month, day: start.day },
    repeat: { kind: "daily" },
    until: { year: until.year, month: until.month, day: until.day },
    courseId,
    courseTotal: draft.course.days,
    needsTime: false,
    source: text,
    shelf: shelfHint,
  }, user.settings || {}));
}

// Перенос уже найденной записи: «на час позже» считаем от её срока, а не от часов на стене.
function applyMove(item, result, tz, settings) {
  const beforeDate = item.date ? `${item.date.year}-${item.date.month}-${item.date.day}` : "";
  if (result.shift && item.date) {
    const moved = zonedParts(itemUtc(item, tz) + result.shift * 60000, tz);
    item.date = { year: moved.year, month: moved.month, day: moved.day };
    if (item.time) item.time = { hour: moved.hour, minute: moved.minute };
  }
  if (result.date) item.date = result.date;
  if (result.time) {
    item.time = result.time;
    item.needsTime = false;
    // «внеси правку … на 9 утра» к заметке без даты — ближайшее сегодня/завтра.
    if (!item.date && !result.date) {
      const nowParts = zonedParts(Date.now(), tz);
      const due = result.time.hour * 60 + result.time.minute;
      const nowMins = nowParts.hour * 60 + nowParts.minute;
      item.date = due <= nowMins
        ? addDays(nowParts, 1)
        : { year: nowParts.year, month: nowParts.month, day: nowParts.day };
    }
  }
  if (typeof result.place === "string" && result.place.trim()) {
    item.place = result.place.trim().slice(0, 120);
  }
  if (typeof result.who === "string" && result.who.trim()) {
    item.who = result.who.trim().slice(0, 80);
    if (item.type === "meeting" && item.title && !new RegExp(result.who, "i").test(item.title)) {
      item.title = `Встреча с ${result.who}`;
    }
  }
  if (typeof result.alarm === "boolean") item.alarm = result.alarm;
  if (typeof result.push === "boolean") item.push = result.push;
  // «поменяй таймер на 10 мин» — новый отсчёт: сигнал в конце, без запаса.
  if (result.timer) {
    item.timer = true;
    item.alarm = true;
    item.remind = 0;
  }
  // Заметка получила срок — это уже дело, иначе полка и виджет ведут себя странно.
  if (item.type === "note" && (item.date || item.time)) {
    item.type = "task";
  }
  const afterDate = item.date ? `${item.date.year}-${item.date.month}-${item.date.day}` : "";
  if (beforeDate && afterDate && beforeDate !== afterDate) {
    item.dateMoves = (item.dateMoves || 0) + 1;
  }
  item.remindedAt = null;
  item.alarmedAt = null;
  item.done = false;
  item.updatedAt = Date.now();
  item.shelf = shelfFor(item, settings);
}

function sameDayAndTime(item, draft) {
  const dateEqual = (!item.date && !draft.date)
    || (item.date && draft.date && compareDates(item.date, draft.date) === 0);
  const timeEqual = (!item.time && !draft.time)
    || (item.time && draft.time && item.time.hour === draft.time.hour && item.time.minute === draft.time.minute);
  return dateEqual && timeEqual;
}

const ROUTES = [];

function route(method, pattern, handler, options = {}) {
  ROUTES.push({
    method,
    pattern,
    handler,
    auth: options.auth !== false,
    rawBody: options.rawBody === true,
  });
}

route("GET", /^\/api\/config$/, async () => ({ status: 200, body: { vapidPublicKey: publicKey() } }), { auth: false });

route("POST", /^\/api\/portfolio\/contact$/, async (ctx) => {
  if (rateLimited(`portfolio:${ctx.ip}`, 8, 3600000)) {
    return { status: 429, body: { error: "Слишком много заявок. Попробуйте позже или напишите на indopochte13@gmail.com" } };
  }
  const parsed = validatePortfolioContact(ctx.body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  await savePortfolioLead(parsed, { ip: ctx.ip, ua: ctx.req.headers["user-agent"] });
  return { status: 200, body: { ok: true } };
}, { auth: false });

// Первое открытие: аккаунт выдаётся сам, без имени и любых других данных о человеке.
route("POST", /^\/api\/start$/, async (ctx) => {
  if (rateLimited(`start:${ctx.ip}`, 10)) return { status: 429, body: { error: "Слишком часто. Подождите." } };

  // Если пришёл действующий токен — человек уже с нами, и новый аккаунт заводить нельзя.
  // Без этой проверки одна ошибка на клиенте отрезала человека от всех его записей:
  // старый токен затирался, а дела оставались в аккаунте, к которому нет доступа.
  // Так за неделю набежало семьдесят шесть брошенных аккаунтов на одного человека.
  //
  // ctx.user уже разобран из заголовка на входе — даже для роутов без обязательного входа.
  if (ctx.user) {
    if (ctx.body?.tz && ctx.user.settings) ctx.user.settings.tz = safeZone(ctx.body.tz);
    applyConsent(ctx.user, ctx.body?.consent);
    save();
    return { status: 200, body: { token: ctx.token, ...stateFor(ctx.user) } };
  }

  const user = createUser(safeZone(ctx.body?.tz));
  applyConsent(user, ctx.body?.consent);
  const token = issueToken(user.id);
  save();
  return { status: 200, body: { token, ...stateFor(user) } };
}, { auth: false });

// Согласие приходит вместе с первым входом: человек отметил галочку до кнопки «Начать».
function applyConsent(user, version) {
  if (String(version || "") !== CONSENT_VERSION) return false;
  if (!user.settings) user.settings = defaultSettings();
  user.settings.consent = { version: CONSENT_VERSION, at: Date.now() };
  return true;
}

// Возврат к своим записям на другом телефоне — только по ключу переноса.
route("POST", /^\/api\/restore$/, async (ctx) => {
  if (rateLimited(`restore:${ctx.ip}`, 15)) return { status: 429, body: { error: "Слишком много попыток. Подождите." } };
  const user = findUserByTransferKey(ctx.body?.key);
  if (!user) return { status: 401, body: { error: "Ключ не подходит" } };
  const tz = safeZone(ctx.body.tz);
  if (tz && user.settings) user.settings.tz = tz;
  // Согласие с другого телефона не затираем. Новое принимаем только если клиент явно прислал consent.
  if (ctx.body?.consent) applyConsent(user, ctx.body.consent);
  const token = issueToken(user.id);
  save();
  return { status: 200, body: { token, ...stateFor(user) } };
}, { auth: false });

route("GET", /^\/api\/state$/, async (ctx) => {
  // Часовой пояс телефона мог измениться — держим его актуальным.
  if (ctx.query?.tz) {
    const tz = safeZone(ctx.query.tz);
    if (ctx.user.settings && ctx.user.settings.tz !== tz) {
      ctx.user.settings.tz = tz;
      save();
    }
  }
  return { status: 200, body: stateFor(ctx.user) };
});

/** Один capture на пользователя за раз — иначе два параллельных запроса оба не видят twin. */
const captureLocks = new Map();
function withCaptureLock(userId, fn) {
  const prev = captureLocks.get(userId) || Promise.resolve();
  const next = prev.then(fn, fn);
  captureLocks.set(userId, next.catch(() => {}));
  return next;
}

route("POST", /^\/api\/capture$/, async (ctx) => {
  if (rateLimited(`cap:${ctx.user.id}`, 90)) {
    return { status: 429, body: { error: "Слишком много записей подряд. Подождите минуту." } };
  }
  if (itemsFull(ctx.user.id)) {
    return { status: 400, body: { error: "Записей слишком много. Почистите архив." } };
  }
  return withCaptureLock(ctx.user.id, async () => {
    const reply = await handleCapture(ctx.user, ctx.body);
    return { status: 200, body: { reply, ...stateFor(ctx.user) } };
  });
});

function proWriteBlocked(user, draft) {
  if (isPro(user)) return null;
  const probe = {
    type: draft?.type,
    shelf: draft?.shelf,
  };
  if (draft?.type === "alarm" || draft?.shelf === "alarms") {
    probe.type = "alarm";
    probe.shelf = "alarms";
  }
  if (!itemOnProShelf(probe)) return null;
  return { status: 403, body: { error: "Доступно по подписке ПРО", proRequired: true } };
}

route("POST", /^\/api\/items$/, async (ctx) => {
  if (itemsFull(ctx.user.id)) {
    return { status: 400, body: { error: "Записей слишком много. Почистите архив." } };
  }
  const blocked = proWriteBlocked(ctx.user, ctx.body || {});
  if (blocked) return blocked;
  const item = makeItem(ctx.user.id, {
    type: ctx.body.type || "task",
    title: ctx.body.title || "Новая запись",
    place: ctx.body.place,
    note: ctx.body.note,
    starred: ctx.body.starred,
    carePart: ctx.body.carePart,
    careOrder: ctx.body.careOrder,
    date: ctx.body.date,
    time: ctx.body.time,
    remind: ctx.body.remind,
    alarm: ctx.body.alarm,
    shelf: ctx.body.shelf,
    // Так же, как при голосовом вводе: время спрашиваем только у встреч
    // и будильников, где без часа запись бессмысленна. Дело и покупка
    // прекрасно живут без времени.
    needsTime: !ctx.body.time
      && ["meeting", "alarm"].includes(ctx.body.type || "task"),
    source: ctx.body.source || "manual",
    repeat: ctx.body.repeat,
  }, ctx.user.settings || {});
  if (ctx.body.type === "alarm" || ctx.body.shelf === "alarms") {
    item.type = "alarm";
    item.shelf = "alarms";
    item.alarm = true;
    item.remind = 0;
    item.push = false;
    if ("repeat" in (ctx.body || {})) item.repeat = normalizeRepeat(ctx.body.repeat);
    if (typeof ctx.body.enabled === "boolean") item.enabled = ctx.body.enabled;
  } else if ("repeat" in (ctx.body || {})) {
    item.repeat = normalizeRepeat(ctx.body.repeat);
  }
  if (item.type === "care" || item.shelf === "care") {
    item.type = "care";
    item.shelf = "care";
    item.place = "";
  }
  save();
  return { status: 200, body: { item: describeItem(item, ctx.user.settings || {}), ...stateFor(ctx.user) } };
});

route("PATCH", /^\/api\/items\/([\w-]+)$/, async (ctx) => {
  const item = db.items[ctx.params[0]];
  if (!item || item.ownerId !== ctx.user.id) return { status: 404, body: { error: "Не найдено" } };
  if (!isPro(ctx.user) && itemOnProShelf(item)) {
    return { status: 403, body: { error: "Доступно по подписке ПРО", proRequired: true } };
  }
  const b = ctx.body;
  let scheduleChanged = false;
  if (typeof b.title === "string") item.title = b.title.trim().slice(0, 200) || item.title;
  if (typeof b.place === "string") item.place = b.place.trim().slice(0, 120);
  if (typeof b.who === "string") item.who = b.who.trim().slice(0, 80);
  if (typeof b.phone === "string") item.phone = b.phone.trim().slice(0, 32);
  if (typeof b.note === "string") item.note = b.note.trim().slice(0, 2000);
  if (typeof b.starred === "boolean") item.starred = b.starred;
  if (b.carePart === "morning" || b.carePart === "evening" || b.carePart === null) item.carePart = b.carePart;
  if (Number.isFinite(b.careOrder)) item.careOrder = Math.max(0, Math.min(Number(b.careOrder), 99));
  if (b.healthPart === "morning" || b.healthPart === "midday" || b.healthPart === "evening" || b.healthPart === null) {
    item.healthPart = b.healthPart;
  }
  if (Number.isFinite(b.healthOrder)) item.healthOrder = Math.max(0, Math.min(Number(b.healthOrder), 99));
  if (typeof b.asNeeded === "boolean") item.asNeeded = b.asNeeded;
  if (typeof b.weekendPause === "boolean") item.weekendPause = b.weekendPause;
  if ("date" in b) {
    const beforeDate = item.date ? `${item.date.year}-${item.date.month}-${item.date.day}` : "";
    item.date = normalizeDate(b.date);
    const afterDate = item.date ? `${item.date.year}-${item.date.month}-${item.date.day}` : "";
    if (beforeDate && afterDate && beforeDate !== afterDate) {
      item.dateMoves = (item.dateMoves || 0) + 1;
    }
    scheduleChanged = true;
  }
  if ("time" in b) {
    item.time = normalizeTime(b.time);
    item.needsTime = !item.time;
    scheduleChanged = true;
  }
  if (Number.isFinite(b.remind)) {
    item.remind = Math.max(0, Math.min(Number(b.remind), 7 * 1440));
    scheduleChanged = true;
  }
  if (typeof b.alarm === "boolean") item.alarm = b.alarm;
  if (typeof b.push === "boolean") item.push = b.push;
  if (typeof b.enabled === "boolean") item.enabled = b.enabled;
  if (typeof b.vibrate === "boolean") item.vibrate = b.vibrate;
  if (typeof b.melody === "string") item.melody = b.melody.trim().slice(0, 40) || "default";
  if (Number.isFinite(b.snooze)) item.snooze = Math.max(1, Math.min(Number(b.snooze), 180));
  if ("repeat" in b) item.repeat = normalizeRepeat(b.repeat);
  if (typeof b.yearly === "boolean") item.yearly = b.yearly;
  if ("birthYear" in b) {
    item.birthYear = Number.isFinite(b.birthYear) ? Math.max(1900, Math.min(Number(b.birthYear), 2100)) : null;
  }
  if ("monthWindow" in b && b.monthWindow && typeof b.monthWindow === "object") {
    item.monthWindow = {
      fromDay: Math.max(1, Math.min(28, Number(b.monthWindow.fromDay) || 15)),
      toDay: Math.max(1, Math.min(31, Number(b.monthWindow.toDay) || 26)),
    };
  }
  if ("extraRemind" in b) {
    item.extraRemind = Number.isFinite(b.extraRemind) ? Math.max(0, Math.min(Number(b.extraRemind), 7 * 1440)) : null;
  }
  if (typeof b.done === "boolean") item.done = b.done;
  if (typeof b.type === "string" && ["task", "meeting", "buy", "note", "bday", "sport", "care", "bills", "health", "custom", "alarm"].includes(b.type)) {
    item.type = b.type;
    // Смена типа без явной полки — пересчитать полку заново, не держась за старую.
    if (!("shelf" in b)) item.shelf = null;
  }
  // Свою полку можно выбрать вручную в карточке.
  if (typeof b.shelf === "string") {
    const customs = ctx.user.settings?.customShelves || [];
    if (customs.some(c => c.id === b.shelf) || BUILTIN_SHELF_IDS.includes(b.shelf)) {
      item.shelf = b.shelf;
      if (customs.some(c => c.id === b.shelf)) item.type = "custom";
      if (b.shelf === "alarms") item.type = "alarm";
    }
  }
  if (item.type === "care" || item.shelf === "care") {
    item.type = "care";
    item.shelf = "care";
    item.place = "";
  }
  if (item.type === "health" || item.shelf === "health") {
    item.type = "health";
    item.shelf = "health";
    item.place = "";
  }
  // Сбрасываем отметки о пушах только если поменялось само расписание,
  // иначе правка названия заставит напоминание прийти второй раз.
  if (scheduleChanged) {
    item.remindedAt = null;
    item.alarmedAt = null;
  }
  item.updatedAt = Date.now();
  if (!("shelf" in b) || !item.shelf) item.shelf = shelfFor(item, ctx.user.settings || {});
  save();
  return { status: 200, body: { item: describeItem(item, ctx.user.settings || {}), ...stateFor(ctx.user) } };
});

route("POST", /^\/api\/care\/seed$/, async (ctx) => {
  if (!isPro(ctx.user)) {
    return { status: 403, body: { error: "Доступно по подписке ПРО", proRequired: true } };
  }
  const replace = ctx.body?.replace !== false;
  const tz = safeZone(ctx.user.settings?.tz);
  const nowParts = zonedParts(Date.now(), tz);
  const settings = ctx.user.settings || {};
  const active = activeItems(ctx.user.id).filter(i => i.type === "care" || i.shelf === "care");
  if (replace) {
    for (const item of active) {
      item.cancelled = true;
      item.updatedAt = Date.now();
    }
  }
  const notifyParts = new Set();
  const created = [];
  for (const step of CARE_ROUTINE) {
    if (!replace) {
      const twin = active.find(i =>
        !i.cancelled
        && i.carePart === step.carePart
        && normalizeTitle(i.title) === normalizeTitle(step.title));
      if (twin) continue;
    }
    const time = careDefaultTime(step.carePart);
    const due = time.hour * 60 + time.minute;
    const nowMins = nowParts.hour * 60 + nowParts.minute;
    const date = due <= nowMins
      ? addDays(nowParts, 1)
      : { year: nowParts.year, month: nowParts.month, day: nowParts.day };
    // Один пуш на слот (утро/вечер) ровно в назначенное время.
    const notify = !notifyParts.has(step.carePart);
    if (notify) notifyParts.add(step.carePart);
    created.push(makeItem(ctx.user.id, {
      type: "care",
      shelf: "care",
      title: step.title,
      note: step.note,
      starred: step.starred,
      carePart: step.carePart,
      careOrder: step.careOrder,
      date,
      time,
      repeat: { kind: "daily" },
      remind: 0,
      remindExplicit: true,
      push: notify,
      needsTime: false,
      place: "",
      source: CARE_ROUTINE_SOURCE,
    }, settings));
  }
  settings.careRoutineV1 = true;
  settings.careRoutineV2 = true;
  ctx.user.settings = settings;
  save();
  return { status: 200, body: { created: created.length, ...stateFor(ctx.user) } };
});

route("POST", /^\/api\/care\/time$/, async (ctx) => {
  if (!isPro(ctx.user)) {
    return { status: 403, body: { error: "Доступно по подписке ПРО", proRequired: true } };
  }
  const part = ctx.body?.carePart;
  if (part !== "morning" && part !== "evening") {
    return { status: 400, body: { error: "Нужно утро или вечер" } };
  }
  const time = normalizeTime(ctx.body?.time);
  if (!time) return { status: 400, body: { error: "Укажите время" } };
  const tz = safeZone(ctx.user.settings?.tz);
  const nowParts = zonedParts(Date.now(), tz);
  const due = time.hour * 60 + time.minute;
  const nowMins = nowParts.hour * 60 + nowParts.minute;
  const date = due <= nowMins
    ? addDays(nowParts, 1)
    : { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  let n = 0;
  for (const item of activeItems(ctx.user.id)) {
    if (item.cancelled || item.archived) continue;
    if (!(item.type === "care" || item.shelf === "care")) continue;
    const itemPart = item.carePart === "morning" || item.carePart === "evening"
      ? item.carePart
      : (item.time && item.time.hour >= 15 ? "evening" : "morning");
    if (itemPart !== part) continue;
    item.carePart = part;
    item.time = time;
    item.date = date;
    item.needsTime = false;
    item.remind = 0;
    item.remindedAt = null;
    item.alarmedAt = null;
    item.updatedAt = Date.now();
    n += 1;
  }
  save();
  return { status: 200, body: { updated: n, ...stateFor(ctx.user) } };
});

route("POST", /^\/api\/health\/seed$/, async (ctx) => {
  if (!isPro(ctx.user)) {
    return { status: 403, body: { error: "Доступно по подписке ПРО", proRequired: true } };
  }
  const replace = ctx.body?.replace !== false;
  const tz = safeZone(ctx.user.settings?.tz);
  const nowParts = zonedParts(Date.now(), tz);
  const settings = ctx.user.settings || {};
  const active = activeItems(ctx.user.id).filter(i => i.type === "health" || i.shelf === "health");
  if (replace) {
    for (const item of active) {
      item.cancelled = true;
      item.updatedAt = Date.now();
    }
  }
  const notifyParts = new Set();
  const created = [];
  for (const step of HEALTH_ROUTINE) {
    if (!replace) {
      const twin = active.find(i =>
        !i.cancelled
        && i.healthPart === step.healthPart
        && normalizeTitle(i.title) === normalizeTitle(healthItemTitle(step)));
      if (twin) continue;
    }
    const time = healthDefaultTime(step.healthPart);
    const due = time.hour * 60 + time.minute;
    const nowMins = nowParts.hour * 60 + nowParts.minute;
    const date = due <= nowMins
      ? addDays(nowParts, 1)
      : { year: nowParts.year, month: nowParts.month, day: nowParts.day };
    const days = Array.isArray(step.days) ? step.days : [0, 1, 2, 3, 4, 5, 6];
    // Один пуш на слот (утро/день/вечер), не на каждый витамин.
    const notify = !step.asNeeded && !notifyParts.has(step.healthPart);
    if (notify) notifyParts.add(step.healthPart);
    created.push(makeItem(ctx.user.id, {
      type: "health",
      shelf: "health",
      title: healthItemTitle(step),
      note: step.note || "",
      asNeeded: Boolean(step.asNeeded),
      weekendPause: Boolean(step.weekendPause),
      healthPart: step.healthPart,
      healthOrder: step.healthOrder,
      date,
      time,
      repeat: { kind: "weekly", days },
      remind: 0,
      remindExplicit: true,
      push: notify,
      needsTime: false,
      place: "",
      source: HEALTH_ROUTINE_SOURCE,
    }, settings));
  }
  settings.healthRoutineV1 = true;
  settings.healthRoutineV2 = true;
  settings.healthRoutineV3 = true;
  ctx.user.settings = settings;
  save();
  return { status: 200, body: { created: created.length, ...stateFor(ctx.user) } };
});

const METERS_PRESET = [
  { title: "Свет" },
  { title: "Вода" },
  { title: "Газ" },
];
const METERS_PRESET_KEYS = new Set(METERS_PRESET.map(r => r.title.toLowerCase()));

function metersPresetKey(title) {
  const k = String(title || "").trim().toLowerCase();
  return METERS_PRESET_KEYS.has(k) ? k : null;
}

route("POST", /^\/api\/meters\/seed$/, async (ctx) => {
  if (!isPro(ctx.user)) {
    return { status: 403, body: { error: "Доступно по подписке ПРО", proRequired: true } };
  }
  const settings = ctx.user.settings || {};
  const tz = safeZone(settings.tz);
  const nowParts = zonedParts(Date.now(), tz);
  const baseDate = { year: nowParts.year, month: nowParts.month, day: 15 };
  const monthWindow = { fromDay: 15, toDay: 26 };
  const prefs = shelfPrefsFor("meters", settings);
  const presetRows = [];
  let cancelled = 0;

  for (const item of activeItems(ctx.user.id)) {
    if (item.cancelled || item.archived || item.done) continue;
    const key = metersPresetKey(item.title);
    const title = String(item.title || "").trim().toLowerCase();
    const pokazaniya = title === "показания" || title.startsWith("показан");
    if (key) {
      presetRows.push({ item, key });
      continue;
    }
    if (item.shelf === "meters" || (item.shelf === "bills" && pokazaniya)) {
      item.cancelled = true;
      item.updatedAt = Date.now();
      cancelled += 1;
    }
  }

  const found = new Map();
  for (const { item, key } of presetRows) {
    const prev = found.get(key);
    if (!prev) {
      found.set(key, item);
      continue;
    }
    const keep = prev.shelf === "meters" && item.shelf !== "meters" ? prev
      : item.shelf === "meters" && prev.shelf !== "meters" ? item
        : (prev.createdAt || 0) <= (item.createdAt || 0) ? prev : item;
    found.set(key, keep);
  }

  for (const { item, key } of presetRows) {
    const keeper = found.get(key);
    if (keeper && keeper.id !== item.id) {
      item.cancelled = true;
      item.updatedAt = Date.now();
      cancelled += 1;
    }
  }

  for (const item of found.values()) {
    if (item.cancelled) continue;
    item.shelf = "meters";
    item.type = "bills";
    item.repeat = normalizeRepeat({ kind: "monthly" });
    item.monthWindow = monthWindow;
    item.push = true;
    item.remind = prefs.remind ?? 1440;
    if (!item.date) item.date = baseDate;
    if (!item.time) item.time = { hour: 10, minute: 0 };
    item.updatedAt = Date.now();
  }

  const created = [];
  for (const row of METERS_PRESET) {
    const key = row.title.toLowerCase();
    if (found.has(key) && !found.get(key).cancelled) continue;
    const item = makeItem(ctx.user.id, {
      type: "bills",
      shelf: "meters",
      title: row.title,
      date: baseDate,
      time: { hour: 10, minute: 0 },
      remind: prefs.remind ?? 1440,
      remindExplicit: true,
      push: true,
      repeat: { kind: "monthly" },
      monthWindow,
      needsTime: false,
      source: "meters-preset-v1",
    }, settings);
    item.shelf = "meters";
    item.updatedAt = Date.now();
    created.push(item);
    found.set(key, item);
  }

  settings.metersPresetV1 = true;
  settings.metersPresetV2 = true;
  ctx.user.settings = settings;
  save();
  return { status: 200, body: { created: created.length, cancelled, ...stateFor(ctx.user) } };
});

route("POST", /^\/api\/health\/time$/, async (ctx) => {
  if (!isPro(ctx.user)) {
    return { status: 403, body: { error: "Доступно по подписке ПРО", proRequired: true } };
  }
  const part = ctx.body?.healthPart;
  if (part !== "morning" && part !== "midday" && part !== "evening") {
    return { status: 400, body: { error: "Нужно утро, день или вечер" } };
  }
  const time = normalizeTime(ctx.body?.time);
  if (!time) return { status: 400, body: { error: "Укажите время" } };
  const tz = safeZone(ctx.user.settings?.tz);
  const nowParts = zonedParts(Date.now(), tz);
  const due = time.hour * 60 + time.minute;
  const nowMins = nowParts.hour * 60 + nowParts.minute;
  const date = due <= nowMins
    ? addDays(nowParts, 1)
    : { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  let n = 0;
  for (const item of activeItems(ctx.user.id)) {
    if (item.cancelled || item.archived) continue;
    if (!(item.type === "health" || item.shelf === "health")) continue;
    const itemPart = item.healthPart === "morning" || item.healthPart === "midday" || item.healthPart === "evening"
      ? item.healthPart
      : (item.time && item.time.hour >= 17 ? "evening" : item.time && item.time.hour >= 11 ? "midday" : "morning");
    if (itemPart !== part) continue;
    item.healthPart = part;
    item.time = time;
    item.date = date;
    item.needsTime = false;
    item.remind = 0;
    item.remindedAt = null;
    item.alarmedAt = null;
    item.updatedAt = Date.now();
    n += 1;
  }
  save();
  return { status: 200, body: { updated: n, ...stateFor(ctx.user) } };
});

/**
 * Забыть названия записей на полках витаминов и косметики.
 *
 * «Ретиноид 0.2%» — это сведения о здоровье, специальная категория по 152-ФЗ.
 * Мы их не храним: приложение сохраняет название у себя и просит сервер стереть.
 * Остаётся расписание — полка, время, повтор. Этого хватает и напоминаниям,
 * и виджету: они показывают «Пора пить витамины», а не название препарата.
 */
route("POST", /^\/api\/items\/forget-titles$/, async (ctx) => {
  const ids = Array.isArray(ctx.body?.ids) ? ctx.body.ids.slice(0, 100) : [];
  const PRIVATE = new Set(["health", "care"]);
  let n = 0;
  for (const id of ids) {
    const item = db.items[String(id)];
    if (!item || item.ownerId !== ctx.user.id) continue;
    if (!PRIVATE.has(item.shelf || item.type)) continue;
    // Пустая строка, а не удаление поля: список должен рисоваться и без названия.
    if (item.title) { item.title = ""; n += 1; }
    if (item.note) item.note = "";
    if (item.place) item.place = "";
  }
  if (n) save();
  return { status: 200, body: { forgotten: n } };
});

route("POST", /^\/api\/items\/([\w-]+)\/cancel$/, async (ctx) => {
  const item = db.items[ctx.params[0]];
  if (!item || item.ownerId !== ctx.user.id) return { status: 404, body: { error: "Не найдено" } };
  // Тело `{ cancelled: false }` возвращает запись обратно — на этом держится «Вернуть»
  // после случайного смахивания. Без тела запись отменяется, как было раньше.
  item.cancelled = ctx.body?.cancelled !== false;
  if (item.cancelled) {
    item.archived = false;
    item.deleted = false;
  }
  item.updatedAt = Date.now();
  save();
  return { status: 200, body: stateFor(ctx.user) };
});

route("POST", /^\/api\/items\/([\w-]+)\/archive$/, async (ctx) => {
  const item = db.items[ctx.params[0]];
  if (!item || item.ownerId !== ctx.user.id || item.cancelled) {
    return { status: 404, body: { error: "Не найдено" } };
  }
  if (!canArchiveItem(item) && !item.archived) {
    return { status: 400, body: { error: "Эта запись в архив не складывается" } };
  }
  archiveItem(item);
  save();
  return { status: 200, body: { message: sayFor(ctx.user, "archived"), ...stateFor(ctx.user) } };
});

route("POST", /^\/api\/archive\/clear$/, async (ctx) => {
  const now = Date.now();
  let n = 0;
  for (const item of itemsOf(ctx.user.id)) {
    if (!item.archived || item.cancelled) continue;
    item.deleted = true;
    item.cancelled = true;
    item.updatedAt = now;
    n += 1;
  }
  if (n) save();
  return {
    status: 200,
    body: {
      message: n
        ? (voiceOf(ctx.user) === "he" ? `Удалил ${n}` : `Удалила ${n}`)
        : "Архив пуст",
      ...stateFor(ctx.user),
    },
  };
});

route("POST", /^\/api\/items\/([\w-]+)\/done$/, async (ctx) => {
  const item = db.items[ctx.params[0]];
  if (!item || item.ownerId !== ctx.user.id) return { status: 404, body: { error: "Не найдено" } };
  const done = ctx.body.done !== false;
  const tz = safeZone(ctx.user.settings?.tz);
  const left = activeItems(ctx.user.id).filter(i => !i.done && !i.archived && i.id !== item.id).length;
  let message = done
    ? sayFor(ctx.user, "done", { осталось: count.дел(left) }, "done")
    : (voiceOf(ctx.user) === "he" ? "Вернул в работу" : "Вернула в работу");

  if (done && item.repeat) {
    // Приём курса засчитываем до сдвига: иначе последний день не попадёт в счётчик.
    if (item.courseId) item.courseTaken = Math.min((item.courseTaken || 0) + 1, item.courseTotal || 999);
    const moved = advanceRepeat(item, tz);
    if (item.courseDone) message = "Курс закончен — все приёмы позади";
    else if (item.courseId) {
      // Счётчик приёмов — факт, не реплика из voice.js; тест и экран ждут «приём N из M».
      const marked = voiceOf(ctx.user) === "he" ? "Отметил" : "Отметила";
      message = `${marked} · приём ${item.courseTaken} из ${item.courseTotal} · следующий ${fmtWhen(item, tz)}`;
    } else if (moved) {
      message = sayFor(ctx.user, "done", { осталось: count.дел(left) }, "done");
    }
  } else if (done && canArchiveItem(item)) {
    archiveItem(item);
    message = sayFor(ctx.user, "archived");
  } else if (!done) {
    item.done = false;
    item.archived = false;
    item.archivedAt = null;
    item.updatedAt = Date.now();
  } else {
    item.done = true;
    item.updatedAt = Date.now();
  }
  save();
  return { status: 200, body: { message, ...stateFor(ctx.user) } };
});

// Ответ прямо из шторки уведомления: реплика всегда про эту запись, искать её не нужно.
const REPLY_DONE_RE = /^(?:готово|сделано|сделал[аи]?|выполнено|закрыл[аи]?|ок|окей|да|\+)[\s!.]*$/iu;
const REPLY_CANCEL_RE = /^(?:отмена|отмени(?:ть)?|удали(?:ть)?|не\s+нужно|неактуально)[\s!.]*$/iu;

route("POST", /^\/api\/items\/([\w-]+)\/reply$/, async (ctx) => {
  const item = db.items[ctx.params[0]];
  if (!item || item.ownerId !== ctx.user.id || item.cancelled) return { status: 404, body: { error: "Не найдено" } };
  const text = String(ctx.body?.text || "").trim().slice(0, 500);
  if (!text) return { status: 400, body: { error: "Пусто — не расслышал." } };

  const tz = safeZone(ctx.user.settings?.tz);
  const settings = ctx.user.settings || {};

  if (REPLY_DONE_RE.test(text)) {
    const left = activeItems(ctx.user.id).filter(i => !i.done && !i.archived && i.id !== item.id).length;
    let message = sayFor(ctx.user, "done", { осталось: count.дел(left) }, "done");
    if (item.repeat) {
      if (item.courseId) item.courseTaken = Math.min((item.courseTaken || 0) + 1, item.courseTotal || 999);
      advanceRepeat(item, tz);
      if (item.courseDone) message = "Курс закончен";
      else if (item.courseId) {
        const marked = voiceOf(ctx.user) === "he" ? "Отметил" : "Отметила";
        message = `${marked} · приём ${item.courseTaken} из ${item.courseTotal} · следующий ${fmtWhen(item, tz)}`;
      } else {
        message = sayFor(ctx.user, "done", { осталось: count.дел(left) }, "done");
      }
    } else if (canArchiveItem(item)) {
      archiveItem(item);
      message = sayFor(ctx.user, "archived");
    } else {
      item.done = true;
      item.updatedAt = Date.now();
    }
    save();
    return { status: 200, body: { message, ...stateFor(ctx.user) } };
  }

  if (REPLY_CANCEL_RE.test(text)) {
    item.cancelled = true;
    item.updatedAt = Date.now();
    save();
    return { status: 200, body: { message: sayFor(ctx.user, "cancelled", {}, "cancelled"), ...stateFor(ctx.user) } };
  }

  const result = parse(text, { now: Date.now(), tz, settings });
  if (result.intent === "move") {
    // Ответ пришёл на конкретное напоминание, поэтому «перенеси» без срока — это «на час позже».
    const move = (result.shift || result.date || result.time) ? result : { ...result, shift: 60 };
    applyMove(item, move, tz, settings);
    save();
    return {
      status: 200,
      body: { message: sayFor(ctx.user, "moved", varsForItem(item, tz), "moved"), ...stateFor(ctx.user) },
    };
  }
  if (result.intent === "cancel") {
    item.cancelled = true;
    item.updatedAt = Date.now();
    save();
    return { status: 200, body: { message: sayFor(ctx.user, "cancelled", {}, "cancelled"), ...stateFor(ctx.user) } };
  }

  // Всё остальное — обычная новая запись: человек просто надиктовал дело из шторки.
  const reply = await handleCapture(ctx.user, { text });
  return { status: 200, body: { message: reply.message, ...stateFor(ctx.user) } };
});

route("POST", /^\/api\/items\/([\w-]+)\/snooze$/, async (ctx) => {
  const item = db.items[ctx.params[0]];
  if (!item || item.ownerId !== ctx.user.id) return { status: 404, body: { error: "Не найдено" } };
  const minutes = Number.isFinite(ctx.body.minutes) ? Math.max(1, Math.min(Number(ctx.body.minutes), 7 * 1440)) : 60;
  const tz = safeZone(ctx.user.settings?.tz);
  // Из шторки «+1 час» жмут в момент напоминания, а в приложении — по будущей карточке.
  // Поэтому считаем от самого события, если оно ещё впереди, иначе от текущего момента.
  const eventTs = itemUtc(item, tz);
  const base = Number.isFinite(eventTs) && eventTs > Date.now() ? eventTs : Date.now();
  const target = zonedParts(base + minutes * 60000, tz);
  const beforeDate = item.date ? `${item.date.year}-${item.date.month}-${item.date.day}` : "";
  item.date = { year: target.year, month: target.month, day: target.day };
  item.time = { hour: target.hour, minute: target.minute };
  item.needsTime = false;
  item.done = false;
  item.remindedAt = null;
  item.alarmedAt = null;
  item.updatedAt = Date.now();
  item.shelf = shelfFor(item, ctx.user.settings || {});
  const afterDate = `${item.date.year}-${item.date.month}-${item.date.day}`;
  if (beforeDate && beforeDate !== afterDate) {
    item.dateMoves = (item.dateMoves || 0) + 1;
  }
  save();
  return {
    status: 200,
    body: {
      message: sayFor(ctx.user, "moved", varsForItem(item, tz), "moved"),
      item: describeItem(item, ctx.user.settings || {}),
      ...stateFor(ctx.user),
    },
  };
});

route("POST", /^\/api\/settings$/, async (ctx) => {
  const s = ctx.user.settings || defaultSettings();
  const b = ctx.body || {};
  if (b.tz) s.tz = safeZone(b.tz);
  if (b.voice === "she" || b.voice === "he") s.voice = b.voice;
  // Границы обязательны: без них «напомнить за -100 минут» означает сигнал
  // через сто минут ПОСЛЕ события, а «за 999999» — за два года вперёд.
  // Интерфейс таких значений не пришлёт, но он не единственный путь к серверу.
  const SETTING_BOUNDS = {
    remindMeeting: [0, 10080],   // до недели
    remindTask: [0, 10080],
    remindBirthday: [0, 43200],  // до месяца: о дне рождения предупреждают заранее
    eveningHour: [12, 23],       // вечерняя сводка — во второй половине дня
    quietFrom: [0, 23],
    quietTo: [0, 23],
  };
  for (const [key, [lo, hi]] of Object.entries(SETTING_BOUNDS)) {
    if (Number.isFinite(b[key])) {
      s[key] = Math.max(lo, Math.min(hi, Math.round(Number(b[key]))));
    }
  }
  if (Number.isFinite(b.morningHour)) s.morningHour = Math.max(4, Math.min(Math.round(Number(b.morningHour)), 12));
  if (typeof b.alarmSound === "string") s.alarmSound = alarmSoundId(b.alarmSound);
  if (typeof b.notifySound === "string") s.notifySound = notifySoundId(b.notifySound);
  for (const key of ["alarmMeetings", "eveningReview", "keepAudio", "morningBrief", "careRoutineV1", "careRoutineV2", "healthRoutineV1", "healthRoutineV2", "healthRoutineV3", "metersPresetV1"]) {
    if (typeof b[key] === "boolean") s[key] = b[key];
  }
  if (Array.isArray(b.healthDaysOff)) {
    s.healthDaysOff = [...new Set(b.healthDaysOff.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))];
  }
  // «Наборы» записей не хранят, но в списке закладок ведут себя как все: их прячут и переставляют.
  const hideable = [...BUILTIN_SHELF_IDS.filter(id => id !== "today"), ...TAB_ONLY_SHELF_IDS];
  if (Array.isArray(b.hiddenShelves)) {
    const allowed = new Set(hideable);
    s.hiddenShelves = [...new Set(b.hiddenShelves.map(String).filter(id => allowed.has(id)))].slice(0, 20);
  }
  if (Array.isArray(b.shelfOrder)) {
    const allowed = new Set([
      ...hideable,
      ...(s.customShelves || []).map(c => c.id),
    ]);
    const seen = new Set();
    s.shelfOrder = b.shelfOrder
      .map(String)
      .filter(id => allowed.has(id) && !seen.has(id) && (seen.add(id), true))
      .slice(0, 24);
  }
  if (Array.isArray(b.customShelves)) {
    s.customShelves = normalizeCustomShelves(b.customShelves);
  }
  if (b.shelfPrefs && typeof b.shelfPrefs === "object") {
    s.shelfPrefs = { ...(s.shelfPrefs || {}), ...normalizeShelfPrefs(b.shelfPrefs, s) };
  }
  if (typeof b.sharedListDefault === "string") {
    const pid = b.sharedListDefault.trim();
    if (!pid) s.sharedListDefault = "";
    else if (pairsOf(ctx.user.id).some(p => p.id === pid)) s.sharedListDefault = pid;
  }
  const shelfIds = new Set([
    ...BUILTIN_SHELF_IDS,
    ...(s.customShelves || []).map(c => c.id),
  ]);
  if (typeof b.widgetShortcut === "string" && shelfIds.has(b.widgetShortcut)) {
    s.widgetShortcut = b.widgetShortcut;
    // Старое поле тянет правую кнопку конструктора, если отдельный widgetConfig не пришёл.
    if (!(b.widgetConfig && typeof b.widgetConfig === "object")) {
      const cur = s.widgetConfig && typeof s.widgetConfig === "object" ? s.widgetConfig : {};
      s.widgetConfig = normalizeWidgetConfig({ ...cur, rightBtn: b.widgetShortcut }, shelfIds);
    }
  }
  if (b.widgetConfig && typeof b.widgetConfig === "object") {
    s.widgetConfig = normalizeWidgetConfig(b.widgetConfig, shelfIds);
    // Правая кнопка дублируем в старое поле — совместимость и тесты.
    if (s.widgetConfig.rightBtn && s.widgetConfig.rightBtn !== "none") {
      s.widgetShortcut = s.widgetConfig.rightBtn;
    } else {
      s.widgetShortcut = "";
    }
  }
  ctx.user.settings = s;
  save();
  return { status: 200, body: stateFor(ctx.user) };
});

function normalizeWidgetConfig(raw, shelfIds) {
  const allowed = new Set(["today", "daily", "shelves", "shared", "none", ...shelfIds]);
  const tabs = [];
  const srcTabs = Array.isArray(raw.tabs) ? raw.tabs : [];
  for (const id of srcTabs.map(String)) {
    if (!allowed.has(id) || tabs.includes(id)) continue;
    tabs.push(id);
    if (tabs.length >= 4) break;
  }
  if (!tabs.length) tabs.push("today");
  const pickSide = (key, fallback) => {
    const id = String(raw[key] ?? fallback ?? "");
    if (id === "none" || id === "") return "none";
    if (id === "shared" || id === "daily" || id === "shelves") return id;
    if (id !== "today" && allowed.has(id)) return id;
    return fallback;
  };
  return {
    tabs,
    leftBtn: pickSide("leftBtn", "shared"),
    rightBtn: pickSide("rightBtn", "none"),
  };
}

function normalizeCustomShelves(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list.slice(0, 12)) {
    if (!raw || typeof raw !== "object") continue;
    const label = String(raw.label || "").trim().slice(0, 24);
    if (!label) continue;
    let id = String(raw.id || "").trim();
    // nextId("c") даёт «c» + seq + hex — без подчёркивания.
    if (!/^c[a-zA-Z0-9_-]{4,28}$/.test(id)) id = nextId("c");
    if (seen.has(id)) continue;
    seen.add(id);
    const keywords = [...new Set(
      (Array.isArray(raw.keywords) ? raw.keywords : String(raw.keywordsText || "").split(/[,\n;]+/))
        .map(k => String(k || "").trim().slice(0, 40))
        .filter(k => k.length >= 2)
    )].slice(0, 20);
    out.push({ id, label, keywords });
  }
  return out;
}

/* —— Общие списки: парный режим по ID —— */
registerSharedListRoutes(route, dayKeyFromParts);

/* —— Готовые наборы: дети, питомцы, дом, здоровье —— */

route("GET", /^\/api\/templates$/, async () => ({ status: 200, body: templatesPublic() }));

route("POST", /^\/api\/templates\/([\w-]+)\/apply$/, async (ctx) => {
  const template = templateById(ctx.params[0]);
  if (!template) return { status: 404, body: { error: "Такого набора нет" } };
  const picks = Array.isArray(ctx.body?.picks)
    ? ctx.body.picks.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < template.items.length)
    : null;

  const tz = safeZone(ctx.user.settings?.tz);
  const drafts = templateDrafts(template, zonedParts(Date.now(), tz), picks);
  const pool = activeItems(ctx.user.id).filter(i => !i.done);
  const created = [];
  let skipped = 0;

  for (const draft of drafts) {
    // Второй раз тот же набор не задваивает: одинаковые названия просто пропускаем.
    if (pool.some(i => normalizeTitle(i.title) === normalizeTitle(draft.title))) {
      skipped += 1;
      continue;
    }
    created.push(makeItem(ctx.user.id, draft, ctx.user.settings || {}));
  }
  save();
  return {
    status: 200,
    body: {
      added: created.length,
      skipped,
      items: created.map(i => describeItem(i, ctx.user.settings || {})),
      ...stateFor(ctx.user),
    },
  };
});

/* —— Правила, жалобы, блокировки, поддержка —— */

// Согласие на обработку данных: без него приложение не пускает дальше первого экрана.
route("POST", /^\/api\/consent$/, async (ctx) => {
  if (!ctx.user.settings) ctx.user.settings = defaultSettings();
  const version = String(ctx.body?.version || "").slice(0, 20);
  if (version !== CONSENT_VERSION) return { status: 400, body: { error: "Неизвестная редакция условий" } };
  ctx.user.settings.consent = { version, at: Date.now() };
  save();
  return { status: 200, body: stateFor(ctx.user) };
});

function blockedView(user) {
  return (user.blocked || []).map(b => ({ code: b.code, at: b.at }));
}

// Заблокировать можно и того, кого нет в контактах: код виден на присланной записи.
route("POST", /^\/api\/block$/, async (ctx) => {
  const code = String(ctx.body?.code || "").trim().toUpperCase();
  const target = findUserByCode(code);
  if (!target) return { status: 404, body: { error: "Такой ID не найден" } };
  if (target.id === ctx.user.id) return { status: 400, body: { error: "Это ваш ID" } };
  ctx.user.blocked = Array.isArray(ctx.user.blocked) ? ctx.user.blocked : [];
  if (ctx.user.blocked.length >= BLOCKED_MAX) return { status: 400, body: { error: "Список блокировок переполнен" } };
  if (!isBlockedBy(ctx.user, target.id, target.code)) {
    ctx.user.blocked.push({ userId: target.id, code: target.code, at: Date.now() });
  }
  // Присланное этим человеком, но ещё не принятое, убираем сразу.
  for (const item of itemsOf(ctx.user.id)) {
    if (item.status === "pending" && item.from?.code === target.code) {
      item.cancelled = true;
      item.updatedAt = Date.now();
    }
  }
  save();
  return { status: 200, body: stateFor(ctx.user) };
});

route("DELETE", /^\/api\/block\/([A-Z0-9]{4,12})$/, async (ctx) => {
  const code = String(ctx.params[0] || "").toUpperCase();
  ctx.user.blocked = (ctx.user.blocked || []).filter(b => String(b.code || "").toUpperCase() !== code);
  save();
  return { status: 200, body: stateFor(ctx.user) };
});

// Жалоба на присланную запись: текст сохраняем целиком — модерации нужно, на что смотреть.
route("POST", /^\/api\/items\/([\w-]+)\/report$/, async (ctx) => {
  if (rateLimited(`report:${ctx.user.id}`, 20, 24 * 3600000)) {
    return { status: 429, body: { error: "Слишком много жалоб подряд. Напишите в поддержку." } };
  }
  const item = db.items[ctx.params[0]];
  if (!item || item.ownerId !== ctx.user.id) return { status: 404, body: { error: "Не найдено" } };
  if (!item.from?.code) return { status: 400, body: { error: "Эту запись вы создали сами" } };

  const reason = REPORT_REASONS.has(ctx.body?.reason) ? ctx.body.reason : "other";
  const comment = String(ctx.body?.comment || "").trim().slice(0, 500);
  const sender = findUserByCode(item.from.code);
  const report = {
    id: nextId("rep"),
    at: Date.now(),
    status: "new",
    reason,
    comment,
    reporterId: ctx.user.id,
    reporterCode: ctx.user.code,
    senderId: sender?.id || null,
    senderCode: item.from.code,
    itemId: item.id,
    itemTitle: String(item.title || "").slice(0, 200),
    itemPlace: String(item.place || "").slice(0, 120),
  };
  db.reports[report.id] = report;

  item.cancelled = true;
  item.reported = true;
  item.updatedAt = Date.now();

  if (ctx.body?.block) {
    ctx.user.blocked = Array.isArray(ctx.user.blocked) ? ctx.user.blocked : [];
    if (sender && !isBlockedBy(ctx.user, sender.id, sender.code) && ctx.user.blocked.length < BLOCKED_MAX) {
      ctx.user.blocked.push({ userId: sender.id, code: sender.code, at: Date.now() });
    }
    for (const other of itemsOf(ctx.user.id)) {
      if (other.status === "pending" && other.from?.code === item.from.code) {
        other.cancelled = true;
        other.updatedAt = Date.now();
      }
    }
  }
  save();
  console.warn(`[moderation] жалоба ${report.id}: ${reason} на ${report.senderCode}`);
  // Поле называется senderBlocked, а не blocked: в состоянии blocked — это список заблокированных.
  return { status: 200, body: { reported: true, senderBlocked: Boolean(ctx.body?.block), ...stateFor(ctx.user) } };
});

/* —— Поддержка ——
 * Переписка идёт по id человека: он пишет из приложения, оператор отвечает в телеграм-боте,
 * ответ возвращается сюда же. Ни почты, ни телефона мы не спрашиваем.
 */

route("GET", /^\/api\/support$/, async (ctx) => {
  return { status: 200, body: threadView(ctx.user.id) };
});

route("POST", /^\/api\/support$/, async (ctx) => {
  if (rateLimited(`support:${ctx.user.id}`, 10, 60 * 60000)) {
    return { status: 429, body: { error: "Мы уже получили несколько сообщений. Ответим и вернёмся." } };
  }
  const added = addUserMessage(ctx.user, ctx.body?.text, {
    platform: ctx.body?.platform,
    appVersion: ctx.body?.appVersion,
  });
  if (!added) return { status: 400, body: { error: "Опишите, что случилось" } };

  // Ответ человеку не ждёт телеграма: сообщение уже сохранено, доставку догоняет tick().
  const ok = await sendTicket(added.thread, added.message);
  markDelivered(added.message, ok);
  if (!ok) console.warn(`[support] обращение ${added.message.id} от ${added.thread.code} ждёт отправки оператору`);

  return { status: 200, body: { ok: true, ...threadView(ctx.user.id) } };
});

route("POST", /^\/api\/support\/read$/, async (ctx) => {
  markRead(ctx.user.id);
  return { status: 200, body: threadView(ctx.user.id) };
});

route("POST", /^\/api\/push\/subscribe$/, async (ctx) => {
  addSubscription(ctx.user.id, ctx.body.subscription);
  return { status: 200, body: { ok: true } };
});

route("POST", /^\/api\/push\/unsubscribe$/, async (ctx) => {
  removeSubscription(ctx.user.id, ctx.body.endpoint);
  return { status: 200, body: { ok: true } };
});

route("POST", /^\/api\/push\/fcm-register$/, async (ctx) => {
  const token = String(ctx.body?.token || "").trim();
  if (!token || token.length > 512) {
    return { status: 400, body: { ok: false, error: "Некорректный токен" } };
  }
  addFcmToken(ctx.user.id, token);
  return { status: 200, body: { ok: true, fcm: fcmReady() } };
});

route("POST", /^\/api\/push\/fcm-unregister$/, async (ctx) => {
  removeFcmToken(ctx.user.id, ctx.body?.token);
  return { status: 200, body: { ok: true } };
});

route("POST", /^\/api\/push\/test$/, async (ctx) => {
  const res = await sendTo(ctx.user.id, {
    title: "Проверка",
    body: "Уведомления работают.",
    tag: "test",
    url: "/",
  });
  return { status: 200, body: res };
});

// Удаление без возврата: человек должен иметь возможность стереть о себе всё сам.
route("DELETE", /^\/api\/account$/, async (ctx) => {
  const userId = ctx.user.id;

  for (const [id, item] of Object.entries(db.items)) {
    if (item.ownerId === userId) delete db.items[id];
  }
  for (const [token, rec] of Object.entries(db.tokens)) {
    if (rec.userId === userId) delete db.tokens[token];
  }
  delete db.subs[userId];
  delete db.fcmTokens?.[userId];

  // Убираем себя из чужих списков, чтобы там не остался мёртвый идентификатор.
  // Блокировки чистим по той же причине: код освобождается и может достаться другому человеку.
  for (const other of Object.values(db.users)) {
    if (other.id === userId) continue;
    if (Array.isArray(other.contacts)) other.contacts = other.contacts.filter(c => c.userId !== userId);
    if (Array.isArray(other.blocked)) other.blocked = other.blocked.filter(b => b.userId !== userId);
  }

  for (const [id, room] of Object.entries(db.rooms || {})) {
    if (room.hostId === userId) delete db.rooms[id];
    else room.members = room.members.filter(m => m.userId !== userId);
  }

  purgeSharedForUser(userId);

  // Переписка с поддержкой уходит вместе с человеком, вместе с ней — связка с сообщениями бота.
  delete db.support[userId];
  for (const [messageId, owner] of Object.entries(db.supportTg || {})) {
    if (owner === userId) delete db.supportTg[messageId];
  }
  // Жалобы: в них лежит текст записи, место и коды обоих людей.
  // Свои жалобы удаляем целиком, в чужих обезличиваем себя — иначе после
  // удаления аккаунта о человеке остаётся запись с его словами.
  for (const [id, rep] of Object.entries(db.reports || {})) {
    if (rep.reporterId === userId) delete db.reports[id];
    else if (rep.senderId === userId) {
      rep.senderId = null;
      rep.senderCode = "—";
      rep.itemTitle = "";
      rep.itemPlace = "";
    }
  }

  // Незавершённые платежи привязаны к человеку и без него бессмысленны.
  for (const [id, pending] of Object.entries(db.billingPending || {})) {
    if (pending.userId === userId || pending.buyerId === userId) delete db.billingPending[id];
  }

  // Семейные подписки: свою распускаем, из чужих убираем свой код.
  // Код после удаления освобождается и может достаться другому человеку —
  // нельзя, чтобы он унаследовал чужую подписку.
  const myCode = ctx.user.code;
  for (const [id, fam] of Object.entries(db.familySubs || {})) {
    if (fam.payerId === userId) delete db.familySubs[id];
    else if (Array.isArray(fam.beneficiaryCodes)) {
      fam.beneficiaryCodes = fam.beneficiaryCodes.filter(c => c !== myCode);
    }
  }

  // Отметки об оплаченных чеках остаются: по ним человек вернёт «Про» на новом аккаунте,
  // и по ним же второй месяц по одному чеку выдан не будет. Личного в них нет — только номер чека.
  delete db.users[userId];
  save();
  return { status: 200, body: { ok: true } };
});

route("POST", /^\/api\/logout$/, async (ctx) => {
  delete db.tokens[ctx.token];
  save();
  return { status: 200, body: { ok: true } };
});

// —— Подписка: оплата через Prodamus, сервер держит срок ——
route("GET", /^\/api\/billing$/, async (ctx) => ({
  status: 200,
  body: billingState(ctx.user),
}));

route("POST", /^\/api\/billing\/validate-id$/, async (ctx) => {
  const code = String(ctx.body?.code || "").trim();
  const body = validateBillingUserCode(code, ctx.user.id);
  if (!body.ok) return { status: 400, body };
  return { status: 200, body };
});

route("POST", /^\/api\/billing\/family-quote$/, async (ctx) => {
  const codes = Array.isArray(ctx.body?.codes) ? ctx.body.codes : [];
  const termId = String(ctx.body?.termId || "family_1m");
  const unique = [...new Set(codes.map(c => String(c || "").trim().toUpperCase()).filter(Boolean))];
  if (!unique.length) {
    return { status: 200, body: { ok: true, total: 0, monthly: 0, breakdown: null } };
  }
  for (const code of unique) {
    const check = validateBillingUserCode(code, ctx.user.id);
    if (!check.valid) {
      return { status: 200, body: { ok: false, invalidCode: code, total: 0 } };
    }
  }
  const breakdown = familyPriceBreakdown(unique.length, termId);
  return {
    status: 200,
    body: {
      ok: true,
      total: breakdown.total,
      monthly: breakdown.monthly,
      breakdown,
    },
  };
});

route("POST", /^\/api\/billing\/create-family-payment-prodamus$/, async (ctx) => {
  if (rateLimited(`pay:${ctx.user.id}`, 20, 60000)) {
    return { status: 429, body: { ok: false, error: "Слишком часто. Подождите." } };
  }
  if (!pdm.isConfigured()) {
    return { status: 503, body: { ok: false, error: "Оплата пока недоступна" } };
  }
  const codes = Array.isArray(ctx.body?.codes) ? ctx.body.codes : [];
  const termId = String(ctx.body?.termId || "family_1m").trim();
  const paymentId = pdm.newOrderId();
  const pending = createFamilyPendingPayment(ctx.user, codes, termId, paymentId);
  if (!pending.ok) return { status: 400, body: { ok: false, error: pending.error } };
  const res = await pdm.createPaymentLink({
    amountRub: pending.amountRub,
    name: pending.name,
    sku: pending.sku,
    productType: "service",
    extra: pending.extra,
    orderId: paymentId,
  });
  if (!res.ok) {
    return { status: 502, body: { ok: false, error: res.error || "Не удалось создать платёж" } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      payment_id: res.payment_id,
      confirmation_url: res.url,
      final_rub: pending.amountRub,
      memberCount: pending.memberCount,
    },
  };
});

route("POST", /^\/api\/billing\/create-payment-prodamus$/, async (ctx) => {
  if (rateLimited(`pay:${ctx.user.id}`, 20, 60000)) {
    return { status: 429, body: { ok: false, error: "Слишком часто. Подождите." } };
  }
  if (!pdm.isConfigured()) {
    return { status: 503, body: { ok: false, error: "Оплата пока недоступна" } };
  }
  const productId = String(ctx.body?.productId || "").trim();
  const paymentId = pdm.newOrderId();
  const pending = createPendingPayment(ctx.user, productId, paymentId, 0);
  if (!pending.ok) return { status: 400, body: { ok: false, error: pending.error } };
  const res = await pdm.createPaymentLink({
    amountRub: pending.amountRub,
    name: pending.name,
    sku: pending.sku,
    productType: "service",
    extra: pending.extra,
    orderId: paymentId,
  });
  if (!res.ok) {
    return { status: 502, body: { ok: false, error: res.error || "Не удалось создать платёж" } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      payment_id: res.payment_id,
      confirmation_url: res.url,
      final_rub: pending.amountRub,
    },
  };
});

route("POST", /^\/api\/billing\/payment-status$/, async (ctx) => {
  const paymentId = String(ctx.body?.paymentId || ctx.body?.payment_id || "").trim();
  if (!paymentId) return { status: 400, body: { ok: false, error: "Нет номера платежа" } };
  const status = verifyProdamusLocal(paymentId, ctx.user.id);
  const ok = !["foreign", "no_record", "amount_mismatch"].includes(status);
  return { status: 200, body: { ok, status, ...billingState(ctx.user) } };
});

route("POST", /^\/api\/billing\/prodamus\/webhook$/, async (ctx) => {
  const raw = ctx.rawBody || Buffer.alloc(0);
  const sign = pdm.headerSign(ctx.req.headers);
  const payload = pdm.parseBody(raw, ctx.req.headers["content-type"] || "");
  const { ok, mode } = pdm.verify(payload, sign);
  if (!ok) {
    console.warn("[prodamus] webhook: bad signature");
    return {
      status: 400,
      raw: "signature incorrect",
      contentType: "text/plain; charset=utf-8",
    };
  }
  if (mode === "demo" && !pdm.isDemo()) {
    console.warn("[prodamus] webhook: demo signature rejected (live mode)");
    return { status: 400, raw: "demo rejected", contentType: "text/plain; charset=utf-8" };
  }
  if (!pdm.webhookPaid(payload)) {
    return { status: 200, raw: "success", contentType: "text/plain; charset=utf-8" };
  }
  const pid = pdm.webhookOrderId(payload);
  if (!pid || !pdm.isProdamusPid(pid)) {
    console.warn("[prodamus] webhook: unknown order id");
    return { status: 200, raw: "success", contentType: "text/plain; charset=utf-8" };
  }
  const paid = pdm.rubToKopecks(payload.sum || payload.order_sum || 0);
  try {
    const status = grantProdamusPaid(pid, paid);
    if (status === "no_record") {
      return { status: 500, raw: "no_record", contentType: "text/plain; charset=utf-8" };
    }
    if (status !== "succeeded") {
      console.warn("[prodamus] webhook: pid=%s status=%s", pid, status);
    }
  } catch (err) {
    console.error("[prodamus] webhook error:", err);
    return { status: 500, raw: "error", contentType: "text/plain; charset=utf-8" };
  }
  return { status: 200, raw: "success", contentType: "text/plain; charset=utf-8" };
}, { auth: false, rawBody: true });

route("POST", /^\/api\/billing\/restore-purchases$/, async (ctx) => {
  const restored = restorePurchasesForUser(ctx.user);
  return { status: 200, body: { restored, ...billingState(ctx.user) } };
});

route("POST", /^\/api\/billing\/cancel-family$/, async (ctx) => {
  const res = cancelFamilySubscription(ctx.user);
  if (!res.ok) return { status: 400, body: res };
  return { status: 200, body: { ok: true, ...billingState(ctx.user) } };
});

// Приложение для телефона живёт на своём origin, поэтому API открыт только для него.
// Сайт в браузере обращается к своему же серверу, и заголовки CORS ему не нужны.
const APP_ORIGINS = new Set([
  "https://localhost",
  "capacitor://localhost",
  "ionic://localhost",
]);

// Локальные адреса нужны, чтобы гонять сборку приложения на компьютере.
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !(APP_ORIGINS.has(origin) || DEV_ORIGIN.test(origin))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    res.writeHead(Object.keys(cors).length ? 204 : 403, cors);
    res.end();
    return;
  }

  if (Object.keys(cors).length) {
    const writeHead = res.writeHead.bind(res);
    res.writeHead = (status, headers) => writeHead(status, { ...headers, ...cors });
  }

  if (!pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, { error: "method" });
      return;
    }
    // Ручной перехват /icons.js, /voice.js и /cloud.js убран: эти файлы лежат
    // в public/ и отдаются обычной статикой, как sounds-catalog.js.
    // Перехватчик читал их из lib/ и, когда файлы оттуда ушли, отдавал 404 —
    // приложение вставало на «загружается», а тесты этого не видели,
    // потому что в Node модули берутся напрямую, минуя HTTP.
    serveStatic(req, res, pathname);
    return;
  }

  const match = ROUTES.find(r => r.method === req.method && r.pattern.test(pathname));
  if (!match) {
    send(res, 404, { error: "Не найдено" });
    return;
  }

  let body = {};
  let rawBody = null;
  if (req.method !== "GET" && req.method !== "DELETE") {
    if (match.rawBody) {
      try {
        rawBody = await readRawBody(req);
      } catch (err) {
        send(res, 400, { error: err.message === "too large" ? "Слишком большой запрос" : "Некорректное тело" });
        return;
      }
    } else {
      try {
        body = await readBody(req);
      } catch (err) {
        send(res, 400, { error: err.message === "too large" ? "Слишком большой запрос" : "Некорректный JSON" });
        return;
      }
    }
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = userByToken(token);
  if (match.auth && !user) {
    send(res, 401, { error: "Нужен вход" });
    return;
  }

  const ip = clientIp(req);
  const params = pathname.match(match.pattern).slice(1);

  try {
    const result = await match.handler({ req, body, rawBody, user, token, params, ip, query: parsed.query });
    if (result?.raw || result?.stream) {
      res.writeHead(result.status || 200, {
        "Content-Type": result.contentType || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(result.headers || {}),
        ...cors,
      });
      if (result.stream) {
        result.stream.on("error", () => { try { res.destroy(); } catch {} });
        result.stream.pipe(res);
      } else {
        res.end(result.raw);
      }
      return;
    }
    send(res, result.status, result.body);
  } catch (err) {
    console.error("[api]", pathname, err);
    send(res, 500, { error: "Внутренняя ошибка" });
  }
});

// План дня одной строкой: сколько всего и что ближайшее. Пусто — молчим, пустой пуш раздражает.
function briefFor(user, parts) {
  const today = itemsOf(user.id).filter(i =>
    i.status === "active" && !i.cancelled && !i.done && i.enabled !== false
    && i.date && compareDates(i.date, parts) === 0);
  if (!today.length) return null;

  const timed = today.filter(i => i.time).sort((a, b) =>
    (a.time.hour * 60 + a.time.minute) - (b.time.hour * 60 + b.time.minute));
  const head = timed.slice(0, 2).map(i => `${hhmm(i.time)} ${i.title}`);
  const rest = today.length - head.length;
  if (!head.length) {
    const names = today.slice(0, 2).map(i => i.title);
    return {
      title: `Сегодня · ${today.length}`,
      body: rest > names.length ? `${names.join(" · ")} · ещё ${today.length - names.length}` : names.join(" · "),
    };
  }
  return {
    title: `Сегодня · ${today.length}`,
    body: rest > 0 ? `${head.join(" · ")} · ещё ${rest}` : head.join(" · "),
  };
}

function inQuietHours(settings, parts) {
  const from = Number.isFinite(settings.quietFrom) ? settings.quietFrom : 23;
  const to = Number.isFinite(settings.quietTo) ? settings.quietTo : 7;
  if (from === to) return false;
  if (from < to) return parts.hour >= from && parts.hour < to;
  return parts.hour >= from || parts.hour < to;
}

async function tick() {
  const now = Date.now();
  let dirty = false;
  pruneRateLimits(now);

  // Жалобы и обращения не храним вечно: полгода хватает и модерации, и разбирательству.
  for (const [id, rec] of Object.entries(db.reports || {})) {
    if (now - (rec.at || 0) > MODERATION_KEEP_MS) {
      delete db.reports[id];
      dirty = true;
    }
  }

  // Удалённые записи убираем с диска через месяц.
  for (const [id, item] of Object.entries(db.items)) {
    if (!item.deleted) continue;
    if (now - (item.updatedAt || item.createdAt || 0) > DELETED_KEEP_MS) {
      delete db.items[id];
      dirty = true;
    }
  }
  if (pruneSupport(MODERATION_KEEP_MS, now)) dirty = true;

  // Сообщения, которые не доехали до оператора: сеть могла моргнуть в момент отправки.
  if (await flushQueue()) dirty = true;

  await tickSharedLaterReminders(now);

  if (pruneTokens(now)) dirty = true;

  // Один проход по базе вместо полного перебора db.items на каждого пользователя.
  // Раньше это было O(пользователи × записи) каждые 30 секунд.
  const byOwner = new Map();
  for (const item of Object.values(db.items)) {
    if (item.deleted) continue;
    if (item.status !== "active" || item.cancelled || item.done || item.enabled === false) continue;
    if (!item.date || !item.time) continue;
    const list = byOwner.get(item.ownerId);
    if (list) list.push(item);
    else byOwner.set(item.ownerId, [item]);
  }

  for (const user of Object.values(db.users)) {
    const tz = safeZone(user.settings?.tz);
    const items = byOwner.get(user.id) || [];

    for (const item of items) {
      if (item.yearly) {
        const eventTs = itemUtc(item, tz);
        if (eventTs != null && eventTs < now - 36 * 3600000) {
          item.date = { ...item.date, year: item.date.year + 1 };
          item.remindedAt = null;
          item.alarmedAt = null;
          dirty = true;
        }
      }

      const remindTs = remindUtc(item, tz);
      const eventTs = itemUtc(item, tz);
      const healthOff = Array.isArray(user.settings?.healthDaysOff)
        && user.settings.healthDaysOff.includes(weekdayOf(item.date));
      const skipRemindDup = Boolean(item.alarm) && remindTs != null && eventTs != null
        && Math.abs(remindTs - eventTs) < 2000;
      if (item.push !== false && remindTs != null && !item.remindedAt && remindTs <= now
          && !skipRemindDup
          && !((item.type === "health" || item.shelf === "health") && healthOff)) {
        if (now - remindTs > 6 * 3600000) {
          item.remindedAt = now;
          dirty = true;
        } else {
          item.remindedAt = now;
          dirty = true;
          await sendTo(user.id, {
            title: notifyDisplayTitle(item),
            body: item.place ? `${fmtWhen(item, tz)} · ${item.place}` : fmtWhen(item, tz),
            tag: `item-${item.id}`,
            itemId: item.id,
            url: `/?item=${item.id}`,
          });
        }
      }

      // Повторяющееся дело уезжает на следующий раз через 3 часа после срока.
      if (item.repeat) {
        const eventTs = itemUtc(item, tz);
        if (eventTs != null && eventTs < now - 3 * 3600000) {
          advanceRepeat(item, tz);
          dirty = true;
          continue;
        }
      }

      if (item.alarm) {
        const eventTs = itemUtc(item, tz);
        if (eventTs != null && !item.alarmedAt && eventTs <= now && now - eventTs < 30 * 60000) {
          item.alarmedAt = now;
          dirty = true;
          await sendTo(user.id, {
            title: `Сейчас: ${notifyDisplayTitle(item)}`,
            body: item.place || "Время события",
            tag: `alarm-${item.id}`,
            itemId: item.id,
            urgent: true,
            alarm: true,
            url: `/?item=${item.id}`,
          });
        }
      }

      // Прошедшее по времени / после уведомления — в архив (не зачёркивать на полках).
      if (shouldArchiveNow(item, now, tz) && archiveItem(item, now)) {
        dirty = true;
        continue;
      }

      // Таймеры на «постоянных» полках без архива — помечаем done, чтобы не висели просрочкой.
      if (!item.done && !item.archived && !item.repeat && !item.yearly && isTimerItem(item)) {
        const eventTs = itemUtc(item, tz);
        const fired = Boolean(item.alarmedAt || item.remindedAt);
        const past = eventTs != null && now - eventTs >= 45 * 1000;
        if (fired || past) {
          item.done = true;
          item.updatedAt = now;
          dirty = true;
        }
      }
    }

    const settings = user.settings || {};

    // Утренний брифинг: один пуш с планом дня вместо десятка отдельных напоминаний.
    if (settings.morningBrief) {
      const parts = zonedParts(now, tz);
      const key = `${parts.year}-${parts.month}-${parts.day}`;
      const hour = Number.isFinite(settings.morningHour) ? settings.morningHour : 8;
      if (parts.hour === hour && user.lastBrief !== key && !inQuietHours(settings, parts)) {
        user.lastBrief = key;
        dirty = true;
        const brief = briefFor(user, parts);
        if (brief) {
          await sendTo(user.id, {
            title: brief.title,
            body: brief.body,
            tag: "morning",
            url: "/?go=today",
          });
        }
      }
    }

    if (settings.eveningReview) {
      const parts = zonedParts(now, tz);
      const key = `${parts.year}-${parts.month}-${parts.day}`;
      const hour = Number.isFinite(settings.eveningHour) ? settings.eveningHour : 20;
      if (parts.hour === hour && user.lastReview !== key && !inQuietHours(settings, parts)) {
        user.lastReview = key;
        dirty = true;
        const loose = itemsOf(user.id).filter(i => i.status === "active" && !i.cancelled && !i.done && (!i.time || !i.date));
        if (loose.length) {
          await sendTo(user.id, {
            title: "Вечерний разбор",
            body: `Без срока: ${loose.length}. Две минуты — и хвост закрыт.`,
            tag: "evening",
            url: "/?go=review",
          });
        }
      }
    }
  }

  if (dirty) save();
}

setInterval(() => {
  tick().catch(err => console.error("[tick]", err));
}, 30000);

// Ответ оператора должен прилетать так же быстро, как напоминание.
startTelegram({
  onAnswer: async ({ userId, code, text }) => {
    console.warn(`[support] ответ ${code}`);
    const payload = {
      title: "Ответ поддержки",
      body: text.length > 120 ? `${text.slice(0, 119)}…` : text,
      tag: "support",
      url: "/?go=support",
    };
    await sendTo(userId, payload);
    await sendFcmTo(userId, payload);
  },
});
if (telegramReady()) console.log("[telegram] поддержка подключена к боту");
if (fcmReady()) console.log("[fcm] push-уведомления Android подключены");

// Страховка: любой недосмотренный throw в асинхронном обработчике иначе убивает процесс целиком.
// Пишем в журнал и живём дальше — systemd перезапуск не заменяет обработку ошибки.
process.on("unhandledRejection", err => {
  console.error("[unhandledRejection]", err);
});
process.on("uncaughtException", err => {
  console.error("[uncaughtException]", err);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopTelegram();
    flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`[voicecapture] слушаю http://${HOST}:${PORT}`);
  if (billingTestMode()) {
    console.warn("[billing] VC_BILLING_TEST=1 — dev-флаг в API, PRO только через Prodamus");
  } else if (pdm.isConfigured()) {
    console.log("[billing] Prodamus подключён — оплата через payform");
  }
});
