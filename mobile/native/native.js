/**
 * Мост между веб-частью и телефоном.
 * Здесь всё, что умеет только установленное приложение:
 * микрофон системы, напоминания без интернета, кнопки в шторке, аппаратная «Назад».
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

const WidgetBridge = registerPlugin("WidgetBridge");
const MicBridge = registerPlugin("MicBridge");
const UpdateBridge = registerPlugin("UpdateBridge");
const BatteryOptimizationBridge = registerPlugin("BatteryOptimizationBridge");
const PermissionsBridge = registerPlugin("PermissionsBridge");

const ACTION_TYPE = "VC_ITEM";
const CHANNEL_REMIND = "reminders";
const CHANNEL_ALARM = "alarms";

// Ответ поддержки всегда занимает один и тот же номер: свежий ответ заменяет прежний,
// а не копится в шторке. Номера напоминаний из idFor не поднимаются выше 1,6 млрд,
// 1999999999 занят проверочным уведомлением — этот свободен.
const SUPPORT_ID = 1999999998;

// Android запоминает звук канала навсегда: сменить его у существующего нельзя.
// Поэтому на каждый звук — свой канал, а выбор в настройках просто переключает канал.
// Список обязан совпадать с app/public/sounds-catalog.js.
const ALARM_SOUNDS = [
  "alarm_sunrise", "alarm_radar", "alarm_bells", "alarm_kalimba", "alarm_rise",
  "alarm_forte", "alarm_piacevole", "alarm_placido",
];
const NOTIFY_SOUNDS = [
  "notify_marimba", "notify_glass", "notify_kalimba", "notify_drop", "notify_soft",
  "notify_allegro", "notify_pizzicato", "notify_brio",
];
const SOUND_NAMES = {
  alarm_sunrise: "Рассвет",
  alarm_radar: "Маяк",
  alarm_bells: "Колокола",
  alarm_kalimba: "Калимба",
  alarm_rise: "Подъём",
  alarm_forte: "Vertu Форте",
  alarm_piacevole: "Vertu Пиачеволе",
  alarm_placido: "Vertu Плачидо",
  notify_marimba: "Маримба",
  notify_glass: "Стекло",
  notify_kalimba: "Калимба",
  notify_drop: "Капля",
  notify_soft: "Вполголоса",
  notify_allegro: "Vertu Аллегро",
  notify_pizzicato: "Vertu Пиццикато",
  notify_brio: "Vertu Брио",
};

// Каналы первого набора звуков ссылаются на файлы, которых в приложении больше нет:
// их надо убрать, иначе они висят в системных настройках и молчат при срабатывании.
const RETIRED_CHANNELS = [
  "alarms_alarm_bell", "alarms_alarm_dawn", "alarms_alarm_beacon", "alarms_alarm_drops", "alarms_alarm_urgent",
  "reminders_notify_chime", "reminders_notify_tap", "reminders_notify_bubble", "reminders_notify_chord",
];

let alarmSound = "";
let notifySound = "";

function alarmChannel() {
  return ALARM_SOUNDS.includes(alarmSound) ? `alarms_${alarmSound}` : CHANNEL_ALARM;
}

function remindChannel() {
  return NOTIFY_SOUNDS.includes(notifySound) ? `reminders_${notifySound}` : CHANNEL_REMIND;
}

let permission = "default";
let openItemHandler = null;
let pendingOpenItem = "";
let changedHandler = null;
let joinCodeHandler = null;
let pendingJoinCode = "";
let widgetActionHandler = null;
let pendingWidgetAction = null;
let liveNoticeHandler = null;
let supportOpenHandler = null;
let pendingSupportOpen = false;
let scheduling = null;

function token() {
  return localStorage.getItem("vc.token") || "";
}

async function apiCall(path, body) {
  const value = token();
  if (!value) return null;
  try {
    const res = await fetch(`${window.VC_API_BASE}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${value}` },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Стабильный числовой идентификатор из строкового: телефону нужны числа.
function idFor(itemId, slot) {
  let hash = 2166136261;
  for (let i = 0; i < itemId.length; i += 1) {
    hash ^= itemId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 2) % 400000000) * 4 + slot;
}

function eventDate(item) {
  if (!item.date || !item.time) return null;
  const second = Number.isFinite(item.time.second) ? item.time.second : 0;
  return new Date(
    item.date.year,
    item.date.month,
    item.date.day,
    item.time.hour,
    item.time.minute,
    second,
    0,
  );
}

function whenText(item) {
  if (!item.time) return "без времени";
  return `${String(item.time.hour).padStart(2, "0")}:${String(item.time.minute).padStart(2, "0")}`;
}

function aheadText(minutes) {
  if (!minutes) return "";
  if (minutes >= 1440) return `за ${Math.round(minutes / 1440)} дн`;
  if (minutes >= 60) return `за ${Math.round(minutes / 60)} ч`;
  return `за ${minutes} мин`;
}

function notifyDisplayTitle(item) {
  if (!item) return "SoulVoice";
  if (item.type === "health" || item.shelf === "health") {
    const part = item.healthPart === "midday" || item.healthPart === "evening" || item.healthPart === "morning"
      ? item.healthPart
      : (item.time && item.time.hour >= 17 ? "evening" : item.time && item.time.hour >= 11 ? "midday" : "morning");
    if (part === "evening") return "Вечер Витамины";
    if (part === "midday") return "День Витамины";
    return "Утро Витамины";
  }
  if (item.type === "care" || item.shelf === "care") {
    const part = item.carePart === "evening" || (item.time && item.time.hour >= 15) ? "evening" : "morning";
    return part === "evening" ? "Вечер Косметика" : "Утро Косметика";
  }
  return item.title || "SoulVoice";
}

async function ensureSetup() {
  await LocalNotifications.registerActionTypes({
    types: [{
      id: ACTION_TYPE,
      actions: [
        { id: "snooze", title: "+1 час" },
        { id: "done", title: "Сделано" },
        // Ответ прямо из шторки: «перенеси на час», «готово» или новое дело — без открытия приложения.
        {
          id: "reply",
          title: "Ответить",
          input: true,
          inputButtonTitle: "Отправить",
          inputPlaceholder: "Перенеси на час · готово · купить хлеб",
        },
      ],
    }],
  });

  await LocalNotifications.createChannel({
    id: CHANNEL_REMIND,
    name: "Напоминания",
    description: "Заранее о встречах и делах",
    importance: 4,
    visibility: 1,
    vibration: true,
  }).catch(() => {});

  await LocalNotifications.createChannel({
    id: CHANNEL_ALARM,
    name: "Будильник",
    description: "Громкий сигнал в момент встречи",
    importance: 5,
    visibility: 1,
    vibration: true,
  }).catch(() => {});

  for (const id of NOTIFY_SOUNDS) {
    await LocalNotifications.createChannel({
      id: `reminders_${id}`,
      name: `Напоминания · ${SOUND_NAMES[id]}`,
      description: "Заранее о встречах и делах",
      importance: 4,
      visibility: 1,
      vibration: true,
      sound: `${id}.mp3`,
    }).catch(() => {});
  }

  for (const id of RETIRED_CHANNELS) {
    await LocalNotifications.deleteChannel({ id }).catch(() => {});
  }

  for (const id of ALARM_SOUNDS) {
    await LocalNotifications.createChannel({
      id: `alarms_${id}`,
      name: `Будильник · ${SOUND_NAMES[id]}`,
      description: "Громкий сигнал в момент встречи",
      importance: 5,
      visibility: 1,
      vibration: true,
      sound: `${id}.mp3`,
    }).catch(() => {});
  }
}

// Веб-часть знает выбор человека и передаёт его сюда: дальше уведомления идут в нужный канал.
function setSounds({ alarm, notify } = {}) {
  const nextAlarm = ALARM_SOUNDS.includes(alarm) ? alarm : alarmSound;
  const nextNotify = NOTIFY_SOUNDS.includes(notify) ? notify : notifySound;
  if (nextAlarm === alarmSound && nextNotify === notifySound) return false;
  alarmSound = nextAlarm;
  notifySound = nextNotify;
  Preferences.set({ key: "vc.sounds", value: JSON.stringify({ alarm: alarmSound, notify: notifySound }) }).catch(() => {});
  // Уже поставленные уведомления помнят старый канал — их пересоберёт следующий syncReminders.
  return true;
}

async function restoreSounds() {
  try {
    const saved = await Preferences.get({ key: "vc.sounds" });
    if (!saved?.value) return;
    const parsed = JSON.parse(saved.value);
    if (ALARM_SOUNDS.includes(parsed.alarm)) alarmSound = parsed.alarm;
    if (NOTIFY_SOUNDS.includes(parsed.notify)) notifySound = parsed.notify;
  } catch {
    // Не прочиталось — останутся каналы по умолчанию.
  }
}

async function checkPermission() {
  try {
    const res = await LocalNotifications.checkPermissions();
    permission = res.display === "granted" ? "granted" : res.display === "denied" ? "denied" : "default";
  } catch {
    permission = "default";
  }
  return permission;
}

async function requestNotifications() {
  try {
    const res = await LocalNotifications.requestPermissions();
    permission = res.display === "granted" ? "granted" : "denied";
  } catch {
    permission = "denied";
  }
  if (permission === "granted") {
    try {
      const pushPerm = await PushNotifications.requestPermissions();
      if (pushPerm.receive === "granted") await registerFcmToken();
    } catch {
      // FCM не настроен — локальные уведомления всё равно работают.
    }
  }
  return permission === "granted";
}

// Пересобираем расписание целиком: так оно всегда совпадает с тем, что видно в списках.
async function syncReminders(items, settings) {
  if (permission !== "granted") return undefined;
  if (scheduling) return scheduling;

  const offDays = new Set(
    Array.isArray(settings?.healthDaysOff)
      ? settings.healthDaysOff.map(Number).filter(d => d >= 0 && d <= 6)
      : [],
  );

  scheduling = (async () => {
    try {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications?.length) {
        await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      }

      const now = Date.now();
      const list = [];

      for (const item of items || []) {
        if (item.cancelled || item.done || item.status !== "active" || item.enabled === false) continue;
        const at = eventDate(item);
        if (!at) continue;

        const shelf = item.shelf || item.type;
        const isHealth = shelf === "health" || item.type === "health";
        if (isHealth && offDays.has(at.getDay())) continue;

        const place = item.place ? ` · ${item.place}` : "";
        // Уход / витамины: пуш ровно в время на полке (не «за час»).
        const routineAtEvent = shelf === "health" || shelf === "care"
          || item.type === "health" || item.type === "care";
        const remindMins = routineAtEvent ? 0 : (Number(item.remind) || 0);
        const remindAt = new Date(at.getTime() - remindMins * 60000);

        if (item.push !== false && remindAt.getTime() > now + 1000) {
          const sameMoment = Boolean(item.alarm) && remindMins === 0;
          if (!sameMoment) {
            const ahead = aheadText(remindMins);
            list.push({
              id: idFor(item.id, 0),
              title: notifyDisplayTitle(item),
              body: `${ahead ? `${ahead} · ` : ""}${whenText(item)}${place}`,
              // ISO UTC: Android парсит schedule.at как UTC-строку (не локальный Date-объект).
              schedule: { at: remindAt.toISOString(), allowWhileIdle: true },
              _atMs: remindAt.getTime(),
              actionTypeId: ACTION_TYPE,
              channelId: remindChannel(),
              // Канал решает звук на Android 8+, а на старых прошивках его берут прямо отсюда.
              ...(notifySound ? { sound: `${notifySound}.mp3` } : {}),
              extra: { itemId: item.id },
            });
          }
        }

        if (item.alarm && at.getTime() > now + 1000) {
          list.push({
            id: idFor(item.id, 1),
            title: `Сейчас: ${notifyDisplayTitle(item)}`,
            body: `${whenText(item)}${place}`,
            schedule: { at: at.toISOString(), allowWhileIdle: true },
            _atMs: at.getTime(),
            actionTypeId: ACTION_TYPE,
            channelId: alarmChannel(),
            ...(alarmSound ? { sound: `${alarmSound}.mp3` } : {}),
            extra: { itemId: item.id },
          });
        }
      }

      // Система ограничивает число точных будильников — ставим ближайшие.
      list.sort((a, b) => a._atMs - b._atMs);
      const batch = list.slice(0, 60).map(({ _atMs, ...n }) => n);
      if (batch.length) await LocalNotifications.schedule({ notifications: batch });
    } catch {
      // Расписание пересоберётся при следующем обновлении списка.
    } finally {
      scheduling = null;
    }
  })();

  return scheduling;
}

/**
 * Ответ поддержки показывает система, а не сам экран.
 * WebView не даёт проиграть звук из кода без нажатия человека — беззвучным был бы любой баннер.
 * Канал напоминаний уже несёт выбранный сигнал, поэтому ответ идёт тем же путём, что и они:
 * система звучит сама, а при открытом приложении возвращает уведомление сюда — баннером без звука.
 */
