import { ALARM_SOUNDS, NOTIFY_SOUNDS, alarmSoundId, notifySoundId, soundName } from "./sounds-catalog.js";
import { playCalDrumRatchet, unlockUiSounds } from "./ui-sounds.js";
import { ICONS as TABLER_ICONS, icon, SHELF_ICONS } from "/icons.js";
import { count, isHeavy } from "/voice.js";
import { createCloud, listenLevel } from "/cloud.js";
import { reactionFor, guard } from "/reaction.js";
import { FACES, SYMBOLS, PLACEMENT, parsePoints } from "/face-data.js";
import {
  loadDemoShelf,
  loadDemoSharedList,
  isDemoItem,
  isDemoItemId,
} from "/demo-shelves.js";
import { PRO_SHELF_PROMO } from "/pro-shelf-promo.js";

/** Автовыбор простого режима на слабых устройствах (настройка может переопределить). */
function preferSimpleCloud() {
  if (localStorage.getItem("vc.simpleVisual") === "1") return true;
  if (localStorage.getItem("vc.simpleVisual") === "0") return false;
  return (Number(navigator.hardwareConcurrency) || 4) <= 2;
}

// Подключение набора Tabler: lib/icons.js не правим. Недостающие ключи UI —
// только алиасы на уже существующие иконки из того же набора (+ три outline Tabler
// для send/play/stop, которых в файле пока нет).
const A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  ...TABLER_ICONS,
  calendar: TABLER_ICONS.meetings,
  bell: TABLER_ICONS.alarms,
  family: TABLER_ICONS.checklist,
  kit: TABLER_ICONS.checklist,
  trashFilled: TABLER_ICONS.trash,
  // Tabler: send, player-play, player-stop — outline, тот же штрих.
  send: `<svg ${A}><path d="M10 14l11 -11" /><path d="M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5" /></svg>`,
  play: `<svg ${A}><path d="M7 4v16l13 -8z" /></svg>`,
  stop: `<svg ${A}><path d="M5 5m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /></svg>`,
  share: `<svg ${A}><path d="M13 4v4c-6.575 1.028 -9.02 6.788 -10 12c-.037 .206 0 .333 .222 .556s.341 .278 .547 .361c.206 .074 .348 .074 .555 .074c.396 0 .72 -.177 .945 -.483c1.028 -1.44 2.155 -3.17 4.221 -4.378c.328 -.216 .583 -.344 .875 -.483v4a.997 .997 0 0 0 1.414 1.414l6 -6a.997 .997 0 0 0 0 -1.414l-6 -6a.997 .997 0 0 0 -1.414 0l-.083 .094a1 1 0 0 0 .083 1.32z" /></svg>`,
};

const MONTHS_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MINS = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];
const REMIND_OFFSETS = [
  { v: 0, label: "в момент" },
  { v: 5, label: "за 5 мин" },
  { v: 10, label: "за 10 мин" },
  { v: 15, label: "за 15 мин" },
  { v: 30, label: "за 30 мин" },
  { v: 60, label: "за час" },
  { v: 120, label: "за 2 часа" },
  { v: 180, label: "за 3 часа" },
  { v: 1440, label: "за день" },
];
const BUILTIN_SHELVES = [
  { id: "alarms", label: "Будильник" },
  { id: "meetings", label: "Встречи" },
  { id: "tasks", label: "Дела" },
  { id: "sport", label: "Спорт" },
  { id: "care", label: "Косметика" },
  { id: "buy", label: "Покупки" },
  { id: "bills", label: "Оплаты" },
  { id: "meters", label: "Счетчики и ЖКХ" },
  { id: "health", label: "Витамины" },
  { id: "notes", label: "Заметки" },
  { id: "bday", label: "Дни рождения" },
];

/** Ежедневные дела — отдельный экран из верхней панели, не календарь. */
const DAILY_SHELVES = [
  { id: "health", label: "Витамины" },
  { id: "care", label: "Косметика" },
  { id: "sport", label: "Спорт" },
  { id: "bills", label: "Оплаты" },
  { id: "meters", label: "Счетчики и ЖКХ" },
  { id: "alarms", label: "Будильник" },
  { id: "bday", label: "Дни рождения" },
];
const DAILY_SHELF_IDS = new Set(DAILY_SHELVES.map(s => s.id));

/** Шапка: слева платные полки (с замком), справа бесплатные. */
const PRO_STRIP_SHELVES = [
  { id: "shared", label: "Общие списки", go: "lists" },
  { id: "health", label: "Витамины" },
  { id: "care", label: "Косметика" },
  { id: "sport", label: "Спорт" },
  { id: "bills", label: "Оплаты" },
  { id: "meters", label: "Счетчики и ЖКХ" },
];
const FREE_STRIP_SHELVES = [
  { id: "alarms", label: "Будильник" },
  { id: "bday", label: "Дни рождения" },
];

/** PRO-полки верхнего меню и общие списки. */
// Должен совпадать с lib/pro-shelves.js на сервере.
// Будильники и дни рождения бесплатные: будильник — базовая функция
// напоминалки, ДР нужны пару раз в год.
const PRO_SHELF_IDS = new Set([
  "shared", "care", "sport", "health", "meters", "bills",
]);

function isPro() {
  return Boolean(state.billing?.active);
}

function isProShelf(id) {
  return PRO_SHELF_IDS.has(String(id || ""));
}

/** Полка или общие списки доступны только по подписке. */
function proShelfGated(shelfOrScreen) {
  if (isPro()) return false;
  if (shelfOrScreen === "lists" || shelfOrScreen === "shared") return true;
  return isProShelf(shelfOrScreen);
}

/** @deprecated alias */
function proDemoView(shelfOrScreen) {
  return proShelfGated(shelfOrScreen);
}

function proDemoToast() {
  toast("Доступно по подписке ПРО");
}

function proShelfPromoBullets(bullets) {
  if (!bullets?.length) return "";
  return `<ul class="pro-shelf-promo-bullets">${bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>`;
}

function proShelfDemoItemHtml(item) {
  const meta = [item.who, item.note, item.repeatLabel].filter(Boolean).join(" · ");
  return `
    <div class="pro-demo-row">
      <div class="pro-demo-row-title">${esc(item.title)}</div>
      ${meta ? `<div class="pro-demo-row-meta">${esc(meta)}</div>` : ""}
    </div>
  `;
}

function proShelfDemoCareHtml(items) {
  const morning = items.filter(i => carePartOf(i) === "morning");
  const evening = items.filter(i => carePartOf(i) === "evening");
  const section = (label, partItems) => partItems.length ? `
    <section class="pro-demo-section">
      <div class="pro-demo-section-title">${esc(label)}</div>
      ${partItems.map(item => {
        const { step, product } = splitCareTitle(item.title);
        const note = String(item.note || "").trim();
        return `
          <div class="pro-demo-row">
            <div class="pro-demo-row-title">${esc(step || item.title)}${product ? ` · ${esc(product)}` : ""}</div>
            ${note ? `<div class="pro-demo-row-meta">${esc(note)}</div>` : ""}
          </div>
        `;
      }).join("")}
    </section>
  ` : "";
  return `${section("Утро", morning)}${section("Вечер", evening)}`;
}

function proShelfDemoSharedHtml() {
  const open = loadDemoSharedList();
  return `
    <div class="pro-demo-section">
      <div class="pro-demo-section-title">${esc(open.nickname)}</div>
      ${open.items.map(item => `
        <div class="pro-demo-row ${item.done ? "pro-demo-row--done" : ""}">
          <div class="pro-demo-row-title">${esc(item.title)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function proShelfDemoContentHtml(shelfKey) {
  if (shelfKey === "shared") return proShelfDemoSharedHtml();
  const items = loadDemoShelf(shelfKey);
  if (shelfKey === "care") return proShelfDemoCareHtml(items);
  return items.map(proShelfDemoItemHtml).join("");
}

function proShelfDemoModalHtml(shelfKey) {
  const promo = PRO_SHELF_PROMO[shelfKey];
  const label = promo?.title || shelfKey;
  return `
    <div class="pro-demo-overlay" id="pro-demo-overlay" role="dialog" aria-modal="true" aria-label="Пример · ${esc(label)}">
      <div class="pro-demo-modal">
        <header class="pro-demo-modal-head">
          <h2 class="pro-demo-modal-title">Пример · ${esc(label)}</h2>
          <button type="button" class="icon-btn pro-demo-close" data-pro-shelf-demo-close aria-label="Закрыть">${ICONS.close}</button>
        </header>
        <p class="pro-demo-modal-note">Это пример. Ваши записи появятся здесь после подписки.</p>
        <div class="pro-demo-modal-body">${proShelfDemoContentHtml(shelfKey)}</div>
      </div>
    </div>
  `;
}

function proShelfPromoScreenHtml(shelfKey, { screenTitle = "", back = "shelves" } = {}) {
  const promo = PRO_SHELF_PROMO[shelfKey];
  if (!promo) return "";
  const title = screenTitle || promo.title;
  const modal = state.proShelfDemoModal === shelfKey ? proShelfDemoModalHtml(shelfKey) : "";
  return `
    <section class="screen">
      ${offlineBar()}
      ${bar(title, { back })}
      <div class="scroll pad-bottom pro-shelf-promo">
        <p class="pro-shelf-promo-lead">${esc(promo.body)}</p>
        ${proShelfPromoBullets(promo.bullets)}
        ${promo.extra ? `<p class="pro-shelf-promo-extra">${esc(promo.extra)}</p>` : ""}
        ${promo.footer ? `<p class="pro-shelf-promo-footer">${esc(promo.footer)}</p>` : ""}
        <div class="pro-shelf-promo-actions">
          <button type="button" class="btn ghost" data-pro-shelf-demo="${esc(shelfKey)}">Посмотреть пример</button>
          <button type="button" class="btn" data-pro-subscribe>Открыть подписку</button>
        </div>
      </div>
      ${modal}
    </section>
  `;
}

function openProSubscription() {
  state.scrollToSubscription = true;
  state.settingsScroll = 0;
  go("settings");
}

function blockDemoMutation(target) {
  if (typeof target === "string") {
    if (proDemoView(target)) {
      proDemoToast();
      return true;
    }
    return false;
  }
  if (isDemoItem(target)) {
    proDemoToast();
    return true;
  }
  if (target && proDemoView(target.shelf || target.type)) {
    proDemoToast();
    return true;
  }
  return false;
}

/** Главный календарь (экран shelves, не архив) — бесплатный для всех. */
function isMainCalendarView() {
  return state.screen === "shelves" && state.shelf !== "archive";
}

/** + и микрофон: блокируем только PRO-полки и общие списки, не календарь дня. */
function blockShelfFabMutation() {
  if (isMainCalendarView()) return false;
  if (state.screen === "lists") {
    if (proDemoView("lists")) {
      proDemoToast();
      return true;
    }
    return false;
  }
  if (state.screen === "daily") {
    if (proDemoView(state.shelf)) {
      proDemoToast();
      return true;
    }
    return false;
  }
  return blockDemoMutation(state.shelf);
}

async function onProActivated() {
  try {
    state.proShelfDemoModal = null;
    const data = await api("/start", { method: "POST", body: { tz: state.user?.settings?.tz } });
    absorb(data);
    if (state.screen === "daily" || state.screen === "lists") render();
    else if (state.screen === "settings") renderSettings();
  } catch { /* ignore */ }
}

/** Полки «на постоянку» — прошедшее не уходит в архив. */
const NO_ARCHIVE_SHELVES = new Set(["sport", "care", "health", "bills", "meters", "alarms"]);
const NO_ARCHIVE_TYPES = new Set(["sport", "care", "health", "bills", "alarm"]);
const HEALTH_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HEALTH_DAY_LABELS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const HEALTH_PARTS = [
  { id: "morning", label: "Утро", summary: "Утро Витамины" },
  { id: "midday", label: "День", summary: "День Витамины" },
  { id: "evening", label: "Вечер", summary: "Вечер Витамины" },
];

const TAB_ONLY_SHELVES = new Set();
const TYPE_LABEL = {
  meeting: "встреча",
  task: "дело",
  sport: "спорт",
  care: "уход",
  buy: "покупка",
  bills: "платёж",
  health: "витамины",
  note: "заметка",
  bday: "др",
  custom: "своя",
  alarm: "будильник",
};
const EMPTY_SHELF = {
  buy: "Покупок нет.<br/>Скажите «купить хлеб и молоко» — попадёт сюда, срок не нужен.",
  bills: "Платежей нет.<br/>Скажите «20 числа каждый месяц передать показания» — напомню за сутки.",
  health: "Плана витаминов нет.<br/>Откройте полку ещё раз — загрузится ваш план.",
  sport: "Тренировок нет.<br/>Скажите «вторник и четверг в 19 тренировка ноги» — график встанет сам.",
  care: "Протокола ухода нет.<br/>Нажмите + или скажите «утренний уход».",
  alarms: "Будильников нет.<br/>Нажмите + или скажите «поставь будильник на 7».",
};

function customShelves() {
  return Array.isArray(state.user?.settings?.customShelves) ? state.user.settings.customShelves : [];
}

function hiddenShelfSet() {
  return new Set(state.user?.settings?.hiddenShelves || []);
}

// Порядок закладок: сохранённый + всё новое в конце.
function manageShelfIds() {
  const all = [
    ...BUILTIN_SHELVES.filter(s => !s.locked).map(s => s.id),
    ...customShelves().map(s => s.id),
  ];
  const order = Array.isArray(state.user?.settings?.shelfOrder) ? state.user.settings.shelfOrder : [];
  const ranked = [];
  for (const id of order) {
    if (all.includes(id) && !ranked.includes(id) && id !== "today") ranked.push(id);
  }
  for (const id of all) {
    if (!ranked.includes(id) && id !== "today") ranked.push(id);
  }
  return ranked;
}

function defaultShelf() {
  return "care";
}

function defaultDailyShelf() {
  return "alarms";
}

function isDailyShelfItem(item) {
  if (!item) return false;
  return DAILY_SHELF_IDS.has(item.shelf) || DAILY_SHELF_IDS.has(item.type);
}

function effectiveItemDate(item) {
  return item?.date || todayParts();
}

function isCalendarFulfilled(item, day) {
  if (!item || item.cancelled) return false;
  if (item.done) return true;
  if (!item.time) return false;
  const d = effectiveItemDate(item);
  const pickKey = dateKey(day);
  const todayKey = dateKey(todayParts());
  if (pickKey < todayKey) return true;
  if (pickKey > todayKey) return false;
  return itemStamp({ ...item, date: d }) < Date.now();
}

function isAlarmItem(item) {
  return Boolean(item) && (item.type === "alarm" || item.shelf === "alarms");
}

/** Есть ли включённые будильники — для значка «звонит» в полосе полок. */
function hasActiveAlarms() {
  const pool = state.items;
  return pool.some(i =>
    i && !i.cancelled && !i.archived && isAlarmItem(i) && i.enabled !== false,
  );
}

function alarmFiresOnDay(item, day) {
  if (!isAlarmItem(item) || item.enabled === false) return false;
  if (item.date) {
    return dateKey(item.date) === dateKey(day);
  }
  const repeat = item.repeat;
  const dow = new Date(day.year, day.month, day.day).getDay();
  if (!repeat || repeat.kind === "daily") return true;
  if (repeat.kind === "weekdays") return dow >= 1 && dow <= 5;
  if (repeat.kind === "weekly" && Array.isArray(repeat.days) && repeat.days.length) {
    return repeat.days.includes(dow);
  }
  return true;
}

function calendarItemsForDay(day) {
  return state.items.filter(i => {
    if (!i || i.cancelled || i.archived) return false;
    // Будильник — дело выбранного дня, не прячется во вкладке.
    if (isAlarmItem(i)) return alarmFiresOnDay(i, day);
    if (isDailyShelfItem(i)) return false;
    const d = effectiveItemDate(i);
    return d.year === day.year && d.month === day.month && d.day === day.day;
  }).sort((a, b) => {
    const fa = isCalendarFulfilled(a, day);
    const fb = isCalendarFulfilled(b, day);
    if (fa !== fb) return fa ? 1 : -1;
    return itemStamp({ ...a, date: effectiveItemDate(a) }) - itemStamp({ ...b, date: effectiveItemDate(b) });
  });
}

let calendarSessionReady = false;

function ensureCalendarDay() {
  const today = todayParts();
  const todayKey = String(dateKey(today));
  const rolled = localStorage.getItem("vc.calendarKey") !== todayKey;
  // При открытии приложения и при смене календарного дня — всегда сегодня.
  if (!calendarSessionReady || rolled || !state.calendarDay) {
    calendarSessionReady = true;
    state.calendarDay = { year: today.year, month: today.month, day: today.day };
    localStorage.setItem("vc.calendarDay", JSON.stringify(state.calendarDay));
    localStorage.setItem("vc.calendarKey", todayKey);
  }
}

function saveCalendarDay(day) {
  state.calendarDay = { year: day.year, month: day.month, day: day.day };
  localStorage.setItem("vc.calendarDay", JSON.stringify(state.calendarDay));
}

function fmtCalDay(parts) {
  return `${parts.day} ${MONTHS_GEN[parts.month]}`;
}

function fmtCalDrumDay(parts) {
  return `${parts.day} ${MONTHS_SHORT[parts.month]}.`;
}

function calendarStripHtml() {
  ensureCalendarDay();
  const pick = state.calendarDay || todayParts();
  const today = todayParts();
  const items = [];
  let cur = shiftDate(today, -60);
  for (let i = 0; i < 121; i += 1) {
    const isToday = dateKey(cur) === dateKey(today);
    const isPick = dateKey(cur) === dateKey(pick);
    items.push({ parts: { ...cur }, isToday, isPick });
    cur = shiftDate(cur, 1);
  }
  return `
    <div class="cal-panel">
      <div class="cal-drum-stack">
        <div class="cal-drum-frame">
          <div class="cal-drum" id="cal-drum" role="listbox" aria-label="День">
            ${items.map(it => `
              <div class="cal-drum-item${it.isPick ? " on" : ""}${it.isToday ? " today" : ""}"
                data-cal-y="${it.parts.year}" data-cal-m="${it.parts.month}" data-cal-d="${it.parts.day}">
                <span class="cal-drum-label">${fmtCalDrumDay(it.parts)}</span>
              </div>
            `).join("")}
          </div>
          <div class="cal-drum-window" aria-hidden="true"></div>
        </div>
        <button type="button" class="cal-jump cal-jump-bottom" id="cal-jump-today-b" aria-label="Сегодня"></button>
      </div>
    </div>
  `;
}

function calendarDayCardsHtml(day) {
  const pick = day || state.calendarDay || todayParts();
  const list = calendarItemsForDay(pick);
  return list.length
    ? list.map(item => itemCard(item, { calendar: true, day: pick })).join("")
    : `<div class="empty">На ${fmtCalDay(pick)} пусто.<br/>Нажмите + или микрофон — запись попадёт на этот день.</div>`;
}

function refreshCalendarDayCards() {
  const pick = state.calendarDay || todayParts();
  const body = viewEl?.querySelector(".scroll.pad-fab");
  if (body) body.innerHTML = calendarDayCardsHtml(pick);
  const drum = document.getElementById("cal-drum");
  if (drum) {
    const pickKey = dateKey(pick);
    drum.querySelectorAll(".cal-drum-item").forEach(el => {
      const key = dateKey({
        year: Number(el.dataset.calY),
        month: Number(el.dataset.calM),
        day: Number(el.dataset.calD),
      });
      el.classList.toggle("on", key === pickKey);
    });
  }
}

function jumpCalendarToToday() {
  const today = todayParts();
  const prev = state.calendarDay || todayParts();
  const wasDifferent = dateKey(prev) !== dateKey(today);
  saveCalendarDay(today);
  const drum = document.getElementById("cal-drum");
  const target = drum?.querySelector(".cal-drum-item.today")
    || drum?.querySelector(`[data-cal-d="${today.day}"][data-cal-m="${today.month}"][data-cal-y="${today.year}"]`);
  if (drum && target) {
    drum.scrollLeft = Math.max(0, target.offsetLeft - (drum.clientWidth - target.offsetWidth) / 2);
  }
  refreshCalendarDayCards();
  if (calDrumSoundReady && wasDifferent) {
    unlockUiSounds().then(() => playCalDrumRatchet());
  }
}

function mountCalendarStrip() {
  const drum = document.getElementById("cal-drum");
  if (!drum || drum.dataset.mounted === "1") return;
  drum.dataset.mounted = "1";

  calDrumSoundReady = false;

  const primeSound = () => { unlockUiSounds(); };
  drum.addEventListener("pointerdown", primeSound, { passive: true });
  drum.addEventListener("touchstart", primeSound, { passive: true });

  const centerOnPick = () => {
    const on = drum.querySelector(".cal-drum-item.on") || drum.querySelector(".cal-drum-item.today");
    if (!on) return;
    drum.scrollLeft = Math.max(0, on.offsetLeft - (drum.clientWidth - on.offsetWidth) / 2);
  };
  centerOnPick();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    centerOnPick();
    calDrumSoundReady = true;
  }));

  drum.addEventListener("scroll", () => {
    unlockUiSounds();
    const next = drumCenteredDay(drum);
    if (!next) return;
    applyCalendarDrumDay(next, { sound: true });
  }, { passive: true });

  document.getElementById("cal-jump-today-b")?.addEventListener("click", () => jumpCalendarToToday());
}

function dailyShelves() {
  return DAILY_SHELVES;
}

function defaultShelfPref(shelfId) {
  const s = state.user?.settings || {};
  if (shelfId === "meetings") {
    return {
      remind: Number.isFinite(s.remindMeeting) ? s.remindMeeting : 15,
      push: true,
      alarm: s.alarmMeetings !== false,
      snooze: 1,
    };
  }
  if (shelfId === "tasks") {
    return {
      remind: Number.isFinite(s.remindTask) ? s.remindTask : 0,
      push: true,
      alarm: false,
      snooze: 1,
    };
  }
  if (shelfId === "bday") {
    return {
      remind: Number.isFinite(s.remindBirthday) ? s.remindBirthday : 1440,
      push: true,
      alarm: false,
      snooze: 1,
    };
  }
  if (shelfId === "alarms") return { remind: 0, push: false, alarm: true, snooze: 1 };
  if (shelfId === "bills") return { remind: 1440, push: true, alarm: false, snooze: 60 };
  if (shelfId === "health") return { remind: 0, push: true, alarm: false, snooze: 15 };
  if (shelfId === "care" || shelfId === "sport") return { remind: 0, push: true, alarm: false, snooze: 1 };
  return { remind: 0, push: true, alarm: false, snooze: 1 };
}

function shelfPref(shelfId) {
  const stored = state.user?.settings?.shelfPrefs?.[shelfId];
  const base = defaultShelfPref(shelfId);
  if (!stored || typeof stored !== "object") return { ...base };
  return {
    remind: Number.isFinite(stored.remind) ? stored.remind : base.remind,
    push: typeof stored.push === "boolean" ? stored.push : base.push,
    alarm: typeof stored.alarm === "boolean" ? stored.alarm : base.alarm,
    snooze: Number.isFinite(stored.snooze) ? stored.snooze : base.snooze,
  };
}

function truncateDisplay(text, max = 120) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function telHref(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

function fmtRemindMins(mins) {
  const n = Math.max(0, Number(mins) || 0);
  if (!n) return "в момент";
  if (n < 60) return `за ${n} мин`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!m) return `за ${h} ч`;
  return `за ${h} ч ${m} мин`;
}

function fmtUntilAlarm(item) {
  if (!item?.date || !item?.time || item.enabled === false) return "";
  const at = itemStamp(item);
  const left = at - Date.now();
  if (left < 0) return "скоро";
  const mins = Math.round(left / 60000);
  if (mins < 60) return `Через ${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!m) return `Через ${h} ч`;
  return `Через ${h} ч ${m} мин`;
}

// Полки в своём порядке. Архив — кнопка над микрофоном, не закладка.
function visibleShelves() {
  const hidden = hiddenShelfSet();
  const builtins = new Map(BUILTIN_SHELVES.map(s => [s.id, s]));
  const customs = new Map(customShelves().map(s => [s.id, s]));
  const out = [];
  for (const id of manageShelfIds()) {
    if (hidden.has(id) || id === "today" || id === "archive" || id === "chat") continue;
    const b = builtins.get(id);
    if (b) {
      out.push({ id: b.id, label: b.label });
      continue;
    }
    const c = customs.get(id);
    if (c) out.push({ id: c.id, label: c.label, custom: true });
  }
  return out;
}

function canArchiveItem(item) {
  if (!item || item.cancelled || item.archived) return false;
  if (item.repeat || item.yearly) return false;
  if (NO_ARCHIVE_SHELVES.has(item.shelf)) return false;
  if (NO_ARCHIVE_TYPES.has(item.type)) return false;
  if (!item.date) return false;
  return true;
}

const SHELF_MANUAL_ADD_IDS = new Set(["care", "sport", "health", "bday", "meters", "bills", "alarms"]);

/** Главный календарь (shelves) — не демо-полка: + и микрофон всегда видны. */
function shelfFabDemoBlocked() {
  if (isPro()) return false;
  if (state.screen === "lists") return true;
  if (state.screen === "shelves" && state.shelf !== "archive") return false;
  if (state.screen === "daily" && isProShelf(state.shelf)) return true;
  return false;
}

function shelfNeedsAddFab() {
  if (shelfFabDemoBlocked()) return false;
  if (state.screen === "lists" && state.listId) return true;
  if (state.screen === "shelves") return true;
  if (state.screen === "daily") return SHELF_MANUAL_ADD_IDS.has(state.shelf);
  return false;
}

function shelfNeedsMicFab() {
  if (shelfFabDemoBlocked()) return false;
  if (state.screen === "lists" && state.listId) return true;
  if (state.screen === "shelves") return true;
  if (state.screen === "daily") return DAILY_SHELF_IDS.has(state.shelf);
  return false;
}

function shelfFabPadClass() {
  if (shelfNeedsAddFab() && shelfNeedsMicFab()) return "pad-fab-taller";
  if (shelfNeedsAddFab() || shelfNeedsMicFab()) return "pad-fab";
  return "";
}

/** Голос с экрана общих списков — в активную закладку, не в обычные полки. */
function sharedListVoiceContext() {
  if (state.screen !== "lists" || !state.listId || String(state.listId).startsWith("out-")) return null;
  return { sharedList: true, pairId: state.listId, captureMode: "shared" };
}

function flashListSent(text = "Отправлено") {
  state.listSentFlash = { text, at: Date.now() };
  if (state.screen === "lists") renderLists();
  const at = state.listSentFlash.at;
  setTimeout(() => {
    if (state.listSentFlash?.at !== at) return;
    state.listSentFlash = null;
    if (state.screen === "lists") renderLists();
  }, 2600);
}

function shelfFabStack() {
  const showAdd = shelfNeedsAddFab();
  const showMic = shelfNeedsMicFab();
  if (!showAdd && !showMic) return "";
  return `
    <div class="fab-stack">
      ${showAdd ? `<button type="button" class="fab fab-sub" id="shelf-add" aria-label="Добавить вручную">${ICONS.plus}</button>` : ""}
      ${showMic ? `
      <button class="fab fab-soul no-cloud" id="shelf-mic" aria-label="Нажмите, чтобы записать голосом">
        <canvas class="fab-soul-canvas" id="fab-soul-canvas" aria-hidden="true"></canvas>
      </button>` : ""}
    </div>
  `;
}

async function addManualShelfItem(shelfId, opts = {}) {
  const now = todayParts();
  const isCare = shelfId === "care";
  const isHealth = shelfId === "health";
  const isBday = shelfId === "bday";
  const isBills = shelfId === "bills";
  const isMeters = shelfId === "meters";
  const carePart = opts.carePart === "evening" ? "evening" : "morning";
  const healthPart = opts.healthPart === "midday" || opts.healthPart === "evening"
    ? opts.healthPart
    : "morning";
  const careItems = isCare
    ? state.items.filter(i => !i.cancelled && !i.archived && (i.type === "care" || i.shelf === "care") && carePartOf(i) === carePart)
    : [];
  const healthItems = isHealth
    ? state.items.filter(i => !i.cancelled && !i.archived && isHealthItem(i) && healthPartOf(i) === healthPart)
    : [];
  const partTime = isHealth
    ? healthColumnTime(healthItems.length ? healthItems : shelfItems("health"), healthPart)
    : careItems.find(i => i.time)?.time
      || (carePart === "evening" ? { hour: 21, minute: 0 } : { hour: 8, minute: 0 });
  const draft = isBday ? {
    type: "bday",
    shelf: "bday",
    title: "День рождения",
    date: now,
    time: { hour: 9, minute: 0 },
    yearly: true,
    remind: shelfPref("bday").remind,
  } : isBills ? {
    type: "bills",
    shelf: "bills",
    title: "Платёж",
    date: now,
    remind: shelfPref("bills").remind,
    repeat: { kind: "monthly" },
  } : isMeters ? {
    type: "bills",
    shelf: "meters",
    title: "Показания",
    date: now,
    remind: shelfPref("bills").remind,
    repeat: { kind: "monthly" },
  } : {
    type: isCare ? "care" : isHealth ? "health" : "sport",
    shelf: isCare ? "care" : isHealth ? "health" : "sport",
    title: isCare ? "Новый шаг" : isHealth ? "Новый витамин" : "Тренировка",
    date: now,
    time: isCare || isHealth ? partTime : { hour: 19, minute: 0 },
    remind: 0,
    carePart: isCare ? carePart : undefined,
    careOrder: isCare ? careItems.length + 1 : undefined,
    healthPart: isHealth ? healthPart : undefined,
    healthOrder: isHealth ? healthItems.length + 1 : undefined,
    repeat: isCare ? { kind: "daily" } : isHealth ? { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6] } : undefined,
  };
  const data = await api("/items", { method: "POST", body: draft });
  absorb(data);
  const created = data.item;
  if (!created?.id) return null;

  // Ручное добавление на полки витаминов и косметики: название забираем
  // в телефон сразу, как и при записи голосом.
  if (PRIVATE_SHELVES.has(created.shelf || created.type) && draft.title) {
    privateTitles.set(created.id, draft.title);
    api("/items/forget-titles", { method: "POST", body: { ids: [created.id] } })
      .catch(() => {});
  }
  absorb(await api(`/items/${created.id}`, {
    method: "PATCH",
    body: isBday ? {
      type: draft.type,
      shelf: draft.shelf,
      title: draft.title,
      date: draft.date,
      time: draft.time,
      remind: draft.remind,
      yearly: true,
    } : isBills || isMeters ? {
      type: draft.type,
      shelf: draft.shelf,
      title: draft.title,
      date: draft.date,
      remind: draft.remind,
      repeat: draft.repeat,
    } : {
      type: draft.type,
      shelf: draft.shelf,
      title: draft.title,
      date: draft.date,
      time: draft.time,
      remind: 0,
      carePart: isCare ? carePart : undefined,
      careOrder: isCare ? draft.careOrder : undefined,
      healthPart: isHealth ? healthPart : undefined,
      healthOrder: isHealth ? draft.healthOrder : undefined,
      place: isCare || isHealth ? "" : undefined,
      repeat: isCare
        ? { kind: "daily" }
        : isHealth
          ? { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6] }
          : { kind: "weekly", days: [new Date().getDay()] },
    },
  }));
  return created.id;
}

async function addManualCalendarNote(day) {
  const pick = day || state.calendarDay || todayParts();
  const draft = {
    type: "note",
    shelf: "notes",
    title: "Заметка",
    date: { year: pick.year, month: pick.month, day: pick.day },
  };
  const data = await api("/items", { method: "POST", body: draft });
  absorb(data);
  return data.item?.id || null;
}

function carePartOf(item) {
  if (item?.carePart === "morning" || item?.carePart === "evening") return item.carePart;
  if (item?.time && Number.isFinite(item.time.hour)) return item.time.hour >= 15 ? "evening" : "morning";
  return "morning";
}

function splitCareTitle(title) {
  const raw = String(title || "");
  const m = raw.match(/^(.*?)\s+[—–-]\s+(.*)$/);
  if (m) return { step: m[1].trim(), product: m[2].trim() };
  return { step: raw, product: "" };
}

function fmtClock(time) {
  if (!time || !Number.isFinite(time.hour)) return "--:--";
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute || 0).padStart(2, "0")}`;
}

function careColumnTime(items, part) {
  const hit = items.find(i => carePartOf(i) === part && i.time);
  return hit?.time || (part === "evening" ? { hour: 21, minute: 0 } : { hour: 8, minute: 0 });
}

let careSeedBusy = false;
async function ensureCareRoutine() {
  if (!isPro() || !state.user || careSeedBusy) return false;
  if (state.user.settings?.careRoutineV2) return false;
  careSeedBusy = true;
  try {
    absorb(await api("/care/seed", { method: "POST", body: { replace: true } }));
    return true;
  } catch (err) {
    toast(err.message || "Не удалось загрузить уход");
    return false;
  } finally {
    careSeedBusy = false;
  }
}

let healthSeedBusy = false;
async function ensureHealthRoutine() {
  if (!isPro() || !state.user || healthSeedBusy) return false;
  if (state.user.settings?.healthRoutineV3) return false;
  healthSeedBusy = true;
  try {
    absorb(await api("/health/seed", { method: "POST", body: { replace: true } }));
    return true;
  } catch (err) {
    toast(err.message || "Не удалось загрузить витамины");
    return false;
  } finally {
    healthSeedBusy = false;
  }
}

function labelOfShelf(id) {
  return visibleShelves().find(s => s.id === id)?.label
    || BUILTIN_SHELVES.find(s => s.id === id)?.label
    || customShelves().find(s => s.id === id)?.label
    || id;
}
const QUICK_TIMES = [
  { hour: 9, label: "утром 9:00" },
  { hour: 13, label: "в обед 13:00" },
  { hour: 19, label: "вечером 19:00" },
];
const REPEATS = [
  { label: "без повтора", value: null },
  { label: "каждый день", value: { kind: "daily" } },
  { label: "по будням", value: { kind: "weekdays" } },
  { label: "по выходным", value: { kind: "weekends" } },
  { label: "каждую неделю", value: { kind: "weekly" } },
  { label: "каждые две недели", value: { kind: "weekly", every: 2 } },
  { label: "каждый месяц", value: { kind: "monthly" } },
];

// Несколько дней недели («по вторникам и четвергам») в колесо не помещаются,
// поэтому там показываем подпись с сервера, а колесо стоит на ближайшем по смыслу пункте.
function repeatIndex(repeat) {
  if (!repeat) return 0;
  const every = repeat.every > 1 ? repeat.every : 1;
  const exact = REPEATS.findIndex(r => r.value?.kind === repeat.kind && (r.value.every || 1) === every);
  if (exact >= 0) return exact;
  return Math.max(0, REPEATS.findIndex(r => r.value?.kind === repeat.kind));
}

function repeatLabel(item) {
  return item.repeatLabel || REPEATS[repeatIndex(item.repeat)].label;
}

// Тот же токен дублируем в IndexedDB: из него читает service worker,
// когда пользователь жмёт кнопки прямо в уведомлении.
function idbToken(value, remove = false) {
  return new Promise(resolve => {
    let request;
    try {
      request = indexedDB.open("vc-auth", 1);
    } catch {
      resolve(false);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) return resolve(false);
      try {
        const tx = db.transaction("kv", "readwrite");
        const store = tx.objectStore("kv");
        if (remove) store.delete("token");
        else store.put(value, "token");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    };
  });
}

/**
 * Названия средств и препаратов живут только на телефоне.
 *
 * «Ретиноид 0.2%» или «Санскрин SPF 50» — это сведения о здоровье человека,
 * специальная категория по 152-ФЗ. На сервере их нет: он знает только полку,
 * время и повтор — «запись, витамины, 21:00, каждый день».
 *
 * Уведомления и виджет от этого не страдают: они и так показывают общее —
 * «Пора пить витамины», «Утро — косметика». Название нужно только в списке
 * внутри приложения, а список человек смотрит на своём телефоне.
 *
 * Цена решения: при переносе по ключу расписание приедет, а названия нет.
 * Так честнее, чем хранить чужие диагнозы у себя на диске.
 */
const PRIVATE_SHELVES = new Set(["health", "care"]);

const privateTitles = {
  read() {
    try {
      return JSON.parse(localStorage.getItem("vc.privateTitles") || "{}");
    } catch {
      return {};
    }
  },
  write(map) {
    try {
      localStorage.setItem("vc.privateTitles", JSON.stringify(map));
    } catch {
      // Хранилище переполнено — молча продолжаем: расписание важнее названий.
    }
  },
  get(id) {
    return this.read()[id] || "";
  },
  set(id, title) {
    if (!id || !title) return;
    const map = this.read();
    map[id] = String(title).slice(0, 200);
    this.write(map);
  },
  remove(id) {
    const map = this.read();
    if (!(id in map)) return;
    delete map[id];
    this.write(map);
  },
  /** Убираем названия записей, которых больше нет: хранилище не должно расти вечно. */
  keepOnly(ids) {
    const alive = new Set(ids);
    const map = this.read();
    let changed = false;
    for (const id of Object.keys(map)) {
      if (!alive.has(id)) { delete map[id]; changed = true; }
    }
    if (changed) this.write(map);
  },
};

/**
 * Название записи. Для витаминов и косметики берём из телефона.
 *
 * Если названия нет — человек перенёс аккаунт на новый телефон или почистил
 * данные приложения. Расписание приехало, названия остались на прежнем
 * устройстве. Пишем об этом прямо, а не показываем пустую строку.
 */
function itemTitle(item) {
  if (!item) return "";
  const shelf = item.shelf || item.type;
  if (!PRIVATE_SHELVES.has(shelf)) return item.title || "";
  const local = privateTitles.get(item.id);
  if (local) return local;
  if (item.title) return item.title;
  return shelf === "health" ? "Приём — впишите название" : "Средство — впишите название";
}

const store = {
  get token() { return localStorage.getItem("vc.token") || ""; },
  set token(v) {
    if (v) {
      localStorage.setItem("vc.token", v);
      idbToken(v);
    } else {
      localStorage.removeItem("vc.token");
      idbToken(null, true);
    }
  },
  get onboarded() { return localStorage.getItem("vc.onboarded") === "1"; },
  set onboarded(v) { v ? localStorage.setItem("vc.onboarded", "1") : localStorage.removeItem("vc.onboarded"); },
  get simpleVisual() {
    if (localStorage.getItem("vc.simpleVisual") === "1") return true;
    if (localStorage.getItem("vc.simpleVisual") === "0") return false;
    return preferSimpleCloud();
  },
  set simpleVisual(v) { localStorage.setItem("vc.simpleVisual", v ? "1" : "0"); },
  get keySaved() { return localStorage.getItem("vc.keySaved") === "1"; },
  set keySaved(v) { v ? localStorage.setItem("vc.keySaved", "1") : localStorage.removeItem("vc.keySaved"); },
  get chat() { try { return JSON.parse(localStorage.getItem("vc.chat") || "[]"); } catch { return []; } },
  set chat(v) { localStorage.setItem("vc.chat", JSON.stringify(v.slice(-40))); },
  // Код открытой комнаты переживает перезагрузку: QR не пропадёт, если экран моргнул.
  get queue() { try { return JSON.parse(localStorage.getItem("vc.queue") || "[]"); } catch { return []; } },
  set queue(v) { localStorage.setItem("vc.queue", JSON.stringify(v)); },
  get homeWidget() { return localStorage.getItem("vc.homeWidget") === "1"; },
  set homeWidget(v) { v ? localStorage.setItem("vc.homeWidget", "1") : localStorage.removeItem("vc.homeWidget"); },
  get palette() {
    const v = localStorage.getItem("vc.palette");
    return PALETTE_IDS.includes(v) ? v : "stone";
  },
  set palette(v) { localStorage.setItem("vc.palette", PALETTE_IDS.includes(v) ? v : "stone"); },
  get themeMode() {
    const v = localStorage.getItem("vc.themeMode");
    return THEME_MODES.includes(v) ? v : "system";
  },
  set themeMode(v) { localStorage.setItem("vc.themeMode", THEME_MODES.includes(v) ? v : "system"); },
};

const PALETTE_IDS = ["stone", "graphite", "smoke", "ivory", "teal", "plum"];
const PALETTE_LABELS = {
  stone: "камень",
  graphite: "графит",
  smoke: "дым",
  ivory: "кость",
  teal: "teal",
  plum: "слива",
};
const THEME_MODES = ["light", "dark", "system"];
const THEME_LABELS = { light: "Светлая", dark: "Тёмная", system: "Как в системе" };

let systemThemeMql = null;

function applyLook(palette = store.palette, mode = store.themeMode) {
  const dark = mode === "dark"
    || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.palette = PALETTE_IDS.includes(palette) ? palette : "stone";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim() || (dark ? "#1a1817" : "#f7f5f2");
    meta.setAttribute("content", bg);
  }
}

function bindSystemThemeListener() {
  if (systemThemeMql) {
    systemThemeMql.removeEventListener?.("change", onSystemThemeChange);
    systemThemeMql.removeListener?.(onSystemThemeChange);
  }
  systemThemeMql = window.matchMedia("(prefers-color-scheme: dark)");
  if (systemThemeMql.addEventListener) systemThemeMql.addEventListener("change", onSystemThemeChange);
  else if (systemThemeMql.addListener) systemThemeMql.addListener(onSystemThemeChange);
}

function onSystemThemeChange() {
  if (store.themeMode !== "system") return;
  applyLook();
}

applyLook();
bindSystemThemeListener();

/** Переключатель «виджет на столе» отражает реальность, а не желание. */
async function syncHomeWidgetFromDevice() {
  if (!NATIVE?.widgetStatus) return;
  try {
    const st = await NATIVE.widgetStatus();
    store.homeWidget = (st.count || 0) > 0;
  } catch {
    // Нативный мост недоступен — оставляем как есть.
  }
}

/**
 * Ждём, пока человек подтвердит (или отменит) системный диалог закрепления.
 * requestPinAppWidget только показывает диалог — факт появления виджета
 * узнаём через status() после возврата в приложение.
 */
function watchWidgetPin({ timeoutMs = 20000 } = {}) {
  if (!NATIVE?.widgetStatus) return Promise.resolve(false);
  return new Promise(resolve => {
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(poll);
      clearTimeout(timeout);
      resolve(Boolean(ok));
    };
    const check = async () => {
      try {
        const st = await NATIVE.widgetStatus();
        if ((st.count || 0) > 0) finish(true);
      } catch {
        // ignore
      }
    };
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      // После закрытия диалога лаунчеру нужно мгновение обновить список.
      setTimeout(async () => {
        try {
          const st = await NATIVE.widgetStatus();
          finish((st.count || 0) > 0);
        } catch {
          finish(false);
        }
      }, 500);
    };
    document.addEventListener("visibilitychange", onVis);
    const poll = setInterval(check, 700);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    check();
  });
}

// Редакция согласия и правил. Должна совпадать с CONSENT_VERSION на сервере.
const CONSENT_VERSION = "2026-08-31";
// Версия интерфейса: уходит в обращения в поддержку, чтобы понимать, что у человека стоит.
const APP_VERSION = "1.9.62";
// Версия service worker и ?v= у app.js — должны совпадать с sw.js и index.html.
const SW_VERSION = 143;
const AUTO_SAVE_MS = 400;
const DETAIL_FIELD_IDS = new Set([
  "f-title", "f-care-step", "f-care-product", "f-health-note",
  "f-who", "f-place", "f-phone", "f-note",
]);
const SHELF_PREF_FIELD_IDS = new Set(["pref-remind-h", "pref-remind-m", "pref-snooze-m"]);

function ensureServiceWorker() {
  if (NATIVE || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(`/sw.js?v=${SW_VERSION}`).catch(() => {});
}

const state = {
  user: null,
  items: [],
  incoming: [],
  contacts: [],
  blocked: [],
  reportItemId: null,
  reportReason: "offense",
  reportComment: "",
  reportBlock: true,
  supportDraft: "",
  // Переписка с поддержкой и счётчик непрочитанных ответов.
  supportThread: null,
  support: { unread: 0 },
  micState: "",
  batteryIgnored: null,
  permissionsHasIssues: false,
  soundsBack: "settings",
  templates: null,
  templatesLoading: false,
  templateId: null,
  templatePicks: new Set(),
  lists: [],
  listId: null,
  listInvites: [],
  listOutgoing: [],
  listsUnread: 0,
  listInviteDraft: null,
  listAcceptDraft: null,
  listLaterDraft: null,
  listManualOpen: false,
  listManualDraft: "",
  listInviteOpen: false,
  listTabMenu: null,
  listSentFlash: null,
  sharedWidgetPeek: null,
  listJoinDraft: "",
  listAcceptNicknameDraft: "",
  vapidPublicKey: null,
  screen: "shelves",
  shelf: "care",
  calendarDay: null,
  itemId: null,
  highlightId: null,
  tabPings: {},
  picker: null,
  widgetSidePicker: null,
  chat: store.chat,
  chatDraft: "",
  pending: false,
  awaitingFill: false,
  authFlow: null,
  authPreview: null,
  authMicExplained: false,
  detailShow: null,
  detailShowItemId: "",
  prompt: null,
  observation: null,
  pendingMove: null,
  groups: [],
  showKey: false,
  shortcutOpen: false,
  settingsScroll: 0,
  shelfEditId: null,
  alarmEditId: null,
  alarmDraft: null,
  careTimeDraft: null,
  healthTimeDraft: null,
  /** Компактные барабаны «установить время» на карточке календаря. */
  noteTimeDraft: null,
  alarmRepeatPanel: false,
  alarmDaysPanel: false,
  shelfReorder: false,
  chatListening: false,
  billing: null,
  billingBusy: false,
  billingPendingId: "",
  familyDraft: { ids: [""], term: "family_1m", validation: {}, quote: null, quoteBusy: false },
  familyUiOpen: false,
  familyScrollBottom: false,
  billingPlanOpen: null,
  proShelfDemoModal: null,
  scrollToSubscription: false,
  apkVersion: "",
  online: navigator.onLine,
  shelfDraft: null,
};

const appEl = document.getElementById("app");
const toastEl = document.getElementById("toast");
// Сюда рисуем экран: при входе — весь app, после логина — область под общей шапкой.
let viewEl = appEl;
let toastTimer = null;


function voiceIsHe() {
  return state.user?.settings?.voice === "he";
}

/** Реплика в нужном роде для клиентских тостов. */
function v(she, he) {
  return voiceIsHe() ? he : she;
}

function observationBanner() {
  const text = state.observation?.text;
  if (!text) return "";
  return `<div class="voice-note" role="status">${esc(text)}</div>`;
}

// action — необязательная кнопка внутри сообщения, например «Вернуть» после удаления.
function toast(message, action = null) {
  toastEl.textContent = message;
  if (action) {
    const button = document.createElement("button");
    button.className = "toast-do";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      clearTimeout(toastTimer);
      toastEl.classList.remove("show");
      action.run();
    });
    toastEl.append(button);
  }
  toastEl.classList.toggle("has-do", Boolean(action));
  // Держим тост под общей шапкой (или под bar экрана, если шапки ещё нет).
  const head = document.querySelector(".top-chrome") || viewEl.querySelector(".bar");
  toastEl.style.top = head ? `${Math.round(head.getBoundingClientRect().bottom + 8)}px` : "";
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  // На «Вернуть» нужно успеть нажать, поэтому такое сообщение висит дольше.
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show", "has-do");
  }, action ? 4500 : 2200);
}

/** Системное «Поделиться»: Capacitor Share → Web Share API → буфер обмена. */
async function shareNative({ title = "", text = "", url = "", dialogTitle = "Поделиться" } = {}) {
  const payload = { title, text, url: url || undefined, dialogTitle };
  if (NATIVE?.share) {
    try {
      await NATIVE.share(payload);
      return "native";
    } catch (err) {
      if (err?.name === "AbortError" || /cancel/i.test(String(err?.message || ""))) throw err;
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: url || undefined });
      return "web";
    } catch (err) {
      if (err?.name === "AbortError") throw err;
    }
  }
  const clip = text || url;
  if (!clip) throw new Error("nothing to share");
  await navigator.clipboard.writeText(clip);
  toast("Поделиться недоступно — ключ скопирован");
  return "clipboard";
}

async function shareTransferKey() {
  const key = state.user?.transferKey || "";
  if (!key) return toast("Ключ переноса пока недоступен");
  const text = `Ключ переноса SoulVoice: ${key}`;
  try {
    await shareNative({ title: "Ключ переноса SoulVoice", text });
  } catch (err) {
    if (err?.name !== "AbortError" && !/cancel/i.test(String(err?.message || ""))) {
      toast("Не удалось поделиться");
    }
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let liveNoticeTimer = null;

// Пуш пришёл, пока приложение открыто: системную шторку человек не увидит, показываем баннер сами.
function showLiveNotice(payload = {}) {
  const title = String(payload.title || "Напоминание");
  const body = String(payload.body || "");
  document.getElementById("live-notice")?.remove();

  const el = document.createElement("button");
  el.id = "live-notice";
  el.type = "button";
  el.className = "live-notice";
  el.innerHTML = `
    <span class="live-notice-text">
      <span class="live-notice-title">${esc(title)}</span>
      ${body ? `<span class="live-notice-body">${esc(body)}</span>` : ""}
    </span>
    <span class="live-notice-close" aria-hidden="true">✕</span>
  `;

  const close = () => {
    clearTimeout(liveNoticeTimer);
    el.classList.remove("on");
    setTimeout(() => el.remove(), 200);
  };

  el.addEventListener("click", event => {
    if (event.target.closest(".live-notice-close")) return close();
    close();
    if (payload.itemId && state.items.some(i => i.id === payload.itemId)) {
      openFromNotification(payload.itemId);
      return render();
    }
    const target = String(payload.url || "");
    const goTo = target.includes("go=") ? target.split("go=")[1].split("&")[0] : "";
    if (goTo === "support") return go("support");
    if (goTo === "lists") {
      state.listId = null;
      state.screen = "lists";
      return refreshState().then(() => render());
    }
    if (goTo === "care") return go("daily", { shelf: "care" });
    if (goTo === "health") return go("daily", { shelf: "health" });
    if (goTo === "daily" || goTo === "alarms" || goTo === "sport") {
      return go("daily", { shelf: goTo === "daily" ? defaultDailyShelf() : goTo });
    }
    return go("shelves");
  });

  appEl.append(el);
  requestAnimationFrame(() => el.classList.add("on"));
  clearTimeout(liveNoticeTimer);
  liveNoticeTimer = setTimeout(close, 7000);

  // На телефоне звук уже проиграла система — второй раз не нужен.
  // Исключение — ответ поддержки при запрещённых уведомлениях: системе его показать нечем.
  if (!NATIVE || payload.sound) playChosenNotify();

  // Баннер без свежих данных бесполезен: карточка должна уже быть в списке.
  // Косметика / витамины — сразу на свою вкладку с пульсом по контуру.
  if (payload.itemId) {
    openFromNotification(payload.itemId);
    refreshState().then(() => {
      if (consentPending()) return;
      if (state.screen === "shelves") renderShelves();
      else render();
    });
    return;
  }
  if (!consentPending()) refreshState();
}

// Ответ поддержки легко пропустить среди напоминаний: на каждый новый показываем баннер один раз.
function noticeSupport() {
  const unread = state.support?.unread || 0;
  const seen = Number(localStorage.getItem("vc.supportSeen") || 0);
  if (unread === seen) return;
  localStorage.setItem("vc.supportSeen", String(unread));
  if (unread <= seen || state.screen === "support") return;

  const notice = {
    title: "Ответ поддержки",
    body: unread > 1 ? `Новых ответов: ${unread}` : "Он ждёт в настройках",
    url: "/?go=support",
  };
  // На телефоне звук из кода блокирует WebView, поэтому ответ отдаём системе: она звучит
  // выбранным сигналом и сама возвращает уведомление сюда — баннер покажется один раз.
  if (NATIVE?.notifySupport?.(notice)) return;
  showLiveNotice({ ...notice, sound: true });
}

function tz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow"; } catch { return "Europe/Moscow"; }
}

// В браузере адрес пустой (тот же сайт), в приложении — https://soulvoicee.ru.
const VC_PRIMARY_ORIGIN = String(window.VC_API_BASE || "").replace(/\/+$/, "");
let _apiBase = VC_PRIMARY_ORIGIN;
let _apiBaseReady = !_apiBase;
const NATIVE = window.VC_NATIVE || null;

function apiBase() {
  return _apiBase;
}

async function probeApiOrigin(origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${origin}/api/state`, { signal: controller.signal, cache: "no-store" });
    return res.status === 401 || res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveApiBase() {
  if (_apiBaseReady) return _apiBase;
  const origin = VC_PRIMARY_ORIGIN;
  if (!origin) {
    _apiBaseReady = true;
    return _apiBase;
  }
  try {
    const cached = localStorage.getItem("vc.apiBase")?.replace(/\/+$/, "");
    if (cached && /sslip\.io/i.test(cached)) localStorage.removeItem("vc.apiBase");
    else if (cached === origin && await probeApiOrigin(origin)) {
      _apiBase = cached;
      window.VC_API_BASE = cached;
      _apiBaseReady = true;
      return _apiBase;
    }
  } catch { /* ignore */ }
  if (await probeApiOrigin(origin)) {
    _apiBase = origin;
    window.VC_API_BASE = origin;
    _apiBaseReady = true;
    try { localStorage.setItem("vc.apiBase", origin); } catch { /* ignore */ }
    return _apiBase;
  }
  _apiBaseReady = true;
  return _apiBase;
}

/**
 * Правила и политику открываем сами.
 * В приложении WebView не может открыть новое окно, и ссылка с target="_blank" молча гаснет:
 * человек жмёт — и ничего. Поэтому адрес отдаём наружу, приложение остаётся на своём экране.
 */
function openDoc(path) {
  const url = /^https?:/.test(path) ? path : `${apiBase()}${path}`;
  if (NATIVE?.openUrl?.(url)) return;
  // С параметром "noopener" браузер всегда возвращает null, и по нему не понять, открылась ли
  // вкладка. Поэтому просим окно обычным способом, а связь с ним разрываем сами.
  const win = window.open(url, "_blank");
  if (win) {
    try { win.opener = null; } catch { /* чужой домен браузер изолировал и без нас */ }
    return;
  }
  window.location.href = url;
}

async function api(path, { method = "GET", body, timeout = 20000, raw = false, auth = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`${apiBase()}/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(auth !== false && store.token ? { Authorization: `Bearer ${store.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "Сервер не ответил" : "Нет связи с сервером");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && store.token && auth !== false) {
    // Не выкидываем сессию из‑за одноразового 401: токен мог ещё лежать в Preferences.
    // Очищаем только если и системное хранилище пусто — иначе после обновления APK
    // человек попадал на «Начать» и заводил пустой аккаунт, а виджет обнулялся.
    // auth:false — перенос по ключу: 401 значит «ключ не подходит», а не потерянную сессию.
    throw new Error("Нужен вход");
  }
  if (raw) {
    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      throw new Error(data?.error || "Ошибка сети");
    }
    return res.arrayBuffer();
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  // 401 без токена — это отказ по существу («ключ не подходит»), а не потерянная сессия:
  // экран входа пересобирать нельзя, иначе сообщение и набранный ключ исчезнут.
  if (!res.ok) {
    const err = new Error(data?.error || "Ошибка сети");
    err.status = res.status;
    if (data?.code) err.code = data.code;
    throw err;
  }
  return data;
}

function absorb(data) {
  if (!data) return;
  if (data.user) state.user = data.user;
  if (Array.isArray(data.items)) {
    state.items = data.items;
    // Названия витаминов и косметики подставляем из телефона: сервер их не хранит.
    // Названия, ещё лежащие на сервере, забираем в телефон и просим стереть.
    //
    // Это переход со старой схемы: раньше «Ретиноид 0.2%» хранился у нас,
    // теперь живёт только на устройстве. Забираем при первой же загрузке,
    // молча — человеку об этом знать незачем.
    const toForget = [];
    for (const item of state.items) {
      if (!PRIVATE_SHELVES.has(item.shelf || item.type)) continue;
      if (item.title && !privateTitles.get(item.id)) {
        privateTitles.set(item.id, item.title);
        toForget.push(item.id);
      }
      item.title = itemTitle(item);
    }
    if (toForget.length) {
      api("/items/forget-titles", { method: "POST", body: { ids: toForget } })
        .catch(() => {
          // Не вышло — заберём при следующей загрузке. Названия уже в телефоне.
        });
    }
    privateTitles.keepOnly(state.items.map(i => i.id));
  }
  if (Array.isArray(data.incoming)) state.incoming = data.incoming;
  if (Array.isArray(data.contacts)) state.contacts = data.contacts;
  if (Array.isArray(data.groups)) state.groups = data.groups;
  if (Array.isArray(data.blocked)) state.blocked = data.blocked;
  if (Array.isArray(data.lists)) state.lists = data.lists;
  if (Array.isArray(data.pairs)) state.lists = data.pairs;
  if (Array.isArray(data.incoming)) state.listInvites = data.incoming;
  if (Array.isArray(data.outgoing)) state.listOutgoing = data.outgoing;
  if (Number.isFinite(data.unreadTotal)) state.listsUnread = data.unreadTotal;
  if (data.widgetPeek !== undefined) state.sharedWidgetPeek = data.widgetPeek;
  if (data.billing) state.billing = data.billing;
  if (data.support) {
    state.support = data.support;
    noticeSupport();
  }
  if (data.vapidPublicKey) state.vapidPublicKey = data.vapidPublicKey;
  if (data.observation?.text) state.observation = data.observation;
  ensureCalendarDay();
  // В приложении напоминания ставит сам телефон — они срабатывают и без сети.
  pushSoundsToPhone();
  if (NATIVE && Array.isArray(state.items)) NATIVE.syncReminders(state.items, state.user?.settings);
  if (NATIVE?.syncFcmToken && state.user) NATIVE.syncFcmToken();
  // Виджет обновляем только после полного списка items — иначе пустой промежуточный
  // снимок после обновления APK затирает живые заметки на рабочем столе.
  if (NATIVE?.updateWidget && state.user && Array.isArray(data.items)) {
    pushWidget();
  }
  if (Array.isArray(data.items)) queueMicrotask(() => settleExecutedTimers());
}

/* —— dates —— */

function todayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), weekday: d.getDay() };
}

function sameDate(a, b) {
  return a && b && a.year === b.year && a.month === b.month && a.day === b.day;
}

function shiftDate(parts, delta) {
  const d = new Date(parts.year, parts.month, parts.day);
  d.setDate(d.getDate() + delta);
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

function dayDiff(a, b) {
  const da = new Date(a.year, a.month, a.day);
  const db = new Date(b.year, b.month, b.day);
  return Math.round((db - da) / 86400000);
}

let calDrumSoundReady = false;

function drumCenteredDay(drum) {
  const items = [...drum.querySelectorAll(".cal-drum-item")];
  if (!items.length) return null;
  const mid = drum.scrollLeft + drum.clientWidth / 2;
  let best = items[0];
  let bestDist = Infinity;
  for (const el of items) {
    const center = el.offsetLeft + el.offsetWidth / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return {
    year: Number(best.dataset.calY),
    month: Number(best.dataset.calM),
    day: Number(best.dataset.calD),
  };
}

function applyCalendarDrumDay(next, { sound = false } = {}) {
  const cur = state.calendarDay || todayParts();
  if (dateKey(next) === dateKey(cur)) return;
  const step = dayDiff(cur, next);
  saveCalendarDay(next);
  refreshCalendarDayCards();
  if (sound && calDrumSoundReady && (step === 1 || step === -1)) {
    unlockUiSounds().then(() => playCalDrumRatchet());
  }
}

function fmtTime(item) {
  if (!item.time) return "без времени";
  return `${String(item.time.hour).padStart(2, "0")}:${String(item.time.minute).padStart(2, "0")}`;
}

// Отправитель приходит с сервера только по ID, поэтому подписываем его пометкой из своего списка.
function senderName(from) {
  const known = (state.contacts || []).find(c => c.code === from.code);
  return known?.label || from.code || "кого-то";
}

function fmtWhen(item) {
  if (!item.date) return "без срока";
  const now = todayParts();
  let dayLabel;
  if (sameDate(item.date, now)) dayLabel = "сегодня";
  else if (sameDate(item.date, shiftDate(now, 1))) dayLabel = "завтра";
  else dayLabel = `${item.date.day} ${MONTHS_SHORT[item.date.month]}`;
  return item.time ? `${dayLabel} · ${fmtTime(item)}` : `${dayLabel} · без времени`;
}

function fmtRemind(item) {
  if (!item.time || !item.date) return "—";
  const off = REMIND_OFFSETS.find(r => r.v === item.remind) || { v: item.remind, label: `за ${item.remind} мин` };
  if (off.v === 0) return "в момент";
  const total = item.time.hour * 60 + item.time.minute - off.v;
  if (total < 0) return off.label;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")} · ${off.label}`;
}

function itemStamp(item) {
  if (!item.date) return Number.MAX_SAFE_INTEGER;
  const t = item.time || { hour: 0, minute: 0, second: 0 };
  const second = Number.isFinite(t.second) ? t.second : 0;
  return new Date(item.date.year, item.date.month, item.date.day, t.hour, t.minute, second).getTime();
}

function dateKey(date) {
  return date ? date.year * 10000 + date.month * 100 + date.day : Number.MAX_SAFE_INTEGER;
}

function isTimerItem(item) {
  if (!item) return false;
  if (item.timer) return true;
  return Boolean(
    item.alarm
    && !item.repeat
    && !item.yearly
    && item.time
    && /^таймер\b/i.test(String(item.title || ""))
  );
}

/** Таймер уже прозвенел / время вышло — это исполнение, не просрочка. */
function isExecuted(item) {
  if (!item || item.cancelled) return false;
  if (item.done) return true;
  if (!isTimerItem(item) || item.repeat || item.yearly || !item.date || !item.time) return false;
  if (item.alarmedAt || item.remindedAt) return true;
  return itemStamp(item) < Date.now() - 45 * 1000;
}

function isOverdue(item) {
  if (!item || item.cancelled || item.archived || item.done || isExecuted(item) || !item.date) return false;
  // Без времени — просрочено на следующий день; со временем — сразу после назначенной минуты.
  if (!item.time) return dateKey(item.date) < dateKey(todayParts());
  return itemStamp(item) < Date.now();
}

// Полка записи после напоминания: косметика/витамины — свои вкладки, остальное — своя полка.
function shelfForOpen(item) {
  if (!item) return defaultShelf();
  if (isCareItem(item) || item.type === "care" || item.shelf === "care") return "care";
  if (isHealthItem(item) || item.type === "health" || item.shelf === "health") return "health";
  if (item.shelf && item.shelf !== "today") return item.shelf;
  return defaultShelf();
}

function markTabPing(shelfId) {
  if (!shelfId || shelfId === "archive" || shelfId === "today") return;
  if (!state.tabPings || typeof state.tabPings !== "object") state.tabPings = {};
  state.tabPings[shelfId] = Date.now();
}

function clearTabPing(shelfId) {
  if (!state.tabPings || !shelfId) return;
  delete state.tabPings[shelfId];
}

// Нажатие на уведомление ведёт на полку (с пульсом вкладки), а не в карточку правки.
function openFromNotification(id) {
  const item = state.items.find(i => i.id === id);
  ensureCalendarDay();
  if (item && !isDailyShelfItem(item)) {
    const d = effectiveItemDate(item);
    saveCalendarDay(d);
  } else if (isDailyShelfItem(item)) {
    state.screen = "daily";
    state.shelf = shelfForOpen(item);
    state.itemId = null;
    state.highlightId = id;
    markTabPing(state.shelf);
    return render();
  }
  state.highlightId = id;
  state.screen = "shelves";
  state.itemId = null;
}

function isCareItem(item) {
  return Boolean(item && (item.type === "care" || item.shelf === "care") && !item.careSummary);
}

function isHealthItem(item) {
  return Boolean(item && (item.type === "health" || item.shelf === "health") && !item.healthSummary);
}

function healthPartOf(item) {
  if (item?.healthPart === "morning" || item?.healthPart === "midday" || item?.healthPart === "evening") {
    return item.healthPart;
  }
  if (item?.time && Number.isFinite(item.time.hour)) {
    if (item.time.hour >= 17) return "evening";
    if (item.time.hour >= 11) return "midday";
  }
  return "morning";
}

function healthColumnTime(items, part) {
  const hit = items.find(i => healthPartOf(i) === part && i.time);
  return hit?.time || (
    part === "evening" ? { hour: 21, minute: 0 }
      : part === "midday" ? { hour: 13, minute: 0 }
        : { hour: 8, minute: 0 }
  );
}

function healthDaysOf(item) {
  const repeat = item?.repeat;
  if (repeat?.kind === "weekly" && Array.isArray(repeat.days)) {
    return new Set(repeat.days.map(Number).filter(d => d >= 0 && d <= 6));
  }
  if (repeat?.kind === "weekdays") return new Set([1, 2, 3, 4, 5]);
  if (repeat?.kind === "daily" || !repeat) return new Set([0, 1, 2, 3, 4, 5, 6]);
  return new Set([0, 1, 2, 3, 4, 5, 6]);
}

function healthDaysOffSet(settings) {
  const raw = settings?.healthDaysOff;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map(Number).filter(d => d >= 0 && d <= 6));
}

function healthShelfDayOn(weekday) {
  return !healthDaysOffSet(state.user?.settings).has(weekday);
}

async function setHealthShelfDay(weekday, on) {
  const off = healthDaysOffSet(state.user?.settings);
  if (on) off.delete(weekday);
  else off.add(weekday);
  absorb(await api("/settings", {
    method: "POST",
    body: { healthDaysOff: [...off].sort((a, b) => a - b) },
  }));
  if (NATIVE && Array.isArray(state.items)) NATIVE.syncReminders(state.items, state.user?.settings);
}

function healthAppliesOnDay(item, weekday) {
  const days = healthDaysOf(item);
  if (!days.size) return false;
  return days.has(weekday);
}

/** Сводка видна в виджете с назначенного времени и до конца этого дня. */
function careSummaryVisibleInWidget(date, time, nowMs = Date.now()) {
  if (!date || !time || !Number.isFinite(time.hour)) return false;
  const due = new Date(date.year, date.month, date.day, time.hour, time.minute || 0, 0, 0).getTime();
  const endOfDay = new Date(date.year, date.month, date.day + 1, 0, 0, 0, 0).getTime();
  return nowMs >= due - 30 * 1000 && nowMs < endOfDay;
}

/** Сводки для виджета: не весь протокол, а «Утро Косметика» / «Вечер Косметика». */
function careSummaryItems({ forWidget = false } = {}) {
  const care = state.items.filter(i =>
    !i.cancelled && !i.archived && !i.done && !isExecuted(i) && isCareItem(i));
  const out = [];
  const today = todayParts();
  for (const part of ["morning", "evening"]) {
    const items = care.filter(i => carePartOf(i) === part);
    if (!items.length) continue;
    const time = careColumnTime(items, part);
    // Для окна «в момент» считаем от сегодняшнего дня, а не от сдвинутой даты повтора.
    const date = { year: today.year, month: today.month, day: today.day };
    if (forWidget && !careSummaryVisibleInWidget(date, time)) continue;
    out.push({
      id: `care-summary-${part}`,
      careSummary: true,
      carePart: part,
      type: "care",
      shelf: "care",
      title: part === "morning" ? "Утро Косметика" : "Вечер Косметика",
      date,
      time,
      place: "",
      remind: 0,
      alarm: false,
      cancelled: false,
      archived: false,
      done: false,
      repeat: { kind: "daily" },
    });
  }
  return out;
}

/** Сводки витаминов для виджета: «Утро/День/Вечер Витамины». */
function healthSummaryItems({ forWidget = false } = {}) {
  const health = state.items.filter(i =>
    !i.cancelled && !i.archived && !i.done && !isExecuted(i) && isHealthItem(i));
  const out = [];
  const today = todayParts();
  const weekday = new Date(today.year, today.month, today.day).getDay();
  for (const part of HEALTH_PARTS) {
    const items = health.filter(i =>
      healthPartOf(i) === part.id && healthAppliesOnDay(i, weekday));
    if (!items.length) continue;
    const time = healthColumnTime(items, part.id);
    const date = { year: today.year, month: today.month, day: today.day };
    if (forWidget && !careSummaryVisibleInWidget(date, time)) continue;
    out.push({
      id: `health-summary-${part.id}`,
      healthSummary: true,
      healthPart: part.id,
      type: "health",
      shelf: "health",
      title: part.summary,
      date,
      time,
      place: "",
      remind: 0,
      alarm: false,
      cancelled: false,
      archived: false,
      done: false,
      repeat: { kind: "daily" },
    });
  }
  return out;
}

function shelfItems(shelf) {
  let list = state.items.filter(i => !i.cancelled);
  if (shelf === "archive") {
    list = list.filter(i => i.archived);
    return list.sort((a, b) => (b.archivedAt || b.updatedAt || 0) - (a.archivedAt || a.updatedAt || 0));
  }
  // Активные полки — без архива и без зачёркнутого «исполнено».
  list = list.filter(i => !i.archived && !i.done && !isExecuted(i));
  if (shelf === "alarms") list = list.filter(i => i.type === "alarm" || i.shelf === "alarms");
  else list = list.filter(i => (i.shelf || "tasks") === shelf);
  return list.sort((a, b) =>
    Number(isOverdue(b)) - Number(isOverdue(a))
    || itemStamp(a) - itemStamp(b));
}

function overdueCount() {
  return state.items.filter(i => !i.cancelled && !i.archived && !i.done && isOverdue(i)).length;
}

/** Прошедшее по времени / после сигнала — в архив (не оставлять зачёркнутым на полках). */
let settleTimersBusy = false;
function settleExecutedTimers() {
  if (settleTimersBusy) return;
  const due = state.items.filter(i => {
    if (i.cancelled || i.archived || i.done) return false;
    if (canArchiveItem(i) && (isExecuted(i) || isOverdue(i))) return true;
    return isExecuted(i);
  });
  if (!due.length) return;
  settleTimersBusy = true;
  Promise.all(due.map(i => {
    if (canArchiveItem(i)) {
      return api(`/items/${i.id}/archive`, { method: "POST" }).catch(() => null);
    }
    return api(`/items/${i.id}/done`, { method: "POST", body: { done: true } }).catch(() => null);
  })).then(results => {
    const last = results.filter(Boolean).pop();
    if (last) absorb(last);
    settleTimersBusy = false;
    if (last && state.screen === "shelves" && !formsEditing()) softRender();
  }).catch(() => { settleTimersBusy = false; });
}

/* —— screens —— */

let chatVoiceTimer = null;
let chatVoiceSession = null;
let chatVoiceFinish = null; // активное завершение hold/auto-сессии
let chatVoiceMode = null; // "hold" | "auto"
let chatHoldArmTimer = null;
let chatHoldActive = false;
let chatHoldStarted = false;
let chatHoldTouchId = null;
let chatHoldPointerId = null;
let chatHoldMode = null; // "touch" | "mouse"
/** "shelf" — короткий тап показывает подсказку; "chat" — короткий тап начинает auto. */
let chatHoldMicKind = null;
let chatHoldIgnoreUntil = 0;
/** Короткий тап не начинает запись — только удержание. */
let activeVoiceCloud = null;
/** Остановка listenLevel + треков микрофона уровня. Обязательно вместе с cloud.destroy(). */
let stopLevel = null;
/** Пока true — облако в soul, ещё не переключали в listening. */
let cloudAwaitingSpeech = false;
const CHAT_HOLD_ARM_MS = 220;
/** После отпускания — дать STT отдать последний кусок, иначе сразу «не расслышала». */
const HOLD_RELEASE_SETTLE_MS = 360;
/** Полка = виджет: ждём broadcast или resume, иначе сброс облака. */
const SHELF_GOOGLE_MAX_MS = 60000;

function destroyVoiceCloud() {
  if (typeof stopLevel === "function") {
    try { stopLevel(); } catch {}
    stopLevel = null;
  }
  cloudAwaitingSpeech = false;
  if (activeVoiceCloud) {
    try { activeVoiceCloud.destroy(); } catch {}
    activeVoiceCloud = null;
  }
}

function sizeCloudCanvas(canvas, host) {
  const w = Math.max(1, host.clientWidth || window.innerWidth || 360);
  const h = Math.max(1, host.clientHeight || Math.round(w * 0.9) || 360);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
}

function enterCloudListening(cloud) {
  if (!cloud || !cloudAwaitingSpeech) return;
  cloudAwaitingSpeech = false;
  cloud.setMode("listening");
}

function mountVoiceCloud(host, opts = {}) {
  if (!opts.local) destroyVoiceCloud();
  if (!host) return null;
  const canvas = document.createElement("canvas");
  canvas.className = "voice-cloud-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.insertBefore(canvas, host.firstChild);
  sizeCloudCanvas(canvas, host);
  // Цвет из палитры, фон из темы. Раньше стояли зашитые «#121816» и зелёный:
  // на тёмной теме облако сливалось с фоном и оставались одни очертания.
  const root = getComputedStyle(document.documentElement);
  const accent = cssColorToRgb(root.getPropertyValue("--accent").trim());
  const dark = document.documentElement.dataset.theme === "dark";
  const transparent = Boolean(opts.transparent);
  const cloud = createCloud(canvas, {
    background: transparent ? "transparent" : (dark ? "#0e1412" : "#f3f0eb"),
    color: accent || (dark ? "200, 240, 228" : "92, 82, 72"),
  });
  if (store.simpleVisual) cloud.setSimple(true);
  if (opts.finale) {
    cloud.setMode("soul");
  } else {
    // Микрофон открыт, человек ещё не заговорил — присутствие, не пустота.
    cloud.setMode("soul");
    cloudAwaitingSpeech = true;
    activeVoiceCloud = cloud;
  }
  return cloud;
}

async function armCloudMicLevel(cloud) {
  if (!cloud || store.simpleVisual) return;
  if (!navigator.mediaDevices?.getUserMedia) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch {
    return;
  }
  if (!activeVoiceCloud || activeVoiceCloud !== cloud) {
    stream.getTracks().forEach(t => t.stop());
    return;
  }
  const stopListen = listenLevel(stream, v => {
    if (!activeVoiceCloud || activeVoiceCloud !== cloud) return;
    try {
      cloud.setLevel(v);
      if (v > 0.12) enterCloudListening(cloud);
    } catch {}
  });
  stopLevel = () => {
    try { stopListen(); } catch {}
    try { stream.getTracks().forEach(t => t.stop()); } catch {}
  };
}

/**
 * Единственное место: событие capture → событие reaction.js → лицо + символ.
 * Старые имена фигур (check, smile…) — только запасной путь, если точек нет.
 */
const CAPTURE_EVENT_TO_REACTION = {
  waiting: "thinking",
  ask: "unheard",
  saved: "saved",
  timed: "reminded",
  celebrate: "goodday",
  birthday: "birthday",
  heavy: "heavy",
};

const CLOUD_REACTION_TO_SHAPE = {
  waiting: "dots",
  ask: "question",
  saved: "check",
  timed: "clock",
  celebrate: "smile",
  birthday: "heart",
  heavy: "hands",
};

function reactionEventForCapture(event) {
  return CAPTURE_EVENT_TO_REACTION[event] || "saved";
}

function shelfForReaction(shelfHint) {
  const s = shelfHint || state.shelf;
  if (!s || s === "chat") return "";
  return s;
}

/** Собрать reply из broadcast WidgetRecordActivity (полка = Google STT + capture на сервере). */
function replyFromSpeechDone(data) {
  if (!data) return null;
  let items = [];
  const raw = data.replyItems;
  if (typeof raw === "string" && raw) {
    try { items = JSON.parse(raw); } catch { /* ignore */ }
  } else if (Array.isArray(raw)) {
    items = raw;
  }
  const kind = data.replyKind || data.kind || "created";
  return { kind, items };
}

function buildFaceSymbolPoints(reaction, canvas) {
  const packed = FACES[reaction.face];
  if (!packed) return null;
  const CX = canvas.width / 2;
  const CY = canvas.height / 2;
  const face = parsePoints(packed).map(([x, y, w]) => [CX + x, CY + y, w]);
  if (!reaction.symbol || !SYMBOLS[reaction.symbol]) return face;

  const place = PLACEMENT[reaction.face];
  if (!place) return face;

  const raw = parsePoints(SYMBOLS[reaction.symbol]);
  const xs = raw.map(p => p[0]);
  const ys = raw.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const k = Math.min(place.max / (w || 1), (place.max * 0.78) / (h || 1));
  const scx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const scy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const symbol = raw.map(([x, y, t]) => [
    CX + (x - scx) * k,
    CY + (y - scy) * k + place.y,
    t,
  ]);
  return face.concat(symbol);
}

function resolveCloudReaction(event, sourceText, shelf = "") {
  // Тяжесть берём и из текста, и из уже принятого решения. Событие heavy может
  // прийти без исходного текста — тогда heavy остался бы false, guard пропустил бы
  // пару дальше, и символ полки подставил бы торт («bday») или каплю. Спокойное
  // лицо с тортом на тяжёлой теме — то же нарушение правила, что и улыбка.
  const heavy = event === "heavy" || isHeavy(sourceText || "");
  const reactionEvent = heavy ? "saved" : reactionEventForCapture(event);
  return guard(reactionFor({
    event: reactionEvent,
    shelf: shelfForReaction(shelf),
    heavy,
    hour: new Date().getHours(),
  }), heavy);
}

/** Реакция на результат разбора — имена событий, не фигур. */
function reactionForCapture(reply, sourceText) {
  // isHeavy() не трогаем: при тяжёлой теме только спокойная реакция.
  if (isHeavy(sourceText)) return "heavy";
  if (!reply) return "ask";
  if (reply.kind === "not_found" || reply.kind === "ambiguous" || reply.kind === "empty") {
    return "ask";
  }
  if (reply.kind === "cancelled" || reply.kind === "done") return "saved";
  if (reply.kind === "created" || reply.kind === "moved" || reply.kind === "duplicate") {
    const item = reply.items?.[0];
    // День рождения проверяем раньше срока: разбор всегда ставит такой записи
    // час (9:00), поэтому ветка «timed» перехватывала её и тёплое лицо
    // с тортом не показывалось никогда. Полка надёжнее слов: «днюха»
    // и «годовщина» тоже попадают на bday, а строку с «день рожд» не содержат.
    if (item?.shelf === "bday" || item?.type === "bday"
      || /день\s*рожд|днюх|годовщин/i.test(sourceText || "")) return "birthday";
    if (item?.time || item?.remind || item?.alarm) return "timed";
    const doneToday = state.items.filter(i => i.done && !i.cancelled).length;
    return doneToday >= 5 ? "celebrate" : "saved";
  }
  return "saved";
}

/** Показать реакцию на событие. Единственный вызов showShape/showPoints из бизнес-логики. */
function showCloudReaction(cloud, event, { sourceText = "", shelf = "" } = {}) {
  if (!cloud) return;
  const reaction = resolveCloudReaction(event, sourceText, shelf);
  const canvas = typeof cloud.getCanvas === "function" ? cloud.getCanvas() : null;
  const points = canvas ? buildFaceSymbolPoints(reaction, canvas) : null;
  if (points?.length && typeof cloud.showPoints === "function") {
    cloud.showPoints(points, { weighted: true });
    return;
  }
  const shape = CLOUD_REACTION_TO_SHAPE[event] || CLOUD_REACTION_TO_SHAPE.waiting;
  cloud.showShape(shape);
}

async function playCloudFinale(event, sourceText, shelf = "") {
  const cloud = activeVoiceCloud;
  if (!cloud) return;
  cloud.setMode("heard");
  showCloudReaction(cloud, "waiting", { sourceText, shelf });
  await new Promise(r => setTimeout(r, 380));
  if (activeVoiceCloud !== cloud) return;
  // Тяжёлая тема: quiet + heavy. Движение только внутри move.
  if (event === "heavy" || isHeavy(sourceText || "")) {
    cloud.setMode("quiet");
    showCloudReaction(cloud, "heavy", { sourceText, shelf });
    await new Promise(r => setTimeout(r, 2200));
  } else {
    showCloudReaction(cloud, event, { sourceText, shelf });
    await new Promise(r => setTimeout(r, 720));
  }
}

/** Пока лицо на экране — render/softRender не трогают DOM. */
let captureFinaleBusy = false;
/** Один finale на сессию записи — отсекает повтор broadcast/resume/refresh. */
let captureFinaleToken = 0;
let captureFinaleCloud = null;

const CAPTURE_FINALE_ASSEMBLE_MS = 920;
const CAPTURE_FINALE_HOLD_MS = 3000;

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Подтверждение записи — лицо по центру viewport, без подложки. */
async function playCenterFinale(event, sourceText, shelf = "", token = 0) {
  if (captureFinaleBusy) return;
  if (token && token !== captureFinaleToken) return;
  captureFinaleBusy = true;
  document.getElementById("capture-confirm")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "capture-confirm";
  overlay.className = "capture-confirm";
  overlay.innerHTML = `<div class="voice-cloud-host" id="capture-confirm-host"></div>`;
  document.body.appendChild(overlay);
  const host = document.getElementById("capture-confirm-host");
  const cloud = mountVoiceCloud(host, { transparent: true, finale: true, local: true });
  captureFinaleCloud = cloud;
  if (!cloud) {
    overlay.remove();
    captureFinaleBusy = false;
    captureFinaleCloud = null;
    return;
  }
  try {
    cloud.setMode("soul");
    await delay(180);
    if (!document.getElementById("capture-confirm")) return;
    cloud.setMode("listening");
    await delay(140);
    if (!document.getElementById("capture-confirm")) return;
    if (event === "heavy" || isHeavy(sourceText || "")) cloud.setMode("quiet");
    else cloud.setMode("heard");
    showCloudReaction(cloud, event === "heavy" || isHeavy(sourceText || "") ? "heavy" : event, {
      sourceText,
      shelf,
    });
    await delay(CAPTURE_FINALE_ASSEMBLE_MS);
    if (!document.getElementById("capture-confirm")) return;
    await delay(CAPTURE_FINALE_HOLD_MS);
  } finally {
    try { captureFinaleCloud?.destroy(); } catch {}
    captureFinaleCloud = null;
    overlay.remove();
    captureFinaleBusy = false;
    requestAnimationFrame(mountFabSoul);
  }
}

function voiceBusy() {
  return state.chatListening;
}

function softRender() {
  // Экран записи и голосовой оверлей нельзя перерисовать фоном — сбросится микрофон.
  if (voiceBusy() || captureFinaleBusy || state.screen === "record") return;
  // Пока фокус в поле ввода — не сносим DOM: иначе клавиатура закроется и текст пропадёт.
  if (formsEditing()) {
    deferRender();
    return;
  }
  if (consentPending()) {
    viewEl = appEl;
    renderConsent();
    return;
  }
  render();
}

/** Перерисовка отложена: фокус был в поле ввода. */
let renderDeferred = false;

function deferRender() {
  renderDeferred = true;
}

function flushDeferredRender() {
  if (!renderDeferred || formsEditing()) return;
  renderDeferred = false;
  render();
}

function go(screen, params = {}) {
  void goNavigate(screen, params);
}

async function goNavigate(screen, params = {}) {
  await flushAllAutoSaves();
  goImpl(screen, params);
}

function goImpl(screen, params = {}) {
  // Снимаем фокус с полки: на телефоне :focus после тапа залипает и выглядит как «открыта».
  const focused = document.activeElement;
  if (focused?.closest?.("[data-strip-shelf], [data-strip-go]")) focused.blur();
  if (screen !== "settings") {
    state.settingsScroll = 0;
    state.shortcutOpen = false;
    state.shelfReorder = false;
  }
  if (screen === "templates") screen = "daily";
  if (screen === "billing") screen = "settings";
  // Общие списки живут на сервере — подтягиваем свежие строки при каждом заходе.
  if (screen === "lists") {
    state.listInviteOpen = Boolean(params.invite);
    state.listId = params.invite ? null : (params.pairId || state.listId || null);
    if (proShelfGated("shared")) state.proShelfDemoModal = null;
    state.screen = "lists";
    refreshState().then(() => {
      if (!state.listId && state.lists.length && !state.listInviteOpen) state.listId = state.lists[0].id;
      renderLists();
      syncListPoll();
    });
    return;
  }
  // Переписку поддержки перечитываем при каждом заходе: ответ мог прийти, пока экран был закрыт.
  if (screen === "support") state.supportThread = null;
  // Звуки открываются из двух мест — возвращаемся туда, откуда пришли.
  if (screen === "sounds") state.soundsBack = state.screen === "alarm-settings" ? "alarm-settings" : "settings";
  else stopPreview();

  if (screen === "chat") {
    state.screen = "shelves";
    screen = "shelves";
  }
  if (screen === "daily" && !params.shelf) {
    if (!state.shelf) state.shelf = defaultDailyShelf();
  }
  if (screen !== "record") {
    stopRecognition();
    if (state.screen === "record") destroyVoiceCloud();
  }
  if (screen !== "shelves") {
    if (state.chatListening) stopChatVoice(true);
  }

  state.screen = screen;
  if (params.shelf) state.shelf = params.shelf;
  if (params.itemId !== undefined) state.itemId = params.itemId;
  state.picker = null;
  render();
}

function shelfItemCount(shelfId) {
  return state.items.filter(i => {
    if (!i || i.cancelled || i.archived) return false;
    if (shelfId === "alarms") return isAlarmItem(i);
    if (shelfId === "care") return isCareItem(i);
    if (shelfId === "health") return isHealthItem(i);
    return i.shelf === shelfId || i.type === shelfId;
  }).length;
}

function openShelfFromStrip(shelfId) {
  document.activeElement?.blur?.();
  const hidden = state.user?.settings?.hiddenShelves;
  if (Array.isArray(hidden) && hidden.includes(shelfId)) {
    api("/settings", {
      method: "POST",
      body: { hiddenShelves: hidden.filter(id => id !== shelfId) },
    }).then(absorb).catch(() => {});
  }
  if (proShelfGated(shelfId)) state.proShelfDemoModal = null;
  return go("daily", { shelf: shelfId });
}

/**
 * Живое облако на главной кнопке вместо значка микрофона.
 * Тот же приём, что на экране записи, только мельче и спокойнее:
 * кнопка едва дышит, показывая, что приложение слушает.
 */
/** «#5c5248» или «rgb(92,82,72)» → «92, 82, 72» для облака. */
function cssColorToRgb(value) {
  if (!value) return "";
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(", ");
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/);
  if (rgb) return rgb[1].split(",").slice(0, 3).map(v => v.trim()).join(", ");
  return "";
}

let fabSoul = null;

function shelfMicCanvasPixels(btn, canvas) {
  const box = btn || canvas;
  const rect = box?.getBoundingClientRect?.();
  const cssSide = Math.round(Math.max(rect?.width || 0, rect?.height || 0, 62));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.max(1, Math.round(cssSide * dpr));
  return { cssSide, px };
}

async function mountFabSoul() {
  const canvas = document.getElementById("fab-soul-canvas");
  const btn = canvas?.closest(".fab-soul");
  if (!canvas) {
    fabSoul?.destroy?.();
    fabSoul = null;
    return;
  }
  const { px } = shelfMicCanvasPixels(btn, canvas);
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  if (fabSoul?.canvas === canvas && fabSoul?.px === px) return;
  fabSoul?.destroy?.();
  btn?.classList.add("no-cloud");
  try {
    const { createCloud } = await import("/cloud.js");
    // Белые частицы: кнопка залита акцентом, а он свой в каждой палитре.
    // Цвет берём из палитры: облако должно менять оттенок вместе с темой.
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent").trim();
    const cloud = createCloud(canvas, {
      radius: Math.round(px * 0.47),
      background: "transparent",
      color: cssColorToRgb(accent) || "150, 140, 128",
    });
    cloud.setMode("soul");
    fabSoul = { canvas, cloud, px, destroy: () => cloud.destroy() };
    btn?.classList.remove("no-cloud");
  } catch {
    fabSoul = null;
    btn?.classList.add("no-cloud");
  }
}

/** После каждой перерисовки FAB на полке — облако и удержание заново. */
function mountShelfMicFab() {
  mountChatMicHold();
  requestAnimationFrame(mountFabSoul);
}

function stripShelfGlyph(shelfId) {
  if (shelfId === "shared") return icon("checklist", 16);
  const iconName = shelfId === "alarms" && hasActiveAlarms() ? "alarmsOn" : shelfIconName(shelfId);
  return ICONS[iconName] ? icon(iconName, 16) : "";
}

function stripShelfActive(shelf) {
  if (shelf.go === "lists") return state.screen === "lists";
  return state.screen === "daily" && state.shelf === shelf.id;
}

function shelfStripPillHtml(shelf, { locked = false, badge = 0 } = {}) {
  const filled = shelf.go === "lists"
    ? (state.lists?.length > 0 || Boolean(state.listsUnread))
    : shelfItemCount(shelf.id) > 0;
  const active = stripShelfActive(shelf);
  const cls = ["shelf-pill"];
  if (!filled) cls.push("empty");
  if (active) cls.push("on");
  if (locked) cls.push("pro-locked");
  if (badge > 0) cls.push("has-badge");
  const attrs = shelf.go === "lists"
    ? `data-strip-go="lists"`
    : `data-strip-shelf="${shelf.id}"`;
  const lock = locked ? `<span class="shelf-pill-lock" aria-hidden="true">${icon("lock", 8)}</span>` : "";
  const count = badge > 0
    ? `<span class="shelf-pill-badge">${badge > 99 ? "99+" : badge}</span>`
    : "";
  const ico = `<span class="shelf-pill-ico">${stripShelfGlyph(shelf.id)}${lock}</span>`;
  return `<button type="button" class="${cls.join(" ")}" ${attrs}
    aria-label="${esc(shelf.label)}" aria-current="${active ? "page" : "false"}">${ico}${count}</button>`;
}

/**
 * Полоса полок в шапке.
 *
 * Слева — платные полки под замком, справа — бесплатные. Без подписей:
 * только значки фиксированного размера в одну строку.
 */
function shelfStripHtml() {
  if (!state.user) return "";
  if (state.screen === "record" || state.screen === "start") return "";

  const locked = !isPro();
  const listsUnread = state.listsUnread || 0;
  const proPills = PRO_STRIP_SHELVES.map(shelf => shelfStripPillHtml(shelf, {
    locked,
    badge: shelf.id === "shared" ? listsUnread : 0,
  })).join("");
  const freePills = FREE_STRIP_SHELVES.map(shelf => shelfStripPillHtml(shelf)).join("");

  return `
    <nav class="shelf-strip shelf-strip--pro" aria-label="Полки по подписке">${proPills}</nav>
    <nav class="shelf-strip shelf-strip--free" aria-label="Бесплатные полки">${freePills}</nav>
  `;
}

function topChrome() {
  const support = state.support?.unread || 0;
  return `
    <header class="top-chrome">
      ${shelfStripHtml()}
      <button type="button" class="icon-btn chrome-ring chrome-badge ${state.screen === "settings" ? "on" : ""}" data-go="settings" aria-label="${support ? `Настройки, ответ поддержки: ${support}` : (state.permissionsHasIssues ? "Настройки, нужно проверить разрешения" : "Настройки")}">
        ${ICONS.menu}${support ? `<span class="chrome-count">${support > 99 ? "99+" : support}</span>` : ""}${state.permissionsHasIssues ? '<span class="chrome-perm-dot" aria-hidden="true"></span>' : ""}
      </button>
    </header>
  `;
}

function render() {
  if (formsEditing()) {
    deferRender();
    return;
  }
  renderDeferred = false;
  if (state.authFlow) {
    viewEl = appEl;
    return renderAuth();
  }
  // Подключение по ссылке работает и до того, как у человека появился свой аккаунт.
  if (!state.user) {
    viewEl = appEl;
    return renderAuth();
  }

  // Пока согласие не подтверждено, дальше первого экрана не пускаем — ни своих записей, ни чужих.
  if (state.user && !consentAccepted()) {
    viewEl = appEl;
    return renderConsent();
  }

  // Общая плашка на всех экранах: подписка, общий список и настройки под рукой.
  appEl.innerHTML = `
    <div class="app-frame">
      ${topChrome()}
      <div class="stage" id="stage"></div>
    </div>
  `;
  viewEl = document.getElementById("stage");
  requestAnimationFrame(mountFabSoul);

  const map = {
    start: renderOnboarding,
    chat: renderChat,
    record: renderRecord,
    shelves: renderShelves,
    daily: renderDaily,
    detail: renderDetail,
    settings: renderSettings,
    "shelf-edit": renderShelfEdit,
    "shelf-prefs": renderShelfPrefs,
    "alarm-settings": renderAlarmSettings,
    report: renderReport,
    support: renderSupport,
    permissions: renderPermissions,
    sounds: renderSounds,
    lists: renderLists,
    blocked: renderBlocked,
  };
  (map[state.screen] || renderShelves)();
  if (state.screen === "lists") syncListPoll();
  else stopListPoll();
}

function bar(title, { back = null, right = "" } = {}) {
  return `
    <div class="bar">
      ${back ? `<button class="icon-btn" data-go="${back}" data-back aria-label="Назад">${ICONS.back}</button>` : '<span class="spacer"></span>'}
      <h2>${esc(title)}</h2>
      ${right}
    </div>
  `;
}

function offlineBar() {
  return state.online ? "" : '<div class="offline-bar">Нет сети — записи уйдут, когда появится связь</div>';
}

/** После удаления аккаунта — стираем сессию на телефоне, чтобы при следующем запуске был чистый старт. */
async function wipeLocalSessionAfterDelete() {
  state.authFlow = null;
  state.authPreview = null;
  state.user = null;
  state.items = [];
  state.incoming = [];
  state.contacts = [];
  state.chat = [];
  state.billingPendingId = "";
  store.token = "";
  store.onboarded = false;
  store.keySaved = false;
  store.chat = [];
  store.queue = [];
  saveBillingPendingId("");
  try { localStorage.removeItem("vc.privateTitles"); } catch { /* ignore */ }
  try { localStorage.removeItem("vc.calendarDay"); } catch { /* ignore */ }
  try { localStorage.removeItem("vc.calendarKey"); } catch { /* ignore */ }
  try { localStorage.removeItem("vc.supportSeen"); } catch { /* ignore */ }
  if (NATIVE?.clearSession) {
    try { await NATIVE.clearSession(); } catch { /* ignore */ }
  } else if (NATIVE?.updateWidget) {
    NATIVE.updateWidget({}, [], {});
  }
}

async function finishAccountDeletion() {
  await wipeLocalSessionAfterDelete();
  toast("Аккаунт удалён");
  if (NATIVE?.exitApp) {
    setTimeout(() => NATIVE.exitApp(), 700);
    return;
  }
  appEl.innerHTML = `
    <section class="screen auth">
      <div class="auth-inner">
        <h1 class="auth-invite">Аккаунт удалён</h1>
        <p class="auth-example">Закройте вкладку и откройте приложение снова — покажем условия и предложим ключ переноса.</p>
      </div>
    </section>
  `;
}

/** Восстановление по ключу — без старой сессии: иначе 401 превращается в «Нужен вход». */
async function restoreByTransferKey(key) {
  store.token = "";
  state.user = null;
  state.items = [];
  state.incoming = [];
  state.contacts = [];
  state.lists = [];
  if (NATIVE?.clearSession) {
    try { await NATIVE.clearSession(); } catch { /* ignore */ }
  }
  const data = await api("/restore", {
    method: "POST",
    body: { key, tz: tz(), consent: CONSENT_VERSION },
    auth: false,
  });
  store.token = data.token;
  absorb(data);
  return data;
}

async function silentStart(retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i += 1) {
    try {
      const data = await api("/start", {
        method: "POST",
        body: { tz: tz() },
        auth: false,
      });
      store.token = data.token;
      absorb(data);
      store.onboarded = true;
      return;
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastErr || new Error("Нет связи с сервером");
}

async function ensureAuthToken() {
  // Проверяем только токен. Раньше здесь требовался ещё и загруженный state.user —
  // но при запуске приложения он пуст, данные ещё не пришли. Условие не срабатывало,
  // и приложение заводило новый аккаунт, затирая токен старого вместе со всеми записями.
  if (store.token) return;
  await silentStart();
}

function renderBootError(err) {
  viewEl = appEl;
  const msg = err?.message || "Нет связи с сервером";
  appEl.innerHTML = `
    <section class="screen auth">
      <div class="auth-inner">
        <h1 class="auth-invite">Нет связи</h1>
        <p class="auth-example">${esc(msg)}</p>
        <button class="btn block" id="boot-retry" type="button">Повторить</button>
        <button class="auth-switch" id="boot-transfer" type="button">У меня есть ключ переноса</button>
      </div>
    </section>
  `;
  document.getElementById("boot-retry")?.addEventListener("click", () => boot());
  document.getElementById("boot-transfer")?.addEventListener("click", () => {
    state.authFlow = "restore";
    renderAuthRestore();
  });
}

async function authParsePhrase(text, source = "voice") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;
  await ensureAuthToken();
  const data = await api("/capture", { method: "POST", body: { text: trimmed, source } });
  absorb(data);
  state.authPreview = { text: trimmed, source, reply: data.reply };
  if (data.reply?.kind === "ask") {
    state.authFlow = "preview";
    renderAuth();
    if (source === "voice") {
      setTimeout(() => authListenVoice(), 400);
    }
    return;
  }
  if (data.reply?.kind === "created" || data.reply?.kind === "duplicate") {
    state.authFlow = "preview";
    renderAuth();
    return;
  }
  throw new Error(data.reply?.message || "Не удалось разобрать фразу");
}

async function authListenVoice() {
  const errorEl = document.querySelector("[data-auth-error]");
  if (errorEl) errorEl.textContent = "";
  if (!state.authMicExplained) {
    state.authMicExplained = true;
    const hint = document.getElementById("auth-mic-hint");
    if (hint) hint.scrollIntoView({ block: "nearest" });
  }
  try {
    if (typeof NATIVE?.speech?.listenGoogle === "function") {
      const res = await NATIVE.speech.listenGoogle();
      const text = String(res?.text || "").trim();
      if (!text) {
        if (res?.error === "no-recognizer") toast("Не удалось открыть микрофон");
        return;
      }
      await authParsePhrase(text, "voice");
      return;
    }
    if (speechAvailable()) {
      toast("Скажи фразу");
      startChatVoice({ mode: "auto" });
      return;
    }
    toast("Микрофон не отвечает. Давай текстом?");
  } catch (err) {
    const msg = String(err?.message || err || "").toLowerCase();
    if (errorEl) {
      errorEl.textContent = msg.includes("permission") || msg.includes("denied")
        ? "Нет доступа к микрофону"
        : "Не удалось открыть микрофон";
    }
  }
}

function authPreviewItem() {
  const reply = state.authPreview?.reply;
  if (!reply) return null;
  return (reply.items || [])[0] || null;
}

function authPreviewCardHtml(item) {
  if (!item) {
    return `<div class="auth-preview-empty">${esc(state.authPreview?.reply?.message || "Скажите ещё раз")}</div>`;
  }
  const lines = [
    `<div class="auth-preview-title">${esc(item.title)}</div>`,
    `<div class="auth-preview-when">${esc(fmtWhen(item))}</div>`,
  ];
  if (item.place) lines.push(`<div class="auth-preview-line">📍 ${esc(item.place)}</div>`);
  if (item.who) lines.push(`<div class="auth-preview-line">👤 ${esc(item.who)}</div>`);
  return lines.join("");
}

function finishAuthFlow() {
  state.authFlow = null;
  state.authPreview = null;
  store.onboarded = true;
  state.screen = "shelves";
  state.shelf = defaultShelf();
  render();
  attachDevice();
  setupPush(false);
}

async function authSaveAndConsent() {
  await api("/consent", { method: "POST", body: { version: CONSENT_VERSION } });
  absorb(await api(`/state?tz=${encodeURIComponent(tz())}`));
  const item = authPreviewItem();
  if (item?.time) {
    state.authFlow = "notify";
    renderAuth();
    return;
  }
  state.authFlow = "widget";
  renderAuth();
}

function renderAuthPreview() {
  const reply = state.authPreview?.reply;
  const waitingTime = reply?.kind === "ask";
  viewEl.innerHTML = `
    <section class="screen auth">
      <div class="auth-inner">
        <h1 class="auth-invite">${waitingTime ? esc(reply?.message || "Во сколько?") : "Вот что получилось"}</h1>
        <div class="auth-preview-card">${authPreviewCardHtml(waitingTime ? null : authPreviewItem())}</div>
        ${waitingTime ? `
          <button class="auth-mic-btn" id="auth-mic" type="button" aria-label="Ответить голосом">
            <span class="auth-mic-dot" aria-hidden="true"></span>
          </button>
          <button class="auth-text-btn" id="auth-text-toggle" type="button">Ввести текстом</button>
          <div class="auth-text-form hidden" id="auth-text-form">
            <label class="field">
              <textarea id="auth-text-input" rows="2" placeholder="в пятнадцать"></textarea>
            </label>
            <button class="btn block" id="auth-text-go" type="button">Ответить</button>
          </div>
        ` : `
          <p class="auth-consent-links">
            <a href="/privacy.html" data-doc="/privacy.html" target="_blank" rel="noopener">Политика конфиденциальности</a>
          </p>
          <button class="btn block" id="auth-save-consent" type="button">Сохранить и согласен</button>
        `}
        <p class="auth-error" data-auth-error></p>
      </div>
    </section>
  `;
  if (!waitingTime) {
    document.getElementById("auth-save-consent")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        await authSaveAndConsent();
      } catch (err) {
        document.querySelector("[data-auth-error]").textContent = err.message;
        event.currentTarget.disabled = false;
      }
    });
  }
  mountAuthTryHandlers();
}

function renderAuthNotify() {
  const item = authPreviewItem();
  const when = item?.time ? fmtTime(item) : "";
  const pushGranted = notifPermission() === "granted";
  viewEl.innerHTML = `
    <section class="screen auth">
      <div class="auth-inner">
        <h1 class="auth-invite">Напоминания</h1>
        <p class="auth-example">${when
    ? `Чтобы напомнить в ${esc(when)}, нужно разрешение на уведомления.`
    : "Разрешите уведомления — тогда напомню вовремя."}</p>
        <button class="btn block" id="auth-notify-go" type="button">${pushGranted ? "Дальше" : "Разрешить уведомления"}</button>
        <button class="btn ghost block" id="auth-notify-skip" type="button">Пропустить</button>
      </div>
    </section>
  `;
  document.getElementById("auth-notify-go")?.addEventListener("click", async () => {
    if (!pushGranted) await setupPush(true);
    state.authFlow = "widget";
    renderAuth();
  });
  document.getElementById("auth-notify-skip")?.addEventListener("click", () => {
    state.authFlow = "widget";
    renderAuth();
  });
}

function renderAuthWidget() {
  viewEl.innerHTML = `
    <section class="screen auth">
      <div class="auth-inner">
        <h1 class="auth-invite">Виджет на экран</h1>
        <p class="auth-example">Это главный способ пользоваться приложением: записи и микрофон прямо с рабочего стола.</p>
        <div class="auth-widget-steps">
          <p>1. Долгое нажатие на пустое место рабочего стола</p>
          <p>2. «Виджеты» → «SoulVoice»</p>
          <p>3. Перетащите на экран</p>
        </div>
        <button class="btn block" id="auth-widget-done" type="button">Понятно, начать</button>
      </div>
    </section>
  `;
  document.getElementById("auth-widget-done")?.addEventListener("click", () => finishAuthFlow());
}

function mountAuthTryHandlers() {
  document.getElementById("auth-mic")?.addEventListener("click", () => authListenVoice());
  document.getElementById("auth-text-toggle")?.addEventListener("click", () => {
    document.getElementById("auth-text-form")?.classList.toggle("hidden");
  });
  document.getElementById("auth-text-go")?.addEventListener("click", async () => {
    const errorEl = document.querySelector("[data-auth-error]");
    const text = document.getElementById("auth-text-input")?.value || "";
    if (errorEl) errorEl.textContent = "";
    try {
      await authParsePhrase(text, state.authFlow === "preview" ? "voice" : "text");
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    }
  });
}

function renderAuth() {
  viewEl = appEl;
  if (state.authFlow === "restore") return renderAuthRestore();
  if (state.authFlow === "preview") return renderAuthPreview();
  if (state.authFlow === "notify") return renderAuthNotify();
  if (state.authFlow === "widget") return renderAuthWidget();

  viewEl.innerHTML = document.getElementById("tpl-auth").innerHTML;
  const errorEl = viewEl.querySelector("[data-auth-error]");
  const toggle = viewEl.querySelector("#auth-toggle");
  const restoreForm = viewEl.querySelector('[data-auth-form="restore"]');
  let restoreMode = false;

  toggle?.addEventListener("click", () => {
    restoreMode = !restoreMode;
    restoreForm?.classList.toggle("hidden", !restoreMode);
    toggle.textContent = restoreMode ? "Начать заново" : "У меня есть ключ переноса";
    errorEl.textContent = "";
  });

  viewEl.querySelector("#auth-restore")?.addEventListener("click", async (event) => {
    const consentEl = viewEl.querySelector("#auth-restore-consent");
    const key = viewEl.querySelector('input[name="key"]')?.value.trim();
    if (!consentEl?.checked) {
      errorEl.textContent = "Отметьте согласие — без него нельзя продолжить";
      consentEl?.focus();
      return;
    }
    if (!key) {
      errorEl.textContent = "Вставьте ключ переноса";
      return;
    }
    event.currentTarget.disabled = true;
    errorEl.textContent = "";
    try {
      await restoreByTransferKey(key);
      store.onboarded = true;
      state.screen = "shelves";
      state.shelf = defaultShelf();
      render();
      setupPush(false);
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      event.currentTarget.disabled = false;
    }
  });

  mountAuthTryHandlers();
}

function renderAuthRestore() {
  viewEl = appEl;
  viewEl.innerHTML = `
    <section class="screen auth">
      <div class="auth-inner">
        <h1 class="auth-invite">Ключ переноса</h1>
        <p class="auth-example">Вставьте ключ, который показывали в настройках — записи вернутся на этот телефон.</p>
        <label class="field">
          <span>Ключ переноса</span>
          <input name="key" type="text" autocapitalize="characters" autocomplete="off" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
        </label>
        <label class="consent" for="auth-restore-consent">
          <input type="checkbox" id="auth-restore-consent" />
          <span>Согласен на обработку записей и принимаю
            <a href="/privacy.html" data-doc="/privacy.html" target="_blank" rel="noopener">политику конфиденциальности</a>.</span>
        </label>
        <button class="btn block" id="auth-restore" type="button">Забрать свои записи</button>
        <button class="auth-switch" id="auth-restore-back" type="button">${consentPending() ? "Назад к условиям" : "Начать заново"}</button>
        <p class="auth-error" data-auth-error></p>
      </div>
    </section>
  `;
  const errorEl = viewEl.querySelector("[data-auth-error]");
  viewEl.querySelector("#auth-restore-back")?.addEventListener("click", () => {
    state.authFlow = null;
    if (consentPending()) renderConsent();
    else renderAuth();
  });
  viewEl.querySelector("#auth-restore")?.addEventListener("click", async (event) => {
    const consentEl = viewEl.querySelector("#auth-restore-consent");
    const key = viewEl.querySelector('input[name="key"]')?.value.trim();
    if (!consentEl?.checked) {
      errorEl.textContent = "Отметьте согласие — без него нельзя продолжить";
      consentEl?.focus();
      return;
    }
    if (!key) {
      errorEl.textContent = "Вставьте ключ переноса";
      return;
    }
    event.currentTarget.disabled = true;
    errorEl.textContent = "";
    try {
      await restoreByTransferKey(key);
      state.authFlow = null;
      store.onboarded = true;
      state.screen = "shelves";
      state.shelf = defaultShelf();
      render();
      setupPush(false);
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      event.currentTarget.disabled = false;
    }
  });
}

function notifPermission() {
  if (NATIVE) return NATIVE.permissionState();
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function renderOnboarding() {
  const pushGranted = notifPermission() === "granted";
  const installed = Boolean(NATIVE) || isStandalone();

  viewEl.innerHTML = `
    <section class="screen">
      ${bar("Первые шаги", { back: store.onboarded ? "settings" : null })}
      <div class="scroll pad-bottom">
        <div class="step ${installed ? "done" : ""}">
          <div class="step-num">1</div>
          <div class="step-body">
            <div class="name">${NATIVE ? "Приложение установлено" : "Поставьте на экран «Домой»"}</div>
            <div class="sub">${NATIVE
              ? "Напоминания ставит сам телефон — они сработают даже без интернета."
              : installed
              ? "Готово — приложение уже стоит на экране."
              : isIOS()
                ? "В Safari нажмите «Поделиться» внизу, затем «На экран „Домой“»."
                : "В меню браузера (⋮) выберите «Установить приложение» или «Добавить на главный экран»."}</div>
          </div>
        </div>

        <div class="step ${pushGranted ? "done" : ""}">
          <div class="step-num">2</div>
          <div class="step-body">
            <div class="name">Разрешите уведомления</div>
            <div class="sub">${pushGranted ? "Готово — напомню вовремя." : "Без этого напоминания не придут."}</div>
            <button class="btn ${pushGranted ? "ghost" : ""} block" id="onb-push" style="margin-top:8px">
              ${pushGranted ? "Отправить проверочное" : "Разрешить уведомления"}
            </button>
          </div>
        </div>

        <button class="btn block" id="onb-done" style="margin-top:6px">${store.onboarded ? "Назад" : "Всё, начинаем"}</button>
      </div>
    </section>
  `;
}

// Список ближайших для виджета: две видны сразу, остальные листаются пальцем.
function upcomingForWidget() {
  const now = Date.now();
  // В виджет — все ближайшие с датой (время не обязательно), чтобы «Следом» не пропадало.
  return state.items
    .filter(i => !i.cancelled && !i.done && !i.archived && i.date && itemStamp(i) >= now - 60000)
    .sort((a, b) => itemStamp(a) - itemStamp(b));
}

function widgetSideLabel(id) {
  if (!id || id === "none") return "";
  if (id === "shared") {
    const defId = state.user?.settings?.sharedListDefault;
    const def = state.lists.find(l => l.id === defId) || state.lists[0];
    const nick = def?.nickname;
    return nick ? `Списки · ${nick}` : "Общие списки";
  }
  if (id === "daily") return "Ежедневные";
  if (id === "shelves") return "Календарь";
  return labelOfShelf(id) || id;
}

function widgetSideRowLabel(id) {
  return widgetSideLabel(id) || "—";
}

function widgetSideIcon(id) {
  if (!id) return icon("circle", 20);
  if (id === "shared") return icon("checklist", 20);
  if (id === "shelves") return icon("meetings", 20);
  if (id === "daily") return icon("repeat", 20);
  if (id === "alarms") return icon("alarms", 20);
  if (id === "notes") return icon("notes", 20);
  const name = shelfIconName(id);
  return name ? icon(name, 20) : icon("tasks", 20);
}

/** Все действия виджета — как в шапке и на полках. */
function widgetSideChoices() {
  const seen = new Set();
  const out = [];
  const add = (id, label) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label });
  };
  add("shared", "Общие списки");
  add("shelves", "Календарь");
  for (const id of manageShelfIds()) add(id, labelOfShelf(id) || id);
  return out;
}

function patchWidgetSideRows() {
  const cfg = widgetConfig();
  for (const side of ["left", "right"]) {
    const btn = viewEl?.querySelector(`[data-widget-side-open="${side}"]`);
    if (!btn) continue;
    const id = side === "left" ? cfg.leftBtn : cfg.rightBtn;
    const sub = btn.querySelector(".sub");
    if (sub) sub.textContent = widgetSideRowLabel(id);
    const ico = btn.querySelector("[data-widget-side-ico]");
    if (ico) ico.innerHTML = widgetSideIcon(id);
  }
  const side = state.widgetSidePicker;
  if (!side) return;
  const current = side === "left" ? cfg.leftBtn : cfg.rightBtn;
  viewEl?.querySelectorAll("[data-widget-pick]").forEach(row => {
    const id = row.dataset.widgetPick;
    const on = id === current;
    row.classList.toggle("on", on);
    const check = row.querySelector(".widget-picker-check");
    if (on && !check) {
      row.insertAdjacentHTML("beforeend", `<span class="widget-picker-check">${ICONS.circleCheck}</span>`);
    } else if (!on) {
      check?.remove();
    }
    const ico = row.querySelector(".widget-picker-ico");
    if (ico) ico.innerHTML = widgetSideIcon(id);
  });
}

function widgetSidePickerOverlayHtml() {
  const side = state.widgetSidePicker;
  if (!side) return "";
  const cfg = widgetConfig();
  const current = side === "left" ? cfg.leftBtn : cfg.rightBtn;
  const title = side === "left" ? "Левая кнопка" : "Правая кнопка";
  return `
    <div class="widget-picker-backdrop" id="widget-picker-backdrop">
      <div class="widget-picker-sheet" role="dialog" aria-label="${title}">
        <div class="widget-picker-head">
          <div class="widget-picker-title">${title}</div>
          <button type="button" class="icon-btn" id="widget-picker-close" aria-label="Закрыть">${ICONS.close}</button>
        </div>
        <div class="widget-picker-list">
          ${widgetSideChoices().map(o => `
            <button type="button" class="widget-picker-row ${o.id === current ? "on" : ""}" data-widget-pick="${esc(o.id)}">
              <span class="widget-picker-ico">${widgetSideIcon(o.id)}</span>
              <span class="widget-picker-lab">${esc(o.label)}</span>
              ${o.id === current ? `<span class="widget-picker-check">${ICONS.circleCheck}</span>` : ""}
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function defaultWidgetConfig() {
  return { tabs: [], leftBtn: "shared", rightBtn: "shelves" };
}

/** Настройки виджета: боковые кнопки. */
function widgetConfig() {
  const s = state.user?.settings || {};
  const base = defaultWidgetConfig();
  const raw = s.widgetConfig && typeof s.widgetConfig === "object" ? s.widgetConfig : null;
  const allowed = new Set([
    "none", "shelves", "shared", "care", "health", "sport", "alarms", "bday", "meters", "bills",
    "notes", "tasks", "meetings", "buy",
    ...customShelves().map(c => c.id),
  ]);
  allowed.delete("templates");
  allowed.delete("today");

  const sideOk = (id, fallback) => {
    const v = String(id ?? fallback);
    if (!v || v === "none") return fallback;
    if (allowed.has(v)) return v;
    return fallback;
  };
  const leftBtn = sideOk(raw?.leftBtn, base.leftBtn);
  const rightBtn = sideOk(raw?.rightBtn || s.widgetShortcut, base.rightBtn);
  return { tabs: [], leftBtn, rightBtn };
}

/** Правила вкладок виджета — зеркало WidgetSnapshotBuilder.java (один контракт). */
const WIDGET_MAX_ITEMS = 80;

function isWidgetNote(item) {
  return Boolean(item && (item.type === "note" || item.shelf === "notes"));
}

function itemMatchesWidgetTab(item, tabId) {
  if (!item || item.cancelled || item.done || item.archived || isExecuted(item)) return false;
  // В виджете — сводки на вкладках косметики / витаминов, не полный список.
  if (item.careSummary) return tabId === "care";
  if (item.healthSummary) return tabId === "health";
  if (isCareItem(item) || isHealthItem(item)) return false;
  if (tabId === "alarms") return Boolean(item.alarm) || item.type === "alarm" || item.shelf === "alarms";
  if (tabId === "notes") return isWidgetNote(item);
  if (tabId === "meetings") return item.type === "meeting" || item.shelf === "meetings";
  if (tabId === "buy") return item.type === "buy" || item.shelf === "buy";
  return (item.shelf || "tasks") === tabId;
}

function widgetTabIds() {
  const cfg = widgetConfig();
  return cfg.tabs.filter(id => id && id !== "today").slice(0, 4);
}

function toWidgetRow(item, index, tabIds) {
  const tabs = tabIds.filter(tab => itemMatchesWidgetTab(item, tab));
  return {
    id: item.id,
    lab: index === 0 ? "Дальше" : "Следом",
    title: item.title,
    meta: `${fmtWhen(item)}${item.place ? ` · ${item.place}` : ""}`,
    kind: TYPE_LABEL[item.type] || labelOfShelf(item.shelf) || "",
    shelf: item.shelf || (item.type === "note" ? "notes" : ""),
    tabs: tabs.length ? tabs : [tabIds[0] || "notes"],
    alarm: Boolean(item.alarm),
    timer: Boolean(item.timer),
    date: item.date || null,
    time: item.time || null,
    remind: item.remind ?? 0,
  };
}

/**
 * Снимок виджета: два окошка дат (сегодня / завтра) + записи выбранного дня.
 */
function widgetSnapshot() {
  const today = todayParts();
  const tomorrow = shiftDate(today, 1);
  const days = [
    { id: "today", day: today, lab: "Сегодня" },
    { id: "tomorrow", day: tomorrow, lab: "Завтра" },
  ];
  const items = [];
  const peek = state.sharedWidgetPeek;
  if (peek?.title) {
    items.push({
      id: peek.pairId ? `shared-${peek.pairId}` : "shared-peek",
      lab: "Списки",
      title: peek.title,
      meta: peek.body || "",
      kind: "shared",
      shelf: "lists",
      tabs: ["today"],
      alarm: false,
      fulfilled: false,
    });
  }
  for (const slot of days) {
    const list = calendarItemsForDay(slot.day).slice(0, WIDGET_MAX_ITEMS);
    list.forEach((item, index) => {
      items.push({
        id: item.id,
        lab: index === 0 ? slot.lab : "",
        title: item.title,
        meta: isCalendarFulfilled(item, slot.day)
          ? "исполнена"
          : `${fmtWhen(item)}${item.place ? ` · ${item.place}` : ""}`,
        kind: TYPE_LABEL[item.type] || labelOfShelf(item.shelf) || "",
        shelf: item.shelf || (item.type === "note" ? "notes" : ""),
        tabs: [slot.id],
        alarm: Boolean(item.alarm),
        timer: Boolean(item.timer),
        date: effectiveItemDate(item),
        time: item.time || null,
        remind: item.remind ?? 0,
        fulfilled: isCalendarFulfilled(item, slot.day),
      });
    });
  }

  const cfg = widgetConfig();
  const root = document.documentElement;
  return {
    builder: "WidgetSnapshotBuilder",
    builtAt: Date.now(),
    palette: root.dataset.palette || "stone",
    theme: root.dataset.theme || "light",
    accent: getComputedStyle(root).getPropertyValue("--accent").trim(),
    accentSoft: getComputedStyle(root).getPropertyValue("--accent-soft").trim(),
    surface: getComputedStyle(root).getPropertyValue("--surface").trim(),
    ink: getComputedStyle(root).getPropertyValue("--ink").trim(),
    inkMuted: getComputedStyle(root).getPropertyValue("--ink-muted").trim(),
    dayLabel: fmtCalDay(today),
    monthLabel: "",
    tabs: days.map(slot => ({
      id: slot.id,
      label: fmtCalDay(slot.day),
      monthLabel: "",
    })),
    leftBtn: widgetBtnPayload(cfg.leftBtn),
    rightBtn: widgetBtnPayload(cfg.rightBtn),
    sharedListDefault: state.user?.settings?.sharedListDefault || state.lists[0]?.id || "",
    shelfId: cfg.rightBtn === "none" ? "" : cfg.rightBtn,
    shelfLabel: widgetSideLabel(cfg.rightBtn),
    items: items.length ? items : [{
      id: "",
      lab: "Сегодня",
      title: "Пока пусто",
      meta: "Нажмите «Запись» и скажите, что нужно",
      kind: "",
      shelf: "",
      tabs: ["today"],
      alarm: false,
    }],
  };
}

function pushWidget() {
  if (!NATIVE?.updateWidget || !state.user) return;
  const snap = widgetSnapshot();
  // widgetLook в settings — чтобы нативный rebuild из state не терял палитру.
  const settings = {
    ...(state.user.settings || {}),
    widgetLook: {
      palette: snap.palette,
      theme: snap.theme,
      accent: snap.accent,
      accentSoft: snap.accentSoft,
      surface: snap.surface,
      ink: snap.ink,
      inkMuted: snap.inkMuted,
    },
  };
  NATIVE.updateWidget(snap, state.items, settings);
}

function widgetBtnPayload(id) {
  if (!id || id === "none") return { id: "", label: "" };
  return { id, label: widgetSideLabel(id) };
}

async function saveWidgetConfig(patch) {
  const next = { ...widgetConfig(), ...patch };
  const body = { widgetConfig: next };
  body.widgetShortcut = next.rightBtn && next.rightBtn !== "none" ? next.rightBtn : "";
  absorb(await api("/settings", { method: "POST", body }));
  pushWidget();
}

function chatBubble(entry) {
  if (entry.role === "me") return `<div class="bubble me">${esc(entry.text)}</div>`;
  const lines = (entry.lines || []).map(l => `<div class="ai-line">${esc(l)}</div>`).join("");
  const chips = (entry.chips || []).map(c =>
    `<button class="chip ${c.style || ""}" data-chip="${esc(c.action)}" data-id="${esc(c.id || "")}">${esc(c.label)}</button>`
  ).join("");
  return `
    <div class="bubble ai">
      <span class="bubble-ok ${entry.okFlash ? "on" : ""}" aria-hidden="true">👌</span>
      ${entry.title ? `<strong>${esc(entry.title)}</strong>` : ""}
      ${lines}
      ${entry.bell ? `<div class="ai-bell">${esc(entry.bell)}</div>` : ""}
      ${chips ? `<div class="chip-row">${chips}</div>` : ""}
    </div>
  `;
}

function pushChat(entry) {
  state.chat.push(entry);
  state.chat = state.chat.slice(-40);
  store.chat = state.chat;
}

function buildItemChips(item) {
  if (item.time) {
    return [
      { label: "Изменить", action: "edit", id: item.id },
      { label: "Отменить", action: "cancel", id: item.id, style: "danger" },
      { label: item.alarm ? "Будильник вкл" : "Будильник", action: "alarm", id: item.id, style: "ghost" },
    ];
  }
  // Без времени — быстрый выбор + отмена (в т.ч. для будильника).
  return [
    ...QUICK_TIMES.map(q => ({ label: q.label, action: `time-${q.hour}`, id: item.id })),
    { label: "Другое время", action: "edit", id: item.id, style: "ghost" },
    { label: "Отменить", action: "cancel", id: item.id, style: "danger" },
  ];
}

function chatPatchForItem(item) {
  const when = [fmtWhen(item), item.place, item.repeatLabel].filter(Boolean).join(" · ");
  return {
    lines: [item.title, when || ""],
    bell: item.time && item.date ? `Напомню · ${fmtRemind(item)}` : "Времени нет — поставьте одним тапом",
    chips: buildItemChips(item),
  };
}

function chatIndexForItem(itemId) {
  return state.chat.findIndex(e =>
    e.role === "ai"
    && (e.itemId === itemId || (e.chips || []).some(c => c.id === itemId)));
}

/** Меняем плашку в чате на месте — без новых сообщений. */
function updateChatItemCard(itemId, item, { flashOk = false } = {}) {
  const idx = chatIndexForItem(itemId);
  if (idx < 0) return false;
  state.chat[idx] = {
    ...state.chat[idx],
    itemId,
    ...chatPatchForItem(item),
    okFlash: Boolean(flashOk),
  };
  store.chat = state.chat;
  if (flashOk) {
    const token = `${itemId}:${Date.now()}`;
    state.chat[idx].okToken = token;
    setTimeout(() => {
      const i = state.chat.findIndex(e => e.role === "ai" && e.itemId === itemId && e.okToken === token);
      if (i < 0) return;
      state.chat[i] = { ...state.chat[i], okFlash: false, okToken: null };
      store.chat = state.chat;
      if (state.screen === "chat") renderChat();
    }, 2000);
  }
  return true;
}

/** Отмена: убираем плашку ответа и ваш запрос перед ней. */
function removeChatForItem(itemId) {
  const next = [];
  for (let i = 0; i < state.chat.length; i += 1) {
    const e = state.chat[i];
    const hit = e.role === "ai"
      && (e.itemId === itemId || (e.chips || []).some(c => c.id === itemId && (c.action === "cancel" || String(c.action || "").startsWith("time-") || c.action === "edit" || c.action === "alarm")));
    if (hit) {
      if (next.length && next[next.length - 1].role === "me") next.pop();
      continue;
    }
    next.push(e);
  }
  state.chat = next;
  store.chat = state.chat;
}

function renderChat() {
  const waiting = overdueCount();
  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${shelfTabs("chat", { waiting })}
      <div class="chat-log" id="chat-log">
        ${state.chat.length ? state.chat.map(chatBubble).join("") : '<div class="empty">Напишите, что нужно сделать.<br/>Например: встреча завтра в 10 на Таганке</div>'}
        ${state.pending ? '<div class="bubble ai"><div class="ai-line">Разбираю…</div></div>' : ""}
      </div>
      <div class="composer">
        <input id="chat-input" type="text" placeholder="Задача, встреча, отмена…" autocomplete="off" enterkeyhint="send" />
        <div class="composer-stack">
          <button type="button" class="round mic" id="chat-mic" aria-label="Удерживайте, чтобы записать">${ICONS.mic}</button>
          <button type="button" class="round" id="chat-send" aria-label="Отправить">${ICONS.send}</button>
        </div>
      </div>
    </section>
  `;
  const log = document.getElementById("chat-log");
  log.scrollTop = log.scrollHeight;
  const input = document.getElementById("chat-input");
  if (state.chatDraft) input.value = state.chatDraft;
  if (state.chatListening) mountChatVoiceOverlay({ hold: chatVoiceMode === "hold" });
  mountChatMicHold();
}

function fmtRub(n) {
  return `${Number(n || 0).toLocaleString("ru-RU")} ₽`;
}

function billingCanBuy() {
  return Boolean(state.billing?.payEnabled);
}

function billingOnSettings() {
  return state.screen === "settings";
}

function billingPayNote() {
  if (!state.billing?.payEnabled || state.billing.active) return "";
  return "Оплата картой РФ и зарубежных банков. После оплаты вернитесь в приложение — тариф обновится автоматически.";
}

function soloMonthPrice() {
  const month = (state.billing?.products || []).find(p => p.id === "pro_month");
  return Number(month?.price) || 299;
}

function yearSaveRate() {
  const month = (state.billing?.products || []).find(p => p.id === "pro_month");
  const year = (state.billing?.products || []).find(p => p.id === "pro_year");
  if (!month?.price || !year?.price) return 0.45;
  const fullYear = month.price * 12;
  return Math.max(0, 1 - year.price / fullYear);
}

function yearSavePct() {
  return Math.round(yearSaveRate() * 100);
}

function familyTermExtraDiscount(months) {
  const terms = state.billing?.familyTerms;
  const hit = terms?.find(t => t.months === months);
  if (hit) return Number(hit.extraDiscount || 0);
  const y = yearSaveRate();
  if (months >= 12) return y;
  if (months >= 6) return y * 0.5;
  return 0;
}

function familySlotDiscount(slotIndex) {
  if (slotIndex <= 0) return 0;
  return Math.min(0.50, slotIndex * 0.05 + 0.05);
}

function familyMonthlyTotal(memberCount) {
  const base = soloMonthPrice();
  const n = Math.max(1, Number(memberCount) || 1);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += base * (1 - familySlotDiscount(i));
  return Math.round(sum);
}

function billingProductCard(p, { pro, busy, featured = false } = {}) {
  const year = p.id === "pro_year" || featured;
  const open = state.billingPlanOpen === p.id;
  const buyLabel = busy ? "Открываю оплату…" : "Купить";
  const savePct = year ? yearSavePct() : 0;
  const saveBadge = year && savePct ? `Выгоднее ${savePct}%` : (p.saveBadge || "");
  return `
    <div class="pay-card ${year ? "pay-card-year" : ""} ${open ? "open" : ""}">
      <button type="button" class="pay-card-toggle" data-billing-plan="${esc(p.id)}" aria-expanded="${open}">
        ${saveBadge ? `<div class="pay-badge">${esc(saveBadge)}</div>` : ""}
        <div class="pay-row">
          <div class="pay-title">${esc(p.title)}</div>
          <div class="pay-price">${esc(p.priceLabel || "")}</div>
        </div>
        ${p.monthlyEquiv ? `<div class="pay-equiv">${esc(p.monthlyEquiv)}</div>` : ""}
        <span class="row-chevron pay-card-chevron">${ICONS.chevron}</span>
      </button>
      ${open ? `
        <div class="pay-card-body">
          ${!pro ? `<button class="btn block" type="button" data-buy="${esc(p.id)}" ${busy ? "disabled" : ""}>${buyLabel}</button>` : ""}
        </div>
      ` : ""}
    </div>`;
}

function familyTermBtnHtml(t, draft, quote) {
  const selected = draft.term === t.id;
  const termPct = Math.round(Number(t.extraDiscount || 0) * 100);
  const total = selected && quote?.total ? fmtRub(quote.total) : "";
  return `
    <button type="button" class="family-term-btn ${selected ? "on" : ""}" data-family-term="${esc(t.id)}">
      <span class="family-term-period">${esc(t.period)}</span>
      ${termPct ? `<span class="family-term-disc">−${termPct}%</span>` : ""}
      ${total ? `<span class="family-term-total">${esc(total)}</span>` : ""}
    </button>`;
}

function familySubMountEl() {
  if (!billingOnSettings()) return null;
  return document.querySelector("#settings-subscription .pay-card-family");
}

function captureFamilyFieldFocus() {
  const focused = document.activeElement;
  if (focused?.dataset?.familyId == null) return null;
  return {
    index: Number(focused.dataset.familyId),
    start: focused.selectionStart,
    end: focused.selectionEnd,
  };
}

function restoreFamilyFieldFocus(focus) {
  if (!focus) return;
  const el = familySubMountEl()?.querySelector(`[data-family-id="${focus.index}"]`);
  if (!el) return;
  el.focus();
  try {
    if (focus.start != null) el.setSelectionRange(focus.start, focus.end);
  } catch { /* ignore */ }
}

/** Точечное обновление семейного блока — без замены input, чтобы клавиатура не закрывалась. */
function patchFamilySubInline(mount) {
  const draft = state.familyDraft;
  const quote = draft.quote;
  const slots = quote?.breakdown?.slots || [];
  const busy = state.billingBusy;
  const canBuy = billingCanBuy();
  const total = quote?.total || 0;

  mount.querySelectorAll(".family-id-row").forEach((row, i) => {
    const code = String(draft.ids[i] || "").trim().toUpperCase();
    const v = code ? draft.validation[code] : null;
    const mark = v?.checking ? "…" : v?.valid ? "✓" : code ? "✗" : "";
    const markCls = v?.valid ? "ok" : code ? "bad" : "";
    const check = row.querySelector(".family-id-check");
    if (check) {
      check.textContent = mark;
      check.className = `family-id-check ${markCls}`;
    }
    const slotDisc = slots[i]?.discountPct;
    let disc = row.querySelector(".family-id-disc");
    if (slotDisc) {
      if (!disc) {
        disc = document.createElement("span");
        disc.className = "family-id-disc";
        check?.insertAdjacentElement("afterend", disc);
      }
      disc.textContent = `−${slotDisc}%`;
    } else if (disc) {
      disc.remove();
    }
  });

  const priceEl = mount.querySelector(".family-price");
  if (priceEl) {
    priceEl.textContent = draft.quoteBusy ? "Считаю…" : total ? `Итого: ${fmtRub(total)}` : "";
  }
  const payBtn = mount.querySelector("#family-pay");
  if (payBtn) {
    payBtn.disabled = busy || (canBuy && (!familyAllValid() || !total));
    payBtn.textContent = busy ? "Открываю оплату…" : "Купить";
  }

  const termsEl = mount.querySelector(".family-terms");
  if (termsEl) {
    const terms = state.billing?.familyTerms || [
      { id: "family_1m", period: "1 мес", months: 1, extraDiscount: familyTermExtraDiscount(1) },
      { id: "family_6m", period: "6 мес", months: 6, extraDiscount: familyTermExtraDiscount(6) },
      { id: "family_12m", period: "1 год", months: 12, extraDiscount: familyTermExtraDiscount(12) },
    ];
    termsEl.innerHTML = terms.map(t => familyTermBtnHtml(t, draft, quote)).join("");
  }
}

function patchFamilySubBlock() {
  const mount = familySubMountEl();
  if (!mount) {
    if (billingOnSettings()) renderSettings();
    return;
  }
  if (captureFamilyFieldFocus()) {
    patchFamilySubInline(mount);
    return;
  }
  const scrollEl = mount.querySelector(".family-id-list");
  const scrollTop = scrollEl?.scrollTop || 0;
  const focus = captureFamilyFieldFocus();
  const wrap = document.createElement("div");
  wrap.innerHTML = familySubBlockHtml();
  const next = wrap.firstElementChild;
  if (!next) return;
  mount.replaceWith(next);
  const list = next.querySelector(".family-id-list");
  if (list) {
    if (state.familyScrollBottom) {
      list.scrollTop = list.scrollHeight;
      state.familyScrollBottom = false;
    } else {
      list.scrollTop = scrollTop;
    }
  }
  restoreFamilyFieldFocus(focus);
}

function billingPlanOrder(a, b) {
  const order = { pro_year: 0, pro_month: 1 };
  return (order[a.id] ?? 9) - (order[b.id] ?? 9);
}

function billingPayListHtml() {
  const b = state.billing;
  const pro = Boolean(b?.active);
  const busy = state.billingBusy;

  // У кого подписка уже есть — тарифы не показываем: предлагать купить то,
  // что человек только что оплатил, выглядит как ошибка приложения.
  // Остаётся семейная покупка: её берут поверх своей, для близких по ID.
  if (pro) return familySubBlockHtml();

  const products = (b?.products || [])
    .slice()
    .sort(billingPlanOrder)
    .map(p => billingProductCard(p, { pro, busy, featured: p.id === "pro_year" }))
    .join("");
  return `${products}${familySubBlockHtml()}`;
}

function patchBillingProducts() {
  if (formsEditing()) {
    if (captureFamilyFieldFocus()) patchFamilySubBlock();
    deferRender();
    return;
  }
  const list = billingOnSettings()
    ? document.querySelector("#settings-subscription .pay-list")
    : null;
  if (!list || !state.billing) {
    if (billingOnSettings()) renderSettings();
    return;
  }
  list.innerHTML = billingPayListHtml();
}

function patchSettingsSubscription() {
  if (formsEditing()) {
    deferRender();
    return;
  }
  const mount = document.getElementById("settings-subscription");
  if (!mount) {
    if (billingOnSettings()) renderSettings();
    return;
  }
  const wrap = document.createElement("div");
  wrap.innerHTML = settingsSubscriptionHtml();
  const next = wrap.firstElementChild;
  if (!next) return;
  mount.replaceWith(next);
}

function familyDraftCodes() {
  return state.familyDraft.ids.map(c => String(c || "").trim().toUpperCase()).filter(Boolean);
}

function familyAllValid() {
  const codes = familyDraftCodes();
  if (!codes.length) return false;
  return codes.every(code => state.familyDraft.validation[code]?.valid);
}

let familyValidateTimers = {};

function scheduleFamilyValidate(index, raw) {
  clearTimeout(familyValidateTimers[index]);
  familyValidateTimers[index] = setTimeout(() => validateFamilyId(index, raw), 450);
}

async function validateFamilyId(index, raw) {
  const code = String(raw || "").trim().toUpperCase();
  state.familyDraft.ids[index] = code;
  if (!code) {
    delete state.familyDraft.validation[code];
    refreshFamilyQuote();
    return;
  }
  state.familyDraft.validation[code] = { checking: true };
  if (billingOnSettings()) patchFamilySubBlock();
  try {
    const res = await api("/billing/validate-id", { method: "POST", body: { code } });
    state.familyDraft.validation[code] = { valid: Boolean(res.valid), self: Boolean(res.self) };
  } catch {
    state.familyDraft.validation[code] = { valid: false };
  }
  refreshFamilyQuote();
}

async function refreshFamilyQuote() {
  const codes = familyDraftCodes();
  if (!codes.length || !familyAllValid()) {
    state.familyDraft.quote = null;
    if (billingOnSettings()) patchFamilySubBlock();
    return;
  }
  state.familyDraft.quoteBusy = true;
  if (billingOnSettings()) patchFamilySubBlock();
  try {
    const res = await api("/billing/family-quote", {
      method: "POST",
      body: { codes, termId: state.familyDraft.term },
    });
    state.familyDraft.quote = res.ok ? res : null;
  } catch {
    state.familyDraft.quote = null;
  } finally {
    state.familyDraft.quoteBusy = false;
    if (billingOnSettings()) patchFamilySubBlock();
  }
}

function familySubBlockHtml() {
  const b = state.billing;
  const busy = state.billingBusy;
  const canBuy = billingCanBuy();
  const fam = b?.familySub;
  const terms = b?.familyTerms || [
    { id: "family_1m", period: "1 мес", months: 1, extraDiscount: familyTermExtraDiscount(1) },
    { id: "family_6m", period: "6 мес", months: 6, extraDiscount: familyTermExtraDiscount(6) },
    { id: "family_12m", period: "1 год", months: 12, extraDiscount: familyTermExtraDiscount(12) },
  ];
  const draft = state.familyDraft;
  const quote = draft.quote;
  const slots = quote?.breakdown?.slots || [];
  const open = state.billingPlanOpen === "family";

  if (fam?.isOwner && fam.until > Date.now()) {
    return `
      <div class="pay-card pay-card-family ${open ? "open" : ""}">
        <button type="button" class="pay-card-toggle" data-billing-plan="family" aria-expanded="${open}">
          <div class="pay-row">
            <div class="pay-title">Семья</div>
            <div class="pay-price">до ${esc(fmtUntil(fam.until))}</div>
          </div>
          <div class="pay-equiv">${fam.memberCount} участник${fam.memberCount === 1 ? "" : "а"}</div>
          <span class="row-chevron pay-card-chevron">${ICONS.chevron}</span>
        </button>
        ${open ? `
        <div class="pay-card-body compact-body">
          <div class="family-actions">
            <button class="btn ghost block" type="button" data-family-renew ${busy ? "disabled" : ""}>Продлить</button>
            ${fam.autoRenew !== false
              ? `<button class="btn ghost block" type="button" id="family-cancel" ${busy ? "disabled" : ""}>Отменить автопродление</button>`
              : `<div class="hint">Автопродление отключено</div>`}
          </div>
        </div>` : ""}
      </div>`;
  }

  const rows = draft.ids.map((id, i) => {
    const code = String(id || "").trim().toUpperCase();
    const v = code ? draft.validation[code] : null;
    const mark = v?.checking ? "…" : v?.valid ? "✓" : code ? "✗" : "";
    const markCls = v?.valid ? "ok" : code ? "bad" : "";
    const slotDisc = slots[i]?.discountPct;
    const discHtml = slotDisc ? `<span class="family-id-disc">−${slotDisc}%</span>` : "";
    return `
      <div class="family-id-row">
        <input class="family-id-input" type="text" maxlength="6" autocapitalize="characters"
          placeholder="ID участника" data-family-id="${i}" value="${esc(code)}" />
        <span class="family-id-check ${markCls}" aria-hidden="true">${mark}</span>
        ${discHtml}
        ${draft.ids.length > 1 ? `<button type="button" class="icon-btn" data-family-rm="${i}" aria-label="Убрать">${ICONS.close}</button>` : ""}
      </div>`;
  }).join("");

  const total = quote?.total || 0;
  const payDisabled = busy || (canBuy && (!familyAllValid() || !total));
  const buyLabel = busy ? "Открываю оплату…" : "Купить";

  return `
    <div class="pay-card pay-card-family ${open ? "open" : ""}">
      <button type="button" class="pay-card-toggle" data-billing-plan="family" aria-expanded="${open}">
        <div class="pay-row">
          <div class="pay-title">Семья</div>
          <div class="pay-price">от ${esc(fmtRub(soloMonthPrice()))}</div>
        </div>
        <div class="pay-equiv">скидка за каждого участника</div>
        <span class="row-chevron pay-card-chevron">${ICONS.chevron}</span>
      </button>
      ${open ? `
      <div class="pay-card-body">
        <div class="family-id-list">${rows}</div>
        <button type="button" class="btn ghost block" id="family-add-id">+ Добавить участника</button>
        <div class="family-terms" role="group" aria-label="Срок">
          ${terms.map(t => familyTermBtnHtml(t, draft, quote)).join("")}
        </div>
        <div class="family-footer">
          <div class="family-price">
            ${draft.quoteBusy ? "Считаю…" : total ? `Итого: ${esc(fmtRub(total))}` : ""}
          </div>
          <button class="btn block" type="button" id="family-pay" ${payDisabled ? "disabled" : ""}>${buyLabel}</button>
        </div>
      </div>` : ""}
    </div>`;
}

function billingActiveNote(b) {
  if (!b?.active) return "";
  const fam = b.familySub;
  if (fam?.until) {
    return `Тариф «Про» до ${esc(fmtUntil(fam.until || b.until))}${fam.isOwner ? " · семейная" : ""}`;
  }
  return `Тариф «Про» до ${esc(fmtUntil(b.until))}`;
}

function settingsSubscriptionHtml() {
  const b = state.billing;
  const busy = state.billingBusy;
  const canBuy = billingCanBuy();
  if (!b) {
    return `<div class="settings-sub-block" id="settings-subscription"><div class="empty">Загружаю тарифы…</div></div>`;
  }
  const pro = Boolean(b.active);
  return `
    <div class="settings-sub-block" id="settings-subscription">
      <div class="settings-sub-head">
        <span class="settings-sub-mark">${ICONS.spark}</span>
        <div>
          <div class="settings-sub-title">Подписка «Про»</div>
          ${pro ? `<div class="settings-sub-status">${billingActiveNote(b)}</div>` : ""}
        </div>
      </div>
      <div class="pay-list">${billingPayListHtml()}</div>
      ${billingPayNote() ? `<div class="pay-note">${esc(billingPayNote())}</div>` : ""}
      ${canBuy ? `<button class="btn ghost block" type="button" id="billing-restore-purchases" ${busy ? "disabled" : ""}>Восстановить покупки</button>` : ""}
      ${canBuy && state.billingPendingId ? `<button class="btn ghost block" type="button" id="billing-restore" ${busy ? "disabled" : ""}>Проверить оплату</button>` : ""}
    </div>`;
}

function fmtUntil(ts) {
  const d = new Date(Number(ts) || 0);
  if (!Number.isFinite(d.getTime()) || !ts) return "";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()] || ""} ${d.getFullYear()}`;
}

function ensureFamilyDraft() {
  if (!state.user?.code) return;
  if (!String(state.familyDraft.ids[0] || "").trim()) {
    state.familyDraft.ids[0] = state.user.code;
    validateFamilyId(0, state.user.code);
  }
}

async function loadBilling() {
  try {
    state.billing = await api("/billing");
    ensureFamilyDraft();
  } catch (err) {
    toast(err.message);
  }
  if (billingOnSettings()) patchSettingsSubscription();
  else if (state.screen === "settings") renderSettings();
}

async function buySubscription(productId) {
  if (state.billingBusy) return;
  if (!billingCanBuy()) return;
  state.billingBusy = true;
  if (billingOnSettings()) patchSettingsSubscription();
  try {
    const res = await api("/billing/create-payment-prodamus", {
      method: "POST",
      body: { productId },
    });
    if (!res?.ok || !res.confirmation_url) throw new Error(res.error || "Не удалось открыть оплату");
    saveBillingPendingId(res.payment_id);
    openDoc(res.confirmation_url);
    toast("После оплаты вернитесь в приложение");
    startBillingPoll(res.payment_id);
  } catch (err) {
    toast(err.message || "Оплата не завершена");
  } finally {
    state.billingBusy = false;
    if (billingOnSettings()) patchSettingsSubscription();
    else if (state.screen === "settings") renderSettings();
  }
}

let billingPollTimer = null;

function startBillingPoll(paymentId) {
  if (!paymentId) return;
  if (billingPollTimer) clearInterval(billingPollTimer);
  let tries = 0;
  billingPollTimer = setInterval(async () => {
    tries += 1;
    const ok = await checkBillingPayment(paymentId, { silent: true });
    if (ok || tries >= 40) {
      clearInterval(billingPollTimer);
      billingPollTimer = null;
    }
  }, 3000);
}

const BILLING_PENDING_KEY = "vc_billing_pending";

function loadBillingPendingId() {
  try { return localStorage.getItem(BILLING_PENDING_KEY) || ""; } catch { return ""; }
}

function saveBillingPendingId(id) {
  state.billingPendingId = id || "";
  try {
    if (id) localStorage.setItem(BILLING_PENDING_KEY, id);
    else localStorage.removeItem(BILLING_PENDING_KEY);
  } catch { /* ignore */ }
}

async function checkBillingPayment(paymentId, { silent = false } = {}) {
  const pid = paymentId || state.billingPendingId || loadBillingPendingId();
  if (!pid) {
    if (!silent) toast("Нет ожидающей оплаты");
    return false;
  }
  if (state.billingBusy && !silent) return false;
  if (!silent) state.billingBusy = true;
  try {
    const res = await api("/billing/payment-status", {
      method: "POST",
      body: { paymentId: pid },
    });
    state.billing = res;
    if (res.active) {
      saveBillingPendingId("");
      if (!silent) toast("Подписка активна");
      await onProActivated();
      if (billingOnSettings()) patchSettingsSubscription();
      return true;
    }
    if (!silent) toast(res.status === "pending" ? "Оплата ещё не пришла" : "Оплата не подтверждена");
    return false;
  } catch (err) {
    if (!silent) toast(err.message || "Не удалось проверить оплату");
    return false;
  } finally {
    if (!silent) {
      state.billingBusy = false;
      if (billingOnSettings()) patchSettingsSubscription();
    }
  }
}

async function restorePurchases() {
  if (state.billingBusy) return;
  state.billingBusy = true;
  if (billingOnSettings()) patchSettingsSubscription();
  try {
    const res = await api("/billing/restore-purchases", { method: "POST", body: {} });
    state.billing = res;
    if (res.active) await onProActivated();
    toast(res.restored ? "Покупки восстановлены" : "Активных покупок не найдено");
  } catch (err) {
    toast(err.message);
  } finally {
    state.billingBusy = false;
    if (billingOnSettings()) patchSettingsSubscription();
    else if (state.screen === "settings") renderSettings();
  }
}

async function buyFamilySubscription() {
  if (state.billingBusy || !billingCanBuy()) return;
  const codes = familyDraftCodes();
  if (!familyAllValid() || !codes.length) return toast("Проверьте ID участников");
  state.billingBusy = true;
  if (billingOnSettings()) patchSettingsSubscription();
  try {
    const res = await api("/billing/create-family-payment-prodamus", {
      method: "POST",
      body: { codes, termId: state.familyDraft.term },
    });
    if (!res.ok || !res.confirmation_url) throw new Error(res.error || "Не удалось создать платёж");
    saveBillingPendingId(res.payment_id);
    window.open(res.confirmation_url, "_blank", "noopener");
    startBillingPoll(res.payment_id);
  } catch (err) {
    toast(err.message);
  } finally {
    state.billingBusy = false;
    if (billingOnSettings()) patchSettingsSubscription();
    else if (state.screen === "settings") renderSettings();
  }
}

async function cancelFamilySub() {
  if (state.billingBusy) return;
  state.billingBusy = true;
  try {
    const res = await api("/billing/cancel-family", { method: "POST", body: {} });
    state.billing = res;
    toast("Автопродление отключено");
  } catch (err) {
    toast(err.message);
  } finally {
    state.billingBusy = false;
    if (billingOnSettings()) patchSettingsSubscription();
    else if (state.screen === "settings") renderSettings();
  }
}


function sendFromComposer() {
  const input = document.getElementById("chat-input");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  state.chatDraft = "";
  capture(text);
}

let recognition = null;

function stopRecognition() {
  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }
}

function speechAvailable() {
  return Boolean(NATIVE?.speech || window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Пауза тишины перед разбором: с запасом на паузу Android между проходами STT.
const VOICE_SILENCE_MS = 3800;
// После тишины ещё чуть ждём хвост фразы («…курицу»), потом один capture.
const VOICE_SETTLE_MS = 1800;
// Если так и не заговорили — мягко закрываем, чтобы микрофон не висел вечно.
const VOICE_IDLE_MS = 20000;
/** Антидубль: короткий обрывок + полная фраза подряд не должны дать две записи. */
let lastCaptureText = "";
let lastCaptureAt = 0;
/** Пока идёт /api/capture — второй вызов из того же тапа не запускаем. */
let captureBusy = false;
/** Если во время запроса пришла более полная фраза — отправим её следом (сервер склеит). */
let captureFollowup = null;

// Один интерфейс на два движка: нативный микрофон телефона и браузерный.
// Слушает, пока не вызовут stop(): движок может обрывать фразу сам — мы перезапускаем.
function startListening({ onText, onError, onPass }) {
  if (NATIVE?.speech) {
    NATIVE.speech.start({ onText, onError, onPass });
    return { stop: () => NATIVE.speech.stop() };
  }

  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return null;

  let stopped = false;
  let committed = "";
  let current = "";
  let engine = null;
  let emptyRestarts = 0;

  const emit = () => {
    const text = [committed, current].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (text) onText(text);
  };

  const arm = () => {
    if (stopped) return;
    try {
      try { if (typeof onPass === "function") onPass(); } catch { /* ignore */ }
      engine = new Speech();
      engine.lang = "ru-RU";
      engine.interimResults = true;
      engine.continuous = false;
      engine.maxAlternatives = 1;
      current = "";

      engine.onresult = event => {
        let interim = "";
        let final = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += chunk;
          else interim += chunk;
        }
        if (final) {
          emptyRestarts = 0;
          current = "";
          committed = [committed, final.trim()].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
          emit();
        } else {
          current = interim.trim();
          if (current) emptyRestarts = 0;
          emit();
        }
      };

      engine.onerror = event => {
        if (stopped) return;
        if (event.error === "no-speech" || event.error === "aborted") return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") onError("denied");
        else if (event.error !== "network") onError("other");
      };

      engine.onend = () => {
        if (stopped) return;
        if (current.trim()) {
          committed = [committed, current.trim()].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
          current = "";
          emit();
          emptyRestarts = 0;
        } else if (!committed) {
          emptyRestarts += 1;
          if (emptyRestarts > 20) {
            onError("other");
            return;
          }
        } else {
          emptyRestarts = 0;
        }
        // Перезапуск: браузер тоже режет паузу раньше наших 2 секунд.
        setTimeout(arm, 160);
      };

      engine.start();
    } catch {
      if (!stopped) setTimeout(arm, 320);
    }
  };

  arm();

  return {
    stop: () => {
      stopped = true;
      if (engine) {
        engine.onend = null;
        engine.onerror = null;
        try { engine.stop(); } catch {}
        try { engine.abort(); } catch {}
        engine = null;
      }
    },
  };
}

function renderRecord() {
  if (typeof NATIVE?.speech?.listenGoogle === "function") {
    state.screen = "shelves";
    if (!state.shelf || state.shelf === "chat") state.shelf = defaultShelf();
    renderShelves();
    setTimeout(() => startChatVoice({ mode: "auto" }), 0);
    return;
  }
  const Speech = speechAvailable();
  viewEl.innerHTML = `
    <section class="screen screen-record">
      ${offlineBar()}
      ${bar("Запись", {
        back: "shelves",
      })}
      <div class="record">
        <div class="voice-cloud-host" id="voice-cloud-host"></div>
        <div class="rec-text dim" id="rec-text">${Speech ? "Говорите…" : "Голос недоступен в этом браузере"}</div>
        <div class="rec-actions">
          ${Speech
            ? '<button class="btn ghost" data-go="shelves">Отмена</button><button class="btn" id="rec-finish">Готово</button>'
            : '<button class="btn" data-go="shelves">На полки</button>'}
        </div>
      </div>
    </section>
  `;

  if (!Speech) return;

  const cloud = mountVoiceCloud(document.getElementById("voice-cloud-host"));
  if (cloud) {
    armCloudMicLevel(cloud);
  }

  const textEl = document.getElementById("rec-text");
  let transcript = "";
  let sent = false;

  const finish = async () => {
    if (sent) return;
    sent = true;
    stopRecognition();
    const text = transcript.trim();
    // Уровень микрофона больше не нужен — облако остаётся на финал.
    if (typeof stopLevel === "function") {
      try { stopLevel(); } catch {}
      stopLevel = null;
    }
    if (!text) {
      if (activeVoiceCloud) {
        showCloudReaction(activeVoiceCloud, "ask");
        await new Promise(r => setTimeout(r, 480));
      }
      destroyVoiceCloud();
      toast(v("Не расслышала. Напиши текстом?", "Не расслышал. Напиши текстом?"));
      go("shelves", { shelf: defaultShelf() });
      return;
    }
    if (activeVoiceCloud) {
      activeVoiceCloud.setMode("heard");
      showCloudReaction(activeVoiceCloud, "waiting");
    }
    await capture(text, "voice", { keepCloud: true });
  };

  document.getElementById("rec-finish").addEventListener("click", finish);
  viewEl.querySelector('[data-go="shelves"]')?.addEventListener("click", () => {
    destroyVoiceCloud();
  });

  recognition = startListening({
    onText: text => {
      transcript = text;
      textEl.classList.remove("dim");
      textEl.textContent = text || "Говорите…";
      if (activeVoiceCloud && !store.simpleVisual) {
        enterCloudListening(activeVoiceCloud);
        // Без анализатора — лёгкий отклик на появление текста.
        if (!stopLevel) {
          activeVoiceCloud.setLevel(0.35 + Math.min(0.5, String(text || "").length / 80));
        }
      }
    },
    onError: kind => {
      textEl.classList.add("dim");
      if (kind === "denied") textEl.textContent = "Нет доступа к микрофону. Разрешите его в настройках.";
      else textEl.textContent = "Голос не сработал — напишите текстом.";
    },
  });

  if (!recognition) textEl.textContent = "Не удалось включить микрофон.";
}

function resetChatHoldGesture() {
  clearTimeout(chatHoldArmTimer);
  chatHoldArmTimer = null;
  chatHoldActive = false;
  chatHoldStarted = false;
  chatHoldTouchId = null;
  chatHoldPointerId = null;
  chatHoldMode = null;
  chatHoldMicKind = null;
  document.querySelectorAll("#chat-mic, #shelf-mic").forEach(el => el.classList.remove("holding"));
}

function releaseChatHoldCapture() {
  document.querySelectorAll("#chat-mic, #shelf-mic").forEach(el => {
    try {
      if (chatHoldPointerId != null && el.hasPointerCapture?.(chatHoldPointerId)) {
        el.releasePointerCapture(chatHoldPointerId);
      }
    } catch {}
  });
}

/** После удержания — FAB снова в режиме soul, без оверлея и listening. */
function teardownHoldRecordingUI() {
  state.chatListening = false;
  document.querySelectorAll("#chat-mic, #shelf-mic").forEach(el => el.classList.remove("holding"));
  document.getElementById("voice-overlay")?.remove();
  if (typeof stopLevel === "function") {
    try { stopLevel(); } catch {}
    stopLevel = null;
  }
  destroyVoiceCloud();
  requestAnimationFrame(mountFabSoul);
}

function resetMicIdleAfterHold() {
  chatVoiceMode = null;
  chatVoiceFinish = null;
  teardownHoldRecordingUI();
}

function disarmChatHoldReleaseWatch() {
  window.removeEventListener("touchend", onChatHoldTouchEnd, true);
  window.removeEventListener("touchcancel", onChatHoldTouchCancel, true);
  window.removeEventListener("mouseup", onChatHoldMouseUp, true);
  window.removeEventListener("pointerup", onChatHoldPointerUp, true);
  window.removeEventListener("pointercancel", onChatHoldPointerCancel, true);
  document.removeEventListener("visibilitychange", onChatHoldVisibility);
}

function armChatHoldReleaseWatch() {
  window.addEventListener("touchend", onChatHoldTouchEnd, { capture: true, passive: false });
  window.addEventListener("touchcancel", onChatHoldTouchCancel, { capture: true, passive: false });
  window.addEventListener("mouseup", onChatHoldMouseUp, true);
  window.addEventListener("pointerup", onChatHoldPointerUp, true);
  window.addEventListener("pointercancel", onChatHoldPointerCancel, true);
  document.addEventListener("visibilitychange", onChatHoldVisibility);
}

function stopChatVoice(cancel = true) {
  if (chatVoiceMode === "google") return;
  if (typeof chatVoiceFinish === "function") {
    const finish = chatVoiceFinish;
    chatVoiceFinish = null;
    finish(true);
    resetChatHoldGesture();
    disarmChatHoldReleaseWatch();
    return;
  }
  clearTimeout(chatVoiceTimer);
  chatVoiceTimer = null;
  if (chatVoiceSession) {
    try { chatVoiceSession.stop(); } catch {}
    chatVoiceSession = null;
  }
  stopRecognition();
  resetMicIdleAfterHold();
  resetChatHoldGesture();
  disarmChatHoldReleaseWatch();
  if (cancel) return;
}

function mountChatVoiceOverlay({ hold = false, tapCancel = false } = {}) {
  if (document.getElementById("voice-overlay")) return;
  const screen = viewEl.querySelector(".screen");
  if (!screen) return;
  const overlay = document.createElement("div");
  overlay.id = "voice-overlay";
  overlay.className = hold
    ? "voice-overlay voice-overlay-cloud voice-overlay-hold"
    : "voice-overlay voice-overlay-cloud";
  overlay.innerHTML = hold
    ? `<div class="voice-cloud-host" id="voice-cloud-host"></div>`
    : `
    <div class="voice-cloud-host" id="voice-cloud-host"></div>
    <div class="voice-core" id="voice-core">
      <div class="voice-hint" id="voice-hint">Говорите…</div>
    </div>
  `;
  screen.appendChild(overlay);
  const host = document.getElementById("voice-cloud-host");
  const cloud = mountVoiceCloud(host, { transparent: hold, hold });
  if (cloud && !hold) armCloudMicLevel(cloud);
  if (hold && !tapCancel) overlay.style.pointerEvents = "none";
  if (tapCancel) {
    overlay.addEventListener("click", () => chatVoiceFinish?.());
  } else if (!hold) {
    overlay.addEventListener("click", event => {
      if (event.target.closest(".voice-core")) return;
      stopChatVoice(true);
    });
  }
}

const MIC_PERMISSION_ASKED_KEY = "vc.micPermissionAsked";

function buildPermissionIssues() {
  const issues = [];
  if (state.micState && state.micState !== "granted") {
    issues.push({
      id: "mic",
      title: "Микрофон выключен",
      consequence: "Без него нельзя записывать голосом — только вводить текстом",
      button: "Включить",
    });
  }
  if (notifPermission() !== "granted" && notifPermission() !== "unsupported") {
    issues.push({
      id: "notif",
      title: "Уведомления выключены",
      consequence: "Напоминания не придут, даже если запись создана",
      button: "Включить",
    });
  }
  if (NATIVE?.batteryStatus && state.batteryIgnored === false) {
    issues.push({
      id: "battery",
      title: "Приложение засыпает",
      consequence: "Система может задержать напоминание на несколько минут или дольше",
      button: "Исправить",
    });
  }
  return issues;
}

/** Точка на ⚙️ — только в APK и только явные проблемы, не «ещё не спрашивали». */
function permissionsBadgeActive() {
  if (!NATIVE) return false;
  if (state.micState === "denied") return true;
  if (notifPermission() === "denied") return true;
  if (NATIVE?.batteryStatus && state.batteryIgnored === false && notifPermission() === "granted") return true;
  return false;
}

function permissionIssue(id) {
  return buildPermissionIssues().find(issue => issue.id === id);
}

function permissionsSectionHtml() {
  const micOn = state.micState === "granted";
  const notifOn = notifPermission() === "granted";
  const micIssue = permissionIssue("mic");
  const notifIssue = permissionIssue("notif");
  const batteryIssue = permissionIssue("battery");
  const batterySub = state.batteryIgnored === null
    ? "…"
    : (state.batteryIgnored ? "разрешено" : "ограничено");
  const micRow = `
    <button type="button" class="setting perm-row" id="perm-toggle-mic">
      <div class="perm-row-copy">
        <div class="name">${micIssue ? esc(micIssue.title) : "Микрофон"}</div>
        ${micIssue ? `<div class="sub">${esc(micIssue.consequence)}</div>` : ""}
      </div>
      <span class="toggle ${micOn ? "on" : ""}"><i></i></span>
    </button>`;
  const notifRow = `
    <button type="button" class="setting perm-row" id="perm-toggle-notif">
      <div class="perm-row-copy">
        <div class="name">${notifIssue ? esc(notifIssue.title) : "Уведомления"}</div>
        ${notifIssue ? `<div class="sub">${esc(notifIssue.consequence)}</div>` : ""}
      </div>
      <span class="toggle ${notifOn ? "on" : ""}"><i></i></span>
    </button>`;
  const batteryRow = NATIVE?.batteryStatus ? `
    <div class="setting perm-row perm-issue-row">
      <div class="perm-row-copy">
        <div class="name">${batteryIssue ? esc(batteryIssue.title) : "Энергосбережение / работа в фоне"}</div>
        <div class="sub">${batteryIssue ? esc(batteryIssue.consequence) : batterySub}</div>
      </div>
      <button type="button" class="btn ghost perm-issue-btn" data-perm-action="battery">${batteryIssue ? esc(batteryIssue.button) : "Открыть настройки"}</button>
    </div>` : "";
  const dotHint = NATIVE && permissionsBadgeActive()
    ? `<p class="lead perm-dot-hint">Точка на ⚙️ — нужно проверить разрешения ниже.</p>`
    : "";
  return `
    <div class="group-label">Разрешения</div>
    ${dotHint}
    ${micRow}
    ${notifRow}
    ${batteryRow}
  `;
}

function syncPermissionsBadge() {
  state.permissionsHasIssues = permissionsBadgeActive();
}

async function syncNotifStateForSettings() {
  const prev = notifPermission();
  if (NATIVE?.refreshNotificationPermission) {
    try { await NATIVE.refreshNotificationPermission(); } catch { /* ignore */ }
  }
  return prev !== notifPermission();
}

async function refreshPermissionsState() {
  const prevKey = buildPermissionIssues().map(i => i.id).join(",");
  await Promise.all([
    syncMicStateForSettings(),
    syncBatteryStateForSettings(),
    syncNotifStateForSettings(),
  ]);
  syncPermissionsBadge();
  const nextKey = buildPermissionIssues().map(i => i.id).join(",");
  return { changed: prevKey !== nextKey };
}

function applyPermissionsUiRefresh() {
  if (state.screen === "settings") renderSettings();
  else if (state.screen === "permissions") renderPermissions();
  else render();
}

async function ensureMicForVoice() {
  if (!NATIVE?.ensureMicPermission) return true;
  try { localStorage.setItem(MIC_PERMISSION_ASKED_KEY, "1"); } catch { /* ignore */ }
  const res = await NATIVE.ensureMicPermission();
  state.micState = res?.granted ? "granted" : "denied";
  if (res?.granted) return true;
  if (res?.blocked) {
    toast("Микрофон отключён в настройках телефона. Включите его для голосовых заметок — или пишите текстом.");
  } else {
    toast("Без микрофона голосовые заметки не записать. Разрешите доступ — или пишите текстом.");
  }
  return false;
}

/**
 * Полка = виджет: Google STT + capture в WidgetRecordActivity, без облака до результата.
 * Облако/лицо — только один playCenterFinale после broadcast (capture уже на сервере).
 */
async function startShelfVoiceWithCloud() {
  if (state.chatListening) return;
  if (Date.now() < chatHoldIgnoreUntil) return;
  const sharedCtx = sharedListVoiceContext();
  const startRecord = NATIVE?.speech?.startWidgetStyleRecord || NATIVE?.startWidgetStyleRecord;
  if (typeof startRecord !== "function") {
    const voiceOpts = sharedCtx || {};
    if (typeof NATIVE?.speech?.listenGoogle === "function") startGoogleChatVoice(voiceOpts);
    else if (speechAvailable()) startChatVoice({ mode: "auto", ...voiceOpts });
    else toast("Микрофон не отвечает. Давай текстом?");
    return;
  }
  if (state.screen !== "shelves" && state.screen !== "daily" && state.screen !== "lists") {
    state.screen = "shelves";
    if (!state.shelf || state.shelf === "chat") state.shelf = defaultShelf();
    renderShelves();
  }
  state.chatListening = true;
  chatVoiceMode = "shelf-widget";
  const finaleToken = ++captureFinaleToken;
  document.querySelectorAll("#shelf-mic").forEach(el => el.classList.add("holding"));
  let settled = false;
  let shelfGoogleTimer = null;
  let shelfSpeechUnsub = null;
  let shelfResult = null;
  const settleUi = () => {
    if (shelfGoogleTimer) {
      clearTimeout(shelfGoogleTimer);
      shelfGoogleTimer = null;
    }
    shelfSpeechUnsub?.();
    shelfSpeechUnsub = null;
    state.chatListening = false;
    chatVoiceMode = null;
    chatVoiceFinish = null;
    document.querySelectorAll("#shelf-mic").forEach(el => el.classList.remove("holding"));
    chatHoldIgnoreUntil = Date.now() + 400;
    destroyVoiceCloud();
    document.getElementById("voice-overlay")?.remove();
  };
  const completeShelfSession = async (payload = {}) => {
    if (payload?.source === "shelf") shelfResult = payload;
    if (settled) return;
    settled = true;
    settleUi();
    const text = String(shelfResult?.text || "").trim();
    if (!text || shelfResult?.cancelled) {
      await refreshState();
      render();
      return;
    }
    if (shelfResult?.replyKind === "shared_list") {
      toast(shelfResult?.message || "Отправлено");
      flashListSent(shelfResult?.message || "Отправлено");
      await refreshState();
      if (state.screen === "lists") renderLists();
      else render();
      return;
    }
    if (sharedCtx && text && !shelfResult?.cancelled) {
      await capture(text, "voice", { ...sharedCtx, keepCloud: true, forceCapture: true });
      return;
    }
    const reply = replyFromSpeechDone(shelfResult);
    const reactionEvent = reactionForCapture(reply, text);
    const reactionShelf = reply?.items?.[0]?.shelf || shelfResult?.replyShelf || state.shelf || defaultShelf();
    await playCenterFinale(reactionEvent, text, reactionShelf, finaleToken);
    await refreshState();
    render();
  };
  chatVoiceFinish = () => {
    if (settled) return;
    settled = true;
    settleUi();
    refreshState().then(() => render());
  };
  if (NATIVE.onSpeechDone) {
    shelfSpeechUnsub = NATIVE.onSpeechDone(data => {
      if (data?.source !== "shelf") return;
      completeShelfSession(data);
    });
  }
  shelfGoogleTimer = setTimeout(() => {
    if (settled) return;
    completeShelfSession({ source: "shelf", cancelled: true, timeout: true });
    toast("Запись не завершилась — попробуйте ещё раз");
  }, SHELF_GOOGLE_MAX_MS);
  try {
    await startRecord.call(
      NATIVE?.speech?.startWidgetStyleRecord ? NATIVE.speech : NATIVE,
      sharedCtx || {},
    );
  } catch {
    if (!settled) {
      completeShelfSession({ source: "shelf", cancelled: true });
      toast("Не удалось открыть микрофон");
    }
  }
}

function onShelfMicTap(event) {
  event.preventDefault();
  event.stopPropagation();
  if (state.chatListening || Date.now() < chatHoldIgnoreUntil) return;
  startShelfVoiceWithCloud();
}

async function startGoogleChatVoice(voiceOpts = {}) {
  if (state.chatListening) return;
  if (state.screen !== "shelves" && state.screen !== "daily" && state.screen !== "lists") {
    state.screen = "shelves";
    if (!state.shelf || state.shelf === "chat") state.shelf = defaultShelf();
    renderShelves();
  }
  state.chatListening = true;
  chatVoiceMode = "google";
  document.querySelectorAll("#chat-mic").forEach(el => el.classList.add("holding"));
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    state.chatListening = false;
    chatVoiceMode = null;
    chatVoiceFinish = null;
    document.querySelectorAll("#chat-mic").forEach(el => el.classList.remove("holding"));
    chatHoldIgnoreUntil = Date.now() + 400;
  };
  // Диалог Google сам закрывается. Удержание кнопки его не обрывает.
  chatVoiceFinish = () => {};
  try {
    const res = await NATIVE.speech.listenGoogle();
    const text = String(res?.text || "").trim();
    settle();
    if (!text) {
      if (res?.error === "no-recognizer") toast("Не удалось открыть микрофон Google");
      return;
    }
    await capture(text, "voice", voiceOpts);
  } catch (err) {
    settle();
    const msg = String(err?.message || err || "").toLowerCase();
    if (msg.includes("permission") || msg.includes("denied") || msg.includes("insufficient")) {
      toast("Нет доступа к микрофону");
    } else {
      toast("Не удалось открыть микрофон Google");
    }
  }
}

/**
 * mode: "hold" — пока палец на кнопке; "auto" — с виджета, пока не замолчит.
 */
async function startChatVoice({ mode = "auto", sharedList = false, pairId = "" } = {}) {
  if (state.chatListening) return;
  if (!speechAvailable()) {
    toast("Микрофон не отвечает. Давай текстом?");
    return;
  }
  const voiceOpts = sharedList
    ? { sharedList: true, pairId, captureMode: "shared" }
    : (sharedListVoiceContext() || {});
  if (mode !== "hold" && typeof NATIVE?.speech?.listenGoogle === "function") {
    startGoogleChatVoice(voiceOpts);
    return;
  }
  if (mode === "hold" && !(await ensureMicForVoice())) return;
  // Оверлей голоса — на текущем экране (календарь, ежедневные или общие списки).
  if (state.screen !== "shelves" && state.screen !== "daily" && state.screen !== "lists") {
    state.screen = "shelves";
    if (!state.shelf || state.shelf === "chat") state.shelf = defaultShelf();
    renderShelves();
  }
  state.chatListening = true;
  chatVoiceMode = mode;
  mountChatVoiceOverlay({ hold: mode === "hold" });
  const hint = () => document.getElementById("voice-hint");
  let transcript = "";
  let sent = false;
  let heard = false;

  const finish = async (cancel) => {
    if (sent) return;
    sent = true;
    chatVoiceFinish = null;
    clearTimeout(chatVoiceTimer);
    chatVoiceTimer = null;
    if (chatVoiceSession) {
      try { chatVoiceSession.stop(); } catch {}
      chatVoiceSession = null;
    }
    stopRecognition();
    chatVoiceMode = null;
    chatHoldIgnoreUntil = Date.now() + (cancel ? 350 : 4000);

    const text = transcript.trim();
    const overlayGone = !document.getElementById("voice-overlay");
    if (!overlayGone) teardownHoldRecordingUI();

    if (cancel || !text || (mode === "hold" && !heard)) {
      if (!overlayGone && activeVoiceCloud) {
        activeVoiceCloud.setLevel(0);
        showCloudReaction(activeVoiceCloud, "ask");
        await new Promise(r => setTimeout(r, 480));
      }
      if (!overlayGone) resetMicIdleAfterHold();
      return;
    }

    await capture(text, "voice", { voiceHeard: heard, ...voiceOpts });
    if (!overlayGone) resetMicIdleAfterHold();
  };
  chatVoiceFinish = finish;

  // В auto — стоп по тишине + settle, чтобы не резать «приготовить | курицу».
  const armSilence = () => {
    if (mode !== "auto") return;
    clearTimeout(chatVoiceTimer);
    chatVoiceTimer = setTimeout(() => {
      if (sent) return;
      if (!heard) {
        const el = hint();
        if (el) {
          el.classList.add("dim");
          el.textContent = "Не слышно";
        }
        finish(true);
        return;
      }
      chatVoiceTimer = setTimeout(() => {
        if (!sent) finish(false);
      }, VOICE_SETTLE_MS);
    }, heard ? VOICE_SILENCE_MS : VOICE_IDLE_MS);
  };

  const listen = () => {
    if (sent || !state.chatListening) return;
    chatVoiceSession = startListening({
      onText: text => {
        if (sent) return;
        const next = String(text || "").trim();
        if (!next) return;
        transcript = next;
        heard = true;
        if (activeVoiceCloud && !store.simpleVisual) {
          enterCloudListening(activeVoiceCloud);
          if (!stopLevel) {
            activeVoiceCloud.setLevel(0.35 + Math.min(0.5, next.length / 80));
          }
        }
        armSilence();
      },
      // Между проходами Android STT — не считаем это «тишиной конца фразы».
      onPass: () => {
        if (sent || !heard) return;
        armSilence();
      },
      onError: kind => {
        if (sent || !state.chatListening) return;
        if (kind === "denied") {
          const el = hint();
          if (el) {
            el.classList.add("dim");
            el.textContent = "Нет доступа к микрофону";
          }
          clearTimeout(chatVoiceTimer);
          chatVoiceTimer = setTimeout(() => finish(true), 1600);
        }
      },
    });

    if (!chatVoiceSession) {
      const el = hint();
      if (el) el.textContent = "Не удалось включить микрофон";
      setTimeout(() => finish(true), 1200);
      return;
    }
    armSilence();
  };

  // Короткая пауза: Android SpeechRecognizer после смены экрана иначе иногда сразу падает.
  setTimeout(listen, mode === "hold" ? 40 : 150);
}

function canStartChatHold() {
  if (state.chatListening || chatHoldActive) return false;
  if (Date.now() < chatHoldIgnoreUntil) return false;
  return true;
}

function beginChatHoldArm() {
  clearTimeout(chatHoldArmTimer);
  chatHoldArmTimer = setTimeout(() => {
    chatHoldArmTimer = null;
    if (!chatHoldActive || chatHoldStarted) return;
    chatHoldStarted = true;
    document.querySelectorAll("#chat-mic, #shelf-mic").forEach(el => el.classList.add("holding"));
    startChatVoice({ mode: "hold" });
  }, CHAT_HOLD_ARM_MS);
}

function completeChatHoldRelease() {
  if (!chatHoldActive) return;
  const started = chatHoldStarted;
  const micKind = chatHoldMicKind;
  disarmChatHoldReleaseWatch();
  clearTimeout(chatHoldArmTimer);
  chatHoldArmTimer = null;
  chatHoldActive = false;
  chatHoldStarted = false;
  chatHoldTouchId = null;
  chatHoldPointerId = null;
  chatHoldMode = null;
  chatHoldMicKind = null;
  document.querySelectorAll("#chat-mic, #shelf-mic").forEach(el => el.classList.remove("holding"));
  // Короткий tap на чате — Google/auto; полка — отдельный click, сюда не попадает.
  if (!started) {
    if (micKind === "chat" && !state.chatListening && Date.now() >= chatHoldIgnoreUntil) {
      startChatVoice({ mode: "auto" });
    }
    return;
  }
  // Отпускание после arm — сразу гасим оверлей, STT дорабатывает хвост, потом capture.
  releaseChatHoldCapture();
  teardownHoldRecordingUI();
  if (typeof chatVoiceFinish === "function") {
    const finish = chatVoiceFinish;
    setTimeout(() => {
      if (typeof finish === "function") finish(false);
    }, HOLD_RELEASE_SETTLE_MS);
  } else if (started) {
    stopChatVoice(false);
  }
}

function chatHoldReleaseBlocked() {
  return chatHoldStarted && state.chatListening;
}

function onChatMicPointerDown(event) {
  if (event.button != null && event.button !== 0) return;
  if (!canStartChatHold()) return;
  event.preventDefault();
  event.stopPropagation();
  chatHoldMicKind = event.currentTarget.id === "shelf-mic" ? "shelf" : "chat";
  chatHoldMode = event.pointerType === "touch" ? "touch" : "mouse";
  chatHoldPointerId = event.pointerId;
  chatHoldTouchId = chatHoldMode === "touch" ? event.pointerId : null;
  chatHoldActive = true;
  chatHoldStarted = false;
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  armChatHoldReleaseWatch();
  beginChatHoldArm();
}

function onChatHoldTouchEnd(event) {
  if (!chatHoldActive) return;
  if (chatHoldMode === "touch" && chatHoldTouchId != null
      && event.changedTouches?.[0]?.identifier !== chatHoldTouchId) return;
  event.preventDefault();
  completeChatHoldRelease();
}

function onChatHoldTouchCancel(event) {
  if (!chatHoldActive) return;
  // Облако при монтировании оверлея часто шлёт touchcancel — не обрываем запись.
  if (chatHoldReleaseBlocked()) {
    releaseChatHoldCapture();
    return;
  }
  completeChatHoldRelease();
}

function onChatHoldMouseUp() {
  if (!chatHoldActive) return;
  completeChatHoldRelease();
}

function onChatHoldPointerUp(event) {
  if (!chatHoldActive) return;
  if (chatHoldPointerId != null && event.pointerId !== chatHoldPointerId && !chatHoldStarted) return;
  completeChatHoldRelease();
}

function onChatHoldPointerCancel(event) {
  if (!chatHoldActive) return;
  if (chatHoldPointerId != null && event.pointerId !== chatHoldPointerId && !chatHoldStarted) return;
  if (chatHoldReleaseBlocked()) {
    releaseChatHoldCapture();
    return;
  }
  completeChatHoldRelease();
}

function onChatMicLostPointerCapture() {
  if (!chatHoldActive || !chatHoldStarted) return;
  // Оверлей забирает capture — отпускание ловим на window, запись не обрываем.
  if (chatHoldReleaseBlocked()) return;
  completeChatHoldRelease();
}

function onChatHoldVisibility() {
  if (document.visibilityState === "hidden" && chatHoldActive) completeChatHoldRelease();
}

/**
 * Подсказка при коротком тапе по кнопке записи.
 * Держится три секунды — столько нужно, чтобы прочитать и понять.
 */
function showHoldHint() {
  document.getElementById("hold-hint")?.remove();
  const el = document.createElement("div");
  el.id = "hold-hint";
  const nearFab = !!document.getElementById("shelf-mic");
  el.className = nearFab ? "hold-hint hold-hint-fab" : "hold-hint";
  el.textContent = "Держите кнопку, пока говорите";
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("on"));
  setTimeout(() => {
    el.classList.remove("on");
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function mountChatMicHold() {
  // Полка — один тап + WidgetRecordActivity (как виджет). Чат — удержание.
  document.querySelectorAll("#shelf-mic, #chat-mic").forEach(btn => {
    if (btn.dataset.holdBound === "1") return;
    btn.dataset.holdBound = "1";
    const shelf = btn.id === "shelf-mic";
    if (shelf) {
      btn.setAttribute("aria-label", "Нажмите, чтобы записать голосом");
      btn.addEventListener("click", onShelfMicTap);
      return;
    }
    btn.setAttribute("aria-label", "Нажмите или удерживайте, чтобы записать");
    btn.addEventListener("pointerdown", onChatMicPointerDown);
    btn.addEventListener("lostpointercapture", onChatMicLostPointerCapture);
    // Android WebView: отпускание ловим на window (touchend/pointerup), не pointermove.
  });
}

// Строка закладок ежедневных дел.
function shelfIconName(shelfId) {
  return SHELF_ICONS[shelfId] || null;
}

function shelfIconHtml(shelfId) {
  const name = shelfIconName(shelfId);
  if (!name || !ICONS[name]) return "";
  return `<span class="tab-ico" aria-hidden="true">${icon(name, 16)}</span>`;
}

function dailyShelfTabs(activeId) {
  const shelves = dailyShelves();
  const tabId = DAILY_SHELF_IDS.has(activeId) ? activeId : defaultDailyShelf();
  return `
    <div class="tabs">
      ${shelves.map(s => {
        const ping = state.tabPings?.[s.id] ? " tab-ping" : "";
        return `<button class="tab ${s.id === tabId ? "on" : ""}${ping}" data-daily-tab="${s.id}">${shelfIconHtml(s.id)}${esc(s.label)}</button>`;
      }).join("")}
    </div>
  `;
}

function renderDaily() {
  if (!state.shelf) state.shelf = defaultDailyShelf();
  if (proShelfGated(state.shelf)) {
    viewEl.innerHTML = proShelfPromoScreenHtml(state.shelf, { back: "shelves" });
    return;
  }
  if (state.shelf === "alarms") return renderAlarmsShelf(true);
  if (state.shelf === "care") return renderCareShelf(true);
  if (state.shelf === "health") return renderHealthShelf(true);

  const list = shelfItems(state.shelf);
  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${bar(labelOfShelf(state.shelf), { back: "shelves" })}
      ${promptCard()}
      <div class="scroll pad-fab ${shelfFabPadClass()}">
        ${list.length ? list.map(itemCard).join("") : `<div class="empty">${EMPTY_SHELF[state.shelf] || "Пусто.<br/>Скажите или напишите — появится здесь."}</div>`}
      </div>
      ${shelfFabStack()}
    </section>
  `;
  mountShelfMicFab();
}

function renderCalendarMain() {
  ensureCalendarDay();
  const pick = state.calendarDay || todayParts();
  const timeDraft = state.noteTimeDraft;
  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${calendarStripHtml()}
      ${observationBanner()}
      ${promptCard()}
      <div class="scroll pad-fab ${shelfFabPadClass()}">
        ${calendarDayCardsHtml(pick)}
      </div>
      ${shelfFabStack()}
      ${timeDraft ? noteTimeMiniModal(timeDraft) : ""}
    </section>
  `;
  mountCalendarStrip();
  if (timeDraft) mountNoteTimeWheels(timeDraft);
  if (state.highlightId) {
    const row = viewEl.querySelector(`[data-item="${state.highlightId}"]`);
    row?.scrollIntoView({ block: "center" });
    state.highlightId = null;
  }
  mountShelfMicFab();
}

// Строка закладок одна на все корневые экраны: полки, будильник, наборы.
function shelfTabs(activeId, { waiting = 0 } = {}) {
  // Архив открыт кнопкой над микрофоном — в строке закладок его нет.
  const shelves = visibleShelves();
  const tabId = activeId === "archive"
    ? (shelves[0]?.id || defaultShelf())
    : activeId;
  const waitingTab = shelves.find(s => s.id === "tasks")?.id || shelves[0]?.id;
  return `
    <div class="tabs">
      ${shelves.map(s => {
        const mark = s.id === waitingTab && waiting ? `<span class="tab-count">${waiting}</span>` : "";
        const ping = state.tabPings?.[s.id] ? " tab-ping" : "";
        return `<button class="tab ${s.id === tabId ? "on" : ""}${ping}" data-shelf-tab="${s.id}">${shelfIconHtml(s.id)}${esc(s.label)}${mark}</button>`;
      }).join("")}
    </div>
  `;
}

function renderShelves() {
  if (consentPending()) {
    viewEl = appEl;
    return renderConsent();
  }
  if (state.shelf === "archive") return renderArchiveShelf();
  return renderCalendarMain();
}

function promptCard() {
  const p = state.prompt;
  if (!p) return "";
  return `
    <div class="prompt-card">
      <div class="prompt-title">${esc(p.title || "Так?")}</div>
      <div class="chip-row">
        ${(p.chips || []).map(c => `
          <button class="chip ${c.style === "danger" ? "ghost" : ""}" data-chip="${esc(c.action)}" ${c.id ? `data-id="${c.id}"` : ""}>${esc(c.label)}</button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderCareShelf(daily = false) {
  if (proShelfGated("care")) {
    viewEl.innerHTML = proShelfPromoScreenHtml("care", { back: "shelves" });
    return;
  }
  const waiting = overdueCount();
  const list = shelfItems("care").slice().sort((a, b) =>
    (a.careOrder || 0) - (b.careOrder || 0)
    || String(a.title || "").localeCompare(String(b.title || ""), "ru"));
  const morning = list.filter(i => carePartOf(i) === "morning");
  const evening = list.filter(i => carePartOf(i) === "evening");
  const morningTime = careColumnTime(list, "morning");
  const eveningTime = careColumnTime(list, "evening");
  const timeDraft = state.careTimeDraft;

  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${daily ? `${bar(labelOfShelf("care"), { back: "shelves" })}` : shelfTabs("care", { waiting })}
      ${promptCard()}
      <div class="scroll pad-fab ${shelfFabPadClass()} care-board">
        ${list.length ? `
          <div class="care-stack">
            ${careSection("morning", "Утро", ICONS.sun, morning, morningTime)}
            ${careSection("evening", "Вечер", ICONS.moon, evening, eveningTime)}
          </div>` : `<div class="empty">${EMPTY_SHELF.care}</div>`}
      </div>
      ${shelfFabStack()}
      ${timeDraft ? careTimeModal(timeDraft) : ""}
    </section>
  `;
  viewEl.querySelector(".tabs .tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (state.highlightId) {
    const row = viewEl.querySelector(`[data-item="${state.highlightId}"]`);
    row?.scrollIntoView({ block: "center" });
    state.highlightId = null;
  }
  if (timeDraft) mountCareTimeWheels(timeDraft);
  mountShelfMicFab();
  if (!state.user?.settings?.careRoutineV2 && !careSeedBusy) {
    ensureCareRoutine().then(changed => {
      if (changed && state.screen === "shelves" && state.shelf === "care") renderCareShelf(false);
      if (changed && state.screen === "daily" && state.shelf === "care") renderCareShelf(true);
    });
  }
}

function careSection(part, label, icon, items, time) {
  return `
    <section class="care-section" data-care-col="${part}">
      <header class="care-section-head">
        <div class="care-section-title">
          <span class="care-section-ico" aria-hidden="true">${icon}</span>
          <span>${esc(label)}</span>
        </div>
        <button type="button" class="care-section-time" data-care-time="${part}" aria-label="Время ${esc(label)}">
          ${esc(fmtClock(time))}
        </button>
      </header>
      <div class="care-plaques">
        ${items.length
          ? items.map(item => careStepCard(item)).join("")
          : `<div class="care-empty">Пусто</div>`}
      </div>
    </section>
  `;
}

function joinCareTitle(step, product) {
  const s = String(step || "").trim();
  const p = String(product || "").trim();
  if (s && p) return `${s} — ${p}`;
  return s || p || "Уход";
}

function careStepCard(item) {
  const { step, product } = splitCareTitle(item.title);
  const note = String(item.note || "").trim();
  return `
    <div class="swipe care-swipe ${state.highlightId === item.id ? "flash" : ""}" data-item="${item.id}">
      <button class="swipe-del" data-del="${item.id}" tabindex="-1" aria-hidden="true">Удалить</button>
      <div class="swipe-front">
        <div class="care-plaque">
          <div class="care-plaque-main">
            <div class="care-plaque-label">
              ${esc(step || "Шаг")}
              ${item.starred ? `<span class="care-star" aria-hidden="true">${ICONS.star}</span>` : ""}
            </div>
            ${product ? `<div class="care-plaque-product">${esc(product)}</div>` : ""}
            ${note ? `<div class="care-tag">${esc(note)}</div>` : ""}
          </div>
          <button type="button" class="care-edit" data-care-edit="${item.id}" aria-label="Изменить">
            ${ICONS.pencil}
          </button>
        </div>
      </div>
    </div>
  `;
}

function careTimeModal(draft) {
  const time = draft.time || { hour: 8, minute: 0 };
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  const label = draft.carePart === "evening" ? "Вечер" : "Утро";
  return `
    <div class="alarm-overlay" id="care-time-overlay">
      <div class="alarm-modal">
        <div class="alarm-modal-title">Время · ${esc(label)}</div>
        <div class="alarm-modal-sub">Одно время для всего раздела</div>
        <div class="alarm-wheels">
          <div class="alarm-wheel-col">
            <div class="alarm-wheel-lab">ч</div>
            ${wheel(hours, time.hour, "care-hour")}
          </div>
          <div class="alarm-wheel-col">
            <div class="alarm-wheel-lab">м</div>
            ${wheel(minutes, time.minute, "care-minute")}
          </div>
        </div>
        <div class="alarm-modal-actions">
          <button type="button" class="btn ghost" id="care-time-cancel">Отмена</button>
          <button type="button" class="btn" id="care-time-done">Готово</button>
        </div>
      </div>
    </div>
  `;
}

function mountCareTimeWheels(draft) {
  viewEl.querySelectorAll(".wheel").forEach(w => {
    w.scrollTop = Number(w.dataset.index || 0) * 40;
    let timer = null;
    w.addEventListener("scroll", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const items = [...w.querySelectorAll(".wheel-item")];
        const idx = Math.min(items.length - 1, Math.max(0, Math.round(w.scrollTop / 40)));
        items.forEach((el, i) => el.classList.toggle("on", i === idx));
        if (w.dataset.wheel === "care-hour" || w.dataset.wheel === "health-hour") draft.time.hour = idx;
        if (w.dataset.wheel === "care-minute" || w.dataset.wheel === "health-minute") draft.time.minute = idx;
      }, 60);
    });
  });
}

function renderHealthShelf(daily = false) {
  if (proShelfGated("health")) {
    viewEl.innerHTML = proShelfPromoScreenHtml("health", { back: "shelves" });
    return;
  }
  const waiting = overdueCount();
  const list = shelfItems("health").slice().sort((a, b) =>
    (a.healthOrder || 0) - (b.healthOrder || 0)
    || String(a.title || "").localeCompare(String(b.title || ""), "ru"));
  const timeDraft = state.healthTimeDraft;

  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${daily ? `${bar(labelOfShelf("health"), { back: "shelves" })}` : shelfTabs("health", { waiting })}
      ${promptCard()}
      <div class="scroll pad-fab ${shelfFabPadClass()} health-board">
        ${list.length
          ? `<div class="health-stack">${HEALTH_DAY_ORDER.map(day => healthDayBlock(day, list)).join("")}</div>`
          : `<div class="empty">${EMPTY_SHELF.health}</div>`}
      </div>
      ${shelfFabStack()}
      ${timeDraft ? healthTimeModal(timeDraft) : ""}
    </section>
  `;
  viewEl.querySelector(".tabs .tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (timeDraft) mountCareTimeWheels(timeDraft);
  mountShelfMicFab();
  if (!state.user?.settings?.healthRoutineV3 && !healthSeedBusy) {
    ensureHealthRoutine().then(changed => {
      if (changed && state.screen === "shelves" && state.shelf === "health") renderHealthShelf(false);
      if (changed && state.screen === "daily" && state.shelf === "health") renderHealthShelf(true);
    });
  }
}

function healthDayBlock(weekday, allItems) {
  const dayItems = allItems.filter(i => healthAppliesOnDay(i, weekday));
  const weekend = weekday === 0 || weekday === 6;
  const on = healthShelfDayOn(weekday);
  return `
    <section class="health-day ${on ? "" : "health-day--off"}" data-health-day="${weekday}">
      <header class="health-day-head">
        <h3 class="health-day-title">${esc(HEALTH_DAY_LABELS[weekday])}</h3>
        <button type="button" class="health-day-toggle" data-health-shelf-day="${weekday}" aria-label="${on ? "Выключить" : "Включить"} ${esc(HEALTH_DAY_LABELS[weekday])}">
          <span class="toggle ${on ? "on" : ""}" aria-hidden="true"><i></i></span>
        </button>
      </header>
      <div class="health-day-body">
        ${HEALTH_PARTS.map(part => healthPartBlock(weekday, part, dayItems, weekend)).join("")}
      </div>
    </section>
  `;
}

function healthPartBlock(weekday, part, dayItems, weekend) {
  const items = dayItems
    .filter(i => healthPartOf(i) === part.id)
    .sort((a, b) => (a.healthOrder || 0) - (b.healthOrder || 0));
  const time = healthColumnTime(items.length ? items : shelfItems("health"), part.id);
  const pause = weekend && part.id === "evening"
    ? `<div class="health-pause">Ашваганда — перерыв (выходные)</div>`
    : "";
  return `
    <div class="health-part" data-health-part="${part.id}">
      <header class="health-part-head">
        <div class="health-part-title">${esc(part.label)}</div>
        <button type="button" class="care-section-time" data-health-time="${part.id}" aria-label="Время ${esc(part.label)}">
          ${esc(fmtClock(time))}
        </button>
      </header>
      <div class="care-plaques">
        ${items.map(item => healthStepCard(item)).join("")}
        ${pause}
        ${!items.length && !pause ? `<div class="care-empty">Пусто</div>` : ""}
      </div>
    </div>
  `;
}

function healthStepCard(item) {
  const { step, product } = splitCareTitle(item.title);
  const note = String(item.note || "").trim();
  const tag = item.asNeeded ? "по потребности" : "";
  return `
    <div class="swipe care-swipe ${state.highlightId === item.id ? "flash" : ""}" data-item="${item.id}">
      <button class="swipe-del" data-del="${item.id}" tabindex="-1" aria-hidden="true">Удалить</button>
      <div class="swipe-front">
        <div class="care-plaque ${item.asNeeded ? "health-as-needed" : ""}">
          <div class="care-plaque-main">
            <div class="care-plaque-label">${esc(step || "Витамин")}</div>
            ${product ? `<div class="care-plaque-product">${esc(product)}</div>` : ""}
            ${note ? `<div class="care-tag">${esc(note)}</div>` : ""}
            ${tag ? `<div class="care-tag">${esc(tag)}</div>` : ""}
          </div>
          <button type="button" class="care-edit" data-health-edit="${item.id}" aria-label="Изменить">
            ${ICONS.pencil}
          </button>
        </div>
      </div>
    </div>
  `;
}

function healthTimeModal(draft) {
  const time = draft.time || { hour: 8, minute: 0 };
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  const label = HEALTH_PARTS.find(p => p.id === draft.healthPart)?.label || "Слот";
  return `
    <div class="alarm-overlay" id="health-time-overlay">
      <div class="alarm-modal">
        <div class="alarm-modal-title">Время · ${esc(label)}</div>
        <div class="alarm-modal-sub">Одно время для всего слота</div>
        <div class="alarm-wheels">
          <div class="alarm-wheel-col">
            <div class="alarm-wheel-lab">ч</div>
            ${wheel(hours, time.hour, "health-hour")}
          </div>
          <div class="alarm-wheel-col">
            <div class="alarm-wheel-lab">м</div>
            ${wheel(minutes, time.minute, "health-minute")}
          </div>
        </div>
        <div class="alarm-modal-actions">
          <button type="button" class="btn ghost" id="health-time-cancel">Отмена</button>
          <button type="button" class="btn" id="health-time-done">Готово</button>
        </div>
      </div>
    </div>
  `;
}

function renderArchiveShelf() {
  const list = shelfItems("archive");
  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${bar("Архив", { back: "shelves" })}
      ${promptCard()}
      <div class="archive-bar">
        <div class="archive-bar-title">Архив</div>
        ${list.length ? `<button class="icon-btn archive-clear" id="archive-clear" aria-label="Удалить всё">${ICONS.trashFilled}</button>` : ""}
      </div>
      <div class="scroll pad-fab ${shelfFabPadClass() || "pad-fab-tall"}">
        ${list.length
          ? list.map(itemCard).join("")
          : `<div class="empty">Пока пусто.<br/>Сюда уходят прошедшие по времени записи со сроком.</div>`}
      </div>
      ${shelfFabStack()}
    </section>
  `;
  viewEl.querySelector(".tabs .tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  mountShelfMicFab();
}

function renderAlarmsShelf(daily = false) {
  const list = shelfItems("alarms").sort((a, b) => {
    const ta = (a.time?.hour || 0) * 60 + (a.time?.minute || 0);
    const tb = (b.time?.hour || 0) * 60 + (b.time?.minute || 0);
    return ta - tb;
  });
  const nextOn = list.filter(i => i.enabled !== false && i.time).sort((a, b) => itemStamp(a) - itemStamp(b))[0];
  const until = nextOn ? fmtUntilAlarm(nextOn) : "";
  const draft = state.alarmDraft;
  const editing = draft || (state.alarmEditId ? list.find(i => i.id === state.alarmEditId) : null);

  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${daily ? `${bar(labelOfShelf("alarms"), { back: "shelves" })}` : shelfTabs("alarms")}
      <div class="alarm-head">${until ? esc(until) : "Нет включённых будильников"}</div>
      <div class="scroll pad-fab ${shelfFabPadClass()} alarm-list">
        ${list.length ? list.map(alarmCard).join("") : `<div class="empty">${EMPTY_SHELF.alarms}</div>`}
      </div>
      ${shelfFabStack()}
      ${editing ? alarmEditModal(editing) : ""}
    </section>
  `;
  viewEl.querySelector(".tabs .tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (editing) mountAlarmWheels(editing);
  mountShelfMicFab();
}

function alarmRepeatLabel(item) {
  const kind = item.repeat?.kind;
  if (!kind) return "Однократно";
  if (kind === "daily") return "Ежедневно";
  if (kind === "weekdays") return "По будням";
  if (kind === "weekends") return "По выходным";
  if (kind === "weekly" && item.repeat?.days?.length) {
    const names = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    const days = [...item.repeat.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    return days.map(d => names[d]).join(", ");
  }
  if (kind === "weekly") return "Еженедельно";
  return "Однократно";
}

function alarmCard(item) {
  const on = item.enabled !== false;
  const time = item.time
    ? `${String(item.time.hour).padStart(2, "0")}:${String(item.time.minute).padStart(2, "0")}`
    : "--:--";
  const note = item.title && item.title !== "Будильник" ? item.title : "";
  const meta = [alarmRepeatLabel(item), note].filter(Boolean).join(" · ");
  return `
    <button type="button" class="alarm-card ${on ? "" : "off"}" data-alarm-open="${item.id}">
      <div class="alarm-card-main">
        <div class="alarm-time">${time}</div>
        <div class="alarm-meta">${esc(meta)}</div>
      </div>
      <span class="toggle ${on ? "on" : ""}" data-alarm-toggle="${item.id}"><i></i></span>
    </button>
  `;
}

function alarmEditModal(item) {
  const time = item.time || { hour: 7, minute: 0 };
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  const until = fmtUntilAlarm({ ...item, time, enabled: true });
  return `
    <div class="alarm-overlay" id="alarm-overlay">
      <div class="alarm-modal">
        <div class="alarm-modal-title">${item.id ? "Изменить будильник" : "Новый будильник"}</div>
        <div class="alarm-modal-sub">${until ? esc(until) : "Выберите время"}</div>
        <div class="alarm-wheels">
          <div class="alarm-wheel-col">
            <div class="alarm-wheel-lab">ч</div>
            ${wheel(hours, time.hour, "alarm-hour")}
          </div>
          <div class="alarm-wheel-col">
            <div class="alarm-wheel-lab">м</div>
            ${wheel(minutes, time.minute, "alarm-minute")}
          </div>
        </div>
        <div class="alarm-modal-actions">
          <button type="button" class="btn ghost" id="alarm-to-settings">Настройки</button>
          <button type="button" class="btn" id="alarm-done">Готово</button>
        </div>
      </div>
    </div>
  `;
}

function mountAlarmWheels(item) {
  const draft = state.alarmDraft || {
    id: item.id || null,
    time: { ...(item.time || { hour: 7, minute: 0 }) },
    title: item.title || "Будильник",
    repeat: item.repeat || { kind: "daily" },
    vibrate: item.vibrate !== false,
    melody: item.melody || "default",
    enabled: item.enabled !== false,
  };
  state.alarmDraft = draft;

  viewEl.querySelectorAll(".wheel").forEach(w => {
    w.scrollTop = Number(w.dataset.index || 0) * 40;
    let timer = null;
    w.addEventListener("scroll", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const items = [...w.querySelectorAll(".wheel-item")];
        const idx = Math.min(items.length - 1, Math.max(0, Math.round(w.scrollTop / 40)));
        items.forEach((el, i) => el.classList.toggle("on", i === idx));
        if (w.dataset.wheel === "alarm-hour") draft.time.hour = idx;
        if (w.dataset.wheel === "alarm-minute") draft.time.minute = idx;
        const sub = viewEl.querySelector(".alarm-modal-sub");
        if (sub) sub.textContent = fmtUntilAlarm({ ...draft, date: nextAlarmDate(draft.time, draft.repeat), enabled: true }) || "Выберите время";
        scheduleAlarmAutoSave();
      }, 60);
    });
  });
}

function nextAlarmDate(time, repeat = null) {
  const now = new Date();
  const due = time.hour * 60 + time.minute;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (due <= nowMins) d.setDate(d.getDate() + 1);
  const wantDays = repeat?.kind === "weekly" && Array.isArray(repeat.days) && repeat.days.length
    ? new Set(repeat.days)
    : repeat?.kind === "weekdays"
      ? new Set([1, 2, 3, 4, 5])
      : null;
  if (wantDays) {
    for (let i = 0; i < 8; i += 1) {
      if (wantDays.has(d.getDay())) break;
      d.setDate(d.getDate() + 1);
    }
  }
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

function itemCard(item, opts = {}) {
  const calendar = Boolean(opts.calendar);
  const day = opts.day || state.calendarDay || todayParts();
  const fulfilled = calendar && isCalendarFulfilled(item, day);
  if (isAlarmItem(item)) {
    const on = item.enabled !== false;
    const time = item.time
      ? `${String(item.time.hour).padStart(2, "0")}:${String(item.time.minute).padStart(2, "0")}`
      : "--:--";
    const note = item.title && item.title !== "Будильник" ? item.title : "";
    const meta = [alarmRepeatLabel(item), note].filter(Boolean).join(" · ");
    return `
      <button type="button" class="card-row alarm-day-row ${on ? "" : "off"}" data-alarm-open="${item.id}">
        <div class="alarm-day-time">${time}</div>
        <div class="alarm-day-body">
          <div class="title">Будильник</div>
          ${meta ? `<div class="meta">${esc(meta)}</div>` : ""}
        </div>
        <span class="alarm-day-bell" aria-hidden="true">${ICONS.bell}</span>
      </button>
    `;
  }
  if (item.careSummary) {
    return `
      <div class="card-row" data-item="${item.id}">
        <div class="card-body">
          <button class="card-main" data-open-care="${item.carePart || "morning"}">
            <div class="row">
              <div>
                <div class="title">${esc(item.title)}</div>
                <div class="meta">${esc(fmtWhen(item))}</div>
              </div>
              <span class="pill care">уход</span>
            </div>
          </button>
        </div>
      </div>
    `;
  }
  if (item.healthSummary) {
    return `
      <div class="card-row" data-item="${item.id}">
        <div class="card-body">
          <button class="card-main" data-open-health="${item.healthPart || "morning"}">
            <div class="row">
              <div>
                <div class="title">${esc(item.title)}</div>
                <div class="meta">${esc(fmtWhen(item))}</div>
              </div>
              <span class="pill care">витамины</span>
            </div>
          </button>
        </div>
      </div>
    `;
  }
  const archived = Boolean(item.archived);
  const overdue = !archived && !fulfilled && isOverdue(item);
  const isCare = isCareItem(item);
  const meta = [
    fulfilled ? "исполнена"
      : archived ? `архив · ${fmtWhen(item)}`
      : overdue ? `скоро · ${fmtWhen(item)}`
      : fmtWhen(item),
    isCare ? "" : (item.place || ""),
    item.who || "",
    item.repeatLabel || "",
    item.courseId ? `приём ${item.courseTaken || 0} из ${item.courseTotal || 0}` : "",
    !archived && item.shelf && state.shelf === "archive" ? labelOfShelf(item.shelf) : "",
    archived && item.shelf ? labelOfShelf(item.shelf) : "",
  ].filter(Boolean).join(" · ");
  const pill = item.type === "bday" ? "warn"
    : item.type === "note" || item.type === "custom" ? "soft"
    : item.type === "buy" ? "buy"
    : item.type === "sport" ? "sport"
    : item.type === "care" ? "care"
    : item.type === "bills" ? "warn"
    : item.type === "health" ? "care"
    : "";
  const pillLabel = item.type === "custom"
    ? (labelOfShelf(item.shelf) || "своя")
    : (TYPE_LABEL[item.type] || item.type);
  const phoneText = String(item.phone || "").trim();
  const phoneLink = telHref(phoneText);

  // Запись смахивается влево — под ней открывается «Удалить», как в списках телефона.
  return `
    <div class="swipe ${state.highlightId === item.id ? "flash" : ""}" data-item="${item.id}">
      <button class="swipe-del" data-del="${item.id}">Удалить</button>
      <div class="swipe-front">
        <div class="card-row ${archived ? "archived" : ""} ${overdue ? "overdue" : ""} ${fulfilled ? "fulfilled" : ""}">
          <div class="card-body">
            <button class="card-main" data-open="${item.id}">
              <div class="row">
                <div>
                  <div class="title ${fulfilled ? "done-text" : ""}">${esc(item.title)}</div>
                  <div class="meta">${esc(meta)}${!fulfilled && item.time && item.date && !archived ? `<br/>пуш · ${esc(fmtRemind(item))}` : ""}</div>
                </div>
                <span class="card-actions">
                  ${phoneLink ? `<a class="card-call" href="${esc(phoneLink)}" aria-label="Позвонить ${esc(phoneText)}" onclick="event.stopPropagation()">${icon("phone", 18)}</a>` : ""}
                  <span class="card-shelf-ico ${pill}" title="${esc(pillLabel)}" aria-label="${esc(pillLabel)}">${shelfIconHtml(item.shelf || item.type)}</span>
                </span>
              </div>
            </button>
            ${!archived && !fulfilled && !item.time && item.date ? `
              <div class="set-time-row">
                <button type="button" class="set-time-btn" data-set-time="${item.id}" aria-label="Установить время">
                  <span class="set-time-ico">${ICONS.clock}</span>
                  <span>Установить время</span>
                </button>
              </div>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

function noteTimeMiniModal(draft) {
  const time = draft.time || { hour: 12, minute: 0 };
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  return `
    <div class="time-mini-overlay" id="note-time-overlay">
      <div class="time-mini-modal" role="dialog" aria-label="Установить время">
        <div class="time-mini-title">Время</div>
        <div class="time-mini-wheels">
          <div class="time-mini-col">
            <div class="time-mini-lab">ч</div>
            ${wheel(hours, time.hour, "note-hour")}
          </div>
          <div class="time-mini-col">
            <div class="time-mini-lab">м</div>
            ${wheel(minutes, time.minute, "note-minute")}
          </div>
        </div>
        <div class="time-mini-actions">
          <button type="button" class="btn ghost" id="note-time-cancel">Отмена</button>
          <button type="button" class="btn" id="note-time-done">Готово</button>
        </div>
      </div>
    </div>
  `;
}

function mountNoteTimeWheels(draft) {
  viewEl.querySelectorAll("#note-time-overlay .wheel").forEach(w => {
    w.scrollTop = Number(w.dataset.index || 0) * 36;
    let timer = null;
    w.addEventListener("scroll", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const items = [...w.querySelectorAll(".wheel-item")];
        const idx = Math.min(items.length - 1, Math.max(0, Math.round(w.scrollTop / 36)));
        items.forEach((el, i) => el.classList.toggle("on", i === idx));
        if (w.dataset.wheel === "note-hour") draft.time.hour = idx;
        if (w.dataset.wheel === "note-minute") draft.time.minute = idx;
      }, 60);
    });
  });
}

function wheel(values, selectedIndex, key) {
  const idx = Math.max(0, selectedIndex);
  return `
    <div class="wheel" data-wheel="${key}" data-index="${idx}">
      <div class="wheel-pad"></div>
      ${values.map((v, i) => `<div class="wheel-item ${i === idx ? "on" : ""}">${esc(v)}</div>`).join("")}
      <div class="wheel-pad"></div>
    </div>
  `;
}

function currentItem() {
  return state.items.find(i => i.id === state.itemId) || null;
}

function detailShowFields(item) {
  if (state.detailShowItemId !== item.id || !state.detailShow) {
    state.detailShow = {
      who: Boolean(String(item.who || "").trim()),
      place: Boolean(String(item.place || "").trim()),
      phone: Boolean(String(item.phone || "").trim()),
      note: Boolean(String(item.note || "").trim()),
    };
    state.detailShowItemId = item.id;
  }
  return state.detailShow;
}

function renderDetail() {
  const item = currentItem();
  if (!item) return go("shelves");

  const isCare = item.type === "care" || item.shelf === "care";
  const isHealth = isHealthItem(item);
  const slimCard = isCare || isHealth;
  const date = item.date || todayParts();
  const time = item.time || { hour: 9, minute: 0 };
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minuteIdx = Math.max(0, MINS.indexOf(String(time.minute).padStart(2, "0")));
  const remindIdx = Math.max(0, REMIND_OFFSETS.findIndex(r => r.v === item.remind));
  const split = splitCareTitle(item.title);
  const show = slimCard ? null : detailShowFields(item);
  const whoText = String(item.who || "").trim();
  const placeText = String(item.place || "").trim();
  const phoneText = String(item.phone || "").trim();
  const noteText = String(item.note || "").trim();
  const phoneLink = telHref(phoneText);

  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${bar("Карточка", { back: "shelves" })}
      <div class="scroll pad-bottom">
        ${isCare ? `
          <label class="field">
            <span>Название плашки</span>
            <input id="f-care-step" value="${esc(split.step)}" placeholder="Очищение" />
          </label>
          <label class="field">
            <span>Название косметики</span>
            <input id="f-care-product" value="${esc(split.product)}" placeholder="Название средства" />
          </label>
        ` : isHealth ? `
          <label class="field">
            <span>Витамин / добавка</span>
            <input id="f-care-step" value="${esc(split.step)}" placeholder="Магний" />
          </label>
          <label class="field">
            <span>Дозировка</span>
            <input id="f-care-product" value="${esc(split.product)}" placeholder="300–400 мг" />
          </label>
          <label class="field">
            <span>Заметка</span>
            <input id="f-health-note" value="${esc(item.note || "")}" placeholder="не обязательно" />
          </label>
        ` : `
        <div class="detail-summary">
          <div class="detail-summary-title">${esc(item.title)}</div>
          <div class="detail-summary-when">${esc(fmtWhen(item))}</div>
          ${whoText ? `<div class="detail-line">👤 ${esc(whoText)}</div>` : ""}
          ${placeText ? `<div class="detail-line">📍 ${esc(placeText)}</div>` : ""}
          ${phoneText ? `<div class="detail-line detail-phone">
            <span>📞 ${esc(phoneText)}</span>
            ${phoneLink ? `<a class="detail-call" href="${esc(phoneLink)}">Позвонить</a>` : ""}
          </div>` : ""}
          ${noteText ? `<div class="detail-line detail-note">📝 ${esc(truncateDisplay(noteText, 240))}</div>` : ""}
        </div>

        <label class="field">
          <span>Название</span>
          <input id="f-title" value="${esc(item.title)}" />
        </label>
        <div class="pick-block ${state.picker === "date" ? "open" : ""}">
          <button class="pick-head" type="button" data-pick="date">
            <span class="lab">Когда</span>
            <span class="val" id="val-date">${item.date ? `${date.day} ${MONTHS_SHORT[date.month]}` : "без даты"}</span>
            <span class="pick-ico">${ICONS.calendar}</span>
          </button>
          <div class="pick-body">
            <div class="wheels">
              ${wheel(days, date.day - 1, "day")}
              ${wheel(MONTHS_FULL, date.month, "month")}
            </div>
            <div class="pick-hint">листайте · тап по иконке свернёт</div>
          </div>
        </div>
        `}

        ${slimCard ? "" : `
        <div class="pick-block ${state.picker === "time" ? "open" : ""}">
          <button class="pick-head" type="button" data-pick="time">
            <span class="lab">Время</span>
            <span class="val" id="val-time">${item.time ? fmtTime(item) : "без времени"}</span>
            <span class="pick-ico">${ICONS.clock}</span>
          </button>
          <div class="pick-body">
            <div class="wheels">
              ${wheel(hours, time.hour, "hour")}
              ${wheel(MINS, minuteIdx, "minute")}
            </div>
            <div class="pick-hint">листайте · тап по иконке свернёт</div>
          </div>
        </div>

        <div class="pick-block ${state.picker === "remind" ? "open" : ""}">
          <button class="pick-head" type="button" data-pick="remind">
            <span class="lab">Пуш</span>
            <span class="val" id="val-remind">${esc(fmtRemind(item))}</span>
            <span class="pick-ico">${ICONS.bell}</span>
          </button>
          <div class="pick-body">
            <div class="wheels">
              ${wheel(REMIND_OFFSETS.map(r => r.label), remindIdx, "remind")}
            </div>
            <div class="pick-hint">листайте · тап по иконке свернёт</div>
          </div>
        </div>`}

        ${isHealth ? "" : `
        <div class="pick-block ${state.picker === "repeat" ? "open" : ""}">
          <button class="pick-head" type="button" data-pick="repeat">
            <span class="lab">Повтор</span>
            <span class="val" id="val-repeat">${esc(repeatLabel(item))}</span>
            <span class="pick-ico">${ICONS.repeat}</span>
          </button>
          <div class="pick-body">
            <div class="wheels">
              ${wheel(REPEATS.map(r => r.label), repeatIndex(item.repeat), "repeat")}
            </div>
            <div class="pick-hint">листайте · тап по иконке свернёт</div>
          </div>
        </div>
        `}

        ${slimCard ? "" : `
        ${show?.who ? `
        <label class="field">
          <span>Участник</span>
          <input id="f-who" value="${esc(item.who || "")}" placeholder="Иван Петров" />
        </label>` : ""}
        ${show?.place ? `
        <label class="field">
          <span>Место</span>
          <input id="f-place" value="${esc(item.place || "")}" placeholder="Ленина 15" />
        </label>` : ""}
        ${show?.phone ? `
        <label class="field">
          <span>Телефон</span>
          <input id="f-phone" value="${esc(item.phone || "")}" placeholder="+7 900 123-45-67" inputmode="tel" />
        </label>` : ""}
        ${show?.note ? `
        <label class="field">
          <span>Заметка</span>
          <textarea id="f-note" rows="4" maxlength="2000" placeholder="Подробности">${esc(item.note || "")}</textarea>
        </label>` : ""}
        ${(!show?.who || !show?.place || !show?.phone || !show?.note) ? `
        <div class="detail-add-row">
          ${!show?.who ? `<button type="button" class="chip ghost" data-detail-add="who">+ участник</button>` : ""}
          ${!show?.place ? `<button type="button" class="chip ghost" data-detail-add="place">+ место</button>` : ""}
          ${!show?.phone ? `<button type="button" class="chip ghost" data-detail-add="phone">+ телефон</button>` : ""}
          ${!show?.note ? `<button type="button" class="chip ghost" data-detail-add="note">+ заметка</button>` : ""}
        </div>` : ""}

        ${customShelves().length && item.type !== "note" ? `
          <div class="field">
            <span>Своя полка</span>
            <div class="chip-row">
              ${customShelves().map(sh => `
                <button type="button" class="chip ${item.shelf === sh.id ? "" : "ghost"}" data-shelf-set="${sh.id}">${esc(sh.label)}</button>
              `).join("")}
            </div>
          </div>` : ""}
        `}

        <div class="actions-col">
          ${slimCard ? "" : `
          <button class="btn ghost block" id="detail-done">${item.done ? "Вернуть в работу" : "Отметить сделанным"}</button>`}
          <button class="btn ghost block" id="detail-alarm">${item.alarm ? "Будильник включён" : "Поставить будильник"}</button>
          <button class="btn danger block" id="detail-cancel">Отменить запись</button>
        </div>
      </div>
    </section>
  `;

  requestAnimationFrame(() => {
    viewEl.querySelectorAll(".wheel").forEach(w => {
      w.scrollTop = Number(w.dataset.index || 0) * 40;
      let timer = null;
      w.addEventListener("scroll", () => {
        const items = [...w.querySelectorAll(".wheel-item")];
        const idx = Math.min(items.length - 1, Math.max(0, Math.round(w.scrollTop / 40)));
        items.forEach((el, i) => el.classList.toggle("on", i === idx));
        w.dataset.index = String(idx);
        clearTimeout(timer);
        timer = setTimeout(() => applyWheel(w.dataset.wheel, idx), 60);
      }, { passive: true });
    });
  });
}

function applyWheel(key, idx) {
  const item = currentItem();
  if (!item) return;

  if (key === "repeat") {
    item.repeat = REPEATS[idx].value ? { ...REPEATS[idx].value } : null;
    // Повтор без даты не имеет смысла — берём сегодня как точку отсчёта.
    if (item.repeat && !item.date) item.date = todayParts();
    // Подпись с сервера устарела, как только человек сам крутанул колесо.
    item.repeatLabel = "";
    const repEl = document.getElementById("val-repeat");
    if (repEl) repEl.textContent = REPEATS[idx].label;
    scheduleDetailAutoSave();
    return;
  }

  if (!item.date) item.date = todayParts();
  if (!item.time) item.time = { hour: 9, minute: 0 };

  if (key === "day") item.date = { ...item.date, day: idx + 1 };
  if (key === "month") {
    const now = todayParts();
    let year = item.date.year || now.year;
    if (idx < now.month && year === now.year) year += 1;
    item.date = { ...item.date, month: idx, year };
  }
  if (key === "hour") item.time = { ...item.time, hour: idx };
  if (key === "minute") item.time = { ...item.time, minute: Number(MINS[idx]) };
  if (key === "remind") item.remind = REMIND_OFFSETS[idx].v;
  item.needsTime = false;

  const dEl = document.getElementById("val-date");
  const tEl = document.getElementById("val-time");
  const rEl = document.getElementById("val-remind");
  if (dEl) dEl.textContent = `${item.date.day} ${MONTHS_SHORT[item.date.month]}`;
  if (tEl) tEl.textContent = fmtTime(item);
  if (rEl) rEl.textContent = fmtRemind(item);
  scheduleDetailAutoSave();
}

function settingsVersionFooterText() {
  const apk = state.apkVersion || APP_VERSION;
  return `${esc(apk)} · интерфейс v${SW_VERSION}`;
}

async function loadApkVersion() {
  if (!NATIVE?.appBuild) return;
  try {
    const build = await NATIVE.appBuild();
    if (build.name) state.apkVersion = build.name;
  } catch {
    // ignore
  }
}

async function syncMicStateForSettings() {
  const prev = state.micState;
  if (NATIVE?.micStatus) {
    try {
      const st = await NATIVE.micStatus();
      state.micState = st.granted ? "granted" : (st.blocked ? "denied" : "default");
    } catch {
      // ignore
    }
  } else if (typeof navigator !== "undefined" && navigator.permissions?.query) {
    try {
      const st = await navigator.permissions.query({ name: "microphone" });
      state.micState = st.state === "granted" ? "granted" : st.state === "denied" ? "denied" : "default";
    } catch {
      // ignore
    }
  }
  return prev !== state.micState;
}

async function syncBatteryStateForSettings() {
  if (!NATIVE?.batteryStatus) return false;
  const prev = state.batteryIgnored;
  try {
    const st = await NATIVE.batteryStatus();
    state.batteryIgnored = Boolean(st.ignored);
  } catch {
    // ignore
  }
  return prev !== state.batteryIgnored;
}

async function openMicPermissionFromSettings() {
  if (state.micState === "granted") return;
  if (NATIVE?.openAppSettings) {
    await NATIVE.openAppSettings();
    return;
  }
  if (NATIVE?.ensureMicPermission) {
    const res = await NATIVE.ensureMicPermission();
    state.micState = res?.granted ? "granted" : "denied";
  }
}

async function openNotifPermissionFromSettings() {
  if (notifPermission() === "granted") return;
  if (NATIVE?.openNotificationSettings) {
    await NATIVE.openNotificationSettings();
    return;
  }
  await setupPush(true);
}

async function openBatteryPermissionFromSettings() {
  if (!NATIVE?.openBatterySettings) return;
  await NATIVE.openBatterySettings();
}

async function handlePermissionAction(action) {
  if (action === "mic") await openMicPermissionFromSettings();
  else if (action === "notif") await openNotifPermissionFromSettings();
  else if (action === "battery") await openBatteryPermissionFromSettings();
}

function mountPermissionActionHandlers(root = viewEl) {
  root?.querySelectorAll("[data-perm-action]").forEach(btn => {
    btn.addEventListener("click", async event => {
      event.stopPropagation();
      if (state.screen === "settings") {
        state.settingsScroll = root.querySelector(".scroll")?.scrollTop || 0;
      }
      await handlePermissionAction(btn.getAttribute("data-perm-action"));
    });
  });
}

async function toggleMicPermission() {
  if (state.micState === "granted") {
    if (NATIVE?.openAppSettings) {
      await NATIVE.openAppSettings();
      toast("Отключите микрофон в настройках телефона");
    } else {
      toast("Микрофон включён");
    }
    return;
  }
  if (NATIVE?.ensureMicPermission) {
    const res = await NATIVE.ensureMicPermission();
    state.micState = res?.granted ? "granted" : "denied";
    toast(res?.granted ? "Микрофон разрешён" : "Микрофон запрещён — включите в настройках телефона");
    return;
  }
  toast("Разрешите микрофон в браузере");
}

async function toggleNotifPermission() {
  if (notifPermission() === "granted") {
    if (NATIVE?.openAppSettings) {
      await NATIVE.openAppSettings();
      toast("Отключите уведомления в настройках телефона");
    } else {
      toast("Уведомления включены");
    }
    return;
  }
  await setupPush(true);
}

/**
 * Пояснение к ключу переноса.
 *
 * Названия витаминов и косметики мы не храним у себя — это сведения
 * о здоровье, и держать их на чужом сервере человек не подписывался.
 * Обратная сторона: при переезде на новый телефон они не приедут.
 *
 * Об этом честнее сказать заранее, чем оставить человека гадать,
 * почему список опустел.
 */
function showKeyHelp() {
  document.getElementById("key-help-sheet")?.remove();
  const el = document.createElement("div");
  el.id = "key-help-sheet";
  el.className = "help-sheet";
  el.innerHTML = `
    <div class="help-sheet-card" role="dialog" aria-modal="true" aria-label="Что переносится по ключу">
      <h3 class="help-sheet-title">Что переедет на новый телефон</h3>
      <p class="help-sheet-text">
        По ключу переносятся все ваши записи, напоминания, общие списки и подписка.
      </p>
      <p class="help-sheet-text">
        Кроме одного: <b>названия витаминов и средств для ухода</b> хранятся
        только на этом телефоне и никогда не попадают на наш сервер.
      </p>
      <p class="help-sheet-text">
        Что вы принимаете — это сведения о вашем здоровье. Мы решили их не хранить:
        так спокойнее и вам, и нам. Обратная сторона — на новом телефоне
        расписание приёмов сохранится, а названия придётся вписать заново.
      </p>
      <button type="button" class="btn block" id="key-help-close">Понятно</button>
    </div>
  `;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("on"));
  const close = () => {
    el.classList.remove("on");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", e => { if (e.target === el) close(); });
  document.getElementById("key-help-close")?.addEventListener("click", close);
}

function renderSettings() {
  if (formsEditing()) {
    deferRender();
    return;
  }
  if (!state.billing) loadBilling();
  const s = state.user.settings || {};
  const keyShown = state.showKey
    ? esc(state.user.transferKey || "")
    : "•••••-•••••-•••••-•••••";
  const support = state.support?.unread || 0;
  const activeCount = state.items.filter(i => !i.cancelled && !i.done && !i.archived).length;
  const keyBanner = activeCount >= 20 ? `
        <div class="setting highlight">
          <div>
            <div class="name">У вас ${count.записей(activeCount)}</div>
            <div class="sub">Сохраните ключ переноса, чтобы не потерять их при смене телефона</div>
          </div>
          <button type="button" class="btn ghost" id="share-transfer-key">Поделиться</button>
        </div>` : "";

  // Старые функции без экрана в UI — гасим, чтобы не слали уведомления без выключателя.
  const legacyOff = {};
  if (s.eveningReview) legacyOff.eveningReview = false;
  if (s.morningBrief) legacyOff.morningBrief = false;
  if (Object.keys(legacyOff).length) {
    api("/settings", { method: "POST", body: legacyOff }).then(absorb).catch(() => {});
  }

  // Подтянуть факт с телефона: localStorage мог остаться «вкл», а виджета нет.
  if (NATIVE?.widgetStatus && !state._homeWidgetSyncing) {
    state._homeWidgetSyncing = true;
    const was = store.homeWidget;
    syncHomeWidgetFromDevice().then(() => {
      state._homeWidgetSyncing = false;
      if (was !== store.homeWidget && state.screen === "settings") renderSettings();
    }).catch(() => { state._homeWidgetSyncing = false; });
  }

  viewEl.innerHTML = `
    <section class="screen">
      ${bar("Настройки", { back: "shelves" })}
      <div class="scroll pad-bottom">
        ${settingsSubscriptionHtml()}

        <div class="keys-row">
          <button type="button" class="code-tile" id="copy-code" aria-label="Скопировать ID">
            <div class="code-tile-top">
              <span class="code-tile-lab">Ваш ID</span>
              <span class="code-tile-ico">${ICONS.copy}</span>
            </div>
            <div class="code">${esc(state.user.code)}</div>
          </button>
          <button type="button" class="code-tile" id="key-tile" aria-label="Ключ переноса">
            <div class="code-tile-top">
              <span class="code-tile-lab">Ключ переноса</span>
              <span class="code-tile-ico" id="key-help" aria-label="Что переносится по ключу">${ICONS.help}</span>
              <span class="code-tile-ico" id="share-key" aria-label="Поделиться ключом">${ICONS.share}</span>
              <span class="code-tile-ico" id="copy-key" aria-label="Скопировать ключ">${ICONS.copy}</span>
            </div>
            <div class="code key">${keyShown}</div>
          </button>
        </div>

        ${keyBanner}

        <div class="group-label">Оформление</div>
        <div class="look-block">
          <div class="look-row-label">Тема</div>
          <div class="look-theme" role="group" aria-label="Тема">
            ${THEME_MODES.map(m => `
              <button type="button" class="look-theme-btn ${store.themeMode === m ? "on" : ""}" data-set-theme="${m}">${THEME_LABELS[m]}</button>
            `).join("")}
          </div>
          <div class="look-row-label">Палитра</div>
          <div class="look-palettes" role="group" aria-label="Палитра">
            ${PALETTE_IDS.map(id => `
              <button type="button" class="look-palette-btn ${store.palette === id ? "on" : ""}" data-palette="${id}" data-set-palette="${id}" aria-label="${PALETTE_LABELS[id]}">
                <span class="look-palette-swatch" aria-hidden="true"></span>
                ${PALETTE_LABELS[id]}
              </button>
            `).join("")}
          </div>
        </div>

        ${NATIVE?.pinWidget ? (() => {
          const wcfg = widgetConfig();
          return `
          <button class="setting" id="home-widget-toggle">
            <div>
              <div class="name">Виджет на рабочем столе</div>
              <div class="sub">${store.homeWidget ? "на экране телефона" : "выключен"}</div>
            </div>
            <span class="toggle ${store.homeWidget ? "on" : ""}"><i></i></span>
          </button>
          <div class="group-label">Кнопки в виджете</div>
          <button type="button" class="setting" data-widget-side-open="left">
            <div>
              <div class="name">Левая</div>
              <div class="sub">${esc(widgetSideRowLabel(wcfg.leftBtn))}</div>
            </div>
            <span class="widget-side-trail">
              <span class="widget-side-setting-ico" data-widget-side-ico="left" aria-hidden="true">${widgetSideIcon(wcfg.leftBtn)}</span>
              <span class="row-chevron">${ICONS.chevron}</span>
            </span>
          </button>
          <button type="button" class="setting" data-widget-side-open="right">
            <div>
              <div class="name">Правая</div>
              <div class="sub">${esc(widgetSideRowLabel(wcfg.rightBtn))}</div>
            </div>
            <span class="widget-side-trail">
              <span class="widget-side-setting-ico" data-widget-side-ico="right" aria-hidden="true">${widgetSideIcon(wcfg.rightBtn)}</span>
              <span class="row-chevron">${ICONS.chevron}</span>
            </span>
          </button>`;
        })() : ""}

        ${permissionsSectionHtml()}

        <div class="group-label">Приложение</div>
        <div class="setting">
          <div>
            <div class="name">Кто помогает</div>
            <div class="sub">${(s.voice === "he") ? "он" : "она"}</div>
          </div>
          <div class="voice-toggle" role="group" aria-label="Кто помогает">
            <button type="button" class="voice-toggle-btn ${(s.voice || "she") === "she" ? "on" : ""}" data-set-voice="she">Она</button>
            <button type="button" class="voice-toggle-btn ${s.voice === "he" ? "on" : ""}" data-set-voice="he">Он</button>
          </div>
        </div>

        <button class="setting" data-go="sounds">
          <div>
            <div class="name">Звуки</div>
            <div class="sub">будильник · ${esc(soundName(chosenAlarmSound()))} · уведомления · ${esc(soundName(chosenNotifySound()))}</div>
          </div>
          <span class="row-chevron">${ICONS.chevron}</span>
        </button>

        <div class="group-label">Прочее</div>
        <button class="setting" data-go="support">
          <div>
            <div class="name">Поддержка</div>
            <div class="sub">${support ? "есть ответ — посмотрите" : "написать нам · ответим сюда же"}</div>
          </div>
          <span class="row-chevron">${support ? `<span class="pill count">${support > 99 ? "99+" : support}</span>` : ICONS.chevron}</span>
        </button>
        <button class="setting" data-go="blocked">
          <div>
            <div class="name">Заблокированные</div>
            <div class="sub">${state.blocked.length ? `${state.blocked.length}` : "кого не пускать в общие списки"}</div>
          </div>
          <span class="row-chevron">${ICONS.chevron}</span>
        </button>

        <div class="group-label">О приложении</div>

        <a class="setting" href="${apiBase()}/privacy.html" data-doc="/privacy.html" target="_blank" rel="noopener">
          <div>
            <div class="name">Что мы храним</div>
            <div class="sub">политика конфиденциальности</div>
          </div>
          <span class="row-chevron">${ICONS.chevron}</span>
        </a>
        <a class="setting" href="${apiBase()}/offer.html" data-doc="/offer.html" target="_blank" rel="noopener">
          <div>
            <div class="name">Условия подписки</div>
            <div class="sub">что входит, сколько стоит, как вернуть деньги</div>
          </div>
          <span class="row-chevron">${ICONS.chevron}</span>
        </a>
        <button class="setting danger-row" id="wipe-account">
          <div>
            <div class="name">Удалить аккаунт и все записи</div>
            <div class="sub">насовсем, без возможности вернуть</div>
          </div>
          <span class="row-chevron">${ICONS.chevron}</span>
        </button>
      </div>
      <div class="settings-version-footer">${settingsVersionFooterText()}</div>
      ${widgetSidePickerOverlayHtml()}
    </section>
  `;

  // Настройки перерисовываются от любого обновления состояния — например, когда человек
  // вернулся из браузера с политикой. Без этого список каждый раз уезжал бы в начало.
  const scroller = viewEl.querySelector(".scroll");
  if (scroller) {
    if (state.settingsScroll) scroller.scrollTop = state.settingsScroll;
    scroller.addEventListener("scroll", () => { state.settingsScroll = scroller.scrollTop; }, { passive: true });
    if (state.scrollToSubscription) {
      state.scrollToSubscription = false;
      requestAnimationFrame(() => {
        document.getElementById("settings-subscription")?.scrollIntoView({ block: "start" });
      });
    }
  }

  document.getElementById("add-block")?.addEventListener("submit", async event => {
    event.preventDefault();
    const code = String(new FormData(event.target).get("code") || "").trim().toUpperCase();
    if (!code) return;
    try {
      absorb(await api("/block", { method: "POST", body: { code } }));
      toast("Заблокирован");
      render();
    } catch (err) {
      toast(err.message);
    }
  });

  viewEl.querySelectorAll("[data-set-voice]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const voice = btn.getAttribute("data-set-voice");
      if (!voice || voice === (state.user?.settings?.voice || "she")) return;
      state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
      try {
        absorb(await api("/settings", { method: "POST", body: { voice } }));
        toast(voice === "he" ? "Теперь помогает он" : "Теперь помогает она");
        renderSettings();
      } catch (err) {
        toast(err.message);
      }
    });
  });

  viewEl.querySelectorAll("[data-set-theme]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-set-theme");
      // То же для темы: снимок с новыми цветами уходит сразу.
      setTimeout(pushWidget, 0);
      if (!THEME_MODES.includes(mode) || mode === store.themeMode) return;
      store.themeMode = mode;
      applyLook();
      state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
      renderSettings();
    });
  });

  viewEl.querySelectorAll("[data-set-palette]").forEach(btn => {
    btn.addEventListener("click", () => {
      const palette = btn.getAttribute("data-set-palette");
      if (!PALETTE_IDS.includes(palette) || palette === store.palette) return;
      store.palette = palette;
      applyLook();
      // Облако на кнопке красится акцентом — пересобираем под новую палитру.
      fabSoul?.destroy?.();
      fabSoul = null;
      // Виджет живёт на обоях и сам о смене палитры не узнает.
      pushWidget();
      state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
      renderSettings();
    });
  });

  mountPermissionActionHandlers(viewEl);

  document.getElementById("perm-toggle-mic")?.addEventListener("click", async () => {
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    await toggleMicPermission();
    renderSettings();
  });
  document.getElementById("perm-toggle-notif")?.addEventListener("click", async () => {
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    await toggleNotifPermission();
    renderSettings();
  });

  refreshPermissionsState().then(({ changed }) => {
    if (changed && state.screen === "settings") {
      state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
      renderSettings();
    }
  });
}

// Долгое нажатие на закладку — режим порядка; повторное нажатие сохраняет.
function mountShelfLongPress() {
  const list = document.getElementById("shelves-manage");
  if (!list) return;
  list.querySelectorAll("[data-shelf-row]").forEach(row => {
    let timer = null;
    let startY = 0;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    row.addEventListener("pointerdown", event => {
      if (event.button && event.button !== 0) return;
      if (event.target.closest("[data-shelf-vis], [data-shelf-up], [data-shelf-down], .shelf-edit-btn, .pill")) return;
      startY = event.clientY;
      timer = setTimeout(() => {
        timer = null;
        state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
        if (state.shelfReorder) {
          saveShelfOrderAndExit();
        } else {
          state.shelfReorder = true;
          renderSettings();
        }
      }, 480);
    });
    row.addEventListener("pointerup", clear);
    row.addEventListener("pointercancel", clear);
    row.addEventListener("pointermove", event => {
      if (Math.abs(event.clientY - startY) > 10) clear();
    });
  });
}

async function saveShelfOrderAndExit() {
  const order = manageShelfIds();
  state.shelfReorder = false;
  state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
  try {
    absorb(await api("/settings", { method: "POST", body: { shelfOrder: order } }));
    toast(v("Порядок сохранила", "Порядок сохранил"));
  } catch (err) {
    toast(err.message);
  }
  renderSettings();
}

/* —— Согласие, жалобы, блокировки, поддержка —— */

const REPORT_REASONS = [
  { id: "offense", label: "Оскорбления или травля" },
  { id: "threat", label: "Угрозы" },
  { id: "spam", label: "Реклама и спам" },
  { id: "private", label: "Чужие личные данные" },
  { id: "illegal", label: "Запрещённые товары или услуги" },
  { id: "other", label: "Другое" },
];

function consentAccepted() {
  const consent = state.user?.settings?.consent;
  return Boolean(consent && consent.version === CONSENT_VERSION);
}

function consentPending() {
  return Boolean(state.user && !consentAccepted());
}

// Тем, у кого аккаунт уже есть, новую редакцию показываем отдельным экраном до всего остального.
function renderConsent() {
  appEl.innerHTML = `
    <section class="screen auth">
      <div class="auth-inner">
        <div class="brand">
          <h1>${state.user?.settings?.consent ? "Условия обновились" : "Коротко о главном"}</h1>
          <p>Что мы храним и о чём договариваемся.</p>
        </div>
        <div class="consent-text">
          <p>Записи хранятся на нашем сервере: текст, дата, время и место. Имя, телефон и почту мы не спрашиваем.</p>
          <p><b>Названия витаминов и средств для ухода остаются на телефоне</b> — это сведения о здоровье, и мы их у себя не держим.</p>
          <p>Речь распознаёт система телефона: она может отправлять звук производителю. К нам приходит готовый текст. Общие списки видны участникам, которых вы позвали.</p>
        </div>
        <label class="consent" for="consent-ok">
          <input type="checkbox" id="consent-ok" />
          <span>Согласен на обработку моих записей и принимаю условия.</span>
        </label>
        <p class="consent-links">
          <a href="${apiBase()}/privacy.html" data-doc="/privacy.html" target="_blank" rel="noopener">Политика конфиденциальности</a>
          ·
          <a href="${apiBase()}/offer.html" data-doc="/offer.html" target="_blank" rel="noopener">условия подписки</a>
        </p>
        <button class="btn block" id="consent-accept" type="button">Продолжить</button>
        <button class="auth-switch" id="consent-restore" type="button">У меня есть ключ переноса</button>
        <p class="auth-error" data-consent-error></p>
      </div>
    </section>
  `;
}

function reportedItem() {
  return state.incoming.find(i => i.id === state.reportItemId)
    || state.items.find(i => i.id === state.reportItemId)
    || null;
}

function renderReport() {
  if (formsEditing()) {
    deferRender();
    return;
  }
  const item = reportedItem();
  if (!item) return go("shelves");
  const reason = state.reportReason || "offense";

  viewEl.innerHTML = `
    <section class="screen">
      ${bar("Пожаловаться", { back: "shelves" })}
      <div class="scroll pad-bottom">
        <div class="card plain">
          <div class="title">${esc(item.title)}</div>
          <div class="meta">${esc(fmtWhen(item))}${item.from ? ` · от ${esc(senderName(item.from))}` : ""}</div>
        </div>

        <div class="group-label">Что не так</div>
        ${REPORT_REASONS.map(r => `
          <button type="button" class="setting" data-report-reason="${r.id}">
            <div><div class="name">${r.label}</div></div>
            <span class="toggle ${reason === r.id ? "on" : ""}"><i></i></span>
          </button>
        `).join("")}

        <label class="field" style="margin-top:12px">
          <span>Пояснение, если нужно</span>
          <textarea id="report-comment" rows="3" maxlength="500" placeholder="Что именно случилось">${esc(state.reportComment || "")}</textarea>
        </label>

        <button type="button" class="setting" id="report-block">
          <div>
            <div class="name">Заблокировать отправителя</div>
            <div class="sub">он больше не сможет присылать вам записи</div>
          </div>
          <span class="toggle ${state.reportBlock ? "on" : ""}"><i></i></span>
        </button>

        <button class="btn block" id="report-send" style="margin-top:14px">Отправить жалобу</button>
        <p class="lead">Запись пропадёт из списка. Жалобу разбираем в течение трёх рабочих дней.</p>
      </div>
    </section>
  `;
}

// Поддержка — это переписка, а не форма: человек видит и свой вопрос, и наш ответ.
async function loadSupport({ read = false } = {}) {
  try {
    const data = read ? await api("/support/read", { method: "POST" }) : await api("/support");
    state.supportThread = data;
    state.support = { ...(state.support || {}), unread: data.unread || 0 };
    // Ответ прочитан — снимаем уведомление из шторки телефона, оно уже ни к чему.
    if (read) NATIVE?.clearSupportNotice?.();
  } catch {
    // Нет сети — покажем то, что уже загружено, и предложим отправить снова.
  }
}

// Тихая проверка ответов: дёргаем только переписку, а не всё состояние.
async function pollSupport() {
  if (state.screen === "support") {
    const was = state.supportThread?.messages?.length || 0;
    await loadSupport({ read: true });
    if ((state.supportThread?.messages?.length || 0) !== was && !formsEditing()) softRender();
    return;
  }
  const before = state.support?.unread || 0;
  try {
    const data = await api("/support");
    state.support = { ...(state.support || {}), unread: data.unread || 0 };
  } catch {
    return;
  }
  if ((state.support?.unread || 0) === before) return;
  noticeSupport();
  if (!formsEditing()) softRender();
}

function supportBubbles() {
  const messages = state.supportThread?.messages || [];
  if (!messages.length) {
    return `<p class="lead">Напишите, что случилось: что делали и что пошло не так. Ответ придёт сюда же, в приложение — почта и телефон не нужны.</p>`;
  }
  return `
    <div class="chat-log">
      ${messages.map(m => `
        <div class="chat-msg ${m.from === "support" ? "them" : "mine"}">
          <div class="chat-bubble">${esc(m.text)}</div>
          <div class="chat-when">${m.from === "support" ? "Поддержка · " : ""}${esc(fmtSupportTime(m.at))}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function fmtSupportTime(at) {
  const d = new Date(at);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? time : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${time}`;
}


function renderSupport() {
  if (formsEditing()) {
    deferRender();
    return;
  }
  if (!state.supportThread) {
    // Читаем переписку и сразу гасим счётчик: перерисовываем целиком, чтобы точка ушла и с иконки.
    loadSupport({ read: true }).then(() => {
      if (state.screen === "support" && !formsEditing()) render();
    });
  }

  viewEl.innerHTML = `
    <section class="screen">
      ${bar("Поддержка", { back: "settings" })}
      <div class="scroll pad-bottom">
        ${supportBubbles()}
        <label class="field">
          <span>Сообщение</span>
          <textarea id="support-text" rows="4" maxlength="2000" placeholder="Например: напоминание не пришло в 9:00">${esc(state.supportDraft || "")}</textarea>
        </label>
        <button class="btn block" id="support-send">Отправить</button>
        <p class="lead">Отвечаем на ваш ID ${esc(state.user.code)} — он уже виден нам, называть его не нужно.</p>
      </div>
    </section>
  `;

  // Свежее сообщение должно быть перед глазами, а не за прокруткой.
  const log = viewEl.querySelector(".chat-log");
  if (log) log.scrollTop = log.scrollHeight;
}

function renderPermissions() {
  viewEl.innerHTML = `
    <section class="screen">
      ${bar("Разрешения", { back: "settings" })}
      <div class="scroll pad-bottom">
        ${permissionsSectionHtml()}
      </div>
    </section>
  `;
  mountPermissionActionHandlers(viewEl);
  document.getElementById("perm-toggle-mic")?.addEventListener("click", async () => {
    await toggleMicPermission();
    renderPermissions();
  });
  document.getElementById("perm-toggle-notif")?.addEventListener("click", async () => {
    await toggleNotifPermission();
    renderPermissions();
  });
  refreshPermissionsState().then(({ changed }) => {
    if (changed && state.screen === "permissions") renderPermissions();
  });
}

/* —— Звуки будильника и уведомлений —— */

let previewAudio = null;
let previewId = "";
let noticeAudio = null;

// Баннер поверх открытого приложения звучит тем же сигналом, что выбран в настройках.
function playChosenNotify() {
  if (!state.user) return;
  if (!noticeAudio) noticeAudio = new Audio();
  noticeAudio.src = `/sounds/${chosenNotifySound()}.mp3`;
  noticeAudio.play().catch(() => {});
}

function chosenAlarmSound() {
  return alarmSoundId(state.user?.settings?.alarmSound);
}

function chosenNotifySound() {
  return notifySoundId(state.user?.settings?.notifySound);
}

// Телефон ставит уведомления сам, поэтому выбранные звуки держим и на его стороне.
function pushSoundsToPhone() {
  if (!NATIVE?.setSounds || !state.user) return;
  const changed = NATIVE.setSounds({ alarm: chosenAlarmSound(), notify: chosenNotifySound() });
  // Уведомления уже стоят в очереди со старым звуком — пересобираем расписание.
  if (changed && Array.isArray(state.items)) NATIVE.syncReminders(state.items, state.user?.settings);
}

function stopPreview() {
  if (!previewAudio) return;
  previewAudio.pause();
  previewAudio.currentTime = 0;
  previewId = "";
}

// Слушаем ровно тот файл, который потом играет телефон: он лежит и в вебе, и в res/raw.
function previewSound(id) {
  const wasPlaying = previewId === id && previewAudio && !previewAudio.paused;
  stopPreview();
  if (wasPlaying) return renderSounds({ keepScroll: true });

  if (!previewAudio) {
    previewAudio = new Audio();
    previewAudio.addEventListener("ended", () => {
      previewId = "";
      if (state.screen === "sounds") renderSounds({ keepScroll: true });
    });
  }
  previewAudio.src = `/sounds/${id}.mp3`;
  previewId = id;
  previewAudio.play().catch(() => {
    previewId = "";
    toast("Не получилось проиграть звук");
  });
  if (state.screen === "sounds") renderSounds({ keepScroll: true });
}

function soundRows(list, current, kind) {
  return list.map(sound => `
    <div class="setting sound-row ${sound.id === current ? "on" : ""}">
      <button type="button" class="sound-main" data-sound-pick="${sound.id}" data-sound-kind="${kind}">
        <div class="name">${esc(sound.name)}${sound.id === current ? " · выбран" : ""}</div>
        <div class="sub">${esc(sound.hint)}</div>
      </button>
      <button type="button" class="icon-btn sound-play ${previewId === sound.id ? "on" : ""}" data-sound-play="${sound.id}" aria-label="Прослушать ${esc(sound.name)}">
        ${previewId === sound.id ? ICONS.stop : ICONS.play}
      </button>
    </div>
  `).join("");
}

function renderSounds({ keepScroll = false } = {}) {
  const scroller = keepScroll ? viewEl.querySelector(".scroll") : null;
  const top = scroller ? scroller.scrollTop : 0;

  viewEl.innerHTML = `
    <section class="screen">
      ${bar("Звуки", { back: state.soundsBack || "settings" })}
      <div class="scroll pad-bottom">
        <p class="lead">Нажмите на кружок — послушать, на название — выбрать. ${NATIVE
          ? "Звук встанет на будильники и напоминания телефона."
          : "На сайте звук слышно, пока приложение открыто; в шторке браузер играет системный сигнал. В приложении для телефона выбор работает везде."}</p>

        <div class="group-label">Будильник · ${esc(soundName(chosenAlarmSound()))}</div>
        ${soundRows(ALARM_SOUNDS, chosenAlarmSound(), "alarm")}

        <div class="group-label">Уведомления · ${esc(soundName(chosenNotifySound()))}</div>
        ${soundRows(NOTIFY_SOUNDS, chosenNotifySound(), "notify")}

        <p class="lead" style="margin-top:14px">Громкость — системная, из настроек уведомлений телефона. Здесь, в приложении, звук идёт через громкость медиа, поэтому может звучать чуть иначе.</p>
      </div>
    </section>
  `;

  if (top) {
    const fresh = viewEl.querySelector(".scroll");
    if (fresh) fresh.scrollTop = top;
  }
}

/* —— Общие списки (любая пара) —— */

function absorbSharedLists(data) {
  if (!data) return;
  if (Array.isArray(data.pairs)) state.lists = data.pairs;
  else if (Array.isArray(data.lists)) state.lists = data.lists;
  if (data.pair) absorbList(data.pair);
  if (Array.isArray(data.incoming)) state.listInvites = data.incoming;
  if (Array.isArray(data.outgoing)) state.listOutgoing = data.outgoing;
  if (Number.isFinite(data.unreadTotal)) state.listsUnread = data.unreadTotal;
  if (data.widgetPeek !== undefined) state.sharedWidgetPeek = data.widgetPeek;
}

function sharedListTabs() {
  const pairs = state.lists || [];
  const outgoing = state.listOutgoing || [];
  return [...pairs, ...outgoing.map(o => ({ ...o, id: `out-${o.id}`, pending: true }))];
}

function listSentFlashHtml() {
  if (!state.listSentFlash) return "";
  return `<div class="list-sent-flash" role="status">${esc(state.listSentFlash.text)}</div>`;
}

function listTabMenuHtml() {
  const id = state.listTabMenu;
  if (!id || String(id).startsWith("out-")) return "";
  const tab = sharedListTabs().find(t => t.id === id);
  const label = tab?.nickname || "закладку";
  return `
    <div class="list-tab-menu-overlay" id="list-tab-menu-overlay">
      <div class="list-tab-menu" role="dialog" aria-label="Действия с закладкой">
        <button type="button" class="btn ghost block danger-row" data-list-delete="${esc(id)}">Удалить «${esc(label)}»</button>
        <button type="button" class="btn ghost block" id="list-tab-menu-cancel">Отмена</button>
      </div>
    </div>
  `;
}

let listTabPressTimer = null;

function bindListTabLongPress() {
  viewEl.querySelectorAll("[data-list-tab]").forEach(tab => {
    if (tab.dataset.lpBound === "1" || tab.classList.contains("pending")) return;
    tab.dataset.lpBound = "1";
    const clearPress = () => {
      clearTimeout(listTabPressTimer);
      listTabPressTimer = null;
    };
    tab.addEventListener("pointerdown", () => {
      if (tab.classList.contains("pending")) return;
      clearPress();
      const id = tab.dataset.listTab;
      listTabPressTimer = setTimeout(() => {
        listTabPressTimer = null;
        state.listTabMenu = id;
        renderLists();
      }, 520);
    });
    tab.addEventListener("pointerup", clearPress);
    tab.addEventListener("pointercancel", clearPress);
    tab.addEventListener("pointerleave", clearPress);
  });
}

function listPersonTabsHtml(activeId) {
  const tabs = sharedListTabs();
  return `
    <div class="tabs list-person-tabs">
      ${tabs.map(t => {
        const mark = t.unread ? `<span class="tab-count">${t.unread}</span>` : "";
        const pend = t.pending ? " pending" : "";
        return `<button type="button" class="tab ${t.id === activeId ? "on" : ""}${pend}" data-list-tab="${esc(t.id)}">${esc(t.nickname)}${mark}</button>`;
      }).join("")}
      <button type="button" class="tab tab-add" id="list-invite-tab" aria-label="Пригласить">+</button>
    </div>
  `;
}

function listOnboardHtml() {
  return `
    <div class="list-onboard">
      <p class="lead">Общие задачи с любым человеком: покупки, поручения, дела на день. Получатель отмечает «Сделал» — у вас зачёркнуто.</p>
      <div class="list-onboard-steps">
        <div class="list-onboard-step"><span class="list-onboard-num">1</span> Добавьте человека по ID</div>
        <div class="list-onboard-step"><span class="list-onboard-num">2</span> Задайте прозвище — вкладка в карусели</div>
        <div class="list-onboard-step"><span class="list-onboard-num">3</span> Говорите задание голосом</div>
      </div>
      <div class="group-label">Примеры</div>
      <div class="list-scenario">
        <div class="name">Покупки с партнёром</div>
        <div class="sub">«отправь жене молоко и хлеб»</div>
      </div>
      <div class="list-scenario">
        <div class="name">Задача сотруднику</div>
        <div class="sub">«отправь Кате подготовить отчёт» → Сделал / Позже</div>
      </div>
      <div class="list-scenario">
        <div class="name">Дело ребёнку</div>
        <div class="sub">«отправь Саше убрать комнату»</div>
      </div>
    </div>
  `;
}

function listInviteBannerHtml() {
  const invites = state.listInvites || [];
  if (!invites.length) return "";
  return invites.map(inv => `
    <div class="list-invite-banner">
      <div class="list-invite-txt">
        <div class="name">${esc(inv.fromNickname)}</div>
        <div class="sub">ID ${esc(inv.fromCode)} · приглашает в общие списки</div>
      </div>
      <div class="list-invite-actions">
        <button type="button" class="btn ghost" data-list-decline="${esc(inv.id)}">Отклонить</button>
        <button type="button" class="btn" data-list-accept="${esc(inv.id)}">Принять</button>
      </div>
    </div>
  `).join("");
}

function listInviteFormHtml() {
  const draft = state.listInviteDraft;
  if (draft?.step === "nickname") {
    return `
      <div class="group-label">Как подписать ${esc(draft.code)}?</div>
      <form id="list-nickname-form">
        <div class="row-form">
          <input name="nickname" placeholder="Жена, Катя, Сын…" maxlength="30" required autofocus value="${esc(draft.nickname || "")}" />
        </div>
      </form>
      <button type="button" class="btn ghost block" id="list-invite-cancel">Отмена</button>
    `;
  }
  return `
    <div class="group-label">Пригласить по ID</div>
    <form id="list-invite-form">
      <div class="row-form">
        <input name="code" placeholder="Шестизначный ID" maxlength="6" autocapitalize="characters" required value="${esc(state.listJoinDraft)}" />
        <button class="btn" type="submit">Далее</button>
      </div>
    </form>
    <p class="hint">Ваш ID: <b>${esc(state.user?.code || "—")}</b> — если вас пригласят, достаточно принять приглашение</p>
  `;
}

function listAcceptFormHtml() {
  const inv = (state.listInvites || []).find(i => i.id === state.listAcceptDraft);
  if (!inv) return "";
  return `
    <div class="list-accept-card">
      <p class="lead">Как подписать ${esc(inv.fromNickname)} (${esc(inv.fromCode)})?</p>
      <form id="list-accept-form">
        <div class="row-form">
          <input name="nickname" placeholder="Муж, Босс, Мама…" maxlength="30" required autofocus value="${esc(state.listAcceptNicknameDraft || "")}" />
        </div>
      </form>
    </div>
  `;
}

function sharedListItemRow(item) {
  const done = item.done;
  const actions = !done && !item.fromMe ? `
    <div class="list-item-actions">
      <button type="button" class="chip" data-list-done="${esc(item.id)}">Сделал</button>
      <button type="button" class="chip ghost" data-list-later="${esc(item.id)}">Позже</button>
    </div>
  ` : "";
  const readMark = item.fromMe && item.read ? `<span class="list-read-mark" aria-label="Прочитано">${ICONS.circleCheck || "✓"}</span>` : "";
  return `
    <div class="setting list-item-row${done ? " done" : ""}">
      <div class="shelf-row-main">
        <div class="name" style="${done ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(item.title)}</div>
        <div class="sub">${esc(item.by)}${item.laterAt ? ` · напомню ${fmtListLater(item.laterAt)}` : ""}</div>
        ${actions}
      </div>
      ${readMark}
    </div>
  `;
}

function fmtListLater(ts) {
  const d = new Date(Number(ts) || 0);
  if (!Number.isFinite(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function listLaterModalHtml(draft) {
  const time = draft.time || { hour: 12, minute: 0 };
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  return `
    <div class="time-mini-overlay" id="list-later-overlay">
      <div class="time-mini-modal" role="dialog" aria-label="Напомнить когда">
        <div class="time-mini-title">Напомнить в</div>
        <div class="time-mini-wheels">
          <div class="time-mini-col">
            <div class="time-mini-lab">ч</div>
            ${wheel(hours, time.hour, "list-later-hour")}
          </div>
          <div class="time-mini-col">
            <div class="time-mini-lab">м</div>
            ${wheel(minutes, time.minute, "list-later-minute")}
          </div>
        </div>
        <div class="time-mini-actions">
          <button type="button" class="btn ghost" id="list-later-cancel">Отмена</button>
          <button type="button" class="btn" id="list-later-done">Готово</button>
        </div>
      </div>
    </div>
  `;
}

function mountListLaterWheels(draft) {
  viewEl.querySelectorAll("#list-later-overlay .wheel").forEach(w => {
    w.scrollTop = Number(w.dataset.index || 0) * 36;
    let timer = null;
    w.addEventListener("scroll", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const items = [...w.querySelectorAll(".wheel-item")];
        const idx = Math.min(items.length - 1, Math.max(0, Math.round(w.scrollTop / 36)));
        items.forEach((el, i) => el.classList.toggle("on", i === idx));
        if (w.dataset.wheel === "list-later-hour") draft.time.hour = idx;
        if (w.dataset.wheel === "list-later-minute") draft.time.minute = idx;
      }, 60);
    });
  });
}

async function saveSharedListDefault(pairId) {
  if (!pairId || String(pairId).startsWith("out-")) return;
  if (state.user?.settings?.sharedListDefault === pairId) return;
  try {
    absorb(await api("/settings", { method: "POST", body: { sharedListDefault: pairId } }));
  } catch { /* не критично */ }
}

async function markSharedListRead(pairId) {
  if (!pairId || String(pairId).startsWith("out-")) return;
  try {
    const data = await api(`/lists/${pairId}/read`, { method: "POST", body: {} });
    absorbSharedLists(data);
  } catch { /* офлайн — badge сбросится при следующем заходе */ }
}

/** Поле ручного ввода: текст, textarea, number — не чекбоксы и кнопки. */
function isFormField(el) {
  if (!el?.tagName) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = String(el.type || "text").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "hidden", "file", "image"].includes(type);
}

/** Пока фокус в любом поле ввода приложения — не перерисовываем и не опрашиваем списки. */
function formsEditing() {
  const el = document.activeElement;
  if (!isFormField(el)) return false;
  // После submit поле могло уже сняться с DOM — не блокируем перерисовку.
  return el.isConnected !== false;
}

/** @deprecated — используйте formsEditing() */
function listFormsEditing() {
  return formsEditing();
}

async function addSharedListItem(title) {
  const pairId = state.listId;
  if (!pairId || String(pairId).startsWith("out-")) return false;
  const day = todayParts();
  try {
    const data = await api(`/lists/${pairId}/items`, {
      method: "POST",
      body: { title: String(title || "").trim().slice(0, 120), dayKey: dateKey(day) },
    });
    absorbSharedLists(data);
    if (data.duplicate) toast("Уже в списке");
    else {
      toast("Отправлено");
      flashListSent("Отправлено");
    }
    renderLists();
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

function renderLists() {
  if (formsEditing()) {
    deferRender();
    return;
  }
  if (proShelfGated("shared")) {
    viewEl.innerHTML = proShelfPromoScreenHtml("shared", { screenTitle: "Общие списки", back: "shelves" });
    return;
  }
  if (state.listAcceptDraft) {
    viewEl.innerHTML = `
      <section class="screen">
        ${bar("Общие списки", { back: "shelves" })}
        <div class="scroll pad-bottom">${listAcceptFormHtml()}</div>
      </section>
    `;
    return;
  }

  const tabs = sharedListTabs();
  if (!state.listId && tabs.length && !state.listInviteOpen) state.listId = tabs[0].id;
  const open = state.lists.find(l => l.id === state.listId);

  if (open) {
    markSharedListRead(open.id);
    viewEl.innerHTML = `
      <section class="screen">
        ${bar("Общие списки", { back: "shelves" })}
        ${listInviteBannerHtml()}
        ${listSentFlashHtml()}
        ${listPersonTabsHtml(state.listId)}
        <div class="scroll pad-fab ${shelfFabPadClass()}">
          ${state.listManualOpen ? `
            <form id="list-manual-add">
              <div class="row-form">
                <input name="title" placeholder="Что добавить" maxlength="120" autofocus required value="${esc(state.listManualDraft || "")}" />
                <button class="btn" type="submit">Добавить</button>
              </div>
            </form>
          ` : ""}
          ${open.items?.length
    ? open.items.map(sharedListItemRow).join("")
    : `<div class="empty">На сегодня пусто.<br/>Скажите «отправь ${esc(open.nickname)} …» или нажмите +.</div>`}
        </div>
        ${shelfFabStack()}
        ${state.listLaterDraft ? listLaterModalHtml(state.listLaterDraft) : ""}
        ${listTabMenuHtml()}
      </section>
    `;
    viewEl.querySelector(".list-person-tabs .tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (state.listLaterDraft) mountListLaterWheels(state.listLaterDraft);
    bindListTabLongPress();
    mountShelfMicFab();
    return;
  }

  viewEl.innerHTML = `
    <section class="screen">
      ${bar("Общие списки", { back: "shelves" })}
      <div class="scroll pad-bottom">
        ${listInviteBannerHtml()}
        ${listSentFlashHtml()}
        ${tabs.length ? listPersonTabsHtml(null) : ""}
        ${!tabs.length ? listOnboardHtml() : ""}
        ${listInviteFormHtml()}
      </div>
      ${listTabMenuHtml()}
    </section>
  `;
  bindListTabLongPress();
}

function absorbList(list) {
  if (!list) return;
  const index = state.lists.findIndex(l => l.id === list.id);
  if (index >= 0) state.lists[index] = list;
  else state.lists.push(list);
}

/* —— Готовые наборы записей —— */

async function loadTemplates() {
  if (state.templates || state.templatesLoading) return;
  state.templatesLoading = true;
  try {
    state.templates = await api("/templates");
  } catch (err) {
    toast(err.message);
  } finally {
    state.templatesLoading = false;
  }
}

// Наборы живут закладкой рядом с остальными: строка вкладок остаётся на месте,
// меняется только содержимое — список наборов или раскрытый набор.
function renderTemplatesShelf() {
  if (!state.templates) {
    loadTemplates().then(() => {
      if (state.screen === "shelves" && state.shelf === "templates") renderTemplatesShelf();
    });
  }

  const picked = state.templates?.templates.find(t => t.id === state.templateId) || null;
  const body = !state.templates
    ? '<div class="empty">Загружаю…</div>'
    : picked ? templateDetailBody(picked) : templateListBody(state.templates);

  viewEl.innerHTML = `
    <section class="screen">
      ${offlineBar()}
      ${shelfTabs("templates")}
      <div class="scroll pad-fab ${shelfFabPadClass()}">${body}</div>
      ${shelfFabStack()}
    </section>
  `;
  viewEl.querySelector(".tabs .tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  mountShelfMicFab();
}

function templateListBody({ groups, templates }) {
  return `
    <div class="tab-lead">
      <span class="tab-lead-ico">${ICONS.kit}</span>
      <p>Готовый набор ставит сразу несколько записей с напоминаниями. Лишнее снимается до добавления.</p>
    </div>
    ${groups.map(g => `
      <div class="group-label">${esc(g.label)} · ${esc(g.sub)}</div>
      ${templates.filter(t => t.group === g.id).map(t => `
        <button type="button" class="setting" data-template="${t.id}">
          <div>
            <div class="name">${esc(t.label)}</div>
            <div class="sub">${esc(t.sub)} · записей ${t.items.length}</div>
          </div>
          <span class="pill soft">›</span>
        </button>
      `).join("")}
    `).join("")}
  `;
}

function templateDetailBody(template) {
  const picks = state.templatePicks;
  return `
    <button type="button" class="btn ghost block" id="template-back" style="margin-bottom:12px">← Все наборы</button>
    <div class="group-label">${esc(template.label)}</div>
    <p class="lead">${esc(template.sub)}. Отметьте, что нужно.</p>
    ${template.items.map((item, index) => `
      <button type="button" class="setting" data-template-pick="${index}">
        <div>
          <div class="name">${esc(item.title)}</div>
          <div class="sub">${esc(item.when)}</div>
        </div>
        <span class="toggle ${picks.has(index) ? "on" : ""}"><i></i></span>
      </button>
    `).join("")}
    <button class="btn block" id="template-apply" style="margin-top:14px">
      Добавить${picks.size ? ` · ${picks.size}` : ""}
    </button>
  `;
}

function renderBlockedList() {
  if (!state.blocked.length) return `<div class="empty">Пока никого</div>`;
  return state.blocked.map(b => `
      <div class="setting">
        <div>
          <div class="name">${esc(b.code)}</div>
          <div class="sub">записи от него не приходят</div>
        </div>
        <button type="button" class="pill" data-unblock="${esc(b.code)}">Разблокировать</button>
      </div>
    `).join("");
}

function renderBlocked() {
  viewEl.innerHTML = `
    <section class="screen">
      ${bar("Заблокированные", { back: "settings" })}
      <div class="scroll pad-bottom">
        <p class="lead">Заблокированный не сможет позвать вас в общий список. Он об этом не узнает.</p>
        ${renderBlockedList()}
        <div class="group-label">Добавить</div>
        <form id="add-block">
          <div class="row-form">
            <input name="code" placeholder="ID человека" autocapitalize="characters" required />
            <button class="btn" type="submit">Заблокировать</button>
          </div>
        </form>
      </div>
    </section>
  `;
  document.getElementById("add-block")?.addEventListener("submit", async event => {
    event.preventDefault();
    const code = String(new FormData(event.target).get("code") || "").trim().toUpperCase();
    if (!code) return;
    try {
      absorb(await api("/block", { method: "POST", body: { code } }));
      toast("Заблокирован");
      renderBlocked();
    } catch (err) {
      toast(err.message);
    }
  });
}

// Конструктор своей полки: название и слова, по которым туда едут записи с голоса.
function renderShelfEdit() {
  const draft = state.shelfDraft || { id: null, label: "", keywordsText: "" };
  const isNew = !draft.id;

  viewEl.innerHTML = `
    <section class="screen">
      ${bar(isNew ? "Новая полка" : "Полка", { back: "settings" })}
      <div class="scroll pad-bottom">
        <p class="lead">Назовите полку и перечислите слова. Если они или само название прозвучат в голосе — запись попадёт сюда, даже если это похоже на покупку или встречу. Стоя на этой полке, можно говорить без слов: всё новое ляжет сюда.</p>
        <label class="field">
          <span>Название</span>
          <input id="shelf-label" maxlength="24" placeholder="например «Дом»" value="${esc(draft.label)}" />
        </label>
        <label class="field">
          <span>Слова и фразы</span>
          <textarea id="shelf-keywords" rows="5" placeholder="через запятую или с новой строки&#10;ремонт, сантехник, квартира">${esc(draft.keywordsText)}</textarea>
        </label>
        <div class="hint" style="margin:-4px 0 14px">До 20 слов. Название полки тоже ловит голос. Короче двух букв не беру.</div>
        ${isNew ? "" : `<button class="btn danger block" id="shelf-delete" style="margin-top:10px">Удалить полку</button>`}
      </div>
    </section>
  `;
}

// Полная настройка закладки: напоминание, пуш, будильник, отложить.
function renderShelfPrefs() {
  const id = state.shelfEditId;
  const label = labelOfShelf(id) || "Закладка";
  const pref = shelfPref(id);
  const remindPresets = [5, 10, 15];
  const snoozePresets = [1, 2, 3];
  const remindCustom = !remindPresets.includes(pref.remind);
  const snoozeCustom = !snoozePresets.includes(pref.snooze);
  const rh = Math.floor((remindCustom ? pref.remind : 0) / 60);
  const rm = (remindCustom ? pref.remind : 0) % 60;

  viewEl.innerHTML = `
    <section class="screen">
      ${bar(label, { back: "settings" })}
      <div class="scroll pad-bottom">
        <div class="group-label">Напоминание заранее</div>
        <div class="seg pref-row">
          ${remindPresets.map(v => `<button type="button" data-pref-remind="${v}" class="${!remindCustom && pref.remind === v ? "on" : ""}">${v}</button>`).join("")}
          <span class="pref-inline ${remindCustom ? "on" : ""}">
            <input id="pref-remind-h" type="number" min="0" max="48" inputmode="numeric" placeholder="ч" value="${remindCustom && rh ? rh : ""}" />
            <span>:</span>
            <input id="pref-remind-m" type="number" min="0" max="59" inputmode="numeric" placeholder="м" value="${remindCustom ? rm || (pref.remind ? pref.remind % 60 : "") : ""}" />
          </span>
        </div>

        <button class="setting" data-pref-toggle="push">
          <div>
            <div class="name">Пуш-уведомления</div>
            <div class="sub">тихое напоминание заранее</div>
          </div>
          <span class="toggle ${pref.push ? "on" : ""}"><i></i></span>
        </button>
        <button class="setting" data-pref-toggle="alarm">
          <div>
            <div class="name">Будильник</div>
            <div class="sub">громкий сигнал в момент события</div>
          </div>
          <span class="toggle ${pref.alarm ? "on" : ""}"><i></i></span>
        </button>

        <div class="group-label">Повторить через</div>
        <div class="seg pref-row">
          ${snoozePresets.map(v => `<button type="button" data-pref-snooze="${v}" class="${!snoozeCustom && pref.snooze === v ? "on" : ""}">${v}</button>`).join("")}
          <span class="pref-inline ${snoozeCustom ? "on" : ""}">
            <input id="pref-snooze-m" type="number" min="1" max="180" inputmode="numeric" placeholder="мин" value="${snoozeCustom ? pref.snooze : ""}" />
          </span>
        </div>
      </div>
    </section>
  `;
}

const ALARM_DAYS = [
  { d: 1, label: "понедельник" },
  { d: 2, label: "вторник" },
  { d: 3, label: "среда" },
  { d: 4, label: "четверг" },
  { d: 5, label: "пятница" },
  { d: 6, label: "суббота" },
  { d: 0, label: "воскресенье" },
];

function alarmRepeatMode(draft) {
  const r = draft?.repeat;
  if (!r) return "once";
  if (r.kind === "daily") return "daily";
  if (r.kind === "weekdays") return "weekdays";
  if (r.kind === "weekly" && r.days?.length) return "custom";
  return "once";
}

function renderAlarmSettings() {
  const draft = state.alarmDraft;
  if (!draft) return go("daily", { shelf: "alarms" });
  const mode = alarmRepeatMode(draft);
  const selectedDays = new Set(
    mode === "custom" ? (draft.repeat?.days || [])
      : mode === "weekdays" ? [1, 2, 3, 4, 5]
        : mode === "daily" ? [0, 1, 2, 3, 4, 5, 6]
          : []
  );
  const repeatSub = mode === "once" ? "Однократно"
    : mode === "daily" ? "Ежедневно"
      : mode === "weekdays" ? "По будням"
        : alarmRepeatLabel(draft);

  viewEl.innerHTML = `
    <section class="screen">
      <div class="bar">
        <button class="icon-btn" data-go="daily" data-shelf="alarms" data-back aria-label="Назад">${ICONS.back}</button>
        <h2>Настройки будильника</h2>
        <span class="spacer"></span>
      </div>
      <div class="scroll pad-bottom">
        <div class="settings-card">
          <button type="button" class="setting flat" id="alarm-melody">
            <span class="name">Мелодия</span>
            <span class="sub">${esc(soundName(chosenAlarmSound()))}</span>
            <span class="pill soft">›</span>
          </button>
          <button type="button" class="setting flat" id="alarm-repeat-open">
            <span class="name">Повтор</span>
            <span class="sub">${esc(repeatSub)}</span>
            <span class="pill soft">›</span>
          </button>
          <button type="button" class="setting flat" data-alarm-vibrate>
            <span class="name">Вибрировать при срабатывании</span>
            <span class="toggle ${draft.vibrate !== false ? "on" : ""}"><i></i></span>
          </button>
        </div>
        <div class="settings-card" style="margin-top:12px">
          <label class="setting flat alarm-desc">
            <span class="name">Описание</span>
            <input id="alarm-desc" type="text" maxlength="80" placeholder="Ввести описание" value="${esc(draft.title === "Будильник" ? "" : draft.title || "")}" />
          </label>
        </div>

        ${state.alarmRepeatPanel ? `
          <div class="settings-card" style="margin-top:12px">
            <button type="button" class="setting flat repeat-opt ${mode === "once" ? "on" : ""}" data-alarm-repeat="once">
              ${mode === "once" ? '<span class="repeat-tick">✓</span>' : '<span class="repeat-tick empty"></span>'}
              <span class="name">Однократно</span>
            </button>
            <button type="button" class="setting flat repeat-opt ${mode === "daily" ? "on" : ""}" data-alarm-repeat="daily">
              ${mode === "daily" ? '<span class="repeat-tick">✓</span>' : '<span class="repeat-tick empty"></span>'}
              <span class="name">Ежедневно</span>
            </button>
            <button type="button" class="setting flat repeat-opt ${mode === "weekdays" ? "on" : ""}" data-alarm-repeat="weekdays">
              ${mode === "weekdays" ? '<span class="repeat-tick">✓</span>' : '<span class="repeat-tick empty"></span>'}
              <span class="name">По будням</span>
            </button>
          </div>
          <div class="settings-card" style="margin-top:12px">
            <button type="button" class="setting flat ${mode === "custom" || state.alarmDaysPanel ? "on" : ""}" id="alarm-repeat-custom">
              <span class="name">Настроить</span>
              <span class="pill soft">›</span>
            </button>
          </div>
        ` : ""}

        ${state.alarmDaysPanel ? `
          <div class="settings-card" style="margin-top:12px">
            ${ALARM_DAYS.map(day => {
              const on = selectedDays.has(day.d);
              return `
                <button type="button" class="setting flat day-opt" data-alarm-day="${day.d}">
                  <span class="name">${day.label}</span>
                  <span class="day-check ${on ? "on" : ""}">${on ? "✓" : ""}</span>
                </button>
              `;
            }).join("")}
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

/* —— actions —— */

function captureTextRelated(a, b) {
  const x = String(a || "").toLowerCase().replace(/\s+/g, " ").trim();
  const y = String(b || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

async function capture(text, source = "text", opts = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;
  if ((opts.sharedList || state.screen === "lists") && proDemoView("shared")) {
    proDemoToast();
    return;
  }
  if (state.screen === "daily" && proDemoView(state.shelf)) {
    proDemoToast();
    return;
  }
  const onList = state.screen === "lists" && state.listId && !String(state.listId).startsWith("out-");
  if (onList && !opts.sharedList && !opts.forceCapture) {
    opts = { ...opts, sharedList: true, pairId: state.listId, captureMode: "shared" };
  }
  const now = Date.now();
  const low = trimmed.toLowerCase().replace(/\s+/g, " ");
  const prev = lastCaptureText.toLowerCase().replace(/\s+/g, " ");

  // Пока уходит первый обрывок — более полную фразу не теряем, а ставим в очередь.
  if (captureBusy || state.pending) {
    if (captureTextRelated(low, prev) && low.length >= prev.length) {
      captureFollowup = { text: trimmed, source };
    }
    return;
  }
  if (prev && now - lastCaptureAt < 45_000) {
    if (low === prev) return;
    // «приготовить» → следом «приготовить курицу»: берём только более полную.
    if (captureTextRelated(low, prev) && low.length <= prev.length) return;
  }
  lastCaptureText = trimmed;
  lastCaptureAt = now;
  captureBusy = true;
  captureFollowup = null;

  pushChat({ role: "me", text: trimmed });
  // С своей полки голос кладёт записи туда же.
  const shelfHint = customShelves().some(s => s.id === state.shelf) ? state.shelf : "";
  if (!opts.keepCloud && state.screen !== "shelves" && !opts.sharedList) {
    state.screen = "shelves";
    if (!state.shelf || state.shelf === "chat") state.shelf = defaultShelf();
  }
  if (!opts.keepCloud && !opts.sharedList) softRender();

  if (!navigator.onLine) {
    const queue = store.queue;
    queue.push({ text: trimmed, source, shelf: shelfHint, ts: Date.now() });
    store.queue = queue;
    captureBusy = false;
    destroyVoiceCloud();
    document.getElementById("voice-overlay")?.remove();
    toast("Нет сети — разберу, как появится связь");
    return;
  }

  state.pending = true;
  try {
    const data = await api("/capture", {
      method: "POST",
      body: {
        text: trimmed,
        source: opts.captureMode === "shared" ? "shared" : source,
        ...(opts.sharedList ? { sharedList: true, pairId: opts.pairId || state.user?.settings?.sharedListDefault || state.lists[0]?.id || "" } : {}),
        ...(shelfHint ? { shelf: shelfHint } : {}),
      },
    });
    state.pending = false;
    captureBusy = false;

    // Названия витаминов и косметики сохраняем на телефоне и просим сервер
    // их забыть. Сохраняем ДО absorb: если приложение закроют в этот момент,
    // лучше остаться с названием без записи, чем с записью без названия.
    const privateCreated = (data.reply?.items || [])
      .filter(i => PRIVATE_SHELVES.has(i.shelf || i.type) && i.title);
    for (const item of privateCreated) privateTitles.set(item.id, item.title);
    if (privateCreated.length) {
      api("/items/forget-titles", {
        method: "POST",
        body: { ids: privateCreated.map(i => i.id) },
      }).catch(() => {
        // Не вышло — попробуем при следующей загрузке списка.
      });
    }

    absorb(data);
    const reactionEvent = reactionForCapture(data.reply, trimmed);
    const reactionShelf = data.reply?.items?.[0]?.shelf || shelfHint;
    const finaleToken = ++captureFinaleToken;
    if (opts.keepCloud && activeVoiceCloud) {
      await playCloudFinale(reactionEvent, trimmed, reactionShelf);
      destroyVoiceCloud();
      document.getElementById("voice-overlay")?.remove();
    } else if (source === "voice" && trimmed && opts.voiceHeard !== false && !opts.sharedList) {
      await playCenterFinale(reactionEvent, trimmed, reactionShelf, finaleToken);
    }
    showReply(data.reply);
    // После голоса всегда перерисовываем: softRender мог пропустить кадр,
    // пока ещё гасился оверлей / listening-флаг.
    render();
  } catch (err) {
    state.pending = false;
    captureBusy = false;
    destroyVoiceCloud();
    document.getElementById("voice-overlay")?.remove();
    const queue = store.queue;
    queue.push({ text: trimmed, source, shelf: shelfHint, ts: Date.now() });
    store.queue = queue;
    toast(err.message);
  }

  const follow = captureFollowup;
  captureFollowup = null;
  if (follow && follow.text && captureTextRelated(follow.text, lastCaptureText)
      && follow.text.trim().length > lastCaptureText.trim().length) {
    capture(follow.text, follow.source || source);
  }
}

function showReply(reply) {
  if (!reply) return;
  state.prompt = null;
  if (reply.kind === "shared_list") {
    toast(reply.message || "Отправлено в общий список");
    flashListSent(reply.message || "Отправлено");
    if (reply.pairId) {
      state.listId = reply.pairId;
      saveSharedListDefault(reply.pairId);
    }
    if (state.screen === "lists") renderLists();
    return;
  }
  if (reply.kind === "created" || reply.kind === "moved" || reply.kind === "duplicate") {
    state.awaitingFill = false;
    const items = reply.items || [];
    const first = items[0];
    const title = reply.kind === "moved" ? v("Перенесла", "Перенёс") : reply.kind === "duplicate" ? "Уже стоит" : v("Записала", "Запомнил");
    toast(first ? `${title}: ${first.title}` : title);
    // Голос ставит запись на конкретный день — сразу открываем этот день в календаре.
    if (first && !isDailyShelfItem(first)) {
      const day = effectiveItemDate(first);
      saveCalendarDay(day);
      state.highlightId = first.id;
      state.screen = "shelves";
    }
    for (const item of items) {
      const patch = chatPatchForItem(item);
      pushChat({
        role: "ai",
        itemId: item.id,
        title,
        lines: patch.lines,
        bell: patch.bell,
        chips: patch.chips,
      });
    }
  } else if (reply.kind === "cancelled") {
    const cancelled = reply.items || [];
    for (const item of cancelled) removeChatForItem(item.id);
    toast(cancelled.length ? "Уведомления сняты" : v("Отменила", "Отменил"));
  } else if (reply.kind === "confirm") {
    state.pendingIntent = reply.intent || "cancel";
    if (reply.intent === "shared_pick") {
      state.prompt = {
        title: reply.message || "Кому отправить?",
        chips: (state.lists || []).map(l => ({
          label: l.nickname || l.code || "близкий",
          action: "pick-shared",
          id: l.id,
        })),
      };
      return;
    }
    state.prompt = {
      title: reply.message || "Так?",
      chips: [
        { label: "Да", action: "confirm-yes", style: "" },
        { label: "Нет", action: "confirm-no", style: "danger" },
        ...((reply.candidates || []).slice(0, 3).map(c => ({
          label: `${c.title} · ${fmtWhen(c)}`,
          action: state.pendingIntent === "move" ? "pick-move" : "pick-cancel",
          id: c.id,
          style: state.pendingIntent === "move" ? "" : "danger",
        }))),
      ],
    };
  } else if (reply.kind === "ask") {
    state.awaitingFill = true;
    pushChat({ role: "ai", text: reply.message || "Во сколько?" });
    toast(reply.message || "Во сколько?");
    setTimeout(() => {
      if (!state.awaitingFill) return;
      if (typeof NATIVE?.speech?.listenGoogle === "function") {
        startGoogleChatVoice();
      } else if (speechAvailable()) {
        startChatVoice({ mode: "auto" });
      }
    }, 350);
  } else if (reply.kind === "undone") {
    toast(reply.message || v("Вернула как было", "Вернул как было"));
  } else if (reply.kind === "ambiguous" || reply.kind === "not_found") {
    state.pendingMove = reply.pending || null;
    state.pendingIntent = reply.intent || (reply.pending ? "move" : "cancel");
    state.prompt = {
      title: reply.message || "Уточните",
      chips: (reply.candidates || []).map(c => ({
        label: `${c.title} · ${fmtWhen(c)}`,
        action: state.pendingIntent === "move" ? "pick-move" : "pick-cancel",
        id: c.id,
        style: state.pendingIntent === "move" ? "" : "danger",
      })),
    };
  } else {
    toast(reply.message || "Готово");
  }
}

async function flushQueue() {
  const queue = store.queue;
  if (!queue.length || !navigator.onLine) return;
  store.queue = [];
  let ok = 0;
  for (const entry of queue) {
    try {
      const data = await api("/capture", {
        method: "POST",
        body: {
          text: entry.text,
          source: entry.source,
          ...(entry.shelf ? { shelf: entry.shelf } : {}),
        },
      });
      absorb(data);
      ok += 1;
    } catch {
      const rest = store.queue;
      rest.push(entry);
      store.queue = rest;
    }
  }
  if (ok) {
    toast(`${v("Разобрала", "Разобрал")} из очереди · ${ok}`);
    render();
  }
}

const NOTIFICATIONS_PERMISSION_ASKED_KEY = "notificationsPermissionAsked";

/** Сразу после успешного входа — системные диалоги микрофона и уведомлений. */
async function requestStartupPermissions() {
  if (NATIVE) {
    try {
      const mic = await NATIVE.ensureMicPermission();
      state.micState = mic?.granted ? "granted" : (mic?.blocked ? "denied" : "default");
    } catch { /* ignore */ }
    try {
      const granted = await NATIVE.requestNotifications();
      if (granted) NATIVE.syncReminders(state.items, state.user?.settings);
    } catch { /* ignore */ }
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  if (notifPermission() === "granted") setupPush(false);
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      state.micState = "granted";
    } catch { /* в браузере часто нужен жест — попробуем при первой записи */ }
  }
}

async function setupPush(interactive = true) {
  // В приложении на телефоне напоминания ставит сама система, сервер для этого не нужен.
  if (NATIVE) {
    if (interactive) {
      try { localStorage.setItem(NOTIFICATIONS_PERMISSION_ASKED_KEY, "1"); } catch { /* ignore */ }
      const granted = await NATIVE.requestNotifications();
      if (!granted) {
        toast("Уведомления не разрешены");
        return;
      }
      NATIVE.syncReminders(state.items, state.user?.settings);
      await NATIVE.testNotification();
      toast("Проверочное уведомление отправлено");
      return;
    }
    if (notifPermission() === "granted") {
      NATIVE.syncReminders(state.items, state.user?.settings);
    }
    return;
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    if (interactive) toast("Этот браузер не умеет уведомления");
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register(`/sw.js?v=${SW_VERSION}`);
    try { await reg.update(); } catch {}
    let permission = Notification.permission;
    if (permission === "default" && interactive) permission = await Notification.requestPermission();
    if (permission !== "granted") {
      if (interactive) toast("Уведомления не разрешены");
      return;
    }
    const key = state.vapidPublicKey || (await api("/config")).vapidPublicKey;
    if (!key) return;
    const existing = await reg.pushManager.getSubscription();
    const subscription = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api("/push/subscribe", { method: "POST", body: { subscription } });
    if (interactive) {
      await api("/push/test", { method: "POST" });
      toast(v("Отправила тестовое уведомление", "Отправил тестовое уведомление"));
    }
  } catch (err) {
    if (interactive) toast(`Уведомления: ${err.message}`);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function saveSettings(patch, opts = {}) {
  const keepScroll = opts.keepScroll && state.screen === "settings";
  if (keepScroll) {
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
  }
  try {
    absorb(await api("/settings", { method: "POST", body: patch }));
    if (opts.render !== false) render();
    if (!keepScroll) state.settingsScroll = 0;
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

const autoSaveTimers = new Map();
const autoSaveFns = new Map();
let autoSaveFlushing = false;

function scheduleAutoSave(key, fn) {
  autoSaveFns.set(key, fn);
  clearTimeout(autoSaveTimers.get(key));
  autoSaveTimers.set(key, setTimeout(() => {
    autoSaveTimers.delete(key);
    void runAutoSave(key);
  }, AUTO_SAVE_MS));
}

async function runAutoSave(key) {
  const fn = autoSaveFns.get(key);
  if (!fn) return;
  autoSaveFns.delete(key);
  clearTimeout(autoSaveTimers.get(key));
  autoSaveTimers.delete(key);
  try {
    await fn();
  } catch (err) {
    if (err?.message) toast(err.message);
  }
}

async function flushAutoSave(key) {
  clearTimeout(autoSaveTimers.get(key));
  autoSaveTimers.delete(key);
  if (autoSaveFns.has(key)) await runAutoSave(key);
}

async function flushAllAutoSaves() {
  if (autoSaveFlushing) return;
  autoSaveFlushing = true;
  try {
    const keys = [...new Set([...autoSaveTimers.keys(), ...autoSaveFns.keys()])];
    for (const key of keys) await flushAutoSave(key);
  } finally {
    autoSaveFlushing = false;
  }
}

function buildDetailPatch(item) {
  const isCare = isCareItem(item);
  const isHealth = isHealthItem(item);
  const placeEl = document.getElementById("f-place");
  const whoEl = document.getElementById("f-who");
  const phoneEl = document.getElementById("f-phone");
  const noteEl = document.getElementById("f-note");
  const title = isCare || isHealth
    ? joinCareTitle(
      document.getElementById("f-care-step")?.value || "",
      document.getElementById("f-care-product")?.value || "",
    )
    : (document.getElementById("f-title")?.value ?? item.title ?? "");
  const body = {
    title,
    place: isCare || isHealth ? "" : (placeEl?.value || ""),
    who: isCare || isHealth ? "" : (whoEl?.value || ""),
    phone: isCare || isHealth ? "" : (phoneEl?.value || ""),
    carePart: isCare ? carePartOf(item) : item.carePart,
    healthPart: isHealth ? healthPartOf(item) : item.healthPart,
    remind: isCare ? 0 : item.remind,
    repeat: item.repeat || null,
  };
  if (isHealth) {
    body.note = document.getElementById("f-health-note")?.value || "";
  } else if (!isCare && noteEl) {
    body.note = noteEl.value || "";
  }
  if (!isCare && !isHealth) {
    body.date = item.date;
    body.time = item.time;
  }
  return body;
}

async function saveDetailItem(opts = {}) {
  const item = currentItem();
  if (!item || state.screen !== "detail") return false;
  const body = buildDetailPatch(item);

  // Правку названия витаминов и косметики оставляем в телефоне: на сервер
  // уходит всё остальное — время, повтор, отметки. Иначе название, стёртое
  // при создании, вернулось бы на сервер при первом же редактировании.
  if (PRIVATE_SHELVES.has(item.shelf || item.type) && "title" in body) {
    privateTitles.set(item.id, body.title);
    body.title = "";
  }

  const data = await api(`/items/${item.id}`, { method: "PATCH", body });
  absorb(data);
  const next = data.item || state.items.find(i => i.id === item.id);
  if (next) updateChatItemCard(item.id, next, { flashOk: opts.flashOk });
  if (!opts.silent) toast(v("Сохранила", "Сохранил"));
  return true;
}

function scheduleDetailAutoSave() {
  if (state.screen !== "detail" || !currentItem()) return;
  scheduleAutoSave("detail", () => saveDetailItem({ silent: true }));
}

async function saveShelfDraft(opts = {}) {
  if (state.screen !== "shelf-edit") return false;
  const label = String(document.getElementById("shelf-label")?.value || "").trim();
  const keywordsText = String(document.getElementById("shelf-keywords")?.value || "");
  if (!label) return false;
  const draft = state.shelfDraft || {};
  const next = customShelves().map(s => ({ ...s }));
  if (draft.id) {
    const idx = next.findIndex(s => s.id === draft.id);
    if (idx < 0) throw new Error("Полка не найдена");
    next[idx] = { id: draft.id, label, keywordsText };
  } else {
    if (next.length >= 12) throw new Error("Больше 12 своих полок не нужно");
    next.push({ label, keywordsText });
  }
  absorb(await api("/settings", { method: "POST", body: { customShelves: next } }));
  const saved = customShelves();
  const opened = draft.id
    ? saved.find(s => s.id === draft.id)
    : saved.find(s => s.label === label) || saved[saved.length - 1];
  if (opened) {
    state.shelfDraft = {
      id: opened.id,
      label: opened.label || label,
      keywordsText: (opened.keywords || []).join(", ") || keywordsText,
    };
  }
  if (!opts.silent) toast(v("Сохранила", "Сохранил"));
  return true;
}

function scheduleShelfAutoSave() {
  if (state.screen !== "shelf-edit") return;
  scheduleAutoSave("shelf", () => saveShelfDraft({ silent: true }));
}

async function saveShelfPrefsFromForm(opts = {}) {
  if (state.screen !== "shelf-prefs") return false;
  const id = state.shelfEditId;
  if (!id) return false;
  const prefs = { ...shelfPref(id) };
  const h = Number(document.getElementById("pref-remind-h")?.value);
  const m = Number(document.getElementById("pref-remind-m")?.value);
  if (Number.isFinite(h) || Number.isFinite(m)) {
    const hh = Number.isFinite(h) ? h : 0;
    const mm = Number.isFinite(m) ? m : 0;
    if (document.getElementById("pref-remind-h")?.value !== "" || document.getElementById("pref-remind-m")?.value !== "") {
      prefs.remind = Math.max(0, hh * 60 + mm);
    }
  }
  const sm = Number(document.getElementById("pref-snooze-m")?.value);
  if (Number.isFinite(sm) && sm >= 1) prefs.snooze = Math.min(180, sm);
  absorb(await api("/settings", { method: "POST", body: { shelfPrefs: { [id]: prefs } } }));
  state.shelfEditId = id;
  if (!opts.silent) toast(v("Сохранила", "Сохранил"));
  return true;
}

function scheduleShelfPrefsAutoSave() {
  if (state.screen !== "shelf-prefs") return;
  scheduleAutoSave("shelf-prefs", () => saveShelfPrefsFromForm({ silent: true }));
}

async function submitListNicknameInvite() {
  const nickname = String(
    document.querySelector("#list-nickname-form [name=nickname]")?.value
    || state.listInviteDraft?.nickname
    || "",
  ).trim();
  const code = state.listInviteDraft?.code || state.listJoinDraft;
  if (!nickname || nickname.length < 2 || !code) return false;
  const data = await api("/lists/invite", { method: "POST", body: { code, nickname } });
  absorbSharedLists(data);
  state.listInviteDraft = null;
  state.listJoinDraft = "";
  state.listAcceptNicknameDraft = "";
  state.listInviteOpen = false;
  toast("Приглашение отправлено");
  renderLists();
  return true;
}

function scheduleListNicknameAutoSave() {
  if (state.screen !== "lists" || state.listInviteDraft?.step !== "nickname") return;
  scheduleAutoSave("list-nickname", submitListNicknameInvite);
}

async function submitListAcceptInvite() {
  const nickname = String(
    document.querySelector("#list-accept-form [name=nickname]")?.value
    || state.listAcceptNicknameDraft
    || "",
  ).trim();
  const inviteId = state.listAcceptDraft;
  if (!nickname || nickname.length < 2 || !inviteId) return false;
  const data = await api(`/lists/invites/${inviteId}/accept`, { method: "POST", body: { nickname } });
  absorbSharedLists(data);
  state.listAcceptDraft = null;
  state.listAcceptNicknameDraft = "";
  state.listId = data.pair?.id || state.lists[0]?.id || null;
  toast("Готово — можно делиться списками");
  renderLists();
  return true;
}

function scheduleListAcceptAutoSave() {
  if (state.screen !== "lists" || !state.listAcceptDraft) return;
  scheduleAutoSave("list-accept", submitListAcceptInvite);
}

async function saveAlarmDraft(opts = {}) {
  const draft = state.alarmDraft;
  if (!draft?.time) return false;
  const date = nextAlarmDate(draft.time, draft.repeat);
  if (draft.id) {
    absorb(await api(`/items/${draft.id}`, {
      method: "PATCH",
      body: {
        title: draft.title || "Будильник",
        time: draft.time,
        date,
        repeat: draft.repeat || null,
        alarm: true,
        enabled: draft.enabled !== false,
        vibrate: draft.vibrate !== false,
        melody: draft.melody || "default",
        shelf: "alarms",
        type: "alarm",
        remind: 0,
      },
    }));
  } else {
    absorb(await api("/items", {
      method: "POST",
      body: {
        type: "alarm",
        title: draft.title || "Будильник",
        time: draft.time,
        date,
        alarm: true,
        remind: 0,
      },
    }));
    const created = state.items
      .filter(i => i.type === "alarm" || i.shelf === "alarms")
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (created) {
      absorb(await api(`/items/${created.id}`, {
        method: "PATCH",
        body: {
          repeat: draft.repeat || { kind: "daily" },
          enabled: true,
          vibrate: draft.vibrate !== false,
          melody: draft.melody || "default",
          shelf: "alarms",
          type: "alarm",
        },
      }));
      state.alarmDraft = {
        ...draft,
        id: created.id,
      };
    }
  }
  if (!opts.silent) toast(v("Сохранила", "Сохранил"));
  return true;
}

function scheduleAlarmAutoSave() {
  if (!state.alarmDraft?.id) return;
  scheduleAutoSave("alarm", () => saveAlarmDraft({ silent: true }));
}

/* —— global events —— */

// Страховка: приложение никогда не должно перезагружаться из-за отправки формы.
document.addEventListener("submit", async event => {
  if (!event.target.closest("[data-auth-form]")) event.preventDefault();

  if (event.target.id === "list-manual-add") {
    const title = String(new FormData(event.target).get("title") || "").trim();
    if (!title) return;
    state.listManualOpen = false;
    state.listManualDraft = "";
    await addSharedListItem(title);
    return;
  }

  if (event.target.id === "list-invite-form") {
    const code = String(new FormData(event.target).get("code") || "").trim().toUpperCase();
    if (code.length < 4) return toast("ID — буквы и цифры");
    state.listJoinDraft = code;
    state.listInviteDraft = { code, step: "nickname" };
    return renderLists();
  }

  if (event.target.id === "list-nickname-form") {
    const nickname = String(new FormData(event.target).get("nickname") || "").trim();
    const code = state.listInviteDraft?.code || state.listJoinDraft;
    if (!nickname || !code) return;
    try {
      const data = await api("/lists/invite", { method: "POST", body: { code, nickname } });
      absorbSharedLists(data);
      state.listInviteDraft = null;
      state.listJoinDraft = "";
      state.listAcceptNicknameDraft = "";
      state.listInviteOpen = false;
      toast("Приглашение отправлено");
      renderLists();
    } catch (err) { toast(err.message); }
    return;
  }

  if (event.target.id === "list-accept-form") {
    const nickname = String(new FormData(event.target).get("nickname") || "").trim();
    const inviteId = state.listAcceptDraft;
    if (!nickname || !inviteId) return;
    try {
      const data = await api(`/lists/invites/${inviteId}/accept`, { method: "POST", body: { nickname } });
      absorbSharedLists(data);
      state.listAcceptDraft = null;
      state.listAcceptNicknameDraft = "";
      state.listId = data.pair?.id || state.lists[0]?.id || null;
      toast("Готово — можно делиться списками");
      renderLists();
    } catch (err) { toast(err.message); }
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Enter" && event.target?.id === "chat-input") {
    event.preventDefault();
    sendFromComposer();
  }
});

document.addEventListener("input", event => {
  const t = event.target;
  if (!isFormField(t)) return;
  if (t.id === "chat-input") state.chatDraft = t.value;
  // Черновики не должны пропадать, если экран перерисуется фоном.
  if (t.id === "support-text") state.supportDraft = t.value;
  if (t.id === "report-comment") state.reportComment = t.value;
  if (t.id === "shelf-label") {
    state.shelfDraft = { ...(state.shelfDraft || {}), label: t.value };
    scheduleShelfAutoSave();
  }
  if (t.id === "shelf-keywords") {
    state.shelfDraft = { ...(state.shelfDraft || {}), keywordsText: t.value };
    scheduleShelfAutoSave();
  }
  if (SHELF_PREF_FIELD_IDS.has(t.id)) scheduleShelfPrefsAutoSave();
  if (DETAIL_FIELD_IDS.has(t.id)) scheduleDetailAutoSave();
  if (t.id === "alarm-desc" && state.alarmDraft) {
    state.alarmDraft = { ...state.alarmDraft, title: t.value.trim() || "Будильник" };
    scheduleAlarmAutoSave();
  }
  if (t.closest?.("#list-manual-add") && t.name === "title") {
    state.listManualDraft = t.value;
  }
  if (t.closest?.("#list-invite-form") && t.name === "code") {
    state.listJoinDraft = String(t.value || "").toUpperCase();
  }
  if (t.closest?.("#list-nickname-form") && t.name === "nickname") {
    const code = state.listInviteDraft?.code || state.listJoinDraft;
    state.listInviteDraft = { code, step: "nickname", nickname: t.value };
    scheduleListNicknameAutoSave();
  }
  if (t.closest?.("#list-accept-form") && t.name === "nickname") {
    state.listAcceptNicknameDraft = t.value;
    scheduleListAcceptAutoSave();
  }
  if (t.dataset?.familyId != null) {
    const i = Number(t.dataset.familyId);
    t.value = String(t.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    state.familyDraft.ids[i] = t.value;
    scheduleFamilyValidate(i, t.value);
  }
});

document.addEventListener("change", event => {
  const t = event.target;
  if (t.dataset?.familyId != null) {
    validateFamilyId(Number(t.dataset.familyId), t.value);
  }
});

document.addEventListener("focusout", event => {
  const t = event.target;
  if (!isFormField(t)) return;
  if (DETAIL_FIELD_IDS.has(t.id)) void flushAutoSave("detail");
  if (t.id === "shelf-label" || t.id === "shelf-keywords") void flushAutoSave("shelf");
  if (SHELF_PREF_FIELD_IDS.has(t.id)) void flushAutoSave("shelf-prefs");
  if (t.closest?.("#list-nickname-form") && t.name === "nickname") void flushAutoSave("list-nickname");
  if (t.closest?.("#list-accept-form") && t.name === "nickname") void flushAutoSave("list-accept");
  if (t.id === "alarm-desc") void flushAutoSave("alarm");
});

/* —— смахивание записи —— */

// Влево — из-под записи выезжает «Удалить». Жест привычен по спискам телефона,
// поэтому объяснять его в интерфейсе не нужно.
const SWIPE_WIDTH = 96;
let swipeRow = null;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeShift = 0;
let swiping = false;
let swipeJustEnded = false;

function closeSwipes(keep = null) {
  document.querySelectorAll(".swipe.open").forEach(row => {
    if (row !== keep) row.classList.remove("open");
  });
}

document.addEventListener("pointerdown", event => {
  const row = event.target.closest(".swipe");
  if (!row || event.target.closest(".swipe-del") || event.target.closest(".care-edit")) return;
  swipeRow = row;
  swipeStartX = event.clientX;
  swipeStartY = event.clientY;
  swipeShift = row.classList.contains("open") ? -SWIPE_WIDTH : 0;
  swiping = false;
});

document.addEventListener("pointermove", event => {
  if (!swipeRow) return;
  const dx = event.clientX - swipeStartX;
  const dy = event.clientY - swipeStartY;
  if (!swiping) {
    // Палец пошёл вниз — человек листает список, жест не наш.
    if (Math.abs(dy) > Math.abs(dx)) {
      swipeRow = null;
      return;
    }
    if (Math.abs(dx) < 8) return;
    swiping = true;
    closeSwipes(swipeRow);
    swipeRow.classList.add("dragging");
  }
  const from = swipeRow.classList.contains("open") ? -SWIPE_WIDTH : 0;
  // Дальше кнопки не тянем, вправо за край — тоже.
  swipeShift = Math.min(0, Math.max(-SWIPE_WIDTH - 24, from + dx));
  swipeRow.querySelector(".swipe-front").style.transform = `translateX(${swipeShift}px)`;
});

function endSwipe() {
  if (!swipeRow) return;
  const row = swipeRow;
  swipeRow = null;
  row.classList.remove("dragging");
  row.querySelector(".swipe-front").style.transform = "";
  if (!swiping) return;
  swiping = false;
  row.classList.toggle("open", swipeShift < -SWIPE_WIDTH / 2);
  // Смахивание не должно сработать ещё и как нажатие по записи.
  swipeJustEnded = true;
  setTimeout(() => { swipeJustEnded = false; }, 350);
}

document.addEventListener("pointerup", endSwipe);
document.addEventListener("pointercancel", endSwipe);

document.addEventListener("click", event => {
  if (swipeJustEnded) {
    swipeJustEnded = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const open = document.querySelector(".swipe.open");
  if (!open || event.target.closest(".swipe-del")) return;
  // Пока «Удалить» открыто, первое касание записи просто закрывает его.
  closeSwipes();
  if (open.contains(event.target)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

document.addEventListener("click", async event => {
  // Ссылка на документ открывается своим окном, а не переходом по адресу.
  //
  // Раньше проверка ловила любое нажатие внутри подписи к галочке согласия —
  // ссылка на политику лежит там же. Человек жал по тексту, обработчик
  // находил ссылку выше по дереву и гасил нажатие: галочка не ставилась,
  // и продолжить было нельзя.
  //
  // Теперь считаем только попадание в саму ссылку.
  const doc = event.target.closest("[data-doc]");
  if (doc) {
    event.preventDefault();
    return openDoc(doc.dataset.doc);
  }

  if (event.target.closest("#chat-send")) {
    event.preventDefault();
    return sendFromComposer();
  }

  if (event.target.closest("#consent-restore")) {
    state.authFlow = "restore";
    return renderAuthRestore();
  }

  if (event.target.closest("#consent-accept")) {
    const box = document.getElementById("consent-ok");
    const errorEl = document.querySelector("[data-consent-error]");
    if (!box?.checked) {
      if (errorEl) errorEl.textContent = "Отметьте согласие — без него нельзя продолжить";
      return;
    }
    try {
      absorb(await api("/consent", { method: "POST", body: { version: CONSENT_VERSION } }));
      render();
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    }
    return;
  }

  const reportOpen = event.target.closest("[data-report-item]");
  if (reportOpen) {
    state.reportItemId = reportOpen.dataset.reportItem;
    state.reportReason = "offense";
    state.reportComment = "";
    state.reportBlock = true;
    return go("report");
  }

  const reportReason = event.target.closest("[data-report-reason]");
  if (reportReason) {
    state.reportComment = document.getElementById("report-comment")?.value || "";
    state.reportReason = reportReason.dataset.reportReason;
    return renderReport();
  }

  if (event.target.closest("#report-block")) {
    state.reportComment = document.getElementById("report-comment")?.value || "";
    state.reportBlock = !state.reportBlock;
    return renderReport();
  }

  if (event.target.closest("#report-send")) {
    const id = state.reportItemId;
    if (!id) return go("shelves");
    try {
      absorb(await api(`/items/${id}/report`, {
        method: "POST",
        body: {
          reason: state.reportReason || "other",
          comment: document.getElementById("report-comment")?.value || "",
          block: Boolean(state.reportBlock),
        },
      }));
      state.reportItemId = null;
      toast(state.reportBlock ? "Жалоба отправлена, отправитель заблокирован" : "Жалоба отправлена");
      return go("shelves");
    } catch (err) {
      return toast(err.message);
    }
  }

  if (event.target.closest("#billing-restore")) {
    return checkBillingPayment();
  }

  if (event.target.closest("#billing-restore-purchases")) {
    return restorePurchases();
  }

  if (event.target.closest("#family-pay")) {
    if (!billingCanBuy()) return;
    return buyFamilySubscription();
  }

  if (event.target.closest("#family-cancel")) {
    return cancelFamilySub();
  }

  if (event.target.closest("#family-add-id")) {
    state.familyDraft.ids.push("");
    state.familyScrollBottom = true;
    if (billingOnSettings()) return patchFamilySubBlock();
  }

  const familyRm = event.target.closest("[data-family-rm]");
  if (familyRm) {
    const i = Number(familyRm.dataset.familyRm);
    state.familyDraft.ids.splice(i, 1);
    if (!state.familyDraft.ids.length) state.familyDraft.ids = [""];
    refreshFamilyQuote();
    return;
  }

  const familyTerm = event.target.closest("[data-family-term]");
  if (familyTerm) {
    state.familyDraft.term = familyTerm.dataset.familyTerm;
    state.billingPlanOpen = "family";
    refreshFamilyQuote();
    return;
  }

  if (event.target.closest("[data-family-renew]")) {
    state.billingPlanOpen = "family";
    if (billingOnSettings()) return patchBillingProducts();
    return go("settings");
  }

  const billingPlan = event.target.closest("[data-billing-plan]");
  if (billingPlan) {
    const id = billingPlan.dataset.billingPlan;
    state.billingPlanOpen = state.billingPlanOpen === id ? null : id;
    if (billingOnSettings()) return patchBillingProducts();
  }

  const buyBtn = event.target.closest("[data-buy]");
  if (buyBtn) {
    if (!billingCanBuy()) return;
    return buySubscription(buyBtn.dataset.buy);
  }

  const unblock = event.target.closest("[data-unblock]");
  if (unblock) {
    try {
      absorb(await api(`/block/${encodeURIComponent(unblock.dataset.unblock)}`, { method: "DELETE" }));
      toast("Разблокирован");
      render();
    } catch (err) { toast(err.message); }
    return;
  }

  if (event.target.closest("#support-send")) {
    const text = document.getElementById("support-text")?.value || "";
    if (text.trim().length < 5) return toast("Опишите, что случилось");
    try {
      const data = await api("/support", {
        method: "POST",
        body: {
          text,
          appVersion: state.apkVersion || APP_VERSION,
          platform: NATIVE ? "android" : "web",
        },
      });
      state.supportDraft = "";
      state.supportThread = data;
      state.support = { ...(state.support || {}), unread: data.unread || 0 };
      toast("Отправлено. Ответ придёт сюда же");
      // Остаёмся в переписке: человек видит своё сообщение и понимает, что оно ушло.
      return renderSupport();
    } catch (err) {
      return toast(err.message);
    }
  }

  if (event.target.closest("[data-perm-action]")) {
    const btn = event.target.closest("[data-perm-action]");
    if (state.screen === "settings") {
      state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    }
    await handlePermissionAction(btn.getAttribute("data-perm-action"));
    return;
  }

  if (event.target.closest("#perm-toggle-mic")) {
    await toggleMicPermission();
    return state.screen === "permissions" ? renderPermissions() : renderSettings();
  }

  if (event.target.closest("#perm-toggle-notif")) {
    await toggleNotifPermission();
    return state.screen === "permissions" ? renderPermissions() : renderSettings();
  }

  const listTab = event.target.closest("[data-list-tab]");
  if (listTab) {
    const id = listTab.dataset.listTab;
    if (String(id).startsWith("out-")) return toast("Ждём ответа на приглашение");
    state.listInviteOpen = false;
    state.listTabMenu = null;
    state.listId = id;
    state.listInviteDraft = null;
    saveSharedListDefault(id);
    return refreshState().then(() => {
      renderLists();
      syncListPoll();
    });
  }

  if (event.target.closest("#list-invite-tab")) {
    state.listInviteOpen = true;
    state.listId = null;
    state.listInviteDraft = null;
    state.listTabMenu = null;
    return renderLists();
  }

  if (event.target.closest("#list-tab-menu-cancel") || event.target.id === "list-tab-menu-overlay") {
    state.listTabMenu = null;
    return renderLists();
  }

  const listDeleteBtn = event.target.closest("[data-list-delete]");
  if (listDeleteBtn) {
    const pairId = listDeleteBtn.dataset.listDelete;
    state.listTabMenu = null;
    try {
      const data = await api(`/lists/${pairId}/leave`, { method: "POST", body: {} });
      absorbSharedLists(data);
      if (state.listId === pairId) state.listId = state.lists[0]?.id || null;
      state.listInviteOpen = false;
      toast("Закладка удалена");
      renderLists();
    } catch (err) { toast(err.message); }
    return;
  }

  if (event.target.closest("#list-invite-cancel")) {
    state.listInviteDraft = null;
    state.listJoinDraft = "";
    state.listAcceptNicknameDraft = "";
    state.listInviteOpen = false;
    if (!state.listId && state.lists.length) state.listId = state.lists[0].id;
    return renderLists();
  }

  const listAcceptBtn = event.target.closest("[data-list-accept]");
  if (listAcceptBtn) {
    state.listAcceptDraft = listAcceptBtn.dataset.listAccept;
    return renderLists();
  }

  const listDeclineBtn = event.target.closest("[data-list-decline]");
  if (listDeclineBtn) {
    try {
      const data = await api(`/lists/invites/${listDeclineBtn.dataset.listDecline}/decline`, { method: "POST", body: {} });
      absorbSharedLists(data);
      toast("Отклонено");
      renderLists();
    } catch (err) { toast(err.message); }
    return;
  }

  const listDone = event.target.closest("[data-list-done]");
  if (listDone && state.screen === "lists") {
    const entryId = listDone.dataset.listDone;
    try {
      const data = await api(`/lists/${state.listId}/items/${entryId}/done`, { method: "POST", body: { done: true } });
      absorbSharedLists(data);
      renderLists();
    } catch (err) { toast(err.message); }
    return;
  }

  const listLaterBtn = event.target.closest("[data-list-later]");
  if (listLaterBtn) {
    const now = new Date();
    state.listLaterDraft = { itemId: listLaterBtn.dataset.listLater, time: { hour: now.getHours(), minute: now.getMinutes() } };
    return renderLists();
  }

  if (event.target.closest("#list-later-cancel")) {
    state.listLaterDraft = null;
    return renderLists();
  }

  if (event.target.closest("#list-later-done")) {
    const draft = state.listLaterDraft;
    if (!draft) return;
    try {
      const data = await api(`/lists/${state.listId}/items/${draft.itemId}/later`, {
        method: "POST",
        body: { hour: draft.time.hour, minute: draft.time.minute },
      });
      absorbSharedLists(data);
      state.listLaterDraft = null;
      toast("Напомню в выбранное время");
      renderLists();
    } catch (err) { toast(err.message); }
    return;
  }

  const templatePick = event.target.closest("[data-template]");
  if (templatePick) {
    state.templateId = templatePick.dataset.template;
    const template = state.templates?.templates.find(t => t.id === state.templateId);
    // Необязательное (например «родительское собрание» без даты) по умолчанию не отмечаем.
    state.templatePicks = new Set((template?.items || [])
      .map((item, index) => (item.optional ? -1 : index))
      .filter(index => index >= 0));
    return renderTemplatesShelf();
  }

  const templateItem = event.target.closest("[data-template-pick]");
  if (templateItem) {
    const index = Number(templateItem.dataset.templatePick);
    state.templatePicks.has(index) ? state.templatePicks.delete(index) : state.templatePicks.add(index);
    return renderTemplatesShelf();
  }

  if (event.target.closest("#template-back")) {
    state.templateId = null;
    state.templatePicks = new Set();
    return renderTemplatesShelf();
  }

  if (event.target.closest("#template-apply")) {
    if (!state.templatePicks.size) return toast("Отметьте хотя бы одну запись");
    try {
      const data = await api(`/templates/${state.templateId}/apply`, {
        method: "POST",
        body: { picks: [...state.templatePicks] },
      });
      absorb(data);
      state.templateId = null;
      state.templatePicks = new Set();
      toast(data.skipped
        ? `Добавила ${data.added} · ${data.skipped} уже было`
        : `Добавила ${data.added}`);
      // Добавленное человек должен увидеть, поэтому уходим с наборов на «Сегодня».
      return go("shelves", { shelf: defaultShelf() });
    } catch (err) {
      return toast(err.message);
    }
  }

  if (event.target.closest("#brief-toggle")) {
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    try {
      absorb(await api("/settings", { method: "POST", body: { morningBrief: !state.user.settings?.morningBrief } }));
      renderSettings();
    } catch (err) { toast(err.message); }
    return;
  }

  const briefHour = event.target.closest("[data-brief-hour]");
  if (briefHour) {
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    try {
      absorb(await api("/settings", { method: "POST", body: { morningHour: Number(briefHour.dataset.briefHour) } }));
      renderSettings();
    } catch (err) { toast(err.message); }
    return;
  }

  const del = event.target.closest("[data-del]");
  if (del) {
    const id = del.dataset.del;
    const item = state.items.find(i => i.id === id)
      || shelfItems(state.shelf).find(i => i.id === id);
    if (blockDemoMutation(item)) return;
    const title = item?.title || state.items.find(i => i.id === id)?.title || "запись";
    closeSwipes();
    try {
      absorb(await api(`/items/${id}/cancel`, { method: "POST" }));
      removeChatForItem(id);
      render();
      toast(`${v("Удалила", "Удалил")} «${title}»`, {
        label: "Вернуть",
        run: async () => {
          try {
            absorb(await api(`/items/${id}/cancel`, { method: "POST", body: { cancelled: false } }));
            render();
            toast(v("Вернула", "Вернул"));
          } catch (err) { toast(err.message); }
        },
      });
    } catch (err) { toast(err.message); }
    return;
  }

  const stripShelf = event.target.closest("[data-strip-shelf]");
  if (stripShelf) {
    return openShelfFromStrip(stripShelf.dataset.stripShelf);
  }

  const stripGo = event.target.closest("[data-strip-go]");
  if (stripGo?.dataset.stripGo === "lists") {
    return go("lists");
  }

  const proDemoBtn = event.target.closest("[data-pro-shelf-demo]");
  if (proDemoBtn) {
    const key = proDemoBtn.dataset.proShelfDemo;
    if (key) {
      state.proShelfDemoModal = key;
      render();
    }
    return;
  }

  const proDemoClose = event.target.closest("[data-pro-shelf-demo-close]");
  if (proDemoClose || event.target.id === "pro-demo-overlay") {
    if (state.proShelfDemoModal) {
      state.proShelfDemoModal = null;
      render();
    }
    return;
  }

  if (event.target.closest("[data-pro-subscribe]")) {
    openProSubscription();
    return;
  }

  if (event.target.closest("#home-widget-toggle")) {
    if (!NATIVE?.pinWidget) return;
    const next = !store.homeWidget;
    if (next) {
      const res = await NATIVE.pinWidget();
      // Уже стоит — включаем переключатель и обновляем данные.
      if (res.already || (res.count || 0) > 0) {
        store.homeWidget = true;
        pushWidget();
        toast("Виджет на рабочем столе");
        return renderSettings();
      }
      // Прошивка запретила pin API (часто Xiaomi/Huawei) или запрос не ушёл.
      if (!res.supported || !res.asked) {
        store.homeWidget = false;
        toast(res.supported === false
          ? "На этом телефоне виджет ставится вручную: задержите палец на рабочем столе → «Виджеты» → «SoulVoice»"
          : "Система не дала поставить виджет. Задержите палец на рабочем столе и выберите «Виджеты»");
        return renderSettings();
      }
      // Диалог показан — переключатель пока выкл, пока человек не подтвердит.
      store.homeWidget = false;
      renderSettings();
      toast("Подтвердите добавление на рабочем столе");
      const ok = await watchWidgetPin();
      store.homeWidget = ok;
      if (ok) {
        pushWidget();
        toast("Виджет на рабочем столе");
      } else {
        toast("Виджет не добавлен");
      }
      return renderSettings();
    }
    if (NATIVE.unpinWidget) await NATIVE.unpinWidget();
    store.homeWidget = false;
    toast("Виджет убран с рабочего стола");
    return renderSettings();
  }

  const shelfPrefsOpen = event.target.closest("[data-shelf-prefs]");
  if (shelfPrefsOpen) {
    if (state.shelfReorder) return;
    state.shelfEditId = shelfPrefsOpen.dataset.shelfPrefs;
    return go("shelf-prefs");
  }

  const openShelf = event.target.closest("[data-open-shelf]");
  if (openShelf) {
    if (state.shelfReorder) return;
    return go("shelves", { shelf: openShelf.dataset.openShelf });
  }

  // Микрофон (#shelf-mic / #chat-mic) — только через mountChatMicHold.
  // Здесь не трогаем: иначе один тап = finish+capture и сразу второй startChatVoice.

  if (event.target.closest("#shortcut-open")) {
    state.shortcutOpen = !state.shortcutOpen;
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    return renderSettings();
  }

  const widgetTab = event.target.closest("[data-widget-tab]");
  if (widgetTab) {
    event.preventDefault();
    event.stopPropagation();
    const id = widgetTab.dataset.widgetTab;
    const cfg = widgetConfig();
    let tabs = [...cfg.tabs];
    if (tabs.includes(id)) {
      if (tabs.length <= 1) return toast("Нужна хотя бы одна закладка");
      tabs = tabs.filter(t => t !== id);
    } else {
      if (tabs.length >= 4) return toast("Максимум 4 закладки на виджете");
      tabs.push(id);
    }
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    try {
      await saveWidgetConfig({ tabs });
      renderSettings();
    } catch (err) { toast(err.message); }
    return;
  }

  const widgetSideOpen = event.target.closest("[data-widget-side-open]");
  if (widgetSideOpen) {
    event.preventDefault();
    event.stopPropagation();
    state.widgetSidePicker = widgetSideOpen.dataset.widgetSideOpen;
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    renderSettings();
    requestAnimationFrame(() => viewEl.querySelector(".widget-picker-sheet")?.classList.add("on"));
    return;
  }

  const widgetPick = event.target.closest("[data-widget-pick]");
  if (widgetPick && state.widgetSidePicker) {
    event.preventDefault();
    event.stopPropagation();
    const side = state.widgetSidePicker;
    const id = widgetPick.dataset.widgetPick;
    state.widgetSidePicker = null;
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    try {
      await saveWidgetConfig(side === "left" ? { leftBtn: id } : { rightBtn: id });
      patchWidgetSideRows();
      renderSettings();
    } catch (err) { toast(err.message); }
    return;
  }

  if (event.target.closest("#widget-picker-close") || event.target.id === "widget-picker-backdrop") {
    event.preventDefault();
    event.stopPropagation();
    state.widgetSidePicker = null;
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    renderSettings();
    return;
  }

  const shelfUp = event.target.closest("[data-shelf-up]");
  if (shelfUp) {
    event.preventDefault();
    event.stopPropagation();
    const ids = manageShelfIds();
    const id = shelfUp.dataset.shelfUp;
    const idx = ids.indexOf(id);
    if (idx > 0) {
      [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
      if (!state.user.settings) state.user.settings = {};
      state.user.settings.shelfOrder = ids;
      state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
      renderSettings();
    }
    return;
  }

  const shelfDown = event.target.closest("[data-shelf-down]");
  if (shelfDown) {
    event.preventDefault();
    event.stopPropagation();
    const ids = manageShelfIds();
    const id = shelfDown.dataset.shelfDown;
    const idx = ids.indexOf(id);
    if (idx >= 0 && idx < ids.length - 1) {
      [ids[idx + 1], ids[idx]] = [ids[idx], ids[idx + 1]];
      if (!state.user.settings) state.user.settings = {};
      state.user.settings.shelfOrder = ids;
      state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
      renderSettings();
    }
    return;
  }

  if (state.shelfReorder && event.target.closest("#shelf-order-done")) {
    return saveShelfOrderAndExit();
  }

  const shelfVis = event.target.closest("[data-shelf-vis]");
  if (shelfVis) {
    event.preventDefault();
    event.stopPropagation();
    const id = shelfVis.dataset.shelfVis;
    if (id === "today") return;
    const hidden = new Set(state.user.settings?.hiddenShelves || []);
    const turningOff = !hidden.has(id);
    if (turningOff) hidden.add(id);
    else hidden.delete(id);
    try {
      if (id === "alarms" && turningOff) {
        const alarms = state.items.filter(i => !i.cancelled && (i.type === "alarm" || i.shelf === "alarms"));
        for (const a of alarms) {
          if (a.enabled !== false) {
            absorb(await api(`/items/${a.id}`, { method: "PATCH", body: { enabled: false } }));
          }
        }
      }
      return saveSettings({ hiddenShelves: [...hidden] }, { keepScroll: true });
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  if (event.target.closest("#alarm-add")) {
    state.alarmEditId = null;
    state.alarmDraft = {
      id: null,
      time: { hour: 7, minute: 0 },
      title: "Будильник",
      repeat: { kind: "daily" },
      vibrate: true,
      melody: "default",
      enabled: true,
    };
    state.shelf = "alarms";
    return renderAlarmsShelf(state.screen === "daily");
  }

  const alarmToggle = event.target.closest("[data-alarm-toggle]");
  if (alarmToggle) {
    event.preventDefault();
    event.stopPropagation();
    const id = alarmToggle.dataset.alarmToggle;
    const item = shelfItems("alarms").find(i => i.id === id) || state.items.find(i => i.id === id);
    if (blockDemoMutation(item)) return;
    if (!item) return;
    try {
      absorb(await api(`/items/${id}`, { method: "PATCH", body: { enabled: item.enabled === false } }));
      state.shelf = "alarms";
      renderAlarmsShelf(state.screen === "daily");
    } catch (err) { toast(err.message); }
    return;
  }

  const alarmOpen = event.target.closest("[data-alarm-open]");
  if (alarmOpen) {
    const id = alarmOpen.dataset.alarmOpen;
    const item = shelfItems("alarms").find(i => i.id === id) || state.items.find(i => i.id === id);
    if (blockDemoMutation(item)) return;
    if (!item) return;
    state.alarmEditId = id;
    state.alarmDraft = {
      id,
      time: { ...(item.time || { hour: 7, minute: 0 }) },
      title: item.title || "Будильник",
      repeat: item.repeat || { kind: "daily" },
      vibrate: item.vibrate !== false,
      melody: item.melody || "default",
      enabled: item.enabled !== false,
    };
    state.shelf = "alarms";
    return renderAlarmsShelf(state.screen === "daily");
  }

  if (event.target.closest("#alarm-to-settings")) {
    const desc = document.getElementById("alarm-desc");
    if (desc && state.alarmDraft) state.alarmDraft.title = desc.value.trim() || "Будильник";
    state.alarmRepeatPanel = false;
    state.alarmDaysPanel = false;
    return go("alarm-settings");
  }

  if (event.target.closest("#alarm-done")) {
    try {
      await flushAutoSave("alarm");
      if (state.alarmDraft && !state.alarmDraft.id) await saveAlarmDraft({ silent: true });
      state.alarmDraft = null;
      state.alarmEditId = null;
      state.shelf = "alarms";
      renderAlarmsShelf(state.screen === "daily");
    } catch (err) { toast(err.message); }
    return;
  }

  if (event.target.closest("#alarm-overlay") && !event.target.closest(".alarm-modal")) {
    flushAutoSave("alarm")
      .then(() => (state.alarmDraft && !state.alarmDraft.id ? saveAlarmDraft({ silent: true }) : null))
      .catch(err => toast(err.message))
      .finally(() => {
        state.alarmDraft = null;
        state.alarmEditId = null;
        renderAlarmsShelf(state.screen === "daily");
      });
    return;
  }

  if (event.target.closest("#alarm-melody")) {
    const desc = document.getElementById("alarm-desc");
    if (desc && state.alarmDraft) state.alarmDraft.title = desc.value.trim() || "Будильник";
    return go("sounds");
  }

  const soundPlay = event.target.closest("[data-sound-play]");
  if (soundPlay) return previewSound(soundPlay.dataset.soundPlay);

  const soundPick = event.target.closest("[data-sound-pick]");
  if (soundPick) {
    const id = soundPick.dataset.soundPick;
    const key = soundPick.dataset.soundKind === "alarm" ? "alarmSound" : "notifySound";
    if (state.user.settings?.[key] === id) return previewSound(id);
    // Показываем выбор сразу, не дожидаясь сервера: звук уже играет, отметка не должна отставать.
    if (state.user.settings) state.user.settings[key] = id;
    previewSound(id);
    saveSettings({ [key]: id }, { render: false }).then(() => {
      if (state.screen === "sounds") renderSounds({ keepScroll: true });
      pushSoundsToPhone();
    });
    return;
  }

  if (event.target.closest("#alarm-repeat-open")) {
    const desc = document.getElementById("alarm-desc");
    if (desc && state.alarmDraft) state.alarmDraft.title = desc.value.trim() || "Будильник";
    state.alarmRepeatPanel = !state.alarmRepeatPanel;
    if (!state.alarmRepeatPanel) state.alarmDaysPanel = false;
    return renderAlarmSettings();
  }

  if (event.target.closest("#alarm-repeat-custom") && state.alarmDraft) {
    const desc = document.getElementById("alarm-desc");
    if (desc) state.alarmDraft.title = desc.value.trim() || "Будильник";
    const days = state.alarmDraft.repeat?.kind === "weekly" && state.alarmDraft.repeat.days?.length
      ? [...state.alarmDraft.repeat.days]
      : [1, 2, 3, 4, 5];
    state.alarmDraft.repeat = { kind: "weekly", days };
    state.alarmDaysPanel = true;
    state.alarmRepeatPanel = true;
    scheduleAlarmAutoSave();
    return renderAlarmSettings();
  }

  const alarmDay = event.target.closest("[data-alarm-day]");
  if (alarmDay && state.alarmDraft) {
    const day = Number(alarmDay.dataset.alarmDay);
    let days = state.alarmDraft.repeat?.kind === "weekly" && Array.isArray(state.alarmDraft.repeat.days)
      ? [...state.alarmDraft.repeat.days]
      : [];
    if (days.includes(day)) {
      if (days.length <= 1) return toast("Нужен хотя бы один день");
      days = days.filter(d => d !== day);
    } else {
      days.push(day);
      days.sort((a, b) => a - b);
    }
    state.alarmDraft.repeat = { kind: "weekly", days };
    state.alarmDaysPanel = true;
    scheduleAlarmAutoSave();
    return renderAlarmSettings();
  }

  const alarmRepeat = event.target.closest("[data-alarm-repeat]");
  if (alarmRepeat && state.alarmDraft) {
    const map = {
      daily: { kind: "daily" },
      weekdays: { kind: "weekdays" },
      once: null,
    };
    state.alarmDraft.repeat = map[alarmRepeat.dataset.alarmRepeat] ?? null;
    state.alarmDaysPanel = false;
    scheduleAlarmAutoSave();
    return renderAlarmSettings();
  }

  if (event.target.closest("[data-alarm-vibrate]") && state.alarmDraft) {
    state.alarmDraft.vibrate = state.alarmDraft.vibrate === false;
    scheduleAlarmAutoSave();
    return renderAlarmSettings();
  }

  const prefRemind = event.target.closest("[data-pref-remind]");
  if (prefRemind) {
    const id = state.shelfEditId;
    const prefs = { ...shelfPref(id), remind: Number(prefRemind.dataset.prefRemind) };
    try {
      absorb(await api("/settings", { method: "POST", body: { shelfPrefs: { [id]: prefs } } }));
      state.shelfEditId = id;
      return renderShelfPrefs();
    } catch (err) { toast(err.message); }
    return;
  }

  const prefSnooze = event.target.closest("[data-pref-snooze]");
  if (prefSnooze) {
    const id = state.shelfEditId;
    const prefs = { ...shelfPref(id), snooze: Number(prefSnooze.dataset.prefSnooze) };
    try {
      absorb(await api("/settings", { method: "POST", body: { shelfPrefs: { [id]: prefs } } }));
      state.shelfEditId = id;
      return renderShelfPrefs();
    } catch (err) { toast(err.message); }
    return;
  }

  const prefToggle = event.target.closest("[data-pref-toggle]");
  if (prefToggle) {
    const id = state.shelfEditId;
    const key = prefToggle.dataset.prefToggle;
    const prefs = { ...shelfPref(id), [key]: !shelfPref(id)[key] };
    try {
      absorb(await api("/settings", { method: "POST", body: { shelfPrefs: { [id]: prefs } } }));
      state.shelfEditId = id;
      return renderShelfPrefs();
    } catch (err) { toast(err.message); }
    return;
  }

  if (event.target.closest("#add-shelf")) {
    state.shelfDraft = { id: null, label: "", keywordsText: "" };
    return go("shelf-edit");
  }

  const editShelf = event.target.closest("[data-edit-shelf]");
  if (editShelf) {
    const sh = customShelves().find(s => s.id === editShelf.dataset.editShelf);
    if (!sh) return;
    state.shelfDraft = {
      id: sh.id,
      label: sh.label || "",
      keywordsText: (sh.keywords || []).join(", "),
    };
    return go("shelf-edit");
  }

  if (event.target.closest("#shelf-delete")) {
    const id = state.shelfDraft?.id;
    if (!id) return;
    if (!confirm("Удалить полку? Записи останутся — уйдут на обычные полки.")) return;
    const next = customShelves().filter(s => s.id !== id);
    try {
      absorb(await api("/settings", { method: "POST", body: { customShelves: next } }));
      toast(v("Удалила", "Удалил"));
      return go("settings");
    } catch (err) {
      return toast(err.message);
    }
  }

  const goEl = event.target.closest("[data-go]");
  if (goEl) {
    if (state.screen === "alarm-settings" && state.alarmDraft) {
      const desc = document.getElementById("alarm-desc");
      if (desc) state.alarmDraft.title = desc.value.trim() || "Будильник";
    }
    stopRecognition();
    const params = { shelf: goEl.dataset.shelf };
    return go(goEl.dataset.go, params);
  }

  const dailyTab = event.target.closest("[data-daily-tab]");
  if (dailyTab) {
    clearTabPing(dailyTab.dataset.dailyTab);
    state.shelf = dailyTab.dataset.dailyTab;
    if (state.screen !== "daily") return go("daily", { shelf: state.shelf });
    return renderDaily();
  }

  if (event.target.closest("#cal-jump-today-b")) {
    jumpCalendarToToday();
    return;
  }

  const calDay = event.target.closest("[data-cal-d]");
  if (calDay && calDay.closest(".cal-drum-item")) {
    saveCalendarDay({
      year: Number(calDay.dataset.calY),
      month: Number(calDay.dataset.calM),
      day: Number(calDay.dataset.calD),
    });
    const drum = document.getElementById("cal-drum");
    if (drum) {
      drum.dataset.mounted = "";
      mountCalendarStrip();
    }
    return refreshCalendarDayCards();
  }

  if (calDay) {
    saveCalendarDay({
      year: Number(calDay.dataset.calY),
      month: Number(calDay.dataset.calM),
      day: Number(calDay.dataset.calD),
    });
    return renderCalendarMain();
  }

  const tab = event.target.closest("[data-shelf-tab]");
  if (tab) {
    const id = tab.dataset.shelfTab;
    if (id === "chat") return go("shelves", { shelf: defaultShelf() });
    clearTabPing(id);
    state.shelf = id;
    if (state.screen !== "shelves") return go("shelves", { shelf: id });
    return renderShelves();
  }

  if (event.target.closest("#archive-clear")) {
    if (!shelfItems("archive").length) return;
    if (!confirm("Удалить весь архив навсегда?")) return;
    try {
      absorb(await api("/archive/clear", { method: "POST" }));
      toast("Архив пустой. Как новенький");
      state.shelf = defaultShelf();
      return renderShelves();
    } catch (err) { return toast(err.message); }
  }

  if (event.target.closest("#shelf-add")) {
    if (blockShelfFabMutation()) return;
    if (state.screen === "lists" && state.listId) {
      state.listManualOpen = true;
      return renderLists();
    }
    if (state.screen === "daily" && state.shelf === "alarms") {
      state.alarmEditId = null;
      state.alarmDraft = {
        id: null,
        time: { hour: 7, minute: 0 },
        title: "Будильник",
        repeat: { kind: "daily" },
        vibrate: true,
        melody: "default",
        enabled: true,
      };
      return renderAlarmsShelf(true);
    }
    // Главный экран = календарь заметок; ежедневные полки — свой +.
    if (state.screen === "shelves") {
      ensureCalendarDay();
      try {
        const id = await addManualCalendarNote(state.calendarDay || todayParts());
        if (!id) return toast("Не удалось добавить");
        return go("detail", { itemId: id });
      } catch (err) {
        return toast(err.message);
      }
    }
    if (state.screen !== "daily") return;
    const shelfId = state.shelf;
    if (shelfId === "care") {
      state.prompt = {
        title: "Куда добавить шаг?",
        chips: [
          { action: "care-add-morning", label: "Утро" },
          { action: "care-add-evening", label: "Вечер" },
        ],
      };
      return renderCareShelf(state.screen === "daily");
    }
    if (shelfId === "health") {
      state.prompt = {
        title: "Куда добавить витамин?",
        chips: [
          { action: "health-add-morning", label: "Утро" },
          { action: "health-add-midday", label: "День" },
          { action: "health-add-evening", label: "Вечер" },
        ],
      };
      return renderHealthShelf();
    }
    if (!["sport", "bday", "meters", "bills"].includes(shelfId)) return;
    try {
      const id = await addManualShelfItem(shelfId);
      if (!id) return toast("Не удалось добавить");
      state.shelf = shelfId;
      return go("detail", { itemId: id });
    } catch (err) {
      return toast(err.message);
    }
  }

  const careTimeBtn = event.target.closest("[data-care-time]");
  if (careTimeBtn) {
    if (blockDemoMutation("care")) return;
    const part = careTimeBtn.dataset.careTime;
    const time = careColumnTime(shelfItems("care"), part);
    state.careTimeDraft = {
      carePart: part,
      time: { hour: time.hour, minute: time.minute || 0 },
    };
    return renderCareShelf();
  }

  if (event.target.closest("#care-time-cancel")) {
    state.careTimeDraft = null;
    return renderCareShelf();
  }

  if (event.target.closest("#care-time-done")) {
    if (blockDemoMutation("care")) return;
    const draft = state.careTimeDraft;
    if (!draft) return;
    try {
      absorb(await api("/care/time", {
        method: "POST",
        body: { carePart: draft.carePart, time: draft.time },
      }));
      state.careTimeDraft = null;
      toast(`Время · ${fmtClock(draft.time)}`);
      return renderCareShelf(state.screen === "daily");
    } catch (err) {
      return toast(err.message);
    }
  }

  const healthTimeBtn = event.target.closest("[data-health-time]");
  if (healthTimeBtn) {
    if (blockDemoMutation("health")) return;
    const part = healthTimeBtn.dataset.healthTime;
    const time = healthColumnTime(shelfItems("health"), part);
    state.healthTimeDraft = {
      healthPart: part,
      time: { hour: time.hour, minute: time.minute || 0 },
    };
    return renderHealthShelf();
  }

  if (event.target.closest("#health-time-cancel")) {
    state.healthTimeDraft = null;
    return renderHealthShelf();
  }

  if (event.target.closest("#health-time-done")) {
    if (blockDemoMutation("health")) return;
    const draft = state.healthTimeDraft;
    if (!draft) return;
    try {
      absorb(await api("/health/time", {
        method: "POST",
        body: { healthPart: draft.healthPart, time: draft.time },
      }));
      state.healthTimeDraft = null;
      toast(`Время · ${fmtClock(draft.time)}`);
      return renderHealthShelf();
    } catch (err) {
      return toast(err.message);
    }
  }

  const healthShelfDay = event.target.closest("[data-health-shelf-day]");
  if (healthShelfDay) {
    event.preventDefault();
    event.stopPropagation();
    const day = Number(healthShelfDay.dataset.healthShelfDay);
    if (!Number.isFinite(day) || day < 0 || day > 6) return;
    const on = !healthShelfDayOn(day);
    try {
      await setHealthShelfDay(day, on);
      toast(on ? `${HEALTH_DAY_LABELS[day]} · включено` : `${HEALTH_DAY_LABELS[day]} · выключено`);
      if (state.screen === "shelves" && state.shelf === "health") renderHealthShelf();
    } catch (err) {
      toast(err.message || "Не удалось сохранить");
    }
    return;
  }

  const careEdit = event.target.closest("[data-care-edit]");
  if (careEdit) {
    const id = careEdit.dataset.careEdit;
    const item = shelfItems("care").find(i => i.id === id) || state.items.find(i => i.id === id);
    if (blockDemoMutation(item)) return;
    if (!item) return;
    state.shelf = "care";
    return go("detail", { itemId: id });
  }

  const healthEdit = event.target.closest("[data-health-edit]");
  if (healthEdit) {
    const id = healthEdit.dataset.healthEdit;
    const item = shelfItems("health").find(i => i.id === id) || state.items.find(i => i.id === id);
    if (blockDemoMutation(item)) return;
    if (!item) return;
    state.shelf = "health";
    return go("detail", { itemId: id });
  }

  const healthDayToggle = event.target.closest("[data-health-day-toggle]");
  if (healthDayToggle) return;

  const tick = event.target.closest("[data-done]");
  if (tick) {
    const item = state.items.find(i => i.id === tick.dataset.done);
    try {
      const data = await api(`/items/${tick.dataset.done}/done`, { method: "POST", body: { done: !item?.done } });
      absorb(data);
      toast(data.message || "Готово");
      render();
    } catch (err) { toast(err.message); }
    return;
  }

  const setTimeBtn = event.target.closest("[data-set-time]");
  if (setTimeBtn) {
    const item = state.items.find(i => i.id === setTimeBtn.dataset.setTime);
    if (!item) return;
    const now = new Date();
    state.noteTimeDraft = {
      id: item.id,
      time: {
        hour: item.time?.hour ?? now.getHours(),
        minute: item.time?.minute ?? 0,
      },
    };
    return render();
  }

  if (event.target.closest("#note-time-cancel") || event.target.id === "note-time-overlay") {
    state.noteTimeDraft = null;
    return render();
  }

  if (event.target.closest("#note-time-done")) {
    const draft = state.noteTimeDraft;
    if (!draft?.id) {
      state.noteTimeDraft = null;
      return render();
    }
    try {
      const data = await api(`/items/${draft.id}`, {
        method: "PATCH",
        body: { time: { hour: draft.time.hour, minute: draft.time.minute } },
      });
      absorb(data);
      state.noteTimeDraft = null;
      toast(`${v("Время поставила", "Время поставил")} · ${fmtTime(data.item)}`);
      render();
    } catch (err) { toast(err.message); }
    return;
  }

  const quick = event.target.closest("[data-quick-time]");
  if (quick) {
    try {
      const data = await api(`/items/${quick.dataset.id}`, {
        method: "PATCH",
        body: { time: { hour: Number(quick.dataset.quickTime), minute: 0 } },
      });
      absorb(data);
      toast(`${v("Время поставила", "Время поставил")} · ${fmtTime(data.item)}`);
      render();
    } catch (err) { toast(err.message); }
    return;
  }

  const shelfSet = event.target.closest("[data-shelf-set]");
  if (shelfSet) {
    const item = currentItem();
    if (!item) return;
    try {
      absorb(await api(`/items/${item.id}`, { method: "PATCH", body: { shelf: shelfSet.dataset.shelfSet } }));
      renderDetail();
    } catch (err) { toast(err.message); }
    return;
  }

  const openCare = event.target.closest("[data-open-care]");
  if (openCare) {
    return go("daily", { shelf: "care" });
  }

  const openHealth = event.target.closest("[data-open-health]");
  if (openHealth) {
    return go("daily", { shelf: "health" });
  }

  const open = event.target.closest("[data-open]");
  if (open) {
    const id = open.dataset.open;
    const item = state.items.find(i => i.id === id)
      || shelfItems(state.shelf).find(i => i.id === id);
    if (blockDemoMutation(item)) return;
    return go("detail", { itemId: id });
  }

  const pick = event.target.closest("[data-pick]");
  if (pick) {
    state.picker = state.picker === pick.dataset.pick ? null : pick.dataset.pick;
    return renderDetail();
  }

  const detailAdd = event.target.closest("[data-detail-add]");
  if (detailAdd) {
    const key = detailAdd.dataset.detailAdd;
    if (state.detailShow && key in state.detailShow) {
      state.detailShow[key] = true;
      return renderDetail();
    }
  }

  const chip = event.target.closest("[data-chip]");
  if (chip) return handleChip(chip.dataset.chip, chip.dataset.id);

  const toggle = event.target.closest("[data-toggle]");
  if (toggle) {
    const key = toggle.dataset.toggle;
    return saveSettings({ [key]: !state.user.settings?.[key] }, { keepScroll: true });
  }

  const rm = event.target.closest("[data-remind-meeting]");
  if (rm) return saveSettings({ remindMeeting: Number(rm.dataset.remindMeeting) }, { keepScroll: true });

  const rt = event.target.closest("[data-remind-task]");
  if (rt) return saveSettings({ remindTask: Number(rt.dataset.remindTask) }, { keepScroll: true });

  if (event.target.closest("#push-enable")) return setupPush(true);

  if (event.target.closest("#onb-push")) {
    await setupPush(true);
    return renderOnboarding();
  }

  if (event.target.closest("#onb-done")) {
    store.onboarded = true;
    return go("shelves", { shelf: defaultShelf() });
  }

  if (event.target.closest("#copy-code") || event.target.closest("#copy-code *")) {
    // Плашка ID целиком копирует.
    try {
      await navigator.clipboard.writeText(state.user.code);
      toast(v("Скопировала. Можно вставлять", "Скопировал. Можно вставлять"));
    } catch {
      toast(`Ваш ID: ${state.user.code}`);
    }
    return;
  }

  if (event.target.closest("#share-transfer-key") || event.target.closest("#share-key")) {
    event.stopPropagation();
    return shareTransferKey();
  }

  // Раньше копирования: значок вопроса лежит внутри той же плитки,
  // и обработчик копирования перехватил бы нажатие.
  if (event.target.closest("#key-help")) {
    showKeyHelp();
    return;
  }

  if (event.target.closest("#copy-key")) {
    event.stopPropagation();
    const key = state.user.transferKey || "";
    try {
      await navigator.clipboard.writeText(key);
      store.keySaved = true;
      toast("Ключ скопирован — сохраните его у себя");
      if (state.screen === "start") renderOnboarding();
    } catch {
      toast(`Ключ: ${key}`);
    }
    return;
  }

  if (event.target.closest("#key-tile")) {
    state.showKey = !state.showKey;
    state.settingsScroll = viewEl.querySelector(".scroll")?.scrollTop || 0;
    return renderSettings();
  }

  if (event.target.closest("#show-key")) {
    state.showKey = !state.showKey;
    return renderSettings();
  }

  if (event.target.closest("#copy-key-btn") || event.target.closest("#copy-key-legacy")) {
    const key = state.user.transferKey || "";
    try {
      await navigator.clipboard.writeText(key);
      store.keySaved = true;
      toast("Ключ скопирован — сохраните его у себя");
      if (state.screen === "start") renderOnboarding();
      else render();
    } catch {
      toast(`Ключ: ${key}`);
    }
    return;
  }

  if (event.target.closest("#wipe-account")) {
    const sure = confirm("Удалить аккаунт и все записи? Вернуть их будет нельзя даже по ключу переноса.");
    if (!sure) return;
    try {
      await api("/account", { method: "DELETE" });
    } catch (err) {
      return toast(err.message);
    }
    return finishAccountDeletion();
  }

  if (event.target.closest("#detail-done")) {
    const item = currentItem();
    if (!item) return;
    try {
      const data = await api(`/items/${item.id}/done`, { method: "POST", body: { done: !item.done } });
      absorb(data);
      toast(data.message || (item.done ? v("Вернула в работу", "Вернул в работу") : "Готово"));
      go("shelves");
    } catch (err) { toast(err.message); }
    return;
  }

  if (event.target.closest("#detail-alarm")) {
    const item = currentItem();
    if (!item) return;
    try {
      absorb(await api(`/items/${item.id}`, { method: "PATCH", body: { alarm: !item.alarm } }));
      toast(!item.alarm ? "Будильник включён" : "Будильник выключен");
      renderDetail();
    } catch (err) { toast(err.message); }
    return;
  }

  if (event.target.closest("#detail-cancel")) {
    const item = currentItem();
    if (!item) return;
    try {
      absorb(await api(`/items/${item.id}/cancel`, { method: "POST" }));
      removeChatForItem(item.id);
      toast(v("Отменила", "Отменил"));
      go(state.chat.length ? "chat" : "shelves");
    } catch (err) { toast(err.message); }
    return;
  }
});

async function handleChip(action, id) {
  const afterPrompt = () => {
    state.prompt = null;
    softRender();
  };
  if (action === "care-add-morning" || action === "care-add-evening") {
    state.prompt = null;
    try {
      const part = action === "care-add-evening" ? "evening" : "morning";
      const newId = await addManualShelfItem("care", { carePart: part });
      if (!newId) return toast("Не удалось добавить");
      state.shelf = "care";
      return go("detail", { itemId: newId });
    } catch (err) {
      return toast(err.message);
    }
  }
  if (action === "health-add-morning" || action === "health-add-midday" || action === "health-add-evening") {
    state.prompt = null;
    try {
      const part = action === "health-add-evening"
        ? "evening"
        : action === "health-add-midday"
          ? "midday"
          : "morning";
      const newId = await addManualShelfItem("health", { healthPart: part });
      if (!newId) return toast("Не удалось добавить");
      state.shelf = "health";
      return go("detail", { itemId: newId });
    } catch (err) {
      return toast(err.message);
    }
  }
  if (action.startsWith("time-")) {
    const hour = Number(action.slice(5));
    try {
      const data = await api(`/items/${id}`, { method: "PATCH", body: { time: { hour, minute: 0 } } });
      absorb(data);
      const item = data.item || state.items.find(i => i.id === id);
      if (item) toast(`${v("Время поставила", "Время поставил")} · ${fmtTime(item)}`);
      afterPrompt();
    } catch (err) { toast(err.message); }
    return;
  }
  if (action === "edit") return go("detail", { itemId: id });
  if (action === "alarm") {
    try {
      const item = state.items.find(i => i.id === id);
      const data = await api(`/items/${id}`, { method: "PATCH", body: { alarm: !item?.alarm } });
      absorb(data);
      toast("Будильник переключён");
      afterPrompt();
    } catch (err) { toast(err.message); }
    return;
  }
  if (action === "cancel" || action === "pick-cancel") {
    try {
      absorb(await api(`/items/${id}/cancel`, { method: "POST" }));
      removeChatForItem(id);
      toast("Уведомления сняты");
      afterPrompt();
    } catch (err) { toast(err.message); }
    return;
  }
  if (action === "confirm-yes") {
    state.prompt = null;
    capture("да", "text");
    return;
  }
  if (action === "confirm-no") {
    state.prompt = null;
    capture("нет", "text");
    return;
  }
  if (action === "pick-shared") {
    state.prompt = null;
    capture(lastCaptureText || "", "voice", { sharedList: true, pairId: id, captureMode: "shared", keepCloud: true });
    return;
  }
  if (action === "pick-move") {
    const pending = state.pendingMove || {};
    try {
      const data = await api(`/items/${id}`, {
        method: "PATCH",
        body: { ...(pending.date ? { date: pending.date } : {}), ...(pending.time ? { time: pending.time } : {}) },
      });
      absorb(data);
      const item = data.item;
      toast(item ? `${v("Перенесла", "Перенёс")}: ${item.title}` : v("Перенесла", "Перенёс"));
      afterPrompt();
    } catch (err) { toast(err.message); }
  }
}

window.addEventListener("online", () => {
  state.online = true;
  flushQueue();
  softRender();
});
window.addEventListener("offline", () => {
  state.online = false;
  softRender();
});

async function refreshLists() {
  if (!state.user || formsEditing()) return;
  try {
    const data = await api("/lists");
    absorbSharedLists(data);
    if (state.screen === "lists" && !formsEditing()) renderLists();
  } catch {
    // офлайн или сеть — подождём следующего опроса
  }
}

let listPollTimer = null;
let listPollMode = null;

function listPollModeNow() {
  if (state.screen !== "lists" || document.visibilityState !== "visible" || !state.user) return null;
  return state.listId ? "detail" : "overview";
}

function stopListPoll() {
  if (listPollTimer) clearInterval(listPollTimer);
  listPollTimer = null;
  listPollMode = null;
}

function syncListPoll() {
  const mode = listPollModeNow();
  if (!mode) {
    stopListPoll();
    return;
  }
  if (listPollTimer && listPollMode === mode) return;
  stopListPoll();
  listPollMode = mode;
  refreshLists();
  const ms = mode === "detail" ? 2500 : 5000;
  listPollTimer = setInterval(() => {
    if (formsEditing()) return;
    refreshLists();
  }, ms);
}

document.addEventListener("focusin", event => {
  if (!isFormField(event.target)) return;
  if (state.screen === "lists") stopListPoll();
});

document.addEventListener("focusout", event => {
  if (!isFormField(event.target)) return;
  requestAnimationFrame(() => {
    if (formsEditing()) return;
    flushDeferredRender();
    if (state.screen === "lists") {
      syncListPoll();
      refreshLists();
    }
  });
});

function refreshState() {
  if (!state.user) return Promise.resolve();
  if (consentPending()) return Promise.resolve();
  return api(`/state?tz=${encodeURIComponent(tz())}`)
    .then(data => {
      absorb(data);
      if (!formsEditing()) {
        softRender();
        syncListPoll();
      } else {
        deferRender();
      }
    })
    .catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flushAllAutoSaves();
  if (document.visibilityState === "visible") {
    if (!consentPending()) refreshState();
    if (!formsEditing()) syncListPoll();
  } else {
    stopListPoll();
  }
});

// Раз в минуту обновляем полки: только что прошедшее время должно стать зачёркнутым само.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (formsEditing()) return;
  if (consentPending()) return;
  // На «Наборах» времени нет, а перерисовка сбросила бы выбор глазами — их не трогаем.
  if (state.screen === "shelves") renderShelves();
  else if (state.screen === "daily") renderDaily();
  else if (state.screen === "lists") refreshState();
  pushWidget();
  // В браузере ответ поддержки приносит пуш, в приложении для телефона его нет — спрашиваем сами.
  if (NATIVE && state.user) pollSupport();
}, 60000);

// Нажали «Сделано» или «+1 час» прямо в уведомлении — подтягиваем свежее состояние.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.type === "state-changed") refreshState();
    if (event.data?.type === "push") showLiveNotice(event.data.payload);
  });
}

// Установленное приложение открывают ссылкой с QR: адрес перехода приходит отдельно от старта.
function listenForLaunch() {}

function mountBillingReturnHooks(billingReturn) {
  if (billingReturn || state.billingPendingId) {
    checkBillingPayment(state.billingPendingId, { silent: !billingReturn });
    if (state.billingPendingId) startBillingPoll(state.billingPendingId);
  }
  if (!document._vcBillingVisHook) {
    document._vcBillingVisHook = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.billingPendingId) {
        checkBillingPayment(state.billingPendingId, { silent: true });
      }
    });
  }
}

function applyBootRoute(params) {
  const pairId = params.get("pair");
  if (pairId) {
    state.listId = pairId;
    state.screen = "lists";
    return;
  }
  const inviteCode = String(params.get("join") || params.get("id") || "").trim().toUpperCase();
  if (inviteCode.length >= 4) {
    state.listJoinDraft = inviteCode;
    state.screen = "lists";
    return;
  }
  const goTo = params.get("go");
  if (goTo === "record") {
    state.screen = "shelves";
    state.shelf = defaultShelf();
    setTimeout(() => startChatVoice({ mode: "auto" }), 0);
  } else if (goTo === "chat") { state.screen = "shelves"; state.shelf = defaultShelf(); }
  else if (goTo === "review" || goTo === "incoming" || goTo === "today") { state.screen = "shelves"; state.shelf = defaultShelf(); }
  else if (goTo === "archive") { state.screen = "shelves"; state.shelf = "archive"; }
  else if (goTo === "lists") state.screen = "lists";
  else if (goTo === "support") state.screen = "support";
  else if (params.get("item")) {
    // Старые ссылки из уведомлений тоже ведут на полку, а не в редактирование.
    openFromNotification(params.get("item"));
  } else {
    state.screen = "shelves";
    state.shelf = defaultShelf();
  }
}

async function loadAppState(params, { billingReturn = false } = {}) {
  absorb(await api(`/state?tz=${encodeURIComponent(tz())}`));
  idbToken(store.token);
  applyBootRoute(params);
  render();
  flushQueue();
  attachDevice();
  mountBillingReturnHooks(billingReturn);
  requestStartupPermissions();
  refreshPermissionsState().then(({ changed }) => {
    if (changed) applyPermissionsUiRefresh();
  });
  if (state.listJoinDraft && state.screen === "lists" && state.user) {
    state.listInviteDraft = { code: state.listJoinDraft, step: "nickname" };
    state.listJoinDraft = "";
  }
}

/**
 * Подписка появляется без перезапуска приложения.
 *
 * Человек уходит платить — в браузер, в магазин, или ему дарят подписку с
 * чужого телефона. Возвращается, а приложение всё ещё считает его бесплатным
 * и просит купить то, что уже оплачено.
 *
 * Поэтому при возврате на передний план обновляем состояние. Не чаще раза
 * в десять секунд: человек переключается между приложениями часто, и дёргать
 * сервер на каждый взгляд не нужно.
 */
let lastForegroundSync = 0;

function watchForeground() {
  const syncBilling = () => {
    if (document.visibilityState !== "visible") return;
    if (!store.token) return;
    if (state.user && !consentAccepted()) return;
    const now = Date.now();
    if (now - lastForegroundSync < 10000) return;
    lastForegroundSync = now;
    const wasPro = Boolean(state.billing?.active);
    refreshState().then(() => {
      if (Boolean(state.billing?.active) !== wasPro) render();
    }).catch(() => {});
  };
  const syncPermissionsOnResume = () => {
    if (document.visibilityState !== "visible") return;
    if (!store.token) return;
    if (state.user && !consentAccepted()) return;
    refreshPermissionsState().then(({ changed }) => {
      if (changed) applyPermissionsUiRefresh();
    }).catch(() => {});
  };
  const onResume = () => {
    syncBilling();
    syncPermissionsOnResume();
  };
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("focus", onResume);
}

async function boot() {
  watchForeground();
  ensureServiceWorker();
  await resolveApiBase();
  await loadApkVersion();
  if (NATIVE?.syncApiBase) await NATIVE.syncApiBase();
  const params = new URLSearchParams(location.search);
  const billingReturn = params.get("billing") === "return";
  if (location.search) history.replaceState({}, "", "/");
  listenForLaunch();
  state.billingPendingId = loadBillingPendingId();

  // После обновления APK localStorage иногда пуст, а токен ещё в Capacitor Preferences —
  // подтягиваем до любого /start, иначе создаётся пустой аккаунт и виджет обнуляется.
  if (!store.token && NATIVE?.ensureToken) {
    try { await NATIVE.ensureToken(); } catch { /* ignore */ }
  }

  // Аккаунт заводится молча при первом запуске. Экран «Скажите, что напомнить» —
  // только для ключа переноса, не для обычного входа.
  if (!store.token) {
    try {
      await ensureAuthToken();
    } catch (err) {
      return renderBootError(err);
    }
  }
  try {
    await loadAppState(params, { billingReturn });
  } catch (err) {
    // Просроченный токен после обновления — пробуем Preferences или /start.
    // Если токен мёртвый (удалили аккаунт) — не заводим пустой аккаунт, даём ключ переноса.
    if (store.token && err.message === "Нужен вход") {
      const badToken = store.token;
      store.token = "";
      state.user = null;
      state.items = [];
      state.incoming = [];
      state.contacts = [];
      try { await NATIVE?.clearSession?.(); } catch { /* ignore */ }
      try { await NATIVE?.ensureToken?.(); } catch { /* ignore */ }
      if (store.token && store.token === badToken) {
        store.token = "";
        try { await NATIVE?.clearSession?.(); } catch { /* ignore */ }
        state.authFlow = null;
        render();
        requestStartupPermissions();
        return;
      }
      try {
        if (!store.token) await silentStart();
        await loadAppState(params, { billingReturn });
        return;
      } catch (retryErr) {
        if (retryErr.message === "Нужен вход") {
          store.token = "";
          state.user = null;
          try { await NATIVE?.clearSession?.(); } catch { /* ignore */ }
          state.authFlow = null;
          render();
          requestStartupPermissions();
          return;
        }
        return renderBootError(retryErr);
      }
    }
    // Сеть/временный сбой — не выкидывать на экран с микрофоном и не терять сессию.
    if (store.token) {
      state.screen = "shelves";
      state.shelf = defaultShelf();
      render();
      attachDevice();
      toast(err?.message || "Нет связи — записи подтянутся при сети");
      requestStartupPermissions();
      return;
    }
    renderBootError(err);
  }
}

function attachDevice() {
  if (NATIVE) {
    NATIVE.onOpenItem(id => {
      openFromNotification(id);
      render();
    });
    // Кнопки виджета ведут прямо на нужный экран, минуя главный.
    if (NATIVE.onWidgetAction) {
      NATIVE.onWidgetAction(async ({ action, shelf, item }) => {
        if (action === "record") {
          // Виджет: Google-диалог внутри приложения; лица только после in-app hold/voice.
          stopChatVoice(true);
          return startChatVoice({ mode: "auto" });
        }
        stopRecognition();
        if (action === "left" || action === "right" || action === "shelf") {
          if (shelf === "shared") {
            stopRecognition();
            const pairId = state.user?.settings?.sharedListDefault || state.lists[0]?.id || "";
            return startChatVoice({ mode: "auto", sharedList: true, pairId });
          }
          if (shelf === "daily") return go("daily", { shelf: defaultDailyShelf() });
          if (shelf === "shelves") return go("shelves");
          if (DAILY_SHELF_IDS.has(shelf)) return go("daily", { shelf });
          if (shelf && shelf !== "none") return go("shelves", { shelf });
          return go("shelves");
        }
        if (action === "chat") return go("shelves", { shelf: defaultShelf() });
        if (action === "edit" || action === "open") {
          // Сразу карточка редактирования (время, повтор, место…) — не полки.
          if (!state.items?.length) {
            try { absorb(await api("/state")); } catch { /* дальше проверим */ }
          }
          if (item && state.items.some(i => i.id === item)) {
            state.picker = "time";
            return go("detail", { itemId: item });
          }
          return go("shelves", { shelf: defaultShelf() });
        }
        // trash/alarm с виджета обрабатывает нативный слой без открытия UI.
      });
    }
    NATIVE.onChanged(() => {
      refreshState();
      refreshPermissionsState().then(({ changed }) => {
        if (changed) applyPermissionsUiRefresh();
      }).catch(() => {});
    });
    NATIVE.onLiveNotice?.(payload => showLiveNotice(payload));
    // Нажали на ответ поддержки в шторке — открываем переписку, а не главный экран.
    NATIVE.onSupportOpen?.(() => go("support"));
    NATIVE.onJoinCode?.(code => {
      state.listJoinDraft = String(code || "").trim().toUpperCase();
      state.listInviteDraft = { code: state.listJoinDraft, step: "nickname" };
      if (state.user) go("lists");
    });
    return;
  }
  ensureServiceWorker();
  if (notifPermission() === "granted") setupPush(false);
}

boot();
