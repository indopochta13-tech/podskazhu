// Виртуальный человек: говорит приложению живые бытовые просьбы и проверяет,
// что оно записало. Одна и та же фраза прогоняется при разном «сейчас»,
// потому что «в пять» утром и поздним вечером — это разное время.
//
// Запуск: node qa/virtual-user.mjs [категория]
//
// Пометки в отчёте:
//   ✓ верно   — приложение поняло так же, как понял бы человек
//   ~ спорно  — однозначного правильного ответа нет; фиксируем фактическое поведение
//   ✗ ошибка  — приложение поняло неверно

import { parse } from "../lib/parse.js";
import { zonedParts } from "../lib/time.js";

const TZ = "Europe/Moscow";
// Воскресенье, 2 августа 2026 года. Москва = UTC+3.
const MOMENTS = [
  { label: "08:00", now: Date.UTC(2026, 7, 2, 5, 0) },
  { label: "13:00", now: Date.UTC(2026, 7, 2, 10, 0) },
  { label: "20:00", now: Date.UTC(2026, 7, 2, 17, 0) },
  { label: "23:30", now: Date.UTC(2026, 7, 2, 20, 30) },
];

const SETTINGS = { remindMeeting: 15, remindTask: 0, remindBirthday: 1440, alarmMeetings: true };

const TYPE_NAMES = { note: "заметка", task: "дело", meeting: "встреча", bday: "день рождения" };
const REPEAT_NAMES = {
  daily: "каждый день", weekdays: "по будням", weekends: "по выходным",
  weekly: "каждую неделю", monthly: "каждый месяц",
};