function notifySupport({ title, body, url } = {}) {
  if (permission !== "granted") return false;
  LocalNotifications.schedule({
    notifications: [{
      id: SUPPORT_ID,
      title: title || "Ответ поддержки",
      body: body || "",
      channelId: remindChannel(),
      // Канал решает звук на Android 8+, а на старых прошивках его берут прямо отсюда.
      ...(notifySound ? { sound: `${notifySound}.mp3` } : {}),
      extra: { support: true, url: url || "" },
    }],
  }).catch(() => {});
  return true;
}

// Переписку открыли и прочитали — в шторке уведомлению больше нечего делать.
function clearSupportNotice() {
  LocalNotifications.cancel({ notifications: [{ id: SUPPORT_ID }] }).catch(() => {});
}

async function testNotification() {
  await LocalNotifications.schedule({
    notifications: [{
      id: 1999999999,
      title: "Проверка связи",
      body: "Так будут выглядеть напоминания.",
      schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true },
      channelId: remindChannel(),
      ...(notifySound ? { sound: `${notifySound}.mp3` } : {}),
    }],
  });
}

async function micStatus() {
  try {
    const res = await MicBridge.status();
    return { granted: Boolean(res?.granted), blocked: Boolean(res?.blocked) };
  } catch {
    return { granted: false, blocked: false };
  }
}

