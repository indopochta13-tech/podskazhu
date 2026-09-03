import { parse, shelfFor, resolveCaptureTarget, detectIntent, SHELF_PROFILES, itemMatchesKind, classifyKind } from "../lib/parse.js";
import { zonedParts, addDays } from "../lib/time.js";

const tz = "Europe/Moscow";
const now = Date.UTC(2026, 7, 2, 6, 0);
const ctx = { now, tz, settings: { remindMeeting: 15, remindTask: 0, alarmMeetings: true } };
const nowParts = zonedParts(now, tz);

let failed = 0;

function show(item) {
  const date = item.date ? `${item.date.day}.${item.date.month + 1}.${item.date.year}` : "—";
  const time = item.time ? `${String(item.time.hour).padStart(2, "0")}:${String(item.time.minute).padStart(2, "0")}` : "—";
  const repeat = item.repeat ? ` | повтор ${item.repeat.kind}` : "";
  return `${item.type} | ${item.title} | ${date} ${time} | пуш ${item.remind} | место ${item.place || "—"}${repeat}`;
}

function check(label, condition, detail) {
  if (!condition) {
    failed += 1;
    console.log(`  ✗ ${label} → ${detail}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log(`Сейчас: ${nowParts.day}.${nowParts.month + 1}.${nowParts.year} ${nowParts.hour}:00 (${tz})\n`);

const cases = [
  {
    text: "встреча завтра в 10 на Таганке",
    test: r => {
      const i = r.drafts[0];
      return i.type === "meeting" && i.date.day === 3 && i.time.hour === 10 && i.remind === 15 && /Таган/i.test(i.place);
    },
  },
  {
    text: "не забыть купить термопасту в субботу",
    test: r => {
      const i = r.drafts[0];
      return i.type === "buy" && i.date && i.date.day === 8 && !i.time;
    },
  },
  {
    text: "созвон с клиентом сегодня в 19:30",
    test: r => {
      const i = r.drafts[0];
      return i.type === "meeting" && i.date.day === 2 && i.time.hour === 19 && i.time.minute === 30;
    },
  },
  {
    text: "отмени встречу на Таганке",
    test: r => r.intent === "cancel" && /таган/i.test(r.rawQuery),
  },
  {
    text: "перенеси созвон на 13",
    test: r => r.intent === "move" && r.time && r.time.hour === 13,
  },
  {
    text: "день рождения Маши 12 марта",
    test: r => {
      const i = r.drafts[0];
      return i.type === "bday" && i.date.day === 12 && i.date.month === 2 && i.remind === 1440;
    },
  },
  {
    text: "напомни через 2 часа позвонить маме",
    test: r => {
      const i = r.drafts[0];
      return i.time && i.time.hour === 11 && /мам/i.test(i.title);
    },
  },
  {
    text: "стендап в пятницу в 10 утра и ещё оплатить хостинг",
    test: r => r.drafts.length === 2 && r.drafts[0].time.hour === 10 && r.drafts[1].type !== "meeting",
  },
  {
    text: "записать идею про упаковку",
    test: r => {
      const i = r.drafts[0];
      return !i.date && !i.time && i.type === "note";
    },
  },
  {
    text: "встреча с юристом 15.09 в 16:00 напомни за час",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 15 && i.date.month === 8 && i.time.hour === 16 && i.remind === 60;
    },
  },
  {
    text: "завтра вечером забрать заказ",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 3 && i.time.hour === 19;
    },
  },
  {
    text: "послезавтра в 8 утра поликлиника",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 4 && i.time.hour === 8;
    },
  },
  {
    text: "каждый день в 8 утра витамины",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "daily" && i.time.hour === 8 && i.date.day === 3 && /витамин/i.test(i.title);
    },
  },
  {
    text: "по будням в 7:30 будильник на зарядку",
    test: r => {
      const i = r.drafts[0];
      // 2 августа 2026 — воскресенье, значит первый раз в понедельник 3-го
      return i.repeat?.kind === "weekdays" && i.date.day === 3 && i.time.hour === 7 && i.time.minute === 30;
    },
  },
  {
    text: "каждый вторник в 11 планёрка",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "weekly" && i.date.day === 4 && i.time.hour === 11 && i.type === "meeting";
    },
  },
  {
    text: "каждый месяц 5 числа платить за интернет",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "monthly" && i.date.day === 5;
    },
  },
  {
    text: "каждое утро зарядка",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "daily" && i.time.hour === 9;
    },
  },
  {
    text: "по выходным в 10 бассейн",
    test: r => {
      const i = r.drafts[0];
      // сейчас воскресенье 9:00 — значит первый раз сегодня в 10:00
      return i.repeat?.kind === "weekends" && i.date.day === 2 && i.time.hour === 10;
    },
  },
  {
    text: "по субботам в 12 футбол",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "weekly" && i.date.day === 8 && i.time.hour === 12;
    },
  },
  // —— разговорная речь ——
  {
    text: "после обеда заехать в банк",
    test: r => {
      const i = r.drafts[0];
      // «банк» — слот place (или в title у старого поведения); «обед» во время, не в названии.
      return i.time.hour === 15 && /банк/i.test(`${i.title} ${i.place || ""}`) && !/обед/i.test(i.title);
    },
  },
  {
    text: "завтра ближе к вечеру позвонить маме",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 3 && i.time.hour === 18 && !/вечер/i.test(i.title);
    },
  },
  {
    text: "до обеда отправить документы",
    test: r => r.drafts[0].time.hour === 11,
  },
  {
    text: "рано утром пробежка",
    test: r => r.drafts[0].time.hour === 7,
  },
  {
    text: "поздно вечером выкинуть мусор",
    test: r => r.drafts[0].time.hour === 21,
  },
  {
    text: "на следующей неделе сходить к стоматологу",
    test: r => {
      const i = r.drafts[0];
      // 2 августа 2026 — воскресенье, следующий понедельник это 3-е
      return i.date.day === 3 && /стоматолог/i.test(i.title);
    },
  },
  {
    text: "в конце недели забрать справку",
    test: r => r.drafts[0].date.day === 7,
  },
  {
    text: "на выходных помыть машину",
    test: r => r.drafts[0].date.day === 8,
  },
  {
    text: "в конце месяца оплатить квартиру",
    test: r => r.drafts[0].date.day === 31,
  },
  {
    text: "в начале месяца сдать отчет",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 1 && i.date.month === 8;
    },
  },
  {
    text: "встреча в половине седьмого",
    test: r => {
      const i = r.drafts[0];
      return i.time.hour === 18 && i.time.minute === 30 && i.type === "meeting";
    },
  },
  {
    text: "созвон в половине десятого утра",
    test: r => {
      const i = r.drafts[0];
      return i.time.hour === 9 && i.time.minute === 30;
    },
  },
  {
    text: "без пятнадцати восемь выходить из дома",
    test: r => {
      const i = r.drafts[0];
      return i.time.hour === 19 && i.time.minute === 45;
    },
  },
  {
    text: "через два часа проверить почту",
    test: r => r.drafts[0].time.hour === 11,
  },
  {
    text: "через пару дней позвонить в сервис",
    test: r => r.drafts[0].date.day === 4,
  },
  {
    text: "через месяц продлить страховку",
    test: r => {
      const i = r.drafts[0];
      return i.date.month === 8 && i.date.day === 1;
    },
  },
  {
    text: "завтро в десять встреча с бухгалтером",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 3 && i.time.hour === 10 && i.type === "meeting";
    },
  },
  {
    text: "послезавтра забрать документы",
    test: r => r.drafts[0].date.day === 4,
  },
  {
    text: "через 4 дня сдать отчет",
    test: r => r.drafts[0].date.day === 6,
  },
  {
    text: "в конце следующей недели забрать справку",
    test: r => r.drafts[0].date.day === 7 && r.drafts[0].date.month === 7,
  },
  {
    text: "в следующую пятницу стрижка",
    test: r => r.drafts[0].date.day === 7 && r.drafts[0].date.month === 7,
  },
  {
    text: "в следующем месяце оплатить страховку",
    test: r => r.drafts[0].date.month === 8 && r.drafts[0].date.day === 1,
  },
  {
    text: "первые числа следующего месяца заплатить за квартиру",
    test: r => r.drafts[0].date.month === 8 && r.drafts[0].date.day === 1,
  },
  {
    text: "в середине сентября отпуск",
    test: r => r.drafts[0].date.month === 8 && r.drafts[0].date.day === 15,
  },
  {
    text: "в следующем квартале планировать бюджет",
    test: r => r.drafts[0].date.month === 9 && r.drafts[0].date.day === 1,
  },
  {
    text: "в конце квартала сдать отчетность",
    test: r => r.drafts[0].date.month === 8 && r.drafts[0].date.day === 30,
  },
  {
    text: "в следующем году поменять права",
    test: r => r.drafts[0].date.year === 2027 && r.drafts[0].date.month === 0,
  },
  {
    text: "в пять созвон",
    test: r => r.drafts[0].time.hour === 17 && r.drafts[0].date.day === 2,
  },
  {
    text: "встреча завтра в 10 на Таганке, а нет, лучше в 12 на Тверской",
    test: r => {
      const i = r.drafts[0];
      return i.corrected && i.date.day === 3 && i.time.hour === 12 && /тверской/i.test(i.place);
    },
  },
  {
    text: "созвон не в 10, а в 12",
    test: r => r.drafts[0].time.hour === 12 && r.drafts[0].corrected,
  },
  {
    text: "напомни купить хлеб в 6 нет в 7",
    test: r => r.drafts[0].time.hour === 19 && r.drafts[0].title === "Купить хлеб",
  },
  // —— регрессы по прогону «виртуального человека» (qa/virtual-user.mjs) ——
  {
    // Дата числом-словом: «первого сентября» раньше не считалась датой вовсе.
    text: "первого сентября к врачу в 9",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 1 && i.date.month === 8 && i.time.hour === 9;
    },
  },
  {
    // Прошедшая в этом году дата уезжает на следующий год.
    text: "восьмого марта поздравить маму",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 8 && i.date.month === 2 && i.date.year === 2027;
    },
  },
  {
    text: "двадцать третьего числа платить за садик",
    test: r => {
      const i = r.drafts[0];
      return i.date.day === 23 && i.date.month === 7 && /садик/i.test(i.title);
    },
  },
  {
    // Время без двоеточия — так его слышит распознавание речи.
    text: "созвон в 9 30",
    test: r => {
      const i = r.drafts[0];
      return i.time.hour === 9 && i.time.minute === 30 && i.title === "Созвон";
    },
  },
  {
    // Уточнение времени суток стоит ПЕРЕД часами.
    text: "вечером в 9 позвонить бабушке",
    test: r => {
      const i = r.drafts[0];
      return i.time.hour === 21 && !/вечер/i.test(i.title);
    },
  },
  {
    // Слово «будильник» должно включать звонок, а не тихий пуш.
    text: "поставь будильник на 6 30 утра",
    test: r => {
      const i = r.drafts[0];
      return i.alarm === true && i.time.hour === 6 && i.time.minute === 30 && i.date.day === 3;
    },
  },
  {
    // Улица целиком, а не одно слово из названия.
    text: "встреча на улице Строителей в 14",
    test: r => /улице строителей/i.test(r.drafts[0].place),
  },
  {
    text: "встреча на Ленинском проспекте в 16",
    test: r => /ленинском проспекте/i.test(r.drafts[0].place),
  },
  {
    text: "в поликлинике на Мира в 11 приём",
    test: r => {
      const i = r.drafts[0];
      return /поликлинике на мира/i.test(i.place) && i.time.hour === 11;
    },
  },
  {
    // Слова-паразиты и оговорки не должны попадать в название.
    text: "эээ ну короче надо в 12 забрать торт",
    test: r => r.drafts[0].title === "Забрать торт" && r.drafts[0].time.hour === 12,
  },
  {
    text: "напомни за неделю про страховку 20 сентября",
    test: r => {
      const i = r.drafts[0];
      return i.remind === 10080 && i.date.day === 20 && i.date.month === 8;
    },
  },
  {
    text: "каждый год 9 мая поздравить деда",
    test: r => {
      const i = r.drafts[0];
      return i.yearly === true && i.date.day === 9 && i.date.month === 4;
    },
  },
  {
    // Два дня недели: берём ближайший из них (вторник 4 августа).
    text: "по вторникам и четвергам english в 19",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "weekly" && i.date.day === 4 && i.time.hour === 19;
    },
  },
  {
    // «в течение недели» — это срок до конца рабочей недели, пятница 7 августа.
    text: "в течение недели сдать отчёт",
    test: r => r.drafts[0].date.day === 7 && /отч/i.test(r.drafts[0].title),
  },
  {
    // Второе дело со глаголом в конце: «...сходить и в магазин зайти».
    text: "в аптеку сходить и в магазин зайти",
    test: r => r.drafts.length === 2 && /магазин/i.test(r.drafts[1].title),
  },
  {
    // Поправка сохраняет время суток первой версии: было 18:00, стало 19:00, а не 7 утра.
    text: "встреча в 6 нет лучше в 7",
    test: r => {
      const i = r.drafts[0];
      return i.corrected && i.time.hour === 19;
    },
  },
  {
    // Относительный перенос: сервер сам сдвинет запись на 60 минут вперёд.
    text: "перенеси созвон на час позже",
    test: r => r.intent === "move" && r.shift === 60 && /созвон/i.test(r.rawQuery),
  },
  {
    text: "сдвинь стоматолога на полчаса раньше",
    test: r => r.intent === "move" && r.shift === -30,
  },
  {
    // Заметке время не нужно — чат не должен переспрашивать про него.
    // «мысль» — род объекта, в названии не держим.
    text: "запиши мысль про новый лендинг",
    test: r => {
      const i = r.drafts[0];
      return i.type === "note" && i.needsTime === false
        && /лендинг/i.test(i.title) && !/^мысль/i.test(i.title);
    },
  },
  {
    text: "запиши заметку про отпуск",
    test: r => {
      const i = r.drafts[0];
      return i.type === "note" && /отпуск/i.test(i.title) && !/заметк/i.test(i.title);
    },
  },
  {
    text: "создай заметку",
    test: r => r.drafts[0]?.type === "note" && r.drafts[0]?.title === "Без названия",
  },
  {
    text: "положи в заметки рецепт борща",
    test: r => {
      const i = r.drafts[0];
      return i.type === "note" && /борщ/i.test(i.title) && !i.place && !/заметк/i.test(i.title);
    },
  },
  {
    text: "заметка купить молоко",
    test: r => r.drafts[0]?.type === "note" && /молок/i.test(r.drafts[0]?.title || ""),
  },
  {
    text: "запомни мысль про йогу",
    test: r => r.drafts[0]?.type === "note" && /йог/i.test(r.drafts[0]?.title || ""),
  },
  {
    text: "за метка ключ от дачи",
    test: r => r.drafts[0]?.type === "note" && /ключ/i.test(r.drafts[0]?.title || ""),
  },
  {
    // Профессия после «у» — это встреча, а не дело.
    text: "у нотариуса в четверг в 15",
    test: r => {
      const i = r.drafts[0];
      return i.type === "meeting" && i.date.day === 6 && i.time.hour === 15;
    },
  },
  {
    // Покупка без срока остаётся покупкой и не уезжает в заметки.
    text: "купить хлеб",
    test: r => {
      const i = r.drafts[0];
      return i.type === "buy" && shelfFor(i) === "buy" && !i.date && i.needsTime === false;
    },
  },
  {
    text: "надо купить корм коту",
    test: r => r.drafts[0].type === "buy" && r.drafts[0].title === "Купить корм коту",
  },
  {
    text: "заехать в магазин за продуктами",
    test: r => r.drafts[0].type === "buy",
  },
  {
    text: "закупиться продуктами на выходных",
    test: r => {
      const i = r.drafts[0];
      return i.type === "buy" && i.date && i.date.day === 8;
    },
  },
  {
    text: "взять в аптеке витамин д",
    test: r => r.drafts[0].type === "buy",
  },
  {
    // Покупка со сроком показывается и в «Сегодня», но живёт на полке покупок.
    text: "купить подарок маме в пятницу",
    test: r => {
      const i = r.drafts[0];
      return i.type === "buy" && shelfFor(i) === "buy" && i.date.day === 7;
    },
  },
  {
    // Покупка и дело в одной фразе расходятся по разным полкам.
    text: "купить хлеб и позвонить маме в 18:00",
    test: r => {
      const [a, b] = r.drafts;
      return r.drafts.length === 2
        && a.type === "buy" && shelfFor(a) === "buy"
        && b.type === "task" && shelfFor(b) === "tasks";
    },
  },
  {
    // «Оплатить» — не покупка в магазине. Без часа остаётся делом:
    // это надо сделать, а не запомнить. Время ставят в календаре.
    text: "оплатить хостинг завтра",
    test: r => r.drafts[0].type === "task" && shelfFor(r.drafts[0]) === "tasks" && r.drafts[0].date && !r.drafts[0].time,
  },
  {
    text: "напомни завтра приготовить курицу",
    test: r => {
      const i = r.drafts[0];
      return i.type === "task" && !i.time && i.date
        && /куриц/i.test(i.title) && !/напомни|завтра/i.test(i.title);
    },
  },
  {
    // Повтор с шагом больше одного: «каждые две недели» раньше уезжало в заметки.
    text: "каждые две недели проверять счётчики",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "weekly" && i.repeat.every === 2 && i.title === "Проверять счётчики";
    },
  },
  {
    text: "раз в два месяца платить за интернет",
    test: r => r.drafts[0].repeat?.kind === "monthly" && r.drafts[0].repeat.every === 2,
  },
  {
    text: "каждые 3 дня отчёт",
    test: r => r.drafts[0].repeat?.kind === "daily" && r.drafts[0].repeat.every === 3,
  },
  {
    // Несколько дней недели в одном повторе: раньше запоминался только вторник.
    text: "по вторникам и четвергам английский в 19:00",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "weekly"
        && JSON.stringify(i.repeat.days) === "[2,4]"
        && i.date.day === 4 && i.time.hour === 19 && i.title === "Английский";
    },
  },
  {
    // Один день недели по-прежнему работает как раньше, без списка дней.
    text: "каждый вторник в 11 планёрка",
    test: r => {
      const i = r.drafts[0];
      return i.repeat?.kind === "weekly" && !i.repeat.days && !i.repeat.every && i.date.day === 4;
    },
  },
  {
    // Курица в духовке: отсчёт от текущего момента, а не «в пять вечера».
    text: "поставь таймер на 5 минут",
    test: r => {
      const i = r.drafts[0];
      return i.type === "task" && i.title === "Таймер" && i.date.day === nowParts.day
        && i.time.hour === 9 && i.time.minute === 5 && i.remind === 0 && i.alarm === true;
    },
  },
  {
    text: "таймер 10 минут",
    test: r => {
      const i = r.drafts[0];
      return i.type === "task" && i.title === "Таймер" && i.time.hour === 9 && i.time.minute === 10;
    },
  },
  {
    text: "таймер на 15 минут выключить курицу",
    test: r => {
      const i = r.drafts[0];
      return i.title === "Выключить курицу" && i.time.hour === 9 && i.time.minute === 15 && i.alarm === true;
    },
  },
  {
    text: "таймер на 10",
    test: r => {
      const i = r.drafts[0];
      return i.title === "Таймер" && i.timer === true && i.time.hour === 9 && i.time.minute === 10;
    },
  },
  {
    // Отсчёт от реальной секунды, не от границы минуты на часах.
    text: "таймер на 1 минуту",
    ctx: { now: Date.UTC(2026, 7, 2, 6, 0, 30), tz, settings: ctx.settings },
    test: r => {
      const i = r.drafts[0];
      return i.timer && i.time?.hour === 9 && i.time?.minute === 1 && i.time?.second === 30;
    },
  },
  {
    text: "через 90 секунд чай",
    ctx: { now: Date.UTC(2026, 7, 2, 6, 0, 0), tz, settings: ctx.settings },
    test: r => {
      const i = r.drafts[0];
      return i.time?.hour === 9 && i.time?.minute === 1 && i.time?.second === 30;
    },
  },
  {
    text: "поставь таймер на час",
    test: r => r.drafts[0].title === "Таймер" && r.drafts[0].time.hour === 10 && r.drafts[0].time.minute === 0,
  },
  {
    text: "таймер на полчаса",
    test: r => r.drafts[0].title === "Таймер" && r.drafts[0].time.hour === 9 && r.drafts[0].time.minute === 30,
  },
  {
    text: "таймер на сорок минут",
    test: r => r.drafts[0].title === "Таймер" && r.drafts[0].time.hour === 9 && r.drafts[0].time.minute === 40,
  },
  {
    // «на 20 минут» у будильника — тоже отсчёт, а не двадцать часов.
    text: "поставь будильник на 20 минут",
    test: r => r.drafts[0].title === "Будильник" && r.drafts[0].time.hour === 9 && r.drafts[0].time.minute === 20,
  },
  {
    // А вот «будильник на 7» остаётся семью часами утра.
    text: "поставь будильник на 7",
    test: r => r.drafts[0].time.hour === 7 && r.drafts[0].time.minute === 0 && r.drafts[0].date.day === nowParts.day + 1,
  },
  {
    // Отсчёт часами задаёт только таймер: «на 7 часов» у будильника — это время суток.
    text: "поставь будильник на 7 часов",
    test: r => r.drafts[0].time.hour === 7 && r.drafts[0].date.day === nowParts.day + 1,
  },
  {
    text: "напоминание на 17 часов",
    test: r => r.drafts[0].time.hour === 17 && r.drafts[0].date.day === nowParts.day,
  },
  {
    // Отменяем только по времени: слов о самой записи человек не сказал.
    text: "удали запись на 17:00",
    test: r => r.intent === "cancel" && r.time?.hour === 17 && r.time?.minute === 0,
  },
  {
    // Названный момент и есть напоминание: звать заранее тут нечего.
    text: "напомни через 5 минут выключить курицу",
    test: r => {
      const i = r.drafts[0];
      return i.title === "Выключить курицу" && i.time.minute === 5 && i.remind === 0;
    },
  },
  {
    // Далёкое «через» ведёт себя как обычная запись — с обычным запасом.
    text: "через 3 часа позвонить в банк",
    test: r => r.drafts[0].time.hour === 12 && r.drafts[0].remind === 0,
  },
  {
    // Явную просьбу о запасе уважаем и при относительном сроке.
    text: "встреча через 40 минут напомни за 10 минут",
    test: r => r.drafts[0].remind === 10 && r.drafts[0].time.minute === 40,
  },
  {
    text: "клиент Иван Петров завтра в 10",
    test: r => {
      const i = r.drafts[0];
      return i.title === "Клиент Иван Петров" && i.who === "Иван Петров"
        && i.time?.hour === 10 && i.date?.day === nowParts.day + 1;
    },
  },
  {
    text: "по вторникам и четвергам в 19 тренировка ноги",
    test: r => {
      const i = r.drafts[0];
      return i.type === "sport" && shelfFor(i) === "sport"
        && i.repeat?.kind === "weekly" && JSON.stringify(i.repeat.days) === "[2,4]"
        && i.time.hour === 19 && /ног/i.test(i.title);
    },
  },
  {
    text: "сегодня в 18 тренировка грудь в зале",
    test: r => {
      const i = r.drafts[0];
      return i.type === "sport" && shelfFor(i) === "sport" && i.time.hour === 18 && i.date.day === nowParts.day;
    },
  },
  {
    // Протокол ухода: один раз сказал — каждый день в 8:00.
    text: "утренний уход очищение тоник сыворотка крем",
    test: r => {
      const i = r.drafts[0];
      return i.type === "care" && shelfFor(i) === "care"
        && i.repeat?.kind === "daily" && i.time.hour === 8 && i.remind === 0;
    },
  },
  {
    text: "вечерний протокол ухода ретинол и крем",
    test: r => {
      const i = r.drafts[0];
      return i.type === "care" && shelfFor(i) === "care"
        && i.repeat?.kind === "daily" && i.time.hour === 21 && i.remind === 0;
    },
  },
  {
    // Ключевые слова своей полки сильнее вшитых типов.
    text: "вызвать сантехника завтра в 12",
    test: r => {
      const i = r.drafts[0];
      return shelfFor(i, { customShelves: [{ id: "c_home", label: "Дом", keywords: ["сантехник", "ремонт"] }] }) === "c_home";
    },
  },
  {
    // «Купить» само по себе — покупка, но слово из конструктора уводит на свою полку.
    text: "купить краску для стен",
    test: r => {
      const i = r.drafts[0];
      return i.type === "buy"
        && shelfFor(i, { customShelves: [{ id: "c_home", label: "Ремонт", keywords: ["краск", "стен"] }] }) === "c_home";
    },
  },
  {
    // Название полки тоже ловит голос.
    text: "завтра домой заехать за документами",
    test: r => {
      const i = r.drafts[0];
      return shelfFor(i, { customShelves: [{ id: "c_home", label: "Дом", keywords: [] }] }) === "c_home";
    },
  },
  {
    // Показания счётчиков — своя полка, не платежи: передавать их и платить
    // по счёту это разные дела с разной периодичностью.
    text: "20 числа каждый месяц передать показания счетчиков",
    test: r => {
      const i = r.drafts[0];
      return i.type === "meters" && shelfFor(i) === "meters"
        && i.repeat?.kind === "monthly" && i.date.day === 20;
    },
  },
  {
    text: "заплатить за квартиру 10 числа",
    test: r => {
      const i = r.drafts[0];
      return i.type === "bills" && shelfFor(i) === "bills" && i.date.day === 10;
    },
  },
  {
    text: "кварплата 25 числа",
    test: r => {
      const i = r.drafts[0];
      return i.type === "bills" && shelfFor(i) === "bills" && i.date.day === 25;
    },
  },
  {
    text: "встреча завтра в 15 телефон 8 900 123 45 67",
    test: r => {
      const i = r.drafts[0];
      return i.type === "meeting" && i.phone && i.phone.includes("900");
    },
  },
  {
    // Платёж без часа не должен требовать время: срок у него дневной.
    text: "оплатить кредит в пятницу",
    test: r => {
      const i = r.drafts[0];
      return i.type === "bills" && i.needsTime === false && i.date.day === 7;
    },
  },
  {
    // Курс лечения: три приёма в день на неделю.
    text: "антибиотик три раза в день семь дней",
    test: r => {
      const i = r.drafts[0];
      return i.type === "health" && shelfFor(i) === "health"
        && i.course?.perDay === 3 && i.course?.days === 7
        && i.repeat?.kind === "daily" && i.date.day === nowParts.day;
    },
  },
  {
    text: "пить таблетки 2 раза в день 10 дней",
    test: r => {
      const i = r.drafts[0];
      return i.type === "health" && i.course?.perDay === 2 && i.course?.days === 10;
    },
  },
  {
    // Без длительности курса нет — это обычное повторяющееся дело.
    text: "витамины каждый день в 9 утра",
    test: r => {
      const i = r.drafts[0];
      return i.type === "health" && !i.course && i.repeat?.kind === "daily" && i.time.hour === 9;
    },
  },
  {
    // Аптека — это всё-таки покупка, а не приём лекарства.
    text: "взять в аптеке витамин д",
    test: r => r.drafts[0].type === "buy" && shelfFor(r.drafts[0]) === "buy",
  },
  {
    text: "удали последний таймер",
    test: r => r.intent === "cancel" && r.target?.last && r.target?.kind === "timer",
  },
  {
    text: "удали таймер который ставил до этого",
    test: r => r.intent === "cancel" && r.target?.last && r.target?.kind === "timer",
  },
  {
    text: "удали то что я сказал",
    test: r => r.intent === "cancel" && r.target?.saidLast && r.target?.last,
  },
  {
    text: "удали то что сказал",
    test: r => r.intent === "cancel" && r.target?.saidLast,
  },
  {
    // Новый отсчёт, а не сдвиг: метки таймер+последний и время через 10 минут.
    text: "поменяй таймер последний на 10 мин",
    test: r => r.intent === "move" && r.target?.kind === "timer" && r.target?.last
      && r.timer && r.time?.hour === 9 && r.time?.minute === 10 && !r.shift,
  },
  {
    text: "поменяй последний таймер на 10 минут",
    test: r => r.intent === "move" && r.target?.last && r.target?.kind === "timer" && r.timer && !r.shift,
  },
  {
    text: "установи будильник на 1 мин",
    test: r => {
      const i = r.drafts[0];
      return i.alarm === true && i.timer === true
        && i.title === "Будильник"
        && i.time.hour === 9 && i.time.minute === 1 && i.date.day === nowParts.day;
    },
  },
  {
    text: "встреча с Андреем завтра в 15:00",
    test: r => {
      const i = r.drafts[0];
      return i.type === "meeting" && /андре/i.test(i.title) && i.date.day === 3 && i.time.hour === 15;
    },
  },
  {
    text: "заметка на 15 часов",
    test: r => {
      const i = r.drafts[0];
      return i.time?.hour === 15 && i.time?.minute === 0 && !i.timer;
    },
  },
  {
    text: "напомни на 15 часов",
    test: r => {
      const i = r.drafts[0];
      return i.time?.hour === 15 && i.time?.minute === 0 && !i.timer;
    },
  },
  {
    text: "на пятнадцать часов купить хлеб",
    test: r => {
      const i = r.drafts[0];
      return i.time?.hour === 15 && i.time?.minute === 0 && /хлеб/i.test(i.title);
    },
  },
  {
    text: "заметка на15часов",
    test: r => {
      const i = r.drafts[0];
      return i.time?.hour === 15 && i.time?.minute === 0;
    },
  },
  {
    text: "клиент Иван Петров завтра в 10",
    test: r => {
      const i = r.drafts[0];
      return /клиент/i.test(i.title) && /иван/i.test(i.title) && i.date.day === 3 && i.time.hour === 10;
    },
  },
  {
    text: "встреча с клиентом десять пятнадцать",
    test: r => {
      const i = r.drafts[0];
      return i.type === "meeting" && i.time?.hour === 10 && i.time?.minute === 15
        && /^встреча с клиентом$/i.test(i.title.trim());
    },
  },
  {
    text: "встреча с клиентом 10-15",
    test: r => {
      const i = r.drafts[0];
      return i.time?.hour === 10 && i.time?.minute === 15 && !/10/.test(i.title);
    },
  },
  {
    text: "встреча десять сорок пять",
    test: r => r.drafts[0].time?.hour === 10 && r.drafts[0].time?.minute === 45,
  },
  {
    text: "встреча десять десять",
    test: r => r.drafts[0].time?.hour === 10 && r.drafts[0].time?.minute === 10,
  },
];

for (const c of cases) {
  const result = parse(c.text, c.ctx || ctx);
  const detail = result.intent === "create"
    ? result.drafts.map(show).join(" || ")
    : `intent=${result.intent} query="${result.query}" date=${JSON.stringify(result.date)} time=${JSON.stringify(result.time)}`;
  check(`"${c.text}"`, c.test(result), detail);
  console.log(`      ${detail}`);
}

console.log(failed ? `\n${failed} из ${cases.length} не прошли` : `\nВсе ${cases.length} кейсов прошли`);

console.log("\nВыбор цели cancel/move:");
{
  const pool = [
    { id: "a", title: "Выключить курицу", timer: true, type: "task", createdAt: 1 },
    { id: "b", title: "Таймер чай", timer: true, type: "task", createdAt: 2 },
    { id: "c", title: "Созвон с банком", type: "meeting", createdAt: 3 },
    { id: "d", title: "Купить хлеб", timer: false, type: "task", createdAt: 4 },
  ];

  const lastTimer = resolveCaptureTarget(pool, parse("удали последний таймер", ctx));
  check("последний таймер → свежий timer", lastTimer?.mode === "last_kind" && lastTimer.items[0]?.id === "b", JSON.stringify(lastTimer));

  const prevTimer = resolveCaptureTarget(pool, parse("удали таймер который ставил до этого", ctx));
  check("таймер который ставил → last_kind", prevTimer?.mode === "last_kind" && prevTimer.items[0]?.id === "b", JSON.stringify(prevTimer));

  const said = resolveCaptureTarget(pool, parse("удали то что сказал", ctx));
  check("то что сказал → последняя запись вообще", said?.mode === "last" && said.items[0]?.id === "d", JSON.stringify(said));

  const exact = resolveCaptureTarget(pool, parse("удали выключить курицу", ctx));
  check("точное название важнее рода", exact?.mode === "exact" && exact.items[0]?.id === "a", JSON.stringify(exact));

  const moveTimer = resolveCaptureTarget(pool, parse("поменяй таймер последний на 10 мин", ctx));
  check("правка последнего таймера", moveTimer?.mode === "last_kind" && moveTimer.items[0]?.id === "b", JSON.stringify(moveTimer));

  const laundry = [{ id: "n1", title: "Постирать белье", type: "note", createdAt: 5 }];
  for (const phrase of [
    "внеси изменения в заметку постирать белье на 9 утра",
    "внеси правки постирать белье на 9 утра",
    "исправь заметку постирать белье на 9 утра",
    "поправь постирать белье на 9 утра",
    "измени заметку постирать белье на 9 утра",
  ]) {
    const edited = parse(phrase, ctx);
    const hit = resolveCaptureTarget(laundry, edited);
    check(
      `правка «${phrase}» → move + постирать белье`,
      edited.intent === "move"
        && edited.time?.hour === 9
        && hit?.items?.[0]?.id === "n1"
        && !/внес|правк|исправ|поправ|измен/i.test(edited.query || ""),
      JSON.stringify({ intent: edited.intent, query: edited.query, time: edited.time, hit }),
    );
  }

  const meets = [
    { id: "m1", title: "Встреча с клиентом на Беговой", type: "meeting", place: "Беговой", createdAt: 1 },
    { id: "m2", title: "Встреча с клиентом на Тимирязевской", type: "meeting", place: "Тимирязевской", createdAt: 3 },
    { id: "m3", title: "Встреча с клиентом", type: "meeting", place: "", createdAt: 2 },
  ];
  const movePlace = parse("измени встречу на тимерязевской и поставь ее на 11 часов", ctx);
  const hitPlace = resolveCaptureTarget(meets, movePlace);
  check(
    "правка встречи на тимерязевской (опечатка STT) → свежая на Тимирязевской + 11:00",
    movePlace.intent === "move"
      && movePlace.time?.hour === 11
      && hitPlace?.items?.[0]?.id === "m2",
    JSON.stringify({ intent: movePlace.intent, time: movePlace.time, query: movePlace.query, hit: hitPlace }),
  );

  check("detectIntent create", detectIntent("встреча завтра в 10") === "create");
  check("detectIntent move", detectIntent("измени встречу на 11") === "move");
  check("detectIntent cancel", detectIntent("удали последний таймер") === "cancel");

  const slotted = parse("встреча с клиентом на тимирязевской десять пятнадцать", ctx);
  check(
    "слоты create: title/time/place без времени в названии",
    slotted.intent === "create"
      && slotted.slots?.time?.hour === 10
      && slotted.slots?.time?.minute === 15
      && /тимиряз/i.test(slotted.slots?.place || "")
      && !/10|пятнадца/i.test(slotted.slots?.title || "")
      && !/тимиряз/i.test(slotted.drafts[0]?.title || ""),
    JSON.stringify({ slots: slotted.slots, title: slotted.drafts[0]?.title }),
  );

  console.log("\nПрофили закладок:");
  const shelfCases = [
    ["поставь будильник на 7", "alarms", i => i.type === "alarm" && i.time?.hour === 7],
    ["созвон с банком завтра в 11", "meetings", i => i.type === "meeting" && i.time?.hour === 11],
    ["отправить отчет в пятницу", "tasks", i => i.type === "task" && !i.time && Boolean(i.date)],
    ["отправить отчет в пятницу в 15", "tasks", i => i.type === "task" && i.time?.hour === 15],
    ["вторник в 19 тренировка ноги", "sport", i => i.type === "sport"],
    ["плавание в бассейне в среду", "sport", i => i.type === "sport"],
    ["утренний уход очищение тоник крем", "care", i => i.type === "care" && i.carePart === "morning"],
    ["надо купить молоко и хлеб", "buy", i => i.type === "buy"],
    ["добавь в список сыр", "buy", i => i.type === "buy"],
    ["передать показания 20 числа", "meters", i => i.type === "meters" && i.remind === 1440],
    ["оплатить интернет 5 числа", "bills", i => i.type === "bills"],
    ["антибиотик три раза в день семь дней", "health", i => i.type === "health" && i.course],
    ["измерить давление вечером", "health", i => i.type === "health"],
    ["запиши мысль про отпуск", "notes", i => i.type === "note"],
    ["день рождения Маши 12 марта", "bday", i => i.type === "bday" && i.yearly],
    ["напомни завтра приготовить курицу", "tasks", i => i.type === "task" && /куриц/i.test(i.title) && !i.time],
    ["напомни установить приложение", "tasks", i => i.type === "task" && /установ/i.test(i.title) && /приложен/i.test(i.title)],
    ["молоко и хлеб", "buy", i => i.type === "buy"],
    ["купить курицу", "buy", i => i.type === "buy"],
    ["запиши заметку купить цветы", "notes", i => i.type === "note"],
    ["надо купить подгузники", "buy", i => i.type === "buy"],
    ["позвонить маме завтра в 18", "tasks", i => i.type === "task" && i.time?.hour === 18],
  ];
  for (const [phrase, shelf, pred] of shelfCases) {
    const r = parse(phrase, ctx);
    const i = r.drafts[0];
    check(
      `полка ${shelf}: «${phrase}»`,
      i && pred(i) && (r.slots?.shelf === shelf || shelfFor(i) === shelf),
      JSON.stringify({ type: i?.type, shelf: r.slots?.shelf, shelfFor: i && shelfFor(i), title: i?.title, remind: i?.remind }),
    );
  }

  check("профили SHELF_PROFILES на месте", Object.keys(SHELF_PROFILES).length >= 10);
  check(
    "правка покупки по роду",
    resolveCaptureTarget(
      [{ id: "b1", title: "Купить молоко", type: "buy", createdAt: 1 }],
      parse("удали покупку молоко", ctx),
    )?.items?.[0]?.id === "b1",
  );
  check("itemMatchesKind sport", itemMatchesKind({ type: "sport" }, "sport"));
  check("classifyKind: заметка сильнее покупки", classifyKind("запиши заметку купить цветы").type === "note");
  check("classifyKind: продукты без глагола", classifyKind("молоко и хлеб").type === "buy");
  check("shelfFor не залипает tasks на note", shelfFor({ type: "note", shelf: "tasks", title: "Приготовить" }) === "notes");
  check("shelfFor: счётчики на meters при type bills", shelfFor({ type: "bills", shelf: "meters", title: "Свет" }) === "meters");
  check("shelfFor: платежи на bills", shelfFor({ type: "bills", shelf: "bills", title: "Кварплата" }) === "bills");

  console.log("\nВолна Алисы (лексика + время):");
  const aliceCases = [
    {
      // Утро уже прошло (сейчас 9:00) — ближайшее «без четверти восемь» = 19:45.
      text: "без четверти восемь выходить",
      test: r => r.drafts[0]?.time?.minute === 45 && (r.drafts[0]?.time?.hour === 7 || r.drafts[0]?.time?.hour === 19),
    },
    {
      text: "в четверть пятого созвон",
      test: r => r.drafts[0]?.type === "meeting" && r.drafts[0]?.time?.minute === 15,
    },
    {
      text: "через полтора часа проверить духовку",
      test: r => {
        const i = r.drafts[0];
        return i?.time && (i.time.hour * 60 + i.time.minute) === (nowParts.hour * 60 + nowParts.minute + 90) % (24 * 60)
          || (i?.time?.hour === 10 && i?.time?.minute === 30);
      },
    },
    {
      text: "к обеду заехать в банк",
      test: r => r.drafts[0]?.time?.hour === 13,
    },
    {
      text: "под вечер позвонить",
      test: r => r.drafts[0]?.time?.hour === 18 || r.drafts[0]?.time?.hour === 19,
    },
    {
      text: "сдать отчет на этой неделе",
      test: r => {
        const fri = addDays(nowParts, (5 - nowParts.weekday + 7) % 7);
        const d = r.drafts[0]?.date;
        return d && d.day === fri.day && d.month === fri.month;
      },
    },
    {
      text: "запланируй встречу на завтра в 11",
      test: r => r.intent === "create" && r.drafts[0]?.type === "meeting" && r.drafts[0]?.time?.hour === 11,
    },
    {
      text: "назначь созвон на пятницу в 15",
      test: r => r.drafts[0]?.type === "meeting" && r.drafts[0]?.time?.hour === 15,
    },
    {
      text: "включи будильник на 7",
      test: r => r.drafts[0]?.type === "alarm" && r.drafts[0]?.time?.hour === 7,
    },
    {
      text: "сигнал на 6:30",
      test: r => r.drafts[0]?.type === "alarm" && r.drafts[0]?.time?.hour === 6 && r.drafts[0]?.time?.minute === 30,
    },
    {
      text: "напоминалка на 18 про аптеку",
      test: r => r.drafts[0]?.time?.hour === 18 && /аптек/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "созвон в тимсе завтра в 12",
      test: r => r.drafts[0]?.type === "meeting" && r.drafts[0]?.time?.hour === 12,
    },
    {
      text: "отложи на 10 минут",
      test: r => r.intent === "move" && r.shift === 10,
    },
    {
      text: "переставь созвон на 14",
      test: r => r.intent === "move" && r.time?.hour === 14,
    },
    {
      text: "вычеркни молоко",
      test: r => r.intent === "cancel" && /молок/i.test(r.query || r.rawQuery || ""),
    },
    {
      text: "бу дильник на 7",
      test: r => r.drafts[0]?.type === "alarm" && r.drafts[0]?.time?.hour === 7,
    },
    {
      text: "встреча в930",
      test: r => r.drafts[0]?.time?.hour === 9 && r.drafts[0]?.time?.minute === 30,
    },
    {
      text: "поставь таймер на 10 минут",
      test: r => r.drafts[0]?.title === "Таймер" && r.drafts[0]?.timer === true && r.drafts[0]?.time?.minute === 10,
    },
    {
      text: "таймер на 10",
      test: r => r.drafts[0]?.title === "Таймер" && !/10/.test(r.drafts[0]?.title || ""),
    },
    // ——— Заметки как у Алисы: полка, чистый title, разные формулировки ———
    {
      text: "запиши заметку про отпуск",
      test: r => r.drafts[0]?.type === "note" && /отпуск/i.test(r.drafts[0]?.title || "") && !/заметк/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "добавь в заметки адрес склада",
      test: r => r.drafts[0]?.type === "note" && /склад/i.test(r.drafts[0]?.title || "") && !r.drafts[0]?.place,
    },
    {
      text: "кинь в заметки пароль wifi",
      test: r => r.drafts[0]?.type === "note" && /пароль|wifi/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "в заметках ключ от дачи",
      test: r => r.drafts[0]?.type === "note" && /ключ/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "новая заметка про переезд",
      test: r => r.drafts[0]?.type === "note" && /переезд/i.test(r.drafts[0]?.title || "") && !/заметк/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "записать идею про упаковку",
      test: r => r.drafts[0]?.type === "note" && /упаковк/i.test(r.drafts[0]?.title || "") && !/^записать/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "чтобы не забыть номер страховки",
      test: r => r.drafts[0]?.type === "note" && /страховк/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "на будущее почитать про сон",
      test: r => r.drafts[0]?.type === "note" && /сон|почитать/i.test(r.drafts[0]?.title || "") && !/будущ/i.test(r.drafts[0]?.place || ""),
    },
    {
      text: "заметка позвонить маме когда будет время",
      test: r => r.drafts[0]?.type === "note" && /мам/i.test(r.drafts[0]?.title || "") && !/^заметк/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "окей запиши заметку купить цветы",
      test: r => r.drafts[0]?.type === "note" && /цвет/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "запомни что пароль от роутера админ",
      test: r => r.drafts[0]?.type === "note" && /пароль/i.test(r.drafts[0]?.title || "") && !/запомни|^что/i.test(r.drafts[0]?.title || ""),
    },
    {
      text: "удали последнюю заметку",
      test: r => r.intent === "cancel" && r.target?.kind === "note",
    },
  ];
  for (const c of aliceCases) {
    const r = parse(c.text, ctx);
    check(`Алиса: «${c.text}»`, c.test(r), JSON.stringify({
      intent: r.intent,
      shift: r.shift,
      time: r.drafts?.[0]?.time || r.time,
      date: r.drafts?.[0]?.date || r.date,
      type: r.drafts?.[0]?.type,
      title: r.drafts?.[0]?.title,
      place: r.drafts?.[0]?.place,
      target: r.target,
      query: r.query,
    }));
  }
}

process.exit(failed ? 1 : 0);