// —————————————————————————————————————————————————————————————
// Корпус фраз. Ожидания написаны с точки зрения живого человека:
// если приложение отвечает иначе — это находка, а не подгонка теста.
// —————————————————————————————————————————————————————————————
const CASES = [
  // ——— Заметки без времени ———
  { cat: "Заметки", text: "запиши мысль про новый лендинг",
    expect: { type: "note", title: /лендинг/i, date: null, time: null } },
  { cat: "Заметки", text: "идея сделать подкаст про ремонт",
    expect: { type: "note", title: /подкаст/i, date: null, time: null } },
  { cat: "Заметки", text: "заметка позвонить в налоговую когда будет время",
    expect: { type: "note", title: /налоговую/i, titleNot: /^заметка/i, date: null, time: null } },
  { cat: "Заметки", text: "запомни что пароль от роутера админ",
    expect: { type: "note", title: /пароль от роутера/i, titleNot: /запомни|^что/i, date: null } },
  { cat: "Заметки", text: "запиши что машина на втором уровне парковки",
    expect: { type: "note", title: /машина на втором уровне/i, date: null } },
  { cat: "Заметки", text: "мысль надо бы поменять тариф",
    expect: { type: "note", title: /тариф/i, date: null },
    disputed: "«Мысль» остаётся в начале названия — не ошибка, но и не идеально" },

  // ——— Дела: дата, время, относительные сроки ———
  { cat: "Дела и сроки", text: "не забыть купить термопасту в субботу",
    expect: { type: "task", title: /термопасту/i, titleNot: /забы/i, date: "08.08.2026", time: null } },
  { cat: "Дела и сроки", text: "оплатить садик до пятницы",
    expect: { type: "task", title: /садик/i, date: "07.08.2026" } },
  { cat: "Дела и сроки", text: "к понедельнику доделать презентацию",
    expect: { type: "task", title: /презентацию/i, date: "03.08.2026" } },
  { cat: "Дела и сроки", text: "послезавтра сдать анализы",
    expect: { type: "task", title: /анализы/i, date: "04.08.2026" } },
  { cat: "Дела и сроки", text: "через часок позвонить бабушке",
    expect: { type: "task", title: /бабушке/i },
    byNow: {
      "08:00": { date: "02.08.2026", time: "09:00" },
      "13:00": { date: "02.08.2026", time: "14:00" },
      "20:00": { date: "02.08.2026", time: "21:00" },
      "23:30": { date: "03.08.2026", time: "00:30" },
    } },
  { cat: "Дела и сроки", text: "через 40 минут выключить печку",
    expect: { title: /печку/i },
    byNow: {
      "08:00": { time: "08:40" }, "13:00": { time: "13:40" },
      "20:00": { time: "20:40" }, "23:30": { time: "00:10" },
    } },
  { cat: "Дела и сроки", text: "через пару дней записаться к врачу",
    expect: { title: /врачу/i, date: "04.08.2026" } },
  { cat: "Дела и сроки", text: "через три недели продлить подписку",
    expect: { title: /подписку/i, date: "23.08.2026" } },
  { cat: "Дела и сроки", text: "в конце месяца оплатить квартиру",
    expect: { title: /квартиру/i, date: "31.08.2026", time: null } },
  { cat: "Дела и сроки", text: "в начале сентября записать ребёнка в секцию",
    expect: { title: /секцию/i, date: "01.09.2026" } },
  { cat: "Дела и сроки", text: "на выходных помыть машину",
    expect: { title: /машину/i, date: "08.08.2026" } },
  { cat: "Дела и сроки", text: "на следующей неделе сходить к стоматологу",
    expect: { title: /стоматологу/i, date: "03.08.2026" } },
  { cat: "Дела и сроки", text: "давай позже проверю почту",
    expect: { type: "note", title: /почту/i, date: null, time: null },
    disputed: "«позже» — срок неизвестен, приложение честно оставляет заметку без времени" },
  { cat: "Дела и сроки", text: "в течение недели сдать отчёт",
    expect: { title: /отчёт/i, date: "07.08.2026" } },
  { cat: "Дела и сроки", text: "первого сентября линейка в школе",
    expect: { title: /линейка/i, date: "01.09.2026" } },
  { cat: "Дела и сроки", text: "второго числа заплатить за свет",
    expect: { title: /за свет/i, date: "02.08.2026" },
    disputed: "«второго числа» сказано второго августа — приложение ставит сегодня" },

  // ——— Встречи, адреса, падежи ———
  { cat: "Встречи и места", text: "встреча завтра в 10 на Таганке",
    expect: { type: "meeting", title: /встреча/i, date: "03.08.2026", time: "10:00", place: /таган/i, remind: 15, alarm: true } },
  { cat: "Встречи и места", text: "созвон с подрядчиком завтра в 15:30",
    expect: { type: "meeting", title: /подрядчиком/i, date: "03.08.2026", time: "15:30", remind: 15 } },
  { cat: "Встречи и места", text: "встреча с юристом 15.09 в 16:00 напомни за час",
    expect: { type: "meeting", title: /юристом/i, date: "15.09.2026", time: "16:00", remind: 60 } },
  { cat: "Встречи и места", text: "встреча в офисе завтра в 11",
    expect: { type: "meeting", date: "03.08.2026", time: "11:00", place: /офис/i } },
  { cat: "Встречи и места", text: "в 12 у нотариуса",
    expect: { type: "meeting", title: /нотариуса/i, time: "12:00" } },
  { cat: "Встречи и места", text: "приём у врача в поликлинике на Мира в 14:20",
    expect: { type: "meeting", time: "14:20", place: /поликлиник.*мира/i } },
  { cat: "Встречи и места", text: "встреча на Ленинском проспекте завтра в 9",
    expect: { type: "meeting", date: "03.08.2026", time: "09:00", place: /ленинском проспекте/i } },
  { cat: "Встречи и места", text: "встреча на улице Строителей завтра в 14",
    expect: { type: "meeting", date: "03.08.2026", time: "14:00", place: /строителей/i } },
  { cat: "Встречи и места", text: "стендап в зуме завтра в 10:15",
    expect: { type: "meeting", date: "03.08.2026", time: "10:15", place: /зум/i } },
  { cat: "Встречи и места", text: "интервью с кандидатом в четверг в 16",
    expect: { type: "meeting", title: /кандидатом/i, date: "06.08.2026", time: "16:00" } },
  { cat: "Встречи и места", text: "запись к стоматологу в пятницу в 18:30",
    expect: { type: "meeting", title: /стоматолог/i, date: "07.08.2026", time: "18:30" } },
  { cat: "Встречи и места", text: "собрание в школе в 18 в четверг",
    expect: { type: "meeting", date: "06.08.2026", time: "18:00", place: /школе/i } },
  { cat: "Встречи и места", text: "визит к бабушке в субботу в 15",
    expect: { type: "meeting", title: /бабушке/i, date: "08.08.2026", time: "15:00" } },
  { cat: "Встречи и места", text: "конференция 20 сентября в Сколково",
    expect: { type: "meeting", date: "20.09.2026", time: null, place: /сколково/i } },
  { cat: "Встречи и места", text: "в 16 у зубного",
    expect: { type: "meeting", title: /зубного/i, time: "16:00" } },
  { cat: "Встречи и места", text: "тренировка в спортзале завтра в 19",
    expect: { date: "03.08.2026", time: "19:00", place: /спортзале/i } },

  // ——— Дни рождения ———
  { cat: "Дни рождения", text: "ДР у мамы 14 сентября",
    expect: { type: "bday", title: /мамы/i, date: "14.09.2026", time: "09:00", remind: 1440, yearly: true } },
  { cat: "Дни рождения", text: "днюха у Кати в пятницу",
    expect: { type: "bday", title: /кати/i, date: "07.08.2026", remind: 1440 } },
  { cat: "Дни рождения", text: "день рождения Маши 12 марта",
    expect: { type: "bday", title: /маши/i, date: "12.03.2027", remind: 1440 } },
  { cat: "Дни рождения", text: "годовщина свадьбы 5 июня",
    expect: { type: "bday", date: "05.06.2027", remind: 1440 } },
  { cat: "Дни рождения", text: "у Пети день рождения послезавтра",
    expect: { type: "bday", title: /пети/i, date: "04.08.2026" } },
  { cat: "Дни рождения", text: "напомни за неделю про день рождения жены 20 августа",
    expect: { type: "bday", title: /жены/i, date: "20.08.2026", remind: 10080 } },

  // ——— Повторы ———
  { cat: "Повторы", text: "каждый день в 8 утра витамины",
    expect: { title: /витамин/i, repeat: "daily", time: "08:00", date: "03.08.2026" } },
  { cat: "Повторы", text: "по будням в 7:30 зарядка",
    expect: { title: /зарядка/i, repeat: "weekdays", time: "07:30", date: "03.08.2026" } },
  { cat: "Повторы", text: "по выходным в 10 бассейн",
    expect: { title: /бассейн/i, repeat: "weekends", time: "10:00" },
    byNow: {
      "08:00": { date: "02.08.2026" }, "13:00": { date: "08.08.2026" },
      "20:00": { date: "08.08.2026" }, "23:30": { date: "08.08.2026" },
    } },
  { cat: "Повторы", text: "каждый вторник в 11 планёрка",
    expect: { type: "meeting", title: /планёрка/i, repeat: "weekly", date: "04.08.2026", time: "11:00" } },
  { cat: "Повторы", text: "каждый месяц 5 числа платить за интернет",
    expect: { title: /интернет/i, repeat: "monthly", date: "05.08.2026" } },
  { cat: "Повторы", text: "каждую пятницу выносить мусор",
    expect: { title: /мусор/i, repeat: "weekly", date: "07.08.2026" } },
  { cat: "Повторы", text: "каждое утро зарядка",
    expect: { title: /зарядка/i, repeat: "daily", time: "09:00" },
    byNow: { "08:00": { date: "02.08.2026" }, "13:00": { date: "03.08.2026" }, "20:00": { date: "03.08.2026" }, "23:30": { date: "03.08.2026" } } },
  { cat: "Повторы", text: "каждый вечер читать книгу",
    expect: { title: /книгу/i, repeat: "daily", time: "19:00" },
    byNow: { "08:00": { date: "02.08.2026" }, "13:00": { date: "02.08.2026" }, "20:00": { date: "03.08.2026" }, "23:30": { date: "03.08.2026" } } },
  { cat: "Повторы", text: "по средам английский в 19",
    expect: { title: /английский/i, repeat: "weekly", date: "05.08.2026", time: "19:00" } },
  { cat: "Повторы", text: "каждый год 9 мая звонить деду",
    expect: { title: /деду/i, titleNot: /кажд/i, date: "09.05.2027", yearly: true } },
  { cat: "Повторы", text: "каждые две недели вывозить мусор",
    expect: { title: /мусор/i, repeat: "weekly" } },
  { cat: "Повторы", text: "по вторникам и четвергам английский",
    expect: { title: /английский/i, repeat: "weekly", date: "04.08.2026" },
    disputed: "второй день недели приложение не хранит — запись встанет только на вторник" },

  // ——— Напоминания и будильник ———
  { cat: "Напоминания", text: "напомни завтра в 9 позвонить в банк",
    expect: { title: /банк/i, titleNot: /напомни/i, date: "03.08.2026", time: "09:00" } },
  { cat: "Напоминания", text: "напомни за 15 минут про созвон завтра в 14",
    expect: { type: "meeting", date: "03.08.2026", time: "14:00", remind: 15 } },
  { cat: "Напоминания", text: "напомни за два дня про оплату налогов 20 августа",
    expect: { title: /налог/i, date: "20.08.2026", remind: 2880 } },
  { cat: "Напоминания", text: "напомни мне за 3 дня про визу",
    expect: { title: /визу/i, remind: 4320 } },
  { cat: "Напоминания", text: "напомни за час до встречи с юристом",
    expect: { type: "meeting", title: /юристом/i, remind: 60 },
    disputed: "привязать напоминание к уже существующей записи приложение не умеет" },
  { cat: "Напоминания", text: "поставь будильник на 7 утра",
    expect: { title: /будильник/i, time: "07:00", date: "03.08.2026", alarm: true } },
  { cat: "Напоминания", text: "поставь будильник на полседьмого",
    expect: { title: /будильник/i, titleNot: /\bна$/i, time: "06:30", alarm: true } },
  { cat: "Напоминания", text: "будильник на 6",
    expect: { time: "06:00", date: "03.08.2026", alarm: true } },
  { cat: "Напоминания", text: "разбуди меня в 6",
    expect: { time: "06:00", date: "03.08.2026", alarm: true } },
  { cat: "Напоминания", text: "напомни послезавтра в обед позвонить в сервис",
    expect: { title: /сервис/i, date: "04.08.2026", time: "13:00" } },
  { cat: "Напоминания", text: "напомни за неделю про страховку 20 сентября",
    expect: { title: /страховк/i, date: "20.09.2026", remind: 10080 } },
  { cat: "Напоминания", text: "напомни за месяц про техосмотр 1 октября",
    expect: { title: /техосмотр/i, date: "01.10.2026", remind: 10080 },
    disputed: "и сервер, и разбор обрезают напоминание неделей — «за месяц» превращается в «за неделю»" },

  // ——— Отмена и перенос ———
  { cat: "Отмена и перенос", text: "отмени встречу с юристом",
    expect: { intent: "cancel", query: /юрист/i } },
  { cat: "Отмена и перенос", text: "отмени встречу на Таганке",
    expect: { intent: "cancel", query: /таган/i } },
  { cat: "Отмена и перенос", text: "удали заметку про лендинг",
    expect: { intent: "cancel", query: /лендинг/i } },
  { cat: "Отмена и перенос", text: "убери напоминание про витамины",
    expect: { intent: "cancel", query: /витамин/i } },
  { cat: "Отмена и перенос", text: "отбой по встрече с юристом",
    expect: { intent: "cancel", query: /юрист/i } },
  { cat: "Отмена и перенос", text: "отмени всё на завтра",
    expect: { intent: "cancel", date: "03.08.2026" } },
  { cat: "Отмена и перенос", text: "перенеси созвон на 18:30",
    expect: { intent: "move", query: /созвон/i, time: "18:30" } },
  { cat: "Отмена и перенос", text: "перенеси созвон на 6",
    expect: { intent: "move", query: /созвон/i },
    byNow: { "08:00": { time: "18:00" }, "13:00": { time: "18:00" }, "20:00": { time: "06:00" }, "23:30": { time: "06:00" } } },
  { cat: "Отмена и перенос", text: "сдвинь стоматолога на завтра",
    expect: { intent: "move", query: /стоматолог/i, date: "03.08.2026" } },
  { cat: "Отмена и перенос", text: "перенеси стоматолога на час позже",
    expect: { intent: "move", query: /стоматолог/i, shift: 60, time: null } },
  { cat: "Отмена и перенос", text: "сдвинь планёрку на 15 минут",
    expect: { intent: "move", query: /планёрку/i, shift: 15, time: null } },
  { cat: "Отмена и перенос", text: "поменяй время встречи на 15",
    expect: { intent: "move", query: /встреч/i, time: "15:00" } },
  { cat: "Отмена и перенос", text: "перенеси всё с понедельника на вторник",
    expect: { intent: "move", date: "04.08.2026" },
    disputed: "массовый перенос всех дел одного дня приложение не умеет" },
  { cat: "Отмена и перенос", text: "я уже отменил встречу с юристом",
    expect: { intent: "empty" },
    disputed: "фраза-констатация: приложение создаёт из неё новую встречу" },

  // ——— Несколько дел в одной фразе ———
  { cat: "Несколько дел", text: "купи хлеб и ещё позвони маме в 7",
    expect: { count: 2 },
    drafts: [{ title: /хлеб/i, time: null }, { title: /маме/i }] },
  { cat: "Несколько дел", text: "стендап в пятницу в 10 утра и ещё оплатить хостинг",
    expect: { count: 2 },
    drafts: [{ type: "meeting", date: "07.08.2026", time: "10:00" }, { title: /хостинг/i }] },
  { cat: "Несколько дел", text: "заехать в аптеку, потом забрать ребёнка из садика в 17",
    expect: { count: 2 },
    drafts: [{ title: /аптеку/i }, { title: /ребёнка/i, time: "17:00" }] },
  { cat: "Несколько дел", text: "позвонить маме и записаться к врачу",
    expect: { count: 2 },
    drafts: [{ title: /маме/i }, { title: /врачу/i }] },
  { cat: "Несколько дел", text: "оплатить интернет и вынести мусор и позвонить в сервис",
    expect: { count: 3 } },
  { cat: "Несколько дел", text: "купить молоко и хлеб",
    expect: { count: 1, title: /молоко и хлеб/i } },
  { cat: "Несколько дел", text: "надо в аптеку сходить и в магазин зайти",
    expect: { count: 2 } },

  // ——— Разговорное время ———
  { cat: "Разговорное время", text: "без двадцати шесть выходить",
    expect: { title: /выходить/i },
    byNow: { "08:00": { time: "17:40" }, "13:00": { time: "17:40" }, "20:00": { time: "05:40" }, "23:30": { time: "05:40" } } },
  { cat: "Разговорное время", text: "встреча завтра в половине седьмого",
    expect: { type: "meeting", date: "03.08.2026", time: "18:30" } },
  { cat: "Разговорное время", text: "созвон завтра в половине десятого утра",
    expect: { type: "meeting", date: "03.08.2026", time: "09:30" } },
  { cat: "Разговорное время", text: "полшестого забрать ребенка",
    expect: { title: /ребенка/i },
    byNow: { "08:00": { time: "17:30" }, "13:00": { time: "17:30" }, "20:00": { time: "05:30" }, "23:30": { time: "05:30" } } },
  { cat: "Разговорное время", text: "часов в пять позвонить риелтору",
    expect: { title: /риелтору/i, titleNot: /часов/i },
    byNow: { "08:00": { time: "17:00" }, "13:00": { time: "17:00" }, "20:00": { time: "05:00" }, "23:30": { time: "05:00" } } },
  { cat: "Разговорное время", text: "ближе к вечеру полить цветы",
    expect: { title: /цветы/i, time: "18:00" } },
  { cat: "Разговорное время", text: "после обеда заехать в банк",
    expect: { title: /банк/i, titleNot: /обед/i, time: "15:00" } },
  { cat: "Разговорное время", text: "на ночь поставить таймер",
    expect: { title: /таймер/i, time: "21:00" } },
  { cat: "Разговорное время", text: "до обеда отправить документы",
    expect: { title: /документы/i, time: "11:00" } },
  { cat: "Разговорное время", text: "рано утром пробежка",
    expect: { title: /пробежка/i, time: "07:00" } },
  { cat: "Разговорное время", text: "в полдень обед с командой",
    expect: { title: /командой/i, time: "12:00" } },
  { cat: "Разговорное время", text: "в районе трёх подъехать",
    expect: { title: /подъехать/i },
    byNow: { "08:00": { time: "15:00" }, "13:00": { time: "15:00" }, "20:00": { time: "03:00" }, "23:30": { time: "03:00" } } },
  { cat: "Разговорное время", text: "около 8 быть дома",
    expect: { title: /дома/i, time: "08:00" } },
  { cat: "Разговорное время", text: "ровно в 12 забрать торт",
    expect: { title: /торт/i, titleNot: /ровно/i } },
  { cat: "Разговорное время", text: "с утра позвонить в поликлинику",
    expect: { title: /поликлинику/i, titleNot: /^с /i, time: "09:00" } },
  { cat: "Разговорное время", text: "вечером в 9 позвонить домой",
    expect: { title: /домой/i, titleNot: /вечером/i, time: "21:00" } },
  { cat: "Разговорное время", text: "ночью в 2 проверить сервер",
    expect: { title: /сервер/i, time: "02:00", date: "03.08.2026" } },
  { cat: "Разговорное время", text: "встреча с 15 до 16 с подрядчиком",
    expect: { type: "meeting", time: "15:00" } },
  { cat: "Разговорное время", text: "в 8 вечера баня",
    expect: { title: /баня/i, time: "20:00" } },
  { cat: "Разговорное время", text: "в 12 ночи выключить свет",
    expect: { title: /свет/i, time: "00:00", date: "03.08.2026" } },

  // ——— Поправки на ходу ———
  { cat: "Поправки", text: "встреча завтра в 10 на Таганке, а нет, лучше в 12 на Тверской",
    expect: { type: "meeting", date: "03.08.2026", time: "12:00", place: /тверск/i, corrected: true } },
  { cat: "Поправки", text: "созвон завтра в 15, точнее в 16",
    expect: { type: "meeting", date: "03.08.2026", time: "16:00", corrected: true } },
  { cat: "Поправки", text: "не в 10, а в 12 встреча с врачом",
    expect: { type: "meeting", title: /врачом/i, titleNot: /^не|,/i, time: "12:00", corrected: true } },
  { cat: "Поправки", text: "встреча завтра не в 10, а в 12",
    expect: { type: "meeting", date: "03.08.2026", time: "12:00", corrected: true } },
  { cat: "Поправки", text: "давай не в среду, а в четверг стоматолог",
    expect: { title: /стоматолог/i, date: "06.08.2026", corrected: true } },
  { cat: "Поправки", text: "стоматолог в четверг, стоп, в пятницу",
    expect: { title: /стоматолог/i, date: "07.08.2026", corrected: true } },
  { cat: "Поправки", text: "позвонить маме завтра в 6, ой, в 7",
    expect: { title: /маме/i, date: "03.08.2026", time: "19:00", corrected: true } },
  { cat: "Поправки", text: "встреча завтра в офисе, погоди, в кафе",
    expect: { type: "meeting", place: /кафе/i, corrected: true } },
  { cat: "Поправки", text: "оплатить налоги завтра, то есть послезавтра",
    expect: { title: /налоги/i, date: "04.08.2026", corrected: true } },
  { cat: "Поправки", text: "забрать посылку завтра в 14, вернее в 15",
    expect: { title: /посылку/i, date: "03.08.2026", time: "15:00", corrected: true } },
  { cat: "Поправки", text: "созвон завтра в 10 утра, извини, в 11",
    expect: { type: "meeting", date: "03.08.2026", time: "11:00", corrected: true } },
  { cat: "Поправки", text: "созвон завтра в 15 или лучше в 16",
    expect: { type: "meeting", title: /созвон/i, titleNot: /или/i, time: "16:00", corrected: true } },
  { cat: "Поправки", text: "запиши на пятницу, тьфу, на субботу поездку",
    expect: { title: /поездку/i, date: "08.08.2026", corrected: true } },
  { cat: "Поправки", text: "купить хлеб, нет, лучше молоко в 7",
    expect: { title: /молоко/i },
    disputed: "во второй половине новое дело, поэтому поправка сознательно не применяется" },

  // ——— Контекст времени суток ———
  { cat: "Время суток", text: "без пятнадцати пять забрать ребенка",
    expect: { title: /ребенка/i },
    byNow: {
      "08:00": { date: "02.08.2026", time: "16:45" },
      "13:00": { date: "02.08.2026", time: "16:45" },
      "20:00": { date: "03.08.2026", time: "04:45" },
      "23:30": { date: "03.08.2026", time: "04:45" },
    } },
  { cat: "Время суток", text: "в пять заехать за деньгами",
    expect: { title: /деньгами/i },
    byNow: {
      "08:00": { time: "17:00" }, "13:00": { time: "17:00" },
      "20:00": { time: "05:00" }, "23:30": { time: "05:00" },
    } },
  { cat: "Время суток", text: "встреча в 10",
    expect: { type: "meeting" },
    byNow: {
      "08:00": { date: "02.08.2026", time: "10:00" },
      "13:00": { date: "03.08.2026", time: "10:00" },
      "20:00": { date: "02.08.2026", time: "22:00" },
      "23:30": { date: "03.08.2026", time: "10:00" },
    },
    disputed: "вечерний вариант «в 10» приложение берёт, только если он ближе четырёх часов" },
  { cat: "Время суток", text: "завтра в пять забрать вещи",
    expect: { title: /вещи/i, date: "03.08.2026", time: "17:00" } },
  { cat: "Время суток", text: "каждый день в пять кормить кота",
    expect: { title: /кота/i, repeat: "daily", time: "17:00" } },
  { cat: "Время суток", text: "в шесть тридцать выехать",
    expect: { title: /выехать/i },
    byNow: { "08:00": { time: "18:30" }, "13:00": { time: "18:30" }, "20:00": { time: "06:30" }, "23:30": { time: "06:30" } } },
  { cat: "Время суток", text: "в половине девятого забрать заказ",
    expect: { title: /заказ/i },
    byNow: { "08:00": { time: "08:30" }, "13:00": { time: "08:30" }, "20:00": { time: "20:30" }, "23:30": { time: "08:30" } },
    disputed: "часы 8–11 считаются утренними, вечерний вариант — только если он совсем близко" },
  { cat: "Время суток", text: "в обед перекусить",
    expect: { title: /перекусить/i, time: "13:00" },
    byNow: { "08:00": { date: "02.08.2026" }, "13:00": { date: "03.08.2026" }, "20:00": { date: "03.08.2026" }, "23:30": { date: "03.08.2026" } } },

  // ——— Просторечие и огрехи распознавания ———
  { cat: "Просторечие", text: "эээ ну короче надо в 5 заехать за деньгами",
    expect: { title: /заехать за деньгами/i, titleNot: /ну|короче|надо/i } },
  { cat: "Просторечие", text: "нужно это самое позвонить в жкх в 11",
    expect: { title: /жкх/i, titleNot: /это самое|нужно/i } },
  { cat: "Просторечие", text: "слушай напомни пожалуйста завтра в 8 про таблетки",
    expect: { title: /таблетки/i, titleNot: /слушай|напомни|пожалуйста/i, date: "03.08.2026", time: "08:00" } },
  { cat: "Просторечие", text: "завтро в десять встреча с бухгалтером",
    expect: { type: "meeting", title: /бухгалтером/i, date: "03.08.2026", time: "10:00" } },
  { cat: "Просторечие", text: "встреча в понедельник в дясять",
    expect: { type: "meeting", date: "03.08.2026", time: "10:00" } },
  { cat: "Просторечие", text: "запиши на завтра в 9 30 звонок клиенту",
    expect: { title: /звонок клиенту/i, titleNot: /^на|30/i, date: "03.08.2026", time: "09:30" } },
  { cat: "Просторечие", text: "в 7 15 забрать машину из сервиса",
    expect: { title: /машину/i, titleNot: /15/ },
    byNow: { "08:00": { time: "19:15" }, "13:00": { time: "19:15" }, "20:00": { time: "07:15" }, "23:30": { time: "07:15" } } },
  { cat: "Просторечие", text: "созвон завтра в двенадцать ноль ноль",
    expect: { type: "meeting", title: /созвон/i, titleNot: /ноль/i, date: "03.08.2026", time: "12:00" } },
  { cat: "Просторечие", text: "надо бы сходить в зал вечерком",
    expect: { title: /зал/i, time: "19:00" } },
  { cat: "Просторечие", text: "созвон завтра в 9 по мск",
    expect: { type: "meeting", titleNot: /мск/i, date: "03.08.2026", time: "09:00" } },
  { cat: "Просторечие", text: "чё там по встрече в 14",
    expect: { intent: "empty" },
    disputed: "это вопрос, а не просьба: приложение всё равно создаёт встречу" },
  { cat: "Просторечие", text: "купить корм кошке",
    expect: { type: "task", title: /корм/i },
    disputed: "дело без срока приложение намеренно кладёт в заметки" },
];