/**
 * Системный диалог микрофона. Просим сами, а не через распознавание речи:
 * запись в тренажёре идёт через getUserMedia, и ей нужен выданный RECORD_AUDIO.
 */
async function ensureMicPermission() {
  const current = await micStatus();
  if (current.granted) return current;
  try {
    const res = await MicBridge.request();
    return { granted: Boolean(res?.granted), blocked: Boolean(res?.blocked) };
  } catch {
    // Запасной путь, если плагин почему-то не поднялся.
    try {
      const asked = await SpeechRecognition.requestPermissions();
      return { granted: asked?.speechRecognition === "granted", blocked: false };
    } catch {
      return { granted: false, blocked: false };
    }
  }
}

async function openAppSettings() {
  try {
    await MicBridge.openAppSettings();
    return true;
  } catch {
    return false;
  }
}

async function batteryStatus() {
  try {
    const res = await BatteryOptimizationBridge.status();
    return { ignored: Boolean(res?.ignored) };
  } catch {
    return { ignored: true };
  }
}

async function openBatterySettings() {
  try {
    await BatteryOptimizationBridge.openSettings();
    return true;
  } catch {
    return false;
  }
}

async function openNotificationSettings() {
  try {
    await PermissionsBridge.openNotificationSettings();
    return true;
  } catch {
    return openAppSettings();
  }
}

