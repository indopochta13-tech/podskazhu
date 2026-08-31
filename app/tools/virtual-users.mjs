/**
 * Пятьдесят виртуальных людей живут в приложении своим днём: диктуют записи,
 * ставят будильники, переносят дела, делятся с близкими, ведут общий список,
 * жалуются и блокируют. Скрипт поднимает свой сервер и свою базу, ничего чужого не трогает.
 *
 * Запуск: node tools/virtual-users.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PORT = 8850 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const TZ = "Europe/Moscow";

const sleep = ms => new Promise(r => setTimeout(r, ms));

let problems = [];
let checks = 0;

function ok(person, label, condition, detail = "") {
  checks += 1;
  if (!condition) problems.push({ person, label, detail: String(detail).slice(0, 200) });
  return Boolean(condition);
}

async function call(pathname, { method = "GET", body, token = "" } = {}) {
  const res = await fetch(`${BASE}/api${pathname}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/* —— как считает время сам сервер: сверяем даты в часовом поясе человека —— */
function parts(ts = Date.now()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const out = {};
  for (const p of fmt.formatToParts(ts)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month) - 1,
    day: Number(out.day),
    hour: Number(out.hour === "24" ? 0 : out.hour),
    minute: Number(out.minute),
  };
}

function shiftDays(base, days) {
  const d = new Date(Date.UTC(base.year, base.month, base.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function sameDate(a, b) {
  return Boolean(a && b) && a.year === b.year && a.month === b.month && a.day === b.day;
}

// Сравнимая метка времени записи: сервер отдаёт день и время раздельно.
function whenValue(item) {
  if (!item?.date) return 0;
  const base = Date.UTC(item.date.year, item.date.month, item.date.day);
  const time = item.time ? item.time.hour * 3600000 + item.time.minute * 60000 : 0;
  return base + time;
}

/* —— речь людей: каждая фраза с тем, что обязано получиться —— */
const PHRASES = [
  { text: "встреча с врачом завтра в 10:30", type: "meeting", tomorrow: true, time: [10, 30] },
  { text: "купить молоко и хлеб", type: "buy" },
  { text: "оплатить интернет 15 числа", type: "bills" },
  { text: "витамины каждый день в 9 утра", type: "health", repeat: "daily", time: [9, 0] },
  { text: "поставь будильник на 6:45", type: "alarm", time: [6, 45] },
  { text: "тренировка ноги завтра в 19", type: "sport", tomorrow: true, time: [19, 0] },
  { text: "записать мысль про новый проект", type: "note" },
  { text: "напомни через 2 часа позвонить маме", type: "task" },
  { text: "забрать посылку послезавтра", type: "task" },
  { text: "передать показания счётчиков 20 числа каждый месяц", type: "bills", repeat: "monthly" },
  { text: "созвон с командой сегодня в 17:00", type: "meeting", today: true, time: [17, 0] },
  { text: "день рождения Ани 12 марта", type: "bday" },
  { text: "вечерний уход крем и сыворотка", type: "care", repeat: "daily" },
  { text: "по вторникам и четвергам английский в 19:00", repeat: "weekly", time: [19, 0] },
  { text: "заплатить за садик завтра", type: "bills", tomorrow: true },
  { text: "сходить к стоматологу на следующей неделе" },
  { text: "купить корм коту", type: "buy" },
  { text: "поставь таймер на 15 минут" },
  { text: "встреча в кафе на Тверской в 14", type: "meeting", time: [14, 0] },
  { text: "напомни за час про самолёт 20 сентября в 8:00", time: [8, 0], remind: 60 },
];

const NAMES = [
  "Аня", "Борис", "Вера", "Глеб", "Дина", "Егор", "Жанна", "Захар", "Ирина", "Кирилл",
  "Лена", "Миша", "Настя", "Олег", "Полина", "Рома", "Света", "Тимур", "Ульяна", "Фёдор",
  "Хава", "Цвета", "Чулпан", "Шамиль", "Эдик", "Юля", "Яна", "Артём", "Богдан", "Влад",
  "Галя", "Денис", "Елена", "Женя", "Зоя", "Игорь", "Ксюша", "Лиза", "Марат", "Нина",
  "Оксана", "Павел", "Рита", "Стас", "Таня", "Урал", "Фарид", "Юра", "Ярослав", "Алиса",
];

async function createPerson(name) {
  const start = await call("/start", { method: "POST", body: { tz: TZ, consent: "2026-08-01" } });
  if (start.status !== 200 || !start.data?.token) {
    problems.push({ person: name, label: "аккаунт не создался", detail: JSON.stringify(start.data).slice(0, 120) });
    return null;
  }
  return { name, token: start.data.token, code: start.data.user.code };
}

async function dayOfPerson(person, index) {
  const t = person.token;
  const today = parts();

  // 1. Диктует несколько дел — у каждого человека свой набор.
  const mine = [];
  for (let i = 0; i < 5; i += 1) {
    const phrase = PHRASES[(index * 5 + i) % PHRASES.length];
    const res = await call("/capture", { method: "POST", body: { text: phrase.text }, token: t });
    const reply = res.data?.reply;
    if (!ok(person.name, `запись «${phrase.text}»`, res.status === 200 && reply, JSON.stringify(res.data).slice(0, 120))) continue;
    if (reply.kind === "duplicate") continue;
    const item = reply.items?.[0];
    if (!ok(person.name, `разбор «${phrase.text}»`, Boolean(item), JSON.stringify(reply).slice(0, 140))) continue;
    mine.push(item);

    ok(person.name, `заголовок не пустой «${phrase.text}»`, Boolean(item.title && item.title.trim()), item.title);
    if (phrase.type) ok(person.name, `тип «${phrase.text}»`, item.type === phrase.type, `${item.type} вместо ${phrase.type}`);
    if (phrase.repeat) ok(person.name, `повтор «${phrase.text}»`, item.repeat?.kind === phrase.repeat, JSON.stringify(item.repeat));
    if (phrase.time) {
      ok(person.name, `время «${phrase.text}»`,
        item.time?.hour === phrase.time[0] && item.time?.minute === phrase.time[1],
        JSON.stringify(item.time));
    }
    if (phrase.tomorrow) {
      ok(person.name, `дата «завтра» в «${phrase.text}»`, sameDate(item.date, shiftDays(today, 1)), JSON.stringify(item.date));
    }
    if (phrase.today) {
      ok(person.name, `дата «сегодня» в «${phrase.text}»`, sameDate(item.date, today), JSON.stringify(item.date));
    }
    if (phrase.remind) {
      ok(person.name, `напоминание за час «${phrase.text}»`, item.remind === phrase.remind, String(item.remind));
    }
    // Запись с датой обязана иметь корректный день недели и не уезжать в прошлое без причины.
    if (item.date && !item.repeat && (phrase.tomorrow || phrase.today)) {
      const value = whenValue(item);
      ok(person.name, `дата не в прошлом «${phrase.text}»`, value > 0, JSON.stringify(item.date));
    }
  }

  // 2. Дубль второй раз не создаётся.
  if (mine[0]) {
    const again = await call("/capture", { method: "POST", body: { text: PHRASES[(index * 5) % PHRASES.length].text }, token: t });
    ok(person.name, "дубль не плодится", again.data?.reply?.kind === "duplicate", again.data?.reply?.kind);
  }

  // 3. Что-то делает: закрывает, откладывает, переносит.
  const withTime = mine.find(i => i.time && i.date && !i.repeat);
  if (withTime) {
    const snoozed = await call(`/items/${withTime.id}/snooze`, { method: "POST", body: { minutes: 60 }, token: t });
    const moved = snoozed.data?.items?.find(i => i.id === withTime.id);
    ok(person.name, "«отложить на час» двигает время вперёд",
      Boolean(moved) && whenValue(moved) > whenValue(withTime),
      JSON.stringify({ before: withTime.time, after: moved?.time }));
  }

  const repeating = mine.find(i => i.repeat && i.date);
  if (repeating) {
    const done = await call(`/items/${repeating.id}/done`, { method: "POST", body: { done: true }, token: t });
    const next = done.data?.items?.find(i => i.id === repeating.id);
    ok(person.name, "повтор уезжает на следующий раз и не остаётся сделанным",
      Boolean(next) && next.done === false && whenValue(next) > whenValue(repeating),
      JSON.stringify({ before: repeating.date, after: next?.date, done: next?.done }));
  }

  const plain = mine.find(i => !i.repeat);
  if (plain) {
    const done = await call(`/items/${plain.id}/done`, { method: "POST", body: { done: true }, token: t });
    const closed = done.data?.items?.find(i => i.id === plain.id);
    ok(person.name, "обычное дело закрывается", closed?.done === true, JSON.stringify(closed?.done));
    const back = await call(`/items/${plain.id}/done`, { method: "POST", body: { done: false }, token: t });
    ok(person.name, "закрытое можно вернуть", back.data?.items?.find(i => i.id === plain.id)?.done === false);
  }

  // 4. Переносит голосом: «перенеси … на завтра».
  if (mine[1]) {
    const word = String(mine[1].title || "").split(" ")[0];
    const move = await call("/capture", { method: "POST", body: { text: `перенеси ${word} на завтра в 12` }, token: t });
    ok(person.name, "перенос голосом понят",
      ["moved", "ask", "none", "list"].includes(move.data?.reply?.kind) || Boolean(move.data?.reply),
      JSON.stringify(move.data?.reply).slice(0, 120));
  }

  // 5. Настройки: тихие часы, утренний брифинг, своя полка.
  const settings = await call("/settings", {
    method: "POST",
    body: { morningBrief: true, morningHour: 7, quietFrom: 23, quietTo: 7, remindMeeting: 30 },
    token: t,
  });
  ok(person.name, "настройки сохраняются",
    settings.status === 200 && settings.data?.user?.settings?.morningBrief === true && settings.data?.user?.settings?.morningHour === 7,
    JSON.stringify(settings.data?.user?.settings?.morningHour));

  // 6. Состояние отдаёт согласованные данные.
  const state = await call("/state", { token: t });
  ok(person.name, "состояние приходит целиком",
    state.status === 200 && Array.isArray(state.data?.items) && Array.isArray(state.data?.lists) && Boolean(state.data?.billing),
    JSON.stringify(Object.keys(state.data || {})));
  const broken = (state.data?.items || []).filter(i => !i.title || typeof i.title !== "string");
  ok(person.name, "в списке нет записей без текста", broken.length === 0, JSON.stringify(broken.slice(0, 2)));
  const badDates = (state.data?.items || []).filter(i => i.date && (i.date.month < 0 || i.date.month > 11 || i.date.day < 1 || i.date.day > 31));
  ok(person.name, "даты в допустимых границах", badDates.length === 0, JSON.stringify(badDates.slice(0, 2)));

  return { person, items: mine };
}

async function pairWork(a, b) {
  // Общий список на двоих.
  const created = await call("/lists", { method: "POST", body: { name: "Продукты" }, token: a.token });
  const list = created.data?.list;
  if (ok(a.name, "общий список создаётся", Boolean(list?.id), JSON.stringify(created.data).slice(0, 120))) {
    const invited = await call(`/lists/${list.id}/members`, { method: "POST", body: { code: b.code }, token: a.token });
    ok(a.name, "в общий список зовут по коду", invited.status === 200, JSON.stringify(invited.data).slice(0, 120));
    const added = await call(`/lists/${list.id}/items`, { method: "POST", body: { title: "молоко" }, token: b.token });
    ok(b.name, "второй участник добавляет в общий список",
      added.status === 200 && (added.data?.list?.items || []).some(i => /молок/i.test(i.title || "")),
      JSON.stringify(added.data).slice(0, 140));
    const seen = await call("/state", { token: a.token });
    ok(a.name, "общий список виден обоим",
      (seen.data?.lists || []).some(l => l.id === list.id && (l.items || []).some(i => /молок/i.test(i.title || ""))),
      JSON.stringify(seen.data?.lists || []).slice(0, 140));
  }
}

async function moderationWork(a, b) {
  // Блокировка: заблокированный не попадает в общий список.
  await call("/block", { method: "POST", body: { code: a.code }, token: b.token });
  const created = await call("/lists", { method: "POST", body: { name: "Семья" }, token: a.token });
  const list = created.data?.list;
  if (!list) return;
  const invited = await call(`/lists/${list.id}/members`, { method: "POST", body: { code: b.code }, token: a.token });
  ok(a.name, "приглашение выглядит успешным", invited.status === 200, String(invited.status));
  ok(a.name, "заблокированный не попал в список",
    invited.data?.list?.members?.length === 1,
    JSON.stringify(invited.data?.list?.members));
}

async function extrasWork(person) {
  const t = person.token;
  // Готовый набор.
  const templates = await call("/templates", { token: t });
  const first = templates.data?.templates?.[0];
  ok(person.name, "готовые наборы отдаются", Boolean(first?.id), JSON.stringify(templates.data).slice(0, 120));
  if (first) {
    const applied = await call(`/templates/${first.id}/apply`, { method: "POST", body: { picks: (first.items || []).slice(0, 2).map(i => i.id) }, token: t });
    ok(person.name, "набор добавляет записи", applied.status === 200 && (applied.data?.added || 0) > 0, JSON.stringify(applied.data).slice(0, 120));
  }

  // Курс лекарств.
  const course = await call("/capture", { method: "POST", body: { text: "антибиотик 3 раза в день 5 дней" }, token: t });
  const doses = course.data?.reply?.items || [];
  ok(person.name, "курс лекарств разложен по приёмам", doses.length >= 2, `создано ${doses.length}`);
  if (doses[0]) {
    ok(person.name, "у курса виден срок и счётчик",
      Boolean(doses[0].courseTotal) && Boolean(doses[0].until || doses[0].courseId),
      JSON.stringify({ total: doses[0].courseTotal, until: doses[0].until }));
  }

  // Ответ прямо из уведомления.
  const single = await call("/capture", { method: "POST", body: { text: "полить цветы завтра в 8" }, token: t });
  const flower = single.data?.reply?.items?.[0];
  if (flower) {
    const reply = await call(`/items/${flower.id}/reply`, { method: "POST", body: { text: "перенеси на час" }, token: t });
    const movedItem = reply.data?.items?.find(i => i.id === flower.id);
    ok(person.name, "ответ из уведомления переносит дело",
      reply.status === 200 && Boolean(movedItem) && whenValue(movedItem) > whenValue(flower),
      JSON.stringify({ before: flower.time, after: movedItem?.time, status: reply.status }));
    const finish = await call(`/items/${flower.id}/reply`, { method: "POST", body: { text: "готово" }, token: t });
    ok(person.name, "ответ «готово» закрывает дело",
      finish.data?.items?.find(i => i.id === flower.id)?.done === true, String(finish.status));
  }

  // Свой звук на будильник и на уведомления.
  const sound = await call("/settings", { method: "POST", body: { alarmSound: "alarm_kalimba", notifySound: "notify_glass" }, token: t });
  ok(person.name, "звуки выбираются и держатся",
    sound.data?.user?.settings?.alarmSound === "alarm_kalimba" && sound.data?.user?.settings?.notifySound === "notify_glass",
    JSON.stringify({ a: sound.data?.user?.settings?.alarmSound, n: sound.data?.user?.settings?.notifySound }));
  const soundFile = await fetch(`${BASE}/sounds/alarm_kalimba.mp3`);
  const soundBytes = await soundFile.arrayBuffer();
  ok(person.name, "файл звука скачивается", soundFile.status === 200 && soundBytes.byteLength > 2000,
    `${soundFile.status} ${soundBytes.byteLength}`);

  // Тренажёр: пока оплата не подключена, тариф виден, но в стену человек не упирается.
  await call("/sim/disclaimer", { method: "POST", body: {}, token: t });
  const billing = await call("/billing", { token: t });
  const simPlan = billing.data?.sim || {};
  ok(person.name, "тариф виден и функции открыты",
    billing.data?.plan === "free" && (billing.data?.testMode ? simPlan.unlimited === true : simPlan.limit > 0),
    JSON.stringify(simPlan));
  const blocked = await call("/sim/prepare", { method: "POST", body: { who: "коллега", topic: "как достать наркотики" }, token: t });
  ok(person.name, "запрещённая тема не уходит в ИИ", blocked.status === 403 && blocked.data?.code === "BLOCKED", JSON.stringify(blocked.data).slice(0, 120));

  // Поддержка: переписка по id, без почты и телефона.
  const wrote = await call("/support", { method: "POST", body: { text: "Не пришло напоминание в 9:00", platform: "web", appVersion: "qa" }, token: t });
  ok(person.name, "обращение ложится в переписку",
    wrote.status === 200 && wrote.data?.messages?.length === 1, JSON.stringify(wrote.data).slice(0, 120));
  const again = await call("/support", { method: "POST", body: { text: "И ещё будильник молчит по утрам" }, token: t });
  ok(person.name, "вторая реплика идёт туда же", again.data?.messages?.length === 2, String(again.data?.messages?.length));
  const withCounter = await call("/state", { token: t });
  ok(person.name, "счётчик поддержки приходит в состоянии",
    withCounter.data?.support?.unread === 0, JSON.stringify(withCounter.data?.support));
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-virtual-"));
  const child = spawn(process.execPath, [path.join(APP_DIR, "server.js")], {
    cwd: APP_DIR,
    env: { ...process.env, VC_PORT: String(PORT), VC_HOST: "127.0.0.1", VC_DATA_DIR: dir, VC_RATE_OFF: "1" },
    stdio: "ignore",
  });

  try {
    let up = false;
    for (let i = 0; i < 80; i += 1) {
      try {
        const res = await fetch(`${BASE}/api/config`);
        if (res.ok) { up = true; break; }
      } catch {}
      await sleep(100);
    }
    if (!up) throw new Error("сервер не поднялся");

    console.log(`Пятьдесят человек заходят в приложение (${BASE})\n`);
    const people = [];
    for (let i = 0; i < NAMES.length; i += 1) {
      const person = await createPerson(NAMES[i]);
      if (person) people.push(person);
    }
    console.log(`  Завели аккаунтов: ${people.length}`);

    for (let i = 0; i < people.length; i += 1) {
      await dayOfPerson(people[i], i);
      if ((i + 1) % 10 === 0) console.log(`  Прожили день: ${i + 1} человек`);
    }

    for (let i = 0; i + 1 < people.length; i += 2) {
      await pairWork(people[i], people[i + 1]);
    }
    console.log("  Пары обменялись записями и списками");

    for (let i = 0; i + 1 < 10; i += 2) {
      await moderationWork(people[i], people[i + 1]);
    }
    console.log("  Жалобы и блокировки проверены");

    for (const person of people.slice(0, 12)) {
      await extrasWork(person);
    }
    console.log("  Наборы, курсы лекарств, ответы из уведомлений и тренажёр проверены");

    // Уходя, человек удаляет аккаунт: после этого его данные недоступны.
    const leaver = people[people.length - 1];
    const del = await call("/account", { method: "DELETE", token: leaver.token });
    ok(leaver.name, "аккаунт удаляется по требованию", del.status === 200, String(del.status));
    const after = await call("/state", { token: leaver.token });
    ok(leaver.name, "после удаления доступа нет", after.status === 401, String(after.status));

    console.log("");
    if (!problems.length) {
      console.log(`Проверок: ${checks}. Ошибок нет — 100 из 100.`);
    } else {
      const byLabel = new Map();
      for (const p of problems) {
        const list = byLabel.get(p.label) || [];
        list.push(p);
        byLabel.set(p.label, list);
      }
      console.log(`Проверок: ${checks}. Проблем: ${problems.length}\n`);
      for (const [label, list] of byLabel) {
        console.log(`  ✗ ${label} — у ${list.length} человек`);
        console.log(`      пример: ${list[0].person} → ${list[0].detail}`);
      }
      process.exitCode = 1;
    }
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error("Сбой прогона:", err.message);
  process.exitCode = 1;
});