// —————————————————————————————————————————————————————————————
// Проверка ожиданий
// —————————————————————————————————————————————————————————————
function fmtDate(date) {
  if (!date) return null;
  return `${String(date.day).padStart(2, "0")}.${String(date.month + 1).padStart(2, "0")}.${date.year}`;
}

function fmtTime(time) {
  if (!time) return null;
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function showDraft(d) {
  const parts = [
    TYPE_NAMES[d.type] || d.type,
    `«${d.title}»`,
    fmtDate(d.date) || "без даты",
    fmtTime(d.time) || "без времени",
  ];
  if (d.place) parts.push(`место: ${d.place}`);
  if (d.remind) parts.push(`пуш за ${d.remind} мин`);
  if (d.repeat) parts.push(REPEAT_NAMES[d.repeat.kind] || d.repeat.kind);
  if (d.yearly && d.type !== "bday") parts.push("раз в год");
  if (d.alarm) parts.push("будильник");
  if (d.corrected) parts.push("учтена поправка");
  return parts.join(" · ");
}

function showResult(r) {
  if (r.intent === "create") return r.drafts.map(showDraft).join("  +  ");
  const bits = [`команда: ${r.intent}`, `искать: «${r.query || ""}»`];
  if (r.date) bits.push(`дата ${fmtDate(r.date)}`);
  if (r.time) bits.push(`время ${fmtTime(r.time)}`);
  if (r.shift) bits.push(`сдвиг ${r.shift > 0 ? "+" : ""}${r.shift} мин`);
  return bits.join(" · ");
}

function checkDraft(draft, exp) {
  const bad = [];
  if (exp.type && draft.type !== exp.type) {
    bad.push(`тип «${TYPE_NAMES[draft.type]}», ожидался «${TYPE_NAMES[exp.type]}»`);
  }
  if (exp.title && !exp.title.test(draft.title)) bad.push(`название «${draft.title}»`);
  if (exp.titleNot && exp.titleNot.test(draft.title)) bad.push(`в названии лишнее: «${draft.title}»`);
  if ("date" in exp) {
    const got = fmtDate(draft.date);
    if (got !== exp.date) bad.push(`дата ${got || "не услышана"}, ожидалась ${exp.date || "без даты"}`);
  }
  if ("time" in exp) {
    const got = fmtTime(draft.time);
    if (got !== exp.time) bad.push(`время ${got || "не услышано"}, ожидалось ${exp.time || "без времени"}`);
  }
  if (exp.place && !exp.place.test(draft.place || "")) bad.push(`место «${draft.place || "не услышано"}»`);
  if ("remind" in exp && draft.remind !== exp.remind) bad.push(`пуш за ${draft.remind}, ожидалось за ${exp.remind}`);
  if ("repeat" in exp) {
    const got = draft.repeat ? draft.repeat.kind : null;
    if (got !== exp.repeat) bad.push(`повтор ${got || "нет"}, ожидался ${exp.repeat || "нет"}`);
  }
  if (exp.corrected && !draft.corrected) bad.push("поправка не учтена");
  if ("alarm" in exp && Boolean(draft.alarm) !== exp.alarm) bad.push(exp.alarm ? "не поставлен будильник" : "лишний будильник");
  if (exp.yearly && !draft.yearly) bad.push("не отмечено «раз в год»");
  return bad;
}

function checkCase(c, result, moment) {
  const exp = { ...(c.expect || {}), ...((c.byNow || {})[moment.label] || {}) };
  const bad = [];

  if (exp.intent && exp.intent !== result.intent) {
    bad.push(`приложение решило «${result.intent}», а человек ждал «${exp.intent}»`);
    return bad;
  }

  if (result.intent === "cancel" || result.intent === "move") {
    if (exp.query && !exp.query.test(result.query || "")) bad.push(`искать «${result.query}»`);
    if ("date" in exp) {
      const got = fmtDate(result.date);
      if (got !== exp.date) bad.push(`дата ${got || "нет"}, ожидалась ${exp.date || "нет"}`);
    }
    if ("time" in exp) {
      const got = fmtTime(result.time);
      if (got !== exp.time) bad.push(`время ${got || "нет"}, ожидалось ${exp.time || "нет"}`);
    }
    if ("shift" in exp && (result.shift || null) !== exp.shift) {
      bad.push(`сдвиг ${result.shift || "нет"}, ожидался ${exp.shift}`);
    }
    return bad;
  }

  if (exp.count && result.drafts.length !== exp.count) {
    bad.push(`записей ${result.drafts.length}, ожидалось ${exp.count}`);
  }
  if (c.drafts) {
    c.drafts.forEach((sub, i) => {
      const draft = result.drafts[i];
      if (!draft) {
        bad.push(`нет записи №${i + 1}`);
        return;
      }
      for (const problem of checkDraft(draft, sub)) bad.push(`запись №${i + 1}: ${problem}`);
    });
  } else if (result.drafts.length) {
    bad.push(...checkDraft(result.drafts[0], exp));
  } else {
    bad.push("не создано ни одной записи");
  }
  return bad;
}

// —————————————————————————————————————————————————————————————
// Прогон
// —————————————————————————————————————————————————————————————
const only = process.argv[2] ? process.argv[2].toLowerCase() : null;
const cases = only ? CASES.filter(c => c.cat.toLowerCase().includes(only)) : CASES;

const nowParts = zonedParts(MOMENTS[0].now, TZ);
console.log("ВИРТУАЛЬНЫЙ ЧЕЛОВЕК ГОВОРИТ С ПРИЛОЖЕНИЕМ");
console.log(`Дата разговора: ${nowParts.day}.${nowParts.month + 1}.${nowParts.year}, воскресенье, ${TZ}`);
console.log(`Каждая фраза проверяется при «сейчас» = ${MOMENTS.map(m => m.label).join(", ")}`);
console.log(`Фраз в корпусе: ${cases.length}, всего проверок: ${cases.length * MOMENTS.length}\n`);

const stats = new Map();
const holes = [];
let ok = 0;
let disputed = 0;
let failed = 0;

function bump(cat, field) {
  const row = stats.get(cat) || { total: 0, ok: 0, disputed: 0, failed: 0 };
  row[field] += 1;
  if (field !== "total") row.total += 1;
  stats.set(cat, row);
}

let lastCat = "";
let index = 0;

for (const c of cases) {
  index += 1;
  if (c.cat !== lastCat) {
    console.log(`\n═══ ${c.cat.toUpperCase()} ═══`);
    lastCat = c.cat;
  }

  const runs = MOMENTS.map(moment => {
    const result = parse(c.text, { now: moment.now, tz: TZ, settings: SETTINGS });
    return { moment, result, bad: checkCase(c, result, moment), shown: showResult(result) };
  });

  console.log(`\n[${index}] Человек: «${c.text}»`);
  const sameEverywhere = new Set(runs.map(r => r.shown)).size === 1;
  if (sameEverywhere) {
    console.log(`     Приложение: ${runs[0].shown}`);
  } else {
    for (const r of runs) console.log(`     в ${r.moment.label} → ${r.shown}`);
  }

  const broken = runs.filter(r => r.bad.length);
  if (c.disputed) {
    disputed += 1;
    bump(c.cat, "disputed");
    console.log(`     ~ спорно: ${c.disputed}`);
  } else if (!broken.length) {
    ok += 1;
    bump(c.cat, "ok");
    console.log("     ✓ верно");
  } else {
    failed += 1;
    bump(c.cat, "failed");
    for (const r of broken) {
      const where = sameEverywhere ? "" : ` (в ${r.moment.label})`;
      console.log(`     ✗ ошибка${where}: ${r.bad.join("; ")}`);
    }
    holes.push({
      cat: c.cat,
      text: c.text,
      got: broken[0].shown,
      why: broken[0].bad.join("; "),
    });
  }
}

console.log("\n\n═══════════════ ИТОГ ПО КАТЕГОРИЯМ ═══════════════");
const pad = (s, n) => String(s).padEnd(n, " ");
console.log(`${pad("Категория", 22)}${pad("фраз", 6)}${pad("верно", 7)}${pad("спорно", 8)}ошибок`);
for (const [cat, row] of stats) {
  console.log(`${pad(cat, 22)}${pad(row.total, 6)}${pad(row.ok, 7)}${pad(row.disputed, 8)}${row.failed}`);
}
console.log(`${pad("ВСЕГО", 22)}${pad(cases.length, 6)}${pad(ok, 7)}${pad(disputed, 8)}${failed}`);
const share = cases.length ? Math.round((ok / cases.length) * 100) : 0;
const shareWithDisputed = cases.length ? Math.round(((ok + disputed) / cases.length) * 100) : 0;
console.log(`\nВерно: ${share}% фраз; вместе со спорными (фактическое поведение принято): ${shareWithDisputed}%`);

if (holes.length) {
  console.log("\n═══════════════ НАЙДЕННЫЕ ДЫРЫ ═══════════════");
  for (const h of holes) {
    console.log(`\n• [${h.cat}] «${h.text}»`);
    console.log(`  записало: ${h.got}`);
    console.log(`  не так:   ${h.why}`);
  }
} else {
  console.log("\nЯвных ошибок разбора не осталось.");
}

console.log("");
// Отчётный скрипт: ненулевой код только при поломке самого прогона.
process.exit(0);