async function getDeviceManufacturer() {
  try {
    const res = await PermissionsBridge.getManufacturer();
    return String(res?.manufacturer || "");
  } catch {
    return "";
  }
}

async function startWidgetStyleRecord(opts = {}) {
  try {
    await MicBridge.startWidgetStyleRecord({
      sharedList: Boolean(opts.sharedList),
      pairId: String(opts.pairId || ""),
    });
    return true;
  } catch {
    return false;
  }
}

function onSpeechDone(cb) {
  let handle = null;
  MicBridge.addListener("speechDone", data => {
    cb({
      text: String(data?.text || ""),
      message: String(data?.message || ""),
      source: String(data?.source || ""),
      cancelled: Boolean(data?.cancelled),
      replyKind: String(data?.replyKind || ""),
      replyShelf: String(data?.replyShelf || ""),
      replyItems: String(data?.replyItems || ""),
    });
  }).then(h => { handle = h; });
  return () => { handle?.remove(); };
}

/**
 * Правила и политику показываем в системном браузере.
 * Новое окно WebView открыть негде, поэтому просто уводим адрес: Capacitor видит чужой хост
 * и отдаёт его системе, а приложение при этом остаётся на своём экране.
 * Система отдаёт адрес браузеру только потому, что фильтр ссылок в AndroidManifest.xml
 * закреплён за одним «/» — расширите его, и документы снова начнут открывать нас самих.
 */
