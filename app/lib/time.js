const partsCache = new Map();

function formatter(tz) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsCache.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function safeZone(tz) {
  if (!tz || typeof tz !== "string") return "Europe/Moscow";
  try {
    formatter(tz).format(new Date());
    return tz;
  } catch {
    return "Europe/Moscow";
  }
}

export function zonedParts(ts, tz) {
  const raw = formatter(tz).formatToParts(new Date(ts));
  const p = {};
  for (const part of raw) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month) - 1,
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAY_INDEX[p.weekday] ?? 0,
  };
}

function offsetMs(ts, tz) {
  const p = zonedParts(ts, tz);
  const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

export function zonedToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const sec = Number.isFinite(second) ? Math.max(0, Math.min(59, Math.floor(second))) : 0;
  let ts = Date.UTC(year, month, day, hour, minute, sec);
  for (let i = 0; i < 3; i += 1) {
    const next = Date.UTC(year, month, day, hour, minute, sec) - offsetMs(ts, tz);
    if (next === ts) break;
    ts = next;
  }
  return ts;
}

export function itemUtc(item, tz) {
  if (!item?.date) return null;
  const { year, month, day } = item.date;
  const time = item.time || { hour: 0, minute: 0, second: 0 };
  return zonedToUtc({
    year,
    month,
    day,
    hour: time.hour,
    minute: time.minute,
    second: time.second || 0,
  }, tz);
}

export function remindUtc(item, tz) {
  const base = itemUtc(item, tz);
  if (base == null || !item.time) return null;
  const shelf = item.shelf || item.type;
  const routineAtEvent = shelf === "health" || shelf === "care"
    || item.type === "health" || item.type === "care";
  const offset = routineAtEvent ? 0 : (Number.isFinite(item.remind) ? item.remind : 0);
  return base - offset * 60000;
}

export function addDays({ year, month, day }, delta) {
  const d = new Date(Date.UTC(year, month, day));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

export function addMonths({ year, month, day }, delta) {
  const first = new Date(Date.UTC(year, month + delta, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { year: y, month: m, day: Math.min(day, lastDay) };
}

export function weekdayOf({ year, month, day }) {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

export function compareDates(a, b) {
  const left = a.year * 10000 + a.month * 100 + a.day;
  const right = b.year * 10000 + b.month * 100 + b.day;
  return left === right ? 0 : left > right ? 1 : -1;
}
