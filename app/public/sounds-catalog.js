/**
 * Список звуков будильника и уведомлений — общий для сервера, сайта и приложения.
 * Файлы лежат в /sounds/<id>.mp3, те же самые попадают в res/raw для Android:
 * что человек слышит в настройках, то потом и звучит из шторки.
 *
 * Звуки синтезированы (tools/make-sounds.mjs) живыми тембрами — маримба, глокеншпиль,
 * калимба, колокол, — так звучат сигналы на дорогих телефонах. Лицензировать нечего.
 */

export const ALARM_SOUNDS = [
  { id: "alarm_sunrise", name: "Рассвет", hint: "тёплая подушка и арпеджио, громче с каждым кругом" },
  { id: "alarm_radar", name: "Маяк", hint: "две ноты через паузу, к концу настойчивее" },
  { id: "alarm_bells", name: "Колокола", hint: "редкие удары с долгим хвостом" },
  { id: "alarm_kalimba", name: "Калимба", hint: "спокойный узор, который трудно проспать" },
  { id: "alarm_rise", name: "Подъём", hint: "быстрый бег вверх с ярким акцентом" },
  { id: "alarm_forte", name: "Vertu Форте", hint: "уверенный оркестровый акцент, как на телефоне Vertu" },
  { id: "alarm_piacevole", name: "Vertu Пиачеволе", hint: "мягкий приятный подъём без резкости" },
  { id: "alarm_placido", name: "Vertu Плачидо", hint: "спокойные волны — будит без тревоги" },
];

export const NOTIFY_SOUNDS = [
  { id: "notify_marimba", name: "Маримба", hint: "три ноты вверх, тёплое дерево" },
  { id: "notify_glass", name: "Стекло", hint: "одна нота с долгим сиянием" },
  { id: "notify_kalimba", name: "Калимба", hint: "мягкий росчерк из трёх нот" },
  { id: "notify_drop", name: "Капля", hint: "короткий тон вниз с хвостом" },
  { id: "notify_soft", name: "Вполголоса", hint: "две тихие ноты для ночи" },
  { id: "notify_allegro", name: "Vertu Аллегро", hint: "живой короткий росчерк в духе Vertu" },
  { id: "notify_pizzicato", name: "Vertu Пиццикато", hint: "щипок струны — ясно и коротко" },
  { id: "notify_brio", name: "Vertu Брио", hint: "яркий двунотный акцент" },
];

export const DEFAULT_ALARM_SOUND = "alarm_radar";
export const DEFAULT_NOTIFY_SOUND = "notify_marimba";

// Первый набор звуков заменён целиком. Старый выбор молча переводим на ближайший по смыслу,
// иначе у людей, которые уже что-то выбрали, настройка сбросилась бы на умолчание.
const LEGACY = {
  alarm_bell: "alarm_bells",
  alarm_dawn: "alarm_sunrise",
  alarm_beacon: "alarm_radar",
  alarm_drops: "alarm_kalimba",
  alarm_urgent: "alarm_rise",
  notify_chime: "notify_glass",
  notify_tap: "notify_soft",
  notify_bubble: "notify_marimba",
  notify_chord: "notify_kalimba",
};

export function alarmSoundId(value) {
  const id = LEGACY[value] || value;
  return ALARM_SOUNDS.some(s => s.id === id) ? id : DEFAULT_ALARM_SOUND;
}

export function notifySoundId(value) {
  const id = LEGACY[value] || value;
  return NOTIFY_SOUNDS.some(s => s.id === id) ? id : DEFAULT_NOTIFY_SOUND;
}

export function soundName(id) {
  return [...ALARM_SOUNDS, ...NOTIFY_SOUNDS].find(s => s.id === id)?.name || "";
}