function openUrl(url) {
  try {
    if (new URL(url).origin === window.location.origin) return false;
  } catch {
    return false;
  }
  window.location.href = url;
  return true;
}

const speech = {
  _session: null,

  /**
   * Тот же Google-диалог, что на виджете: одно нажатие → системное окно → фраза.
   * Не крутим фоновый SpeechRecognizer: он на части телефонов не отпускает микрофон.
   */
  async listenGoogle() {
    try {
      await this.stop();
    } catch {
      // предыдущей сессии могло не быть
    }
    try {
      const res = await MicBridge.listenGoogle();
      return {
        text: String(res?.text || "").trim(),
        cancelled: Boolean(res?.cancelled),
        error: String(res?.error || ""),
      };
    } catch (err) {
      const msg = String(err?.message || err || "");
      return { text: "", cancelled: true, error: msg || "no-recognizer" };
    }
  },

  async start({ onText, onError, onPass }) {
    try {
      const available = await SpeechRecognition.available();
      if (!available.available) return onError("other");

      const mic = await ensureMicPermission();
      if (!mic.granted) return onError("denied");

      const session = {
        cancelled: false,
        committed: "",
        current: "",
        pass: 0,
      };
      this._session = session;

      const emit = () => {
        const text = [session.committed, session.current].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (text) onText(text);
      };

      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

      // Один проход распознавания. Android сам режет паузу — поэтому крутим проходы,
      // пока верхний слой не вызовет stop() после своей паузы тишины.
      const onePass = () => new Promise(async (resolve, reject) => {
        if (session.cancelled) return resolve("cancelled");
        session.pass += 1;
        session.current = "";
        let settled = false;
        let poll = null;
        let watchdog = null;
        const done = reason => {
          if (settled) return;
          settled = true;
          if (poll) clearInterval(poll);
          if (watchdog) clearTimeout(watchdog);
          resolve(reason);
        };

        try {
          await SpeechRecognition.removeAllListeners();

          await SpeechRecognition.addListener("partialResults", data => {
            if (session.cancelled || settled) return;
            const list = (data.matches || []).map(s => String(s || "").trim()).filter(Boolean);
            list.sort((a, b) => b.length - a.length);
            const text = list[0] || "";
            if (!text) return;
            session.current = text;
            emit();
          });

          await SpeechRecognition.addListener("listeningState", data => {
            if (data.status === "stopped") done(session.current ? "speech" : "idle");
          });

          const result = await SpeechRecognition.start({
            language: "ru-RU",
            maxResults: 3,
            partialResults: true,
            popup: false,
          });

          // С partialResults start() часто резолвится сразу — ждём конец прохода.
          // Берём самую полную гипотезу: Android часто отдаёт обрывок первым.
          const matches = (result?.matches || []).map(s => String(s || "").trim()).filter(Boolean);
          matches.sort((a, b) => b.length - a.length);
          const immediate = matches[0] || "";
          if (immediate) {
            session.current = immediate;
            emit();
          }

          // Иногда Android рвёт сессию ошибкой без listeningState — проверяем сами.
          // Поллинг только после start, иначе ловим «ещё не слушаю».
          poll = setInterval(async () => {
            if (settled || session.cancelled) return;
            try {
              const st = await SpeechRecognition.isListening();
              if (st && st.listening === false) done(session.current ? "speech" : "idle");
            } catch {
              // ignore
            }
          }, 350);
          watchdog = setTimeout(() => done(session.current ? "speech" : "idle"), 12000);
        } catch (err) {
          const msg = String(err?.message || err || "").toLowerCase();
          if (msg.includes("permission") || msg.includes("insufficient")) {
            if (!settled) {
              if (poll) clearInterval(poll);
              if (watchdog) clearTimeout(watchdog);
              reject(Object.assign(new Error(msg), { kind: "denied" }));
            }
            return;
          }
          done("idle");
        }
      });

      while (!session.cancelled) {
        // Новый проход = ещё слушаем, не пора резать фразу по «тишине».
        try { if (typeof onPass === "function") onPass(session.pass); } catch { /* ignore */ }
        let reason = "idle";
        try {
          reason = await onePass();
        } catch (err) {
          if (session.cancelled) break;
          if (err?.kind === "denied") return onError("denied");
          reason = "idle";
        }
        if (session.cancelled) break;

        if (session.current.trim()) {
          session.committed = [session.committed, session.current.trim()].filter(Boolean).join(" ");
          session.current = "";
          emit();
        }

        // Короткая пауза, чтобы SpeechRecognizer успел перезапуститься.
        try { if (typeof onPass === "function") onPass(session.pass); } catch { /* ignore */ }
        await delay(180);
        try { if (typeof onPass === "function") onPass(session.pass); } catch { /* ignore */ }
      }
      return undefined;
    } catch (err) {
      const msg = String(err?.message || err || "").toLowerCase();
      if (msg.includes("permission") || msg.includes("insufficient")) return onError("denied");
      return onError("other");
    }
  },

  async stop() {
    if (this._session) this._session.cancelled = true;
    try {
      await SpeechRecognition.stop();
      await SpeechRecognition.removeAllListeners();
    } catch {
      // Уже остановлено.
    }
  },
};

