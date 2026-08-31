// Виртуальный человек для настоящего API: говорит обычные фразы и смотрит,
// что реально осело в записях. Это отчётный прогон, а не CI-тест: расхождения
// разбора печатаются, но не роняют выход.
// Запуск: node qa/virtual-user-api.mjs [http://127.0.0.1:8791 | порт]

import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { zonedParts, addDays, zonedToUtc } from "../lib/time.js";
import { parse } from "../lib/parse.js";

const TZ = "Europe/Moscow";
const HOST = "127.0.0.1";
const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARG = process.argv[2] || "";

let BASE = /^https?:\/\//.test(ARG) ? ARG.replace(/\/+$/, "") : "";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => zonedParts(Date.now(), TZ);
const pad = n => String(n).padStart(2, "0");
const sameDate = (a, b) => Boolean(a && b) && a.year === b.year && a.month === b.month && a.day === b.day;

// ——— сервер ———

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = /^\d+$/.test(ARG) ? Number(ARG) : await freePort();
  const dataDir = path.join(os.tmpdir(), `vc-qa-api-${Date.now()}`);
  fs.mkdirSync(dataDir, { recursive: true });

  const child = spawn(process.execPath, ["server.js"], {
    cwd: APP_DIR,
    env: { ...process.env, VC_PORT: String(port), VC_HOST: HOST, VC_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  let exited = null;
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { log += chunk; });
  child.on("exit", code => { exited = code == null ? -1 : code; });

  const handle = {
    base: `http://${HOST}:${port}`,
    port,
    dataDir,
    alive: () => exited === null,
    async stop() {
      if (exited === null) {
        child.kill("SIGTERM");
        const till = Date.now() + 3000;
        while (exited === null && Date.now() < till) await sleep(50);
        if (exited === null) child.kill("SIGKILL");
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };

  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      if (exited !== null) {
        throw new Error(/EADDRINUSE/.test(log)
          ? `порт ${port} занят. Освободите его: lsof -ti:${port} | xargs kill — или задайте другой: node qa/virtual-user-api.mjs 8794`
          : `сервер не запустился (код ${exited}).\n${log.trim()}`);
      }
      try {
        const res = await fetch(`${handle.base}/api/config`);
        if (res.ok) break;
      } catch {
        // сервер ещё поднимается
      }
      if (Date.now() > deadline) throw new Error(`сервер на ${handle.base} не ответил за 15 секунд.\n${log.trim()}`);
      await sleep(120);
    }
  } catch (err) {
    await handle.stop();
    throw err;
  }

  return handle;
}

// ——— обращения к API ———

async function call(token, pathname, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${pathname}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`запрос ${method} /api${pathname} не прошёл: ${err.message}`);
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function newHuman() {
  const res = await call("", "/start", { method: "POST", body: { tz: TZ } });
  if (res.status !== 200 || !res.data?.token) {
    throw new Error(`не удалось завести человека: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return { token: res.data.token, code: res.data.user.code };
}

async function say(human, text) {
  const res = await call(human.token, "/capture", { method: "POST", body: { text } });
  if (res.status !== 200) throw new Error(`капча не прошла: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

async function stateOf(human) {
  const res = await call(human.token, "/state");
  if (res.status !== 200) throw new Error(`состояние не отдалось: ${res.status}`);
  return res.data;
}

// Читаем именно из /api/state — интересует то, что человек увидит в списке.
async function stored(human, id) {
  const state = await stateOf(human);
  return state.items.find(i => i.id === id) || state.incoming.find(i => i.id === id) || null;
}

// Между кейсами прибираем стол, чтобы старые записи не мешали поиску и дублям.
async function reset(human) {
  const state = await stateOf(human);
  for (const item of [...state.items, ...state.incoming]) {
    await call(human.token, `/items/${item.id}/cancel`, { method: "POST" });
  }
}

// ——— печать ———

const TYPE_RU = { task: "дело", meeting: "встреча", note: "заметка", bday: "день рождения" };

function fmtDate(date) {
  return date ? `${pad(date.day)}.${pad(date.month + 1)}.${date.year}` : "без даты";
}

function fmtTime(time) {
  return time ? `${pad(time.hour)}:${pad(time.minute)}` : "без времени";
}

// Без времени сервер не шлёт ни напоминания, ни звонка, а remind=0 — это пуш ровно в момент.
function fmtPush(item) {
  if (!item.time) return "без пуша и звонка";
  let out = "пуш в момент";
  if (item.remind % 1440 === 0 && item.remind) out = `пуш за ${item.remind / 1440} дн`;
  else if (item.remind % 60 === 0 && item.remind) out = `пуш за ${item.remind / 60} ч`;
  else if (item.remind) out = `пуш за ${item.remind} мин`;
  return item.alarm ? `${out} + звонок в момент` : out;
}

function fmtItem(item) {
  if (!item) return "ничего не сохранилось";
  return [
    TYPE_RU[item.type] || item.type,
    item.title,
    `${fmtDate(item.date)} ${fmtTime(item.time)}`,
    item.place || "без места",
    fmtPush(item),
    item.repeatLabel || "без повтора",
    item.shelf,
  ].join(" | ");
}

// ——— учёт кейсов ———

const cases = [];
const holes = [];

function hole(phrase, expected, actual, impact) {
  holes.push({ phrase, expected, actual, impact });
}

function newCase(num, head) {
  const c = {
    num,
    head,
    lines: [],
    fails: [],
    doubts: [],
    log: text => c.lines.push(text),
    chat: reply => c.lines.push(`Чат: ${reply?.kind || "?"} · ${reply?.message || ""}`),
    kept: item => c.lines.push(`Сохранено: ${fmtItem(item)}`),
    must: (label, cond, actual) => {
      if (!cond) c.fails.push(`${label} → вышло: ${actual}`);
      return Boolean(cond);
    },
    doubt: text => c.doubts.push(text),
  };
  return c;
}

function printCase(c) {
  console.log(`Кейс ${c.num}. ${c.head}`);
  for (const line of c.lines) console.log(`  ${line}`);
  if (c.fails.length) {
    console.log("  ✗ ошибка");
    for (const f of c.fails) console.log(`    ${f}`);
  } else if (c.doubts.length) {
    console.log("  ~ спорно");
  } else {
    console.log("  ✓ верно");
  }
  for (const d of c.doubts) console.log(`    ${c.fails.length ? "спорно: " : ""}${d}`);
  console.log("");
}

// ——— сценарии ———

const MEETING = "встреча завтра в 10 на Таганке";

const SCENARIOS = [
  {
    head: `Человек говорит: «${MEETING}»`,
    async run(c, h) {
      await reset(h);
      const res = await say(h, MEETING);
      c.chat(res.reply);
      const item = await stored(h, res.reply.items?.[0]?.id);
      c.kept(item);
      c.must("тип должен быть meeting", item?.type === "meeting", item?.type);
      c.must("дата — завтра", sameDate(item?.date, addDays(now(), 1)), fmtDate(item?.date));
      c.must("время 10:00", item?.time?.hour === 10 && item?.time?.minute === 0, fmtTime(item?.time));
      c.must("место про Таганку", /таганк/i.test(item?.place || ""), item?.place || "пусто");
      c.must("пуш за 15 минут", item?.remind === 15, String(item?.remind));
      c.must("звонок в момент встречи", item?.alarm === true, String(item?.alarm));
      c.must("полка meetings", item?.shelf === "meetings", item?.shelf);
      if (item && item.place !== "Таганка") {
        c.doubt(`место сохранено падежом из фразы — «${item.place}», в списке человек ждёт «Таганка»; само место осталось и в названии «${item.title}»`);
        hole(MEETING, "место «Таганка», название «Встреча»",
          `место «${item.place}», название «${item.title}»`,
          "мелочь, но список выглядит неряшливо и место дублируется в двух полях");
      }
    },
  },
  {
    head: "Человек говорит: «в субботу забрать посылку»",
    async run(c, h) {
      await reset(h);
      const res = await say(h, "в субботу забрать посылку");
      c.chat(res.reply);
      const item = await stored(h, res.reply.items?.[0]?.id);
      c.kept(item);
      const saturday = addDays(now(), (6 - now().weekday + 7) % 7);
      c.must("тип дело", item?.type === "task", item?.type);
      c.must("дата — ближайшая суббота", sameDate(item?.date, saturday), fmtDate(item?.date));
      c.must("время не выдумано", item?.time === null, fmtTime(item?.time));
      c.must("помечено, что времени нет", item?.needsTime === true, String(item?.needsTime));
      c.must("чат предупредил про время", /врем/i.test(res.reply.message || ""), res.reply.message);
      c.must("полка tasks", item?.shelf === "tasks", item?.shelf);
    },
  },
  {
    head: "Человек говорит: «запиши мысль про новый лендинг»",
    async run(c, h) {
      await reset(h);
      const res = await say(h, "запиши мысль про новый лендинг");
      c.chat(res.reply);
      const item = await stored(h, res.reply.items?.[0]?.id);
      c.kept(item);
      c.must("тип заметка", item?.type === "note", item?.type);
      c.must("полка notes", item?.shelf === "notes", item?.shelf);
      c.must("даты нет", item?.date === null, fmtDate(item?.date));
      c.must("времени нет", item?.time === null, fmtTime(item?.time));
      if (/врем/i.test(res.reply.message || "")) {
        c.doubt(`заметке время не нужно, а чат отвечает «${res.reply.message}» — человек думает, что чего-то недослышали`);
        hole("запиши мысль про новый лендинг", "«Записала» без оговорок",
          `«${res.reply.message}»`,
          "мелочь: лишняя тревога на пустом месте при каждой заметке");
      }
    },
  },
  {
    head: "Человек говорит: «ДР у мамы 14 сентября»",
    async run(c, h) {
      await reset(h);
      const res = await say(h, "ДР у мамы 14 сентября");
      c.chat(res.reply);
      const item = await stored(h, res.reply.items?.[0]?.id);
      c.kept(item);
      const n = now();
      const year = 8 < n.month || (8 === n.month && 14 < n.day) ? n.year + 1 : n.year;
      c.must("тип день рождения", item?.type === "bday", item?.type);
      c.must("дата 14 сентября ближайшего года", sameDate(item?.date, { year, month: 8, day: 14 }), fmtDate(item?.date));
      c.must("повторяется каждый год", item?.yearly === true, String(item?.yearly));
      c.must("пуш за сутки", item?.remind === 1440, String(item?.remind));
      c.must("время по умолчанию 9:00", item?.time?.hour === 9 && item?.time?.minute === 0, fmtTime(item?.time));
      c.must("полка bday", item?.shelf === "bday", item?.shelf);
    },
  },
  {
    head: "Человек говорит: «каждый день в 8 утра витамины»",
    async run(c, h) {
      await reset(h);
      const res = await say(h, "каждый день в 8 утра витамины");
      c.chat(res.reply);
      const item = await stored(h, res.reply.items?.[0]?.id);
      c.kept(item);
      const n = now();
      const start = 8 * 60 <= n.hour * 60 + n.minute ? addDays(n, 1) : { year: n.year, month: n.month, day: n.day };
      c.must("повтор ежедневный", item?.repeat?.kind === "daily", JSON.stringify(item?.repeat));
      c.must("подпись повтора «каждый день»", item?.repeatLabel === "каждый день", item?.repeatLabel);
      c.must("время 8:00", item?.time?.hour === 8 && item?.time?.minute === 0, fmtTime(item?.time));
      c.must("первый раз — ближайшее наступающее 8 утра", sameDate(item?.date, start), fmtDate(item?.date));
    },
  },
  {
    head: `Человек говорит то же самое второй раз: «${MEETING}»`,
    async run(c, h) {
      await reset(h);
      const first = await say(h, MEETING);
      const before = first.items.length;
      const second = await say(h, MEETING);
      c.chat(second.reply);
      c.log(`Записей было ${before}, стало ${second.items.length}`);
      c.must("чат распознал дубль", second.reply.kind === "duplicate", second.reply.kind);
      c.must("вторая запись не создана", second.items.length === before, String(second.items.length));
    },
  },
  {
    head: "Человек отмечает «готово» у ежедневного дела (витамины)",
    async run(c, h) {
      await reset(h);
      const created = await say(h, "каждый день в 8 утра витамины");
      const item = created.reply.items[0];
      const res = await call(h.token, `/items/${item.id}/done`, { method: "POST", body: { done: true } });
      c.log(`Чат: ${res.data?.message}`);
      const after = await stored(h, item.id);
      c.kept(after);
      c.must("дата уехала на следующий раз", after && !sameDate(after.date, item.date), `${fmtDate(item.date)} → ${fmtDate(after?.date)}`);
      c.must("дело снова не сделано", after?.done === false, String(after?.done));
      c.must("в сообщении есть «следующий раз»", /следующий раз/i.test(res.data?.message || ""), res.data?.message);
    },
  },
  {
    head: "Человек отмечает «готово» у обычного дела (полить цветы)",
    async run(c, h) {
      await reset(h);
      const created = await say(h, "полить цветы завтра в 19");
      const item = created.reply.items[0];
      const res = await call(h.token, `/items/${item.id}/done`, { method: "POST", body: { done: true } });
      c.log(`Чат: ${res.data?.message}`);
      const after = await stored(h, item.id);
      c.kept(after);
      c.must("дело закрыто", after?.done === true, String(after?.done));
      c.must("дата не уехала", sameDate(after?.date, item.date), `${fmtDate(item.date)} → ${fmtDate(after?.date)}`);
    },
  },
  {
    head: "Человек говорит: «отмени встречу на Таганке»",
    async run(c, h) {
      await reset(h);
      const created = await say(h, MEETING);
      const id = created.reply.items[0].id;
      const res = await say(h, "отмени встречу на Таганке");
      c.chat(res.reply);
      const state = await stateOf(h);
      c.log(`Записей осталось: ${state.items.length}`);
      c.must("чат отменил", res.reply.kind === "cancelled", res.reply.kind);
      c.must("записи больше нет в списке", !state.items.some(i => i.id === id), "запись на месте");
    },
  },
  {
    head: "Человек говорит: «перенеси созвон на 18:30»",
    async run(c, h) {
      await reset(h);
      const created = await say(h, "созвон с подрядчиком в пятницу");
      const item = created.reply.items[0];
      c.log(`До переноса: ${fmtItem(item)}`);
      const res = await say(h, "перенеси созвон на 18:30");
      c.chat(res.reply);
      const after = await stored(h, item.id);
      c.kept(after);
      c.must("чат перенёс", res.reply.kind === "moved", res.reply.kind);
      c.must("время стало 18:30", after?.time?.hour === 18 && after?.time?.minute === 30, fmtTime(after?.time));
      c.must("метка «нужно время» снята", after?.needsTime === false, String(after?.needsTime));
      c.must("день остался прежним", sameDate(after?.date, item.date), fmtDate(after?.date));
    },
  },
  {
    head: "Человек говорит: «сдвинь стоматолога на завтра»",
    async run(c, h) {
      await reset(h);
      const created = await say(h, "стоматолог через 5 дней в 11");
      const item = created.reply.items[0];
      c.log(`До переноса: ${fmtItem(item)}`);
      const res = await say(h, "сдвинь стоматолога на завтра");
      c.chat(res.reply);
      const after = await stored(h, item.id);
      c.kept(after);
      c.must("чат перенёс", res.reply.kind === "moved", res.reply.kind);
      c.must("дата стала завтрашней", sameDate(after?.date, addDays(now(), 1)), fmtDate(after?.date));
      c.must("время не потерялось", after?.time?.hour === 11, fmtTime(after?.time));
    },
  },
  {
    head: "Человек говорит: «купи хлеб и ещё позвони маме в 7»",
    async run(c, h) {
      await reset(h);
      const phrase = "купи хлеб и ещё позвони маме в 7";
      const expected = parse(phrase, { now: Date.now(), tz: TZ, settings: {} });
      const res = await say(h, phrase);
      c.chat(res.reply);
      const ids = (res.reply.items || []).map(i => i.id);
      const bread = await stored(h, ids[0]);
      const mom = await stored(h, ids[1]);
      c.kept(bread);
      c.kept(mom);
      c.must("создано две записи", ids.length === 2, String(ids.length));
      c.must("в ответе «Записала · 2»", (res.reply.message || "").startsWith("Записала · 2"), res.reply.message);
      const wanted = expected.drafts[1]?.time;
      c.must("час у звонка маме совпал с разбором фразы",
        Boolean(mom?.time) && mom.time.hour === wanted?.hour,
        `${fmtTime(mom?.time)}, разбор ждал ${fmtTime(wanted)}`);
      if (mom?.time?.hour !== 7) {
        c.doubt(`«в 7» без «утра/вечера» приложение поняло как ${fmtTime(mom?.time)} — это ближайшее наступающее время, зависит от часа прогона`);
      }
      if (bread?.type === "note") {
        c.doubt(`«купи хлеб» без срока уехало в заметки (${bread.shelf}), а не в дела`);
        hole(phrase, "«купи хлеб» — дело в списке дел",
          `тип «${TYPE_RU[bread.type]}», полка «${bread.shelf}»`,
          "заметно: покупки без срока лежат в заметках, в списке дел их нет и напоминания по ним не приходят");
      }
    },
  },
  {
    head: "Человек говорит: «встреча завтра в 10 на Таганке, а нет, лучше в 12 на Тверской»",
    async run(c, h) {
      await reset(h);
      const res = await say(h, "встреча завтра в 10 на Таганке, а нет, лучше в 12 на Тверской");
      c.chat(res.reply);
      const item = await stored(h, res.reply.items?.[0]?.id);
      c.kept(item);
      c.must("создана одна запись", res.reply.items?.length === 1, String(res.reply.items?.length));
      c.must("время 12:00", item?.time?.hour === 12 && item?.time?.minute === 0, fmtTime(item?.time));
      c.must("место — Тверская", /тверск/i.test(item?.place || ""), item?.place || "пусто");
      c.must("старая Таганка стёрта", !/таганк/i.test(`${item?.place} ${item?.title}`), `${item?.place} / ${item?.title}`);
      c.must("дата осталась завтрашней", sameDate(item?.date, addDays(now(), 1)), fmtDate(item?.date));
      c.must("в ответе есть «по поправке»", /по поправке/i.test(res.reply.message || ""), res.reply.message);
    },
  },
  {
    head: "Человек говорит: «отмени поход в цирк» (такого нет)",
    async run(c, h) {
      await reset(h);
      await say(h, "купить корм коту завтра в 19");
      const before = (await stateOf(h)).items.length;
      const res = await say(h, "отмени поход в цирк");
      c.chat(res.reply);
      const after = (await stateOf(h)).items.length;
      c.log(`Записей было ${before}, стало ${after}`);
      c.must("чат ответил «не нашла»", res.reply.kind === "not_found", res.reply.kind);
      c.must("ничего не удалено", after === before, String(after));
    },
  },
  {
    head: "Человек говорит: «отмени созвон», а созвонов два",
    async run(c, h) {
      await reset(h);
      await say(h, "созвон с Ирой");
      await say(h, "созвон с Петей");
      const before = (await stateOf(h)).items.length;
      const res = await say(h, "отмени созвон");
      c.chat(res.reply);
      const after = (await stateOf(h)).items.length;
      c.log(`Кандидаты: ${(res.reply.candidates || []).map(i => i.title).join(", ") || "нет"}`);
      if (res.reply.kind === "ambiguous") {
        c.must("предложено выбрать из двух", (res.reply.candidates || []).length === 2, String(res.reply.candidates?.length));
        c.must("ничего не удалено до выбора", after === before, `${before} → ${after}`);
      } else {
        c.doubt(`ожидали переспрос, а чат ответил «${res.reply.kind}» — записей было ${before}, стало ${after}`);
      }
    },
  },
  {
    head: "Человек говорит: «встреча с юристом 15.09 в 16:00 напомни за час»",
    async run(c, h) {
      await reset(h);
      const res = await say(h, "встреча с юристом 15.09 в 16:00 напомни за час");
      c.chat(res.reply);
      const item = await stored(h, res.reply.items?.[0]?.id);
      c.kept(item);
      const n = now();
      const year = 8 < n.month || (8 === n.month && 15 < n.day) ? n.year + 1 : n.year;
      c.must("пуш за 60 минут", item?.remind === 60, String(item?.remind));
      c.must("дата 15 сентября", sameDate(item?.date, { year, month: 8, day: 15 }), fmtDate(item?.date));
      c.must("время 16:00", item?.time?.hour === 16 && item?.time?.minute === 0, fmtTime(item?.time));
      c.must("тип встреча", item?.type === "meeting", item?.type);
      c.must("слово «напомни» не попало в название", !/напомни/i.test(item?.title || ""), item?.title);
    },
  },
  {
    head: "Человек говорит: «поставь будильник на 7 утра»",
    async run(c, h) {
      await reset(h);
      const res = await say(h, "поставь будильник на 7 утра");
      c.chat(res.reply);
      const item = await stored(h, res.reply.items?.[0]?.id);
      c.kept(item);
      c.must("время 7:00", item?.time?.hour === 7 && item?.time?.minute === 0, fmtTime(item?.time));
      // Человек, сказавший «будильник», ждёт звонка в 7:00, а не тихой строчки в списке дел.
      c.must("в 7:00 должно зазвонить: alarm=true", item?.alarm === true, `alarm=${item?.alarm}, тип «${TYPE_RU[item?.type] || item?.type}»`);
      if (item && !item.alarm) {
        hole("поставь будильник на 7 утра", "будильник со звуком в 7:00",
          `${TYPE_RU[item.type]} «${item.title}» на полке «${item.shelf}», alarm=false — придёт обычный тихий пуш`,
          "важно: звонок в момент события ставится только встречам, поэтому в беззвучном режиме человек проспит; слова «будильник» разбор не знает");
      }
    },
  },
  {
    head: "Человек зовёт второго в общий список по ID",
    async run(c, h, h2) {
      await reset(h);
      await reset(h2);

      const created = await call(h.token, "/lists", { method: "POST", body: { name: "Продукты" } });
      const listId = created.data?.list?.id;
      c.must("список создан", Boolean(listId), JSON.stringify(created.data?.list));

      const invited = await call(h.token, `/lists/${listId}/members`, { method: "POST", body: { code: h2.code } });
      c.must("второй добавлен по ID", invited.data?.list?.members?.length === 2, JSON.stringify(invited.data?.list?.members));

      const added = await call(h2.token, `/lists/${listId}/items`, { method: "POST", body: { title: "молоко" } });
      c.must("второй дописывает в список", (added.data?.list?.items || []).some(i => /молок/i.test(i.title)), JSON.stringify(added.data?.list?.items));

      const seen = await stateOf(h);
      const list = (seen.lists || []).find(l => l.id === listId);
      c.must("первый видит строку второго", (list?.items || []).some(i => /молок/i.test(i.title)), JSON.stringify(list?.items));
    },
  },
  {
    head: "Человек руками ставит время 13:00 записи без времени",
    async run(c, h) {
      await reset(h);
      const created = await say(h, "в субботу забрать посылку");
      const item = created.reply.items[0];
      c.log(`До правки: ${fmtItem(item)}`);
      const res = await call(h.token, `/items/${item.id}`, { method: "PATCH", body: { time: { hour: 13, minute: 0 } } });
      c.must("правка принята", res.status === 200, String(res.status));
      const after = await stored(h, item.id);
      c.kept(after);
      c.must("время 13:00", after?.time?.hour === 13 && after?.time?.minute === 0, fmtTime(after?.time));
      c.must("метка «нужно время» снята", after?.needsTime === false, String(after?.needsTime));
      c.must("день не съехал", sameDate(after?.date, item.date), fmtDate(after?.date));
    },
  },
  {
    head: "Человек жмёт «отложить на час»",
    async run(c, h) {
      await reset(h);
      const created = await say(h, "полить цветы завтра в 19");
      const item = created.reply.items[0];
      c.log(`До откладывания: ${fmtItem(item)}`);
      const res = await call(h.token, `/items/${item.id}/snooze`, { method: "POST", body: { minutes: 60 } });
      c.log(`Чат: ${res.data?.message}`);
      const after = await stored(h, item.id);
      c.kept(after);
      const target = Date.now() + 60 * 60000;
      const got = after?.date && after?.time
        ? zonedToUtc({ ...after.date, hour: after.time.hour, minute: after.time.minute }, TZ)
        : null;
      const driftMin = got == null ? null : Math.round((got - target) / 60000);
      c.must("новое время примерно через час", driftMin != null && Math.abs(driftMin) <= 2, `расхождение ${driftMin} мин`);
      c.must("метка «нужно время» снята", after?.needsTime === false, String(after?.needsTime));
    },
  },
];

// ——— прогон ———

async function main() {
  const server = BASE ? null : await startServer();
  if (server) BASE = server.base;
  console.log(`Виртуальный человек идёт в ${BASE}${server ? ` (свой сервер, данные в ${server.dataDir})` : " (уже запущенный сервер)"}`);
  const n = now();
  console.log(`Сейчас в Москве: ${pad(n.day)}.${pad(n.month + 1)}.${n.year} ${pad(n.hour)}:${pad(n.minute)}\n`);

  try {
    const human = await newHuman();
    const friend = await newHuman();
    console.log(`Человек ${human.code} и его знакомая ${friend.code} завели аккаунты сами, без анкет.\n`);

    for (let i = 0; i < SCENARIOS.length; i += 1) {
      const scenario = SCENARIOS[i];
      const c = newCase(i + 1, scenario.head);
      try {
        await scenario.run(c, human, friend);
      } catch (err) {
        if (server && !server.alive()) throw err;
        c.fails.push(`сценарий оборвался: ${err.message}`);
      }
      cases.push(c);
      printCase(c);
    }
  } finally {
    if (server) await server.stop();
  }

  const bad = cases.filter(c => c.fails.length).length;
  const soft = cases.filter(c => !c.fails.length && c.doubts.length).length;
  console.log("————————————————————————————————————————");
  console.log(`ИТОГО: кейсов ${cases.length} · верно ${cases.length - bad - soft} · спорно ${soft} · ошибок ${bad}`);

  console.log("\nНАЙДЕННЫЕ ДЫРЫ");
  if (!holes.length) {
    console.log("  Расхождений с ожиданиями живого человека не нашлось.");
  } else {
    holes.forEach((h, i) => {
      console.log(`  ${i + 1}. «${h.phrase}»`);
      console.log(`     ждали: ${h.expected}`);
      console.log(`     вышло: ${h.actual}`);
      console.log(`     в быту: ${h.impact}`);
    });
  }
}

main().then(
  () => process.exit(0),
  err => {
    console.error(`\nПрогон сорвался: ${err.message}`);
    process.exit(1);
  },
);