async function handlePushAction(notification) {
  const data = notification?.data || {};
  if (data.tag === "support" || data.url?.includes("go=support")) {
    if (supportOpenHandler) supportOpenHandler();
    else pendingSupportOpen = true;
    return;
  }
  const itemId = data.itemId;
  if (itemId) {
    if (openItemHandler) openItemHandler(itemId);
    else pendingOpenItem = itemId;
  }
}

let fcmToken = "";
let fcmListenersReady = false;

async function sendFcmTokenToServer() {
  if (!fcmToken || !token()) return;
  await apiCall("/push/fcm-register", { token: fcmToken });
}

async function registerFcmToken() {
  if (permission !== "granted") return;
  try {
    if (!fcmListenersReady) {
      fcmListenersReady = true;
      await PushNotifications.addListener("registration", async ({ value }) => {
        if (!value) return;
        fcmToken = value;
        await sendFcmTokenToServer();
      });
      await PushNotifications.addListener("registrationError", () => {});
      await PushNotifications.addListener("pushNotificationReceived", notification => {
        const data = notification?.data || {};
        if (data.tag === "support") {
          liveNoticeHandler?.({
            title: notification?.title || data.title || "Ответ поддержки",
            body: notification?.body || data.body || "",
            url: data.url || "/?go=support",
          });
        }
      });
      await PushNotifications.addListener("pushNotificationActionPerformed", event => {
        handlePushAction(event.notification);
      });
    }
    await PushNotifications.register();
  } catch {
    // google-services.json может отсутствовать — локальные напоминания работают без FCM.
  }
}

async function handleNotificationAction(event) {
  const extra = event.notification?.extra || {};
  // У ответа поддержки записи нет: он ведёт на переписку.
  if (extra.support) {
    if (supportOpenHandler) supportOpenHandler();
    else pendingSupportOpen = true;
    return;
  }

  const itemId = extra.itemId;
  if (!itemId) return;

  if (event.actionId === "snooze") {
    await apiCall(`/items/${itemId}/snooze`, { minutes: 60 });
    changedHandler?.();
    return;
  }
  if (event.actionId === "done") {
    await apiCall(`/items/${itemId}/done`, { done: true });
    changedHandler?.();
    return;
  }
  if (event.actionId === "reply") {
    const text = String(event.inputValue || "").trim();
    // Пустой ответ — человек передумал: просто открываем запись, ничего не меняя.
    if (!text) {
      if (openItemHandler) openItemHandler(itemId);
      else pendingOpenItem = itemId;
      return;
    }
    await apiCall(`/items/${itemId}/reply`, { text });
    changedHandler?.();
    return;
  }
  // Обычное нажатие: веб-часть может ещё не успеть подписаться — держим id.
  if (openItemHandler) openItemHandler(itemId);
  else pendingOpenItem = itemId;
}

// Приглашение по QR приходит ссылкой ?join=123456. Веб-часть подключается позже самого запуска,
// поэтому код с холодного старта ждёт её в переменной.
function takeJoinCode(url) {
  let code = "";
  try {
    code = new URL(url).searchParams.get("join") || "";
  } catch {
    return;
  }
  if (!code) return;
  if (joinCodeHandler) joinCodeHandler(code);
  else pendingJoinCode = code;
}

// Нажатие по виджету могло случиться, пока приложение было закрыто, поэтому забираем его
// и при запуске, и при каждом возвращении на экран.
async function pullWidgetAction() {
  try {
    const tap = await WidgetBridge.takeAction();
    if (!tap?.action) return;
    if (widgetActionHandler) widgetActionHandler(tap);
    else pendingWidgetAction = tap;
  } catch {
    // Виджета может не быть вовсе — это не повод ломать запуск.
  }
}

// Токен дублируем в системное хранилище: очистка кэша WebView не выкинет из аккаунта.
async function keepTokenSafe() {
  try {
    const saved = await Preferences.get({ key: "token" });
    const current = localStorage.getItem("vc.token");
    if (saved?.value && !current) localStorage.setItem("vc.token", saved.value);
    else if (current) await Preferences.set({ key: "token", value: current });
  } catch {
    // Останется обычное хранилище WebView.
  }

  // Дублируем токен ещё и в prefs виджета — silent API и восстановление после update.
  try {
    const tok = localStorage.getItem("vc.token") || "";
    if (tok) {
      await WidgetBridge.update({
        payload: "",
        apiBase: window.VC_API_BASE || "",
        token: tok,
      });
    }
  } catch {
    // Виджет ещё не готов — не блокируем старт.
  }

  const setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    setItem(key, value);
    if (key === "vc.token") {
      Preferences.set({ key: "token", value }).catch(() => {});
      WidgetBridge.update({
        payload: "",
        apiBase: window.VC_API_BASE || "",
        token: value || "",
      }).catch(() => {});
      if (value) sendFcmTokenToServer().catch(() => {});
    }
  };
  const removeItem = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = key => {
    removeItem(key);
    if (key === "vc.token") Preferences.remove({ key: "token" }).catch(() => {});
  };
}

async function init() {
  await keepTokenSafe();
  // Звуки поднимаем до расписания: первое же уведомление должно уйти в выбранный канал.
  await restoreSounds();
  await ensureSetup();
  await checkPermission();

  await LocalNotifications.addListener("localNotificationActionPerformed", handleNotificationAction);

  await registerFcmToken();

  // Уведомление сработало при открытом приложении: шторку человек не увидит, показываем баннер внутри.
  await LocalNotifications.addListener("localNotificationReceived", notification => {
    const extra = notification?.extra || {};
    liveNoticeHandler?.({
      title: notification?.title || "Напоминание",
      body: notification?.body || "",
      itemId: extra.itemId || null,
      url: extra.url || "",
    });
  });

  App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) return;
    changedHandler?.();
    pullWidgetAction();
  });

  App.addListener("backButton", () => {
    const back = document.querySelector("[data-back]");
    if (back) back.click();
    else App.exitApp();
  });

  App.addListener("appUrlOpen", ({ url }) => takeJoinCode(url));

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) takeJoinCode(launch.url);
  } catch {
    // Приложение открыли обычным способом, без ссылки.
  }

  await pullWidgetAction();

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#f3f7f6" });
  } catch {
    // На части прошивок статус-бар не перекрашивается — не критично.
  }
  document.documentElement.classList.add("vc-native");
}

if (Capacitor.isNativePlatform()) {
  window.VC_NATIVE = {
    speech,
    ensureMicPermission,
    micStatus,
    openAppSettings,
    openNotificationSettings,
    getDeviceManufacturer,
    refreshNotificationPermission: checkPermission,
    batteryStatus,
    openBatterySettings,
    startWidgetStyleRecord,
    onSpeechDone,
    openUrl,
    permissionState: () => permission,
    requestNotifications,
    syncReminders,
    syncFcmToken: sendFcmTokenToServer,
    setSounds,
    testNotification,
    notifySupport,
    clearSupportNotice,
    onOpenItem: cb => {
      openItemHandler = cb;
      if (!pendingOpenItem) return;
      const id = pendingOpenItem;
      pendingOpenItem = "";
      cb(id);
    },
    onChanged: cb => { changedHandler = cb; },
    onLiveNotice: cb => { liveNoticeHandler = cb; },
    // Нажатие по ответу поддержки могло случиться до того, как веб-часть подписалась.
    onSupportOpen: cb => {
      supportOpenHandler = cb;
      if (!pendingSupportOpen) return;
      pendingSupportOpen = false;
      cb();
    },
    onJoinCode: cb => {
      joinCodeHandler = cb;
      if (!pendingJoinCode) return;
      const code = pendingJoinCode;
      pendingJoinCode = "";
      cb(code);
    },
    ensureToken: async () => {
      try {
        const saved = await Preferences.get({ key: "token" });
        if (saved?.value && !localStorage.getItem("vc.token")) {
          localStorage.setItem("vc.token", saved.value);
        }
      } catch {
        // ignore
      }
      return localStorage.getItem("vc.token") || "";
    },
    syncApiBase: async () => {
      try {
        await WidgetBridge.update({
          payload: "",
          apiBase: String(window.VC_API_BASE || "").replace(/\/+$/, ""),
          token: localStorage.getItem("vc.token") || "",
        });
      } catch {
        // Виджет ещё не готов — не блокируем старт.
      }
    },
    updateWidget: (data, items, settings) => {
      WidgetBridge.update({
        payload: JSON.stringify(data),
        apiBase: window.VC_API_BASE || "",
        token: localStorage.getItem("vc.token") || "",
        stateItems: Array.isArray(items) ? JSON.stringify(items) : "",
        stateSettings: settings && typeof settings === "object" ? JSON.stringify(settings) : "",
      }).catch(() => {});
    },
    pinWidget: async () => {
      try {
        const res = await WidgetBridge.pin();
        return {
          asked: Boolean(res?.asked),
          already: Boolean(res?.already),
          supported: res?.supported !== false,
          count: Number(res?.count) || 0,
        };
      } catch {
        return { asked: false, already: false, supported: false, count: 0 };
      }
    },
    unpinWidget: async () => {
      try {
        await WidgetBridge.unpin();
        return true;
      } catch {
        return false;
      }
    },
    widgetStatus: async () => {
      try {
        const res = await WidgetBridge.status();
        return { enabled: Boolean(res?.enabled), count: Number(res?.count) || 0 };
      } catch {
        return { enabled: false, count: 0 };
      }
    },
    onWidgetAction: cb => {
      widgetActionHandler = cb;
      if (!pendingWidgetAction) return;
      const tap = pendingWidgetAction;
      pendingWidgetAction = null;
      cb(tap);
    },
    appBuild: async () => {
      try {
        const res = await UpdateBridge.version();
        return {
          name: res?.versionName || "",
          code: Number(res?.versionCode) || 0,
        };
      } catch {
        return { name: "", code: 0 };
      }
    },
    share: async ({ title = "", text = "", url = "", dialogTitle = "Поделиться" } = {}) => {
      await Share.share({ title, text, url, dialogTitle });
    },
  };

  init()
    .catch(() => {})
    .finally(() => {
      const v = window.__VC_SHELL_V || "";
      const appUrl = v ? `./app.js?v=${v}` : "./app.js";
      import(appUrl).finally(() => {
        SplashScreen.hide().catch(() => {});
      });
    });
} else {
  // Те же файлы, открытые в обычном браузере, работают как веб-версия.
  const v = window.__VC_SHELL_V || "";
  import(v ? `./app.js?v=${v}` : "./app.js");
}
