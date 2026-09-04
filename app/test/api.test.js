// Прогон API через живой сервер: node test/api.test.js [базовый-url]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";
const BASE = process.argv[2] || "http://127.0.0.1:8791";
const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");

let token = "";
let failed = 0;

async function call(path, { method = "GET", body, auth = true, as = "" } = {}) {
  const bearer = as || token;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(auth && bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Отдельный сервер на пару секунд: только так можно честно проверить
// протухший код и переполненную комнату, не растягивая прогон на пять минут.
async function withServer(env, fn) {
  const port = 8900 + Math.floor(Math.random() * 90);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-room-"));
  const child = spawn(process.execPath, [path.join(APP_DIR, "server.js")], {
    cwd: APP_DIR,
    env: { ...process.env, VC_PORT: String(port), VC_HOST: "127.0.0.1", VC_DATA_DIR: dir, ...env },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, { method = "GET", body, as = "" } = {}) => {
    const res = await fetch(`${base}/api${p}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(as ? { Authorization: `Bearer ${as}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        if ((await api("/config")).status === 200) break;
      } catch {}
      await sleep(100);
    }
    await fn(api);
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

function fmt(item) {
  if (!item) return "нет";
  const d = item.date ? `${item.date.day}.${item.date.month + 1}` : "—";
  const t = item.time ? `${item.time.hour}:${String(item.time.minute).padStart(2, "0")}` : "—";
  return `${item.title} | ${d} ${t} | ${item.repeat?.kind || "без повтора"} | done=${item.done}`;
}

async function main() {
  console.log(`Проверяю ${BASE}\n`);

  const start = await call("/start", { method: "POST", body: { tz: "Europe/Moscow" }, auth: false });
  check("аккаунт заводится сам, без анкеты", start.status === 200 && start.data?.token, JSON.stringify(start.data).slice(0, 120));
  token = start.data.token;
  const transferKey = start.data.user.transferKey;
  check("выдан ключ переноса", typeof transferKey === "string" && transferKey.length >= 20, transferKey);
  check("в аккаунте нет личных данных", !start.data.user.name && !start.data.user.email && !start.data.user.phone);

  const noAuth = await fetch(`${BASE}/api/state`).then(r => r.status);
  check("без токена не пускает", noAuth === 401, String(noAuth));

  const badRestore = await call("/restore", { method: "POST", body: { key: "0000000000" }, auth: false });
  check("чужой ключ переноса отклонён", badRestore.status === 401, String(badRestore.status));

  const restore = await call("/restore", { method: "POST", body: { key: transferKey, tz: "Europe/Moscow" }, auth: false });
  check("перенос на другой телефон по ключу", restore.status === 200 && restore.data?.token);

  // Фраза про витамины уехала на полку «Витамины и лекарства», а она в подписке:
  // бесплатный аккаунт получал 403 и прогон обрывался. Повтор проверяем на
  // бесплатной полке — суть проверки та же.
  const repeat = await call("/capture", { method: "POST", body: { text: "каждый день в 8 утра выносить мусор" } });
  const repeatItem = repeat.data?.reply?.items?.[0];
  check("повтор: каждый день", repeatItem?.repeat?.kind === "daily" && repeatItem?.time?.hour === 8, fmt(repeatItem));
  check("подпись повтора", repeatItem?.repeatLabel === "каждый день", repeatItem?.repeatLabel);

  const dup = await call("/capture", { method: "POST", body: { text: "каждый день в 8 утра выносить мусор" } });
  check("дубль не создаётся", dup.data?.reply?.kind === "duplicate", dup.data?.reply?.message);

  const firstDay = repeatItem.date.day;
  const doneRepeat = await call(`/items/${repeatItem.id}/done`, { method: "POST", body: { done: true } });
  const advanced = doneRepeat.data?.items?.find(i => i.id === repeatItem.id);
  check("повтор уехал на следующий раз", advanced && advanced.date.day !== firstDay && advanced.done === false, fmt(advanced));

  // Счётчики — платная полка, и на бесплатном аккаунте фраза упирается в подписку.
  // Шаг повтора проверяем на бесплатной полке, час задаём явно — иначе спросят время.
  const twoWeeks = await call("/capture", { method: "POST", body: { text: "каждые две недели в 10 утра поливать цветы" } });
  const twoWeeksItem = twoWeeks.data?.reply?.items?.[0];
  check("повтор через неделю: шаг сохранён", twoWeeksItem?.repeat?.kind === "weekly" && twoWeeksItem?.repeat?.every === 2, fmt(twoWeeksItem));
  check("подпись шага повтора", twoWeeksItem?.repeatLabel === "каждые две недели", twoWeeksItem?.repeatLabel);

  const twoWeeksDone = await call(`/items/${twoWeeksItem.id}/done`, { method: "POST", body: {} });
  const twoWeeksNext = twoWeeksDone.data?.items?.find(i => i.id === twoWeeksItem.id);
  const dayGap = (a, b) => Math.round((Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / 86400000);
  check("через две недели, а не через одну", twoWeeksNext && dayGap(twoWeeksItem.date, twoWeeksNext.date) === 14, fmt(twoWeeksNext));

  const twoDays = await call("/capture", { method: "POST", body: { text: "по вторникам и четвергам английский в 19:00" } });
  const twoDaysItem = twoDays.data?.reply?.items?.[0];
  const weekdayOfDate = d => new Date(Date.UTC(d.year, d.month, d.day)).getUTCDay();
  check("два дня недели в одном повторе", JSON.stringify(twoDaysItem?.repeat?.days) === "[2,4]", fmt(twoDaysItem));
  check("подпись двух дней", twoDaysItem?.repeatLabel === "по вторникам и четвергам", twoDaysItem?.repeatLabel);
  check("старт на ближайшем из двух дней", [2, 4].includes(weekdayOfDate(twoDaysItem.date)), fmt(twoDaysItem));

  const twoDaysDone = await call(`/items/${twoDaysItem.id}/done`, { method: "POST", body: {} });
  const twoDaysNext = twoDaysDone.data?.items?.find(i => i.id === twoDaysItem.id);
  check(
    "следующий раз — второй день недели, а не через неделю",
    twoDaysNext && [2, 4].includes(weekdayOfDate(twoDaysNext.date)) && [2, 5].includes(dayGap(twoDaysItem.date, twoDaysNext.date)),
    fmt(twoDaysNext));

  const noTime = await call("/capture", { method: "POST", body: { text: "в субботу забрать посылку" } });
  const noTimeItem = noTime.data?.reply?.items?.[0];
  check("без времени — время не выдумано", noTimeItem && noTimeItem.time === null, fmt(noTimeItem));

  const patched = await call(`/items/${noTimeItem.id}`, { method: "PATCH", body: { time: { hour: 13, minute: 0 } } });
  check("время ставится одним запросом", patched.data?.item?.time?.hour === 13, fmt(patched.data?.item));

  const snoozed = await call(`/items/${noTimeItem.id}/snooze`, { method: "POST", body: { minutes: 60 } });
  check("отложить на час", snoozed.status === 200 && snoozed.data?.item?.time, snoozed.data?.message);

  const buy = await call("/capture", { method: "POST", body: { text: "купить корм коту" } });
  const buyItem = buy.data?.reply?.items?.[0];
  check("покупка попадает на свою полку", buyItem?.type === "buy" && buyItem?.shelf === "buy", fmt(buyItem));
  check("покупке срок не нужен", buyItem && buyItem.date === null && buyItem.needsTime !== true, fmt(buyItem));

  const buyTyped = await call(`/items/${buyItem.id}`, { method: "PATCH", body: { type: "task" } });
  check("покупку можно переложить в дела", buyTyped.data?.item?.shelf === "notes" || buyTyped.data?.item?.type === "task", fmt(buyTyped.data?.item));

  const sport = await call("/capture", { method: "POST", body: { text: "по вторникам и четвергам в 19 тренировка ноги" } });
  const sportItem = sport.data?.reply?.items?.[0];
  check("тренировка на полке спорта", sportItem?.type === "sport" && sportItem?.shelf === "sport", fmt(sportItem));
  check("график тренировок с днями недели",
    sportItem?.repeat?.kind === "weekly" && JSON.stringify(sportItem?.repeat?.days) === "[2,4]",
    JSON.stringify(sportItem?.repeat));

  const care = await call("/capture", { method: "POST", body: { text: "утренний уход очищение тоник крем" } });
  const careItem = care.data?.reply?.items?.[0];
  check("протокол ухода на полке косметики", careItem?.type === "care" && careItem?.shelf === "care", fmt(careItem));
  check("утренний протокол каждый день в 8:00",
    careItem?.repeat?.kind === "daily" && careItem?.time?.hour === 8 && careItem?.remind === 0,
    fmt(careItem));

  const careShortcut = await call("/settings", { method: "POST", body: { widgetShortcut: "care" } });
  check("косметику можно повесить на кнопку виджета",
    careShortcut.data?.user?.settings?.widgetShortcut === "care",
    careShortcut.data?.user?.settings?.widgetShortcut);

  // Конструктор полок: выключить встроенную, добавить свою со словами, запись едет туда.
  await withServer({}, async (api) => {
    const me = (await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } })).data;
    const hide = await api("/settings", {
      method: "POST",
      body: { hiddenShelves: ["sport", "care", "bday"] },
      as: me.token,
    });
    check("встроенные полки можно выключить",
      JSON.stringify(hide.data?.user?.settings?.hiddenShelves?.slice().sort()) === JSON.stringify(["bday", "care", "sport"]),
      JSON.stringify(hide.data?.user?.settings?.hiddenShelves));

    const made = await api("/settings", {
      method: "POST",
      body: { customShelves: [{ label: "Дом", keywordsText: "ремонт, сантехник, квартира" }] },
      as: me.token,
    });
    const shelf = made.data?.user?.settings?.customShelves?.[0];
    check("своя полка сохраняется с словами",
      shelf?.label === "Дом" && shelf?.keywords?.includes("ремонт") && /^c[a-z0-9]/i.test(shelf?.id || ""),
      JSON.stringify(shelf));

    const said = await api("/capture", {
      method: "POST",
      body: { text: "завтра в 12 вызвать сантехника" },
      as: me.token,
    });
    const item = said.data?.reply?.items?.[0];
    check("слова из конструктора кладут запись на свою полку",
      item?.type === "custom" && item?.shelf === shelf?.id,
      fmt(item));

    const buyLike = await api("/capture", {
      method: "POST",
      body: { text: "купить краску для ремонта" },
      as: me.token,
    });
    const buyItem = buyLike.data?.reply?.items?.[0];
    check("своя полка перехватывает и покупки по словам",
      buyItem?.type === "custom" && buyItem?.shelf === shelf?.id,
      fmt(buyItem));

    const onShelf = await api("/capture", {
      method: "POST",
      body: { text: "завтра в 10 позвонить управляющему", shelf: shelf?.id },
      as: me.token,
    });
    const pinned = onShelf.data?.reply?.items?.[0];
    check("голос со своей полки кладёт запись туда без ключевых слов",
      pinned?.type === "custom" && pinned?.shelf === shelf?.id,
      fmt(pinned));

    const moved = await api(`/items/${item.id}`, {
      method: "PATCH",
      body: { type: "task", shelf: "tasks" },
      as: me.token,
    });
    check("из карточки можно увести со своей полки",
      moved.data?.item?.type === "task" && moved.data?.item?.shelf === "tasks",
      fmt(moved.data?.item));

    const cleared = await api("/settings", {
      method: "POST",
      body: { customShelves: [] },
      as: me.token,
    });
    check("свою полку можно удалить",
      (cleared.data?.user?.settings?.customShelves || []).length === 0,
      JSON.stringify(cleared.data?.user?.settings?.customShelves));

    // «Наборы» — закладка без записей: её тоже прячут и переставляют.
    const kit = await api("/settings", {
      method: "POST",
      body: { hiddenShelves: ["templates"], shelfOrder: ["templates", "tasks", "buy"] },
      as: me.token,
    });
    const kitSettings = kit.data?.user?.settings || {};
    check("закладку «Наборы» можно выключить и поставить первой",
      kitSettings.hiddenShelves?.includes("templates") && kitSettings.shelfOrder?.[0] === "templates",
      JSON.stringify({ hidden: kitSettings.hiddenShelves, order: kitSettings.shelfOrder }));

    const kitItem = await api("/capture", {
      method: "POST",
      body: { text: "купить хлеб", shelf: "templates" },
      as: me.token,
    });
    check("записи на закладку «Наборы» не кладутся",
      kitItem.data?.reply?.items?.[0]?.shelf !== "templates",
      fmt(kitItem.data?.reply?.items?.[0]));

    const kitWidget = await api("/settings", {
      method: "POST",
      body: { widgetShortcut: "templates" },
      as: me.token,
    });
    check("на кнопку виджета «Наборы» не назначить",
      kitWidget.data?.user?.settings?.widgetShortcut !== "templates",
      String(kitWidget.data?.user?.settings?.widgetShortcut));

    await api("/settings", { method: "POST", body: { hiddenShelves: [], shelfOrder: [] }, as: me.token });
  });

  const meeting = await call("/capture", { method: "POST", body: { text: "созвон с подрядчиком завтра в 15:30" } });
  const meetItem = meeting.data?.reply?.items?.[0];
  check("встреча с напоминанием заранее", meetItem?.type === "meeting" && meetItem?.remind === 15, fmt(meetItem));

  const cancel = await call("/capture", { method: "POST", body: { text: "отмени созвон с подрядчиком" } });
  check("отмена по голосу", cancel.data?.reply?.kind === "cancelled", cancel.data?.reply?.message);

  // «Удали запись на 17:00»: человек назвал только время, но этого достаточно.
  await withServer({}, async (api) => {
    const me = (await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } })).data;
    const say = text => api("/capture", { method: "POST", body: { text }, as: me.token });

    await say("напомнить про отчёт в 17:00");
    const alone = (await say("удали запись на 17:00")).data?.reply;
    check("одну запись на названное время удаляет сразу",
      alone?.kind === "cancelled" && alone?.items?.[0]?.title === "Напомнить про отчёт",
      `${alone?.kind}: ${alone?.message}`);

    await say("созвон с банком в 17:00");
    await say("забрать посылку в 17:00");
    const many = (await say("удали запись на 17:00")).data?.reply;
    const names = (many?.candidates || []).map(c => c.title).sort().join(", ");
    check("когда на это время записей несколько — спрашивает какую",
      many?.kind === "ambiguous" && names === "Забрать посылку, Созвон с банком",
      `${many?.kind}: ${many?.message} [${names}]`);

    const nothing = (await say("удали запись на 21:30")).data?.reply;
    check("на пустое время не удаляет наугад", nothing?.kind === "not_found", nothing?.kind);

    // Случайное смахивание: запись можно вернуть тем же маршрутом.
    const sole = (await say("напомнить про ключи в 18:00")).data?.reply?.items?.[0];
    await api(`/items/${sole.id}/cancel`, { method: "POST", as: me.token });
    const gone = (await api("/state", { as: me.token })).data?.items || [];
    check("после удаления записи в списке нет", !gone.some(i => i.id === sole.id), gone.map(i => i.title).join(", "));
    await api(`/items/${sole.id}/cancel`, { method: "POST", body: { cancelled: false }, as: me.token });
    const back = (await api("/state", { as: me.token })).data?.items || [];
    check("удалённую запись можно вернуть", back.some(i => i.id === sole.id && i.title === "Напомнить про ключи"), back.map(i => i.title).join(", "));

    // Перенос по-прежнему считает время новым сроком, а не приметой записи.
    const moved = (await say("перенеси созвон с банком на 19:00")).data?.reply;
    check("перенос не путает новое время с поиском",
      moved?.kind === "moved" && moved?.items?.[0]?.time?.hour === 19,
      `${moved?.kind}: ${moved?.message}`);
  });

  const move = await call("/capture", { method: "POST", body: { text: "перенеси витамины на 9:15" } });
  check("перенос по голосу", move.data?.reply?.kind === "moved", move.data?.reply?.message);

  const tzState = await call("/state?tz=Asia/Tbilisi");
  check("часовой пояс обновляется", tzState.data?.user?.settings?.tz === "Asia/Tbilisi", tzState.data?.user?.settings?.tz);

  const badItem = await call("/items/несуществующий/done", { method: "POST", body: { done: true } });
  check("чужая или битая запись — 404", badItem.status === 404, String(badItem.status));

  const settings = await call("/settings", { method: "POST", body: { remindMeeting: 30, widgetShortcut: "notes" } });
  check("настройки сохраняются", settings.data?.user?.settings?.remindMeeting === 30 && settings.data?.user?.settings?.widgetShortcut === "notes");

  const buyShortcut = await call("/settings", { method: "POST", body: { widgetShortcut: "buy" } });
  check("покупки можно повесить на кнопку виджета",
    buyShortcut.data?.user?.settings?.widgetShortcut === "buy",
    buyShortcut.data?.user?.settings?.widgetShortcut);

  // Курица в духовке: таймер должен прозвенеть в конце отсчёта, а не за пятнадцать минут до —
  // иначе при такой настройке сигнал пришёлся бы на прошлое.
  await withServer({}, async (api) => {
    const me = (await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } })).data;
    await api("/settings", { method: "POST", body: { remindTask: 15 }, as: me.token });
    const said = await api("/capture", { method: "POST", body: { text: "поставь таймер на 5 минут" }, as: me.token });
    const timer = said.data?.reply?.items?.[0];
    check("таймер звонит в конце отсчёта, а не заранее",
      timer?.type === "task" && timer?.remind === 0 && timer?.alarm === true && Boolean(timer?.time),
      fmt(timer));

    const named = await api("/capture", { method: "POST", body: { text: "таймер на 15 минут выключить курицу" }, as: me.token });
    check("у таймера с делом остаётся понятное название",
      named.data?.reply?.items?.[0]?.title === "Выключить курицу",
      fmt(named.data?.reply?.items?.[0]));
  });

  // Заметка без часа не должна мгновенно уезжать в архив (баг «полночь + 45с»).
  await withServer({}, async (api) => {
    const me = (await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } })).data;
    const said = await api("/capture", {
      method: "POST",
      body: { text: "заметка позвонить маме", source: "voice" },
      as: me.token,
    });
    const replyNote = said.data?.reply?.items?.[0];
    const stateNote = (said.data?.items || []).find(i => i.id === replyNote?.id);
    check("заметка из голоса остаётся активной в state",
      replyNote?.type === "note" && stateNote && !stateNote.archived && !stateNote.done,
      fmt(stateNote || replyNote));

    const buy = await api("/capture", {
      method: "POST",
      body: { text: "заметка купить хлеб", source: "widget" },
      as: me.token,
    });
    const buyItem = buy.data?.reply?.items?.[0];
    const buyState = (buy.data?.items || []).find(i => i.id === buyItem?.id);
    check("покупка/заметка с виджета тоже не архивируется сразу",
      buyState && !buyState.archived && !buyState.done,
      fmt(buyState || buyItem));
  });

  // Отмена и правка по меткам: последний таймер / точное название / «то что сказал».
  await withServer({}, async (api) => {
    const me = (await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } })).data;
    const say = text => api("/capture", { method: "POST", body: { text }, as: me.token });

    await say("таймер на 5 минут чай");
    await say("таймер на 10 минут выключить курицу");
    await say("созвон с банком завтра в 15:00");

    const delLast = (await say("удали последний таймер")).data?.reply;
    check("удали последний таймер снимает свежий таймер",
      delLast?.kind === "cancelled" && delLast?.items?.[0]?.title === "Выключить курицу",
      `${delLast?.kind}: ${delLast?.items?.[0]?.title}`);

    await say("таймер на 8 минут рис");
    const delPrev = (await say("удали таймер который ставил до этого")).data?.reply;
    check("удали таймер который ставил → последний таймер",
      delPrev?.kind === "cancelled" && delPrev?.items?.[0]?.title === "Рис",
      `${delPrev?.kind}: ${delPrev?.items?.[0]?.title}`);

    await say("купить молоко");
    const delSaid = (await say("удали то что я сказал")).data?.reply;
    check("удали то что сказал → последняя созданная запись",
      delSaid?.kind === "cancelled" && delSaid?.items?.[0]?.title === "Купить молоко",
      `${delSaid?.kind}: ${delSaid?.items?.[0]?.title}`);

    await say("таймер на 20 минут выключить духовку");
    const byName = (await say("удали выключить духовку")).data?.reply;
    check("удаление по точному названию",
      byName?.kind === "cancelled" && byName?.items?.[0]?.title === "Выключить духовку",
      `${byName?.kind}: ${byName?.items?.[0]?.title}`);

    const t1 = (await say("таймер на 30 минут тесто")).data?.reply?.items?.[0];
    const moved = (await say("поменяй таймер последний на 10 мин")).data?.reply;
    const movedItem = moved?.items?.[0];
    check("поменяй последний таймер на 10 мин",
      moved?.kind === "moved" && movedItem?.id === t1?.id && movedItem?.timer === true && movedItem?.remind === 0,
      `${moved?.kind}: ${fmt(movedItem)}`);
  });

  const cors = await fetch(`${BASE}/api/state`, {
    method: "OPTIONS",
    headers: { Origin: "https://localhost", "Access-Control-Request-Method": "GET" },
  });
  check("приложению для телефона доступ разрешён", cors.headers.get("access-control-allow-origin") === "https://localhost");

  const corsEvil = await fetch(`${BASE}/api/state`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
  });
  check("чужому сайту доступ закрыт", corsEvil.status === 403, String(corsEvil.status));

  /* —— Готовые наборы, курс лечения, платежи —— */

  const templates = await call("/templates");
  check("наборы отдаются списком",
    templates.status === 200 && Array.isArray(templates.data?.templates) && templates.data.templates.length >= 6,
    String(templates.data?.templates?.length));
  check("у набора расписано, когда сработает",
    (templates.data?.templates || []).every(t => t.items.every(i => typeof i.when === "string" && i.when.length > 0)));

  const dog = await call("/templates/dog/apply", { method: "POST", body: { picks: [0, 1] } });
  check("набор добавляет отмеченные записи", dog.status === 200 && dog.data?.added === 2,
    `${dog.data?.added} добавлено, ${dog.data?.skipped} пропущено`);
  const walk = (dog.data?.items || []).find(i => /прогулка/i.test(i.title));
  check("у записи из набора есть повтор и время", Boolean(walk?.repeat?.kind === "daily" && walk?.time), fmt(walk));

  const dogAgain = await call("/templates/dog/apply", { method: "POST", body: { picks: [0, 1] } });
  check("тот же набор второй раз не задваивает", dogAgain.data?.added === 0 && dogAgain.data?.skipped === 2,
    `${dogAgain.data?.added} / ${dogAgain.data?.skipped}`);

  const noSuchTemplate = await call("/templates/нет-такого/apply", { method: "POST", body: {} });
  check("несуществующий набор отклонён", noSuchTemplate.status === 404, String(noSuchTemplate.status));

  const course = await call("/capture", { method: "POST", body: { text: "антибиотик 3 раза в день 5 дней" } });
  const doses = course.data?.reply?.items || [];
  check("курс лечения расписан по приёмам", doses.length === 3, `создано ${doses.length}`);
  if (doses.length === 3) {
    check("у приёмов общий курс и последний день",
      doses.every(i => i.courseId && i.courseId === doses[0].courseId && i.until && i.courseTotal === 5),
      JSON.stringify({ id: doses[0].courseId, until: doses[0].until, total: doses[0].courseTotal }));
    check("приёмы стоят на разные часы", new Set(doses.map(i => i.time?.hour)).size === 3,
      JSON.stringify(doses.map(i => i.time?.hour)));
    const takeOne = await call(`/items/${doses[0].id}/done`, { method: "POST", body: { done: true } });
    check("отметка приёма попадает в счётчик", /приём 1 из 5/.test(takeOne.data?.message || ""), takeOne.data?.message);
  }

  const bill = await call("/capture", { method: "POST", body: { text: "25 числа каждый месяц оплатить квартиру" } });
  const billItem = bill.data?.reply?.items?.[0];
  check("платёж уходит на полку платежей и напоминает за сутки",
    billItem?.shelf === "bills" && billItem?.remind === 1440 && billItem?.repeat?.kind === "monthly",
    `${billItem?.shelf} · пуш ${billItem?.remind} · ${billItem?.repeat?.kind}`);

  /* —— Общие списки (любая пара) —— */

  const partner = await call("/start", { method: "POST", body: { tz: "Europe/Moscow" }, auth: false });
  const guest = await call("/start", { method: "POST", body: { tz: "Europe/Moscow" }, auth: false });
  const partnerToken = partner.data.token;
  const guestToken = guest.data.token;
  const partnerCode = partner.data.user.code;
  const guestCode = guest.data.user.code;

  const emptyLists = await call("/lists");
  check("общие списки пусты у нового аккаунта",
    emptyLists.status === 200 && (emptyLists.data?.pairs || emptyLists.data?.lists || []).length === 0,
    JSON.stringify(emptyLists.data?.pairs || emptyLists.data?.lists));

  const invited = await call("/lists/invite", { method: "POST", body: { code: partnerCode, nickname: "Муж" } });
  check("приглашение по ID уходит",
    invited.status === 200 && (invited.data?.outgoing || []).some(o => o.toCode === partnerCode),
    JSON.stringify(invited.data?.outgoing));

  const partnerIncoming = await call("/lists", { as: partnerToken });
  const inviteId = (partnerIncoming.data?.incoming || [])[0]?.id;
  check("приглашение видно получателю", Boolean(inviteId), JSON.stringify(partnerIncoming.data?.incoming));

  const accepted = await call(`/lists/invites/${inviteId}/accept`, {
    method: "POST",
    body: { nickname: "Жена" },
    as: partnerToken,
  });
  const pairId = (accepted.data?.pairs || accepted.data?.lists || [])[0]?.id;
  check("пара создаётся после принятия", Boolean(pairId), JSON.stringify(accepted.data?.pairs || accepted.data?.lists));

  const partnerLists = await call("/lists", { as: partnerToken });
  check("список виден второму участнику",
    (partnerLists.data?.pairs || partnerLists.data?.lists || []).some(l => l.id === pairId),
    JSON.stringify((partnerLists.data?.pairs || []).map(l => l.nickname)));

  const added = await call(`/lists/${pairId}/items`, { method: "POST", body: { title: "молоко" } });
  const items = added.data?.pair?.items || [];
  check("строка добавляется в список", items.length === 1, JSON.stringify(items));

  const twin = await call(`/lists/${pairId}/items`, { method: "POST", body: { title: "Молоко" } });
  check("тот же товар не задваивается", twin.data?.duplicate === true && (twin.data?.pair?.items || []).length === 1);

  const partnerSees = (await call("/lists", { as: partnerToken })).data.pairs.find(l => l.id === pairId);
  check("второй участник видит чужую строку", (partnerSees?.items || []).some(i => /молоко/i.test(i.title)));

  const entryId = partnerSees.items[0].id;
  const tookIt = await call(`/lists/${pairId}/items/${entryId}/done`, { method: "POST", body: { done: true }, as: partnerToken });
  check("любой участник может отметить строку", (tookIt.data?.pair?.items || []).every(i => i.done === true));

  const voiceShared = await call("/capture", { method: "POST", body: { text: "отправь общий список мужу купить хлеб" } });
  check("голос «общий список мужу» попадает в пару",
    voiceShared.data?.reply?.kind === "shared_list" && voiceShared.data?.reply?.pairId === pairId,
    JSON.stringify(voiceShared.data?.reply));

  const voiceDirect = await call("/capture", { method: "POST", body: { text: "отправь мужу купить масло" } });
  check("голос «отправь мужу …» без «общий список»",
    voiceDirect.data?.reply?.kind === "shared_list" && voiceDirect.data?.reply?.pairId === pairId,
    JSON.stringify(voiceDirect.data?.reply));

  const voiceTrailing = await call("/capture", { method: "POST", body: { text: "купи хлеб мужу" } });
  check("«купи хлеб мужу» → список мужу, не себе",
    voiceTrailing.data?.reply?.kind === "shared_list" && voiceTrailing.data?.reply?.pairId === pairId
    && /хлеб/i.test(voiceTrailing.data?.reply?.message || ""),
    JSON.stringify(voiceTrailing.data?.reply));

  const partnerVoice = await call("/capture", {
    method: "POST",
    body: { text: "отправь жене купить молоко" },
    as: partnerToken,
  });
  check("обратное направление: партнёр → жена",
    partnerVoice.data?.reply?.kind === "shared_list" && partnerVoice.data?.reply?.pairId === pairId,
    JSON.stringify(partnerVoice.data?.reply));
  const partnerAfter = (await call("/lists", { as: partnerToken })).data.pairs.find(l => l.id === pairId);
  check("хлеб виден получателю после «купи хлеб мужу»",
    (partnerAfter?.items || []).some(i => /хлеб/i.test(i.title)),
    JSON.stringify((partnerAfter?.items || []).map(i => i.title)));
  const guestAfter = (await call("/lists")).data.pairs.find(l => l.id === pairId);
  check("молоко от партнёра видно инициатору",
    (guestAfter?.items || []).some(i => /молок/i.test(i.title)),
    JSON.stringify((guestAfter?.items || []).map(i => i.title)));

  const sharedWidget = await call("/capture", {
    method: "POST",
    body: { text: "купи масло мужу", sharedList: true, pairId, source: "shared" },
  });
  check("shared mode + «мужу» в конце",
    sharedWidget.data?.reply?.kind === "shared_list"
    && /масл/i.test((sharedWidget.data?.reply?.sharedItems || [])[0]?.title || sharedWidget.data?.reply?.message || ""),
    JSON.stringify(sharedWidget.data?.reply));

  const outsiderStart = await call("/start", { method: "POST", body: { tz: "Europe/Moscow" }, auth: false });
  const outsider = await call(`/lists/${pairId}/items`, { method: "POST", body: { title: "чужое" }, as: outsiderStart.data.token });
  check("посторонний в список не пишет", outsider.status === 404, String(outsider.status));

  const leftList = await call(`/lists/${pairId}/leave`, { method: "POST", body: {} , as: partnerToken });
  check("из списка можно выйти",
    (leftList.data?.pairs || leftList.data?.lists || []).every(l => l.id !== pairId),
    JSON.stringify((leftList.data?.pairs || []).map(l => l.nickname)));

  const stillMine = (await call("/lists")).data.pairs?.find(l => l.id === pairId);
  check("после ухода партнёра список закрывается для обоих", !stillMine);

  /* —— Ответ прямо из уведомления —— */

  const replyBase = await call("/capture", { method: "POST", body: { text: "завтра в 14 забрать посылку" } });
  const replyItem = replyBase.data?.reply?.items?.[0];
  const movedByReply = await call(`/items/${replyItem.id}/reply`, { method: "POST", body: { text: "перенеси на час позже" } });
  const movedItem = (movedByReply.data?.items || []).find(i => i.id === replyItem.id);
  check("ответ «перенеси на час позже» двигает саму запись",
    movedByReply.status === 200 && movedItem?.time?.hour === 15,
    `${movedByReply.data?.message} · ${fmt(movedItem)}`);

  const doneByReply = await call(`/items/${replyItem.id}/reply`, { method: "POST", body: { text: "готово" } });
  const doneItem = (doneByReply.data?.items || []).find(i => i.id === replyItem.id);
  check("ответ «готово» закрывает запись", doneItem?.done === true, fmt(doneItem));

  const newByReply = await call(`/items/${replyItem.id}/reply`, { method: "POST", body: { text: "купить батарейки" } });
  check("посторонний ответ становится новой записью",
    (newByReply.data?.items || []).some(i => /батарейк/i.test(i.title)),
    newByReply.data?.message);

  const foreignReply = await call(`/items/${replyItem.id}/reply`, { method: "POST", body: { text: "готово" }, as: guestToken });
  check("на чужую запись ответить нельзя", foreignReply.status === 404, String(foreignReply.status));

  const emptyReply = await call(`/items/${replyItem.id}/reply`, { method: "POST", body: { text: "   " } });
  check("пустой ответ ничего не делает", emptyReply.status === 400, String(emptyReply.status));

  const brief = await call("/settings", { method: "POST", body: { morningBrief: true, morningHour: 7 } });
  check("утренний брифинг включается и помнит час",
    brief.data?.user?.settings?.morningBrief === true && brief.data?.user?.settings?.morningHour === 7,
    JSON.stringify({ on: brief.data?.user?.settings?.morningBrief, h: brief.data?.user?.settings?.morningHour }));

  const briefLate = await call("/settings", { method: "POST", body: { morningHour: 23 } });
  check("ночной час для брифинга не принимается", briefLate.data?.user?.settings?.morningHour === 12,
    String(briefLate.data?.user?.settings?.morningHour));

  /* —— Звуки будильника и уведомлений —— */

  const soundDefaults = await call("/state");
  check("звуки по умолчанию заданы",
    soundDefaults.data?.user?.settings?.alarmSound === "alarm_radar"
    && soundDefaults.data?.user?.settings?.notifySound === "notify_marimba",
    JSON.stringify({ a: soundDefaults.data?.user?.settings?.alarmSound, n: soundDefaults.data?.user?.settings?.notifySound }));

  const pickSound = await call("/settings", { method: "POST", body: { alarmSound: "alarm_rise", notifySound: "notify_soft" } });
  check("выбранные звуки сохраняются",
    pickSound.data?.user?.settings?.alarmSound === "alarm_rise"
    && pickSound.data?.user?.settings?.notifySound === "notify_soft",
    JSON.stringify({ a: pickSound.data?.user?.settings?.alarmSound, n: pickSound.data?.user?.settings?.notifySound }));

  // Первый набор звуков заменён: старый выбор должен переехать на близкий новый, а не сброситься.
  const oldSound = await call("/settings", { method: "POST", body: { alarmSound: "alarm_dawn", notifySound: "notify_chord" } });
  check("выбор из старого набора переезжает на новый",
    oldSound.data?.user?.settings?.alarmSound === "alarm_sunrise"
    && oldSound.data?.user?.settings?.notifySound === "notify_kalimba",
    JSON.stringify({ a: oldSound.data?.user?.settings?.alarmSound, n: oldSound.data?.user?.settings?.notifySound }));

  const badSound = await call("/settings", { method: "POST", body: { alarmSound: "../secret", notifySound: "alarm_bells" } });
  check("чужой идентификатор звука не проходит",
    badSound.data?.user?.settings?.alarmSound === "alarm_radar"
    && badSound.data?.user?.settings?.notifySound === "notify_marimba",
    JSON.stringify({ a: badSound.data?.user?.settings?.alarmSound, n: badSound.data?.user?.settings?.notifySound }));

  for (const id of ["alarm_sunrise", "alarm_radar", "alarm_bells", "alarm_kalimba", "alarm_rise",
    "alarm_forte", "alarm_piacevole", "alarm_placido",
    "notify_marimba", "notify_glass", "notify_kalimba", "notify_drop", "notify_soft",
    "notify_allegro", "notify_pizzicato", "notify_brio"]) {
    const file = await fetch(`${BASE}/sounds/${id}.mp3`);
    const type = file.headers.get("content-type") || "";
    const bytes = await file.arrayBuffer();
    check(`звук ${id} отдаётся сервером`, file.status === 200 && type.startsWith("audio/") && bytes.byteLength > 2000,
      `${file.status} ${type} ${bytes.byteLength}`);
  }

  const catalog = await fetch(`${BASE}/sounds-catalog.js`);
  check("список звуков доступен и вебу, и приложению", catalog.status === 200, String(catalog.status));

  /* —— Правила, согласие, жалобы, блокировки, поддержка —— */

  const privacyPage = await fetch(`${BASE}/privacy.html`);
  check("политика конфиденциальности открывается", privacyPage.status === 200, String(privacyPage.status));

  const beforeConsent = await call("/state");
  const consentVersion = beforeConsent.data?.consentVersion;
  check("сервер называет редакцию согласия", typeof consentVersion === "string" && consentVersion.length >= 8, String(consentVersion));

  const badConsent = await call("/consent", { method: "POST", body: { version: "2000-01-01" } });
  check("чужая редакция согласия отклонена", badConsent.status === 400, String(badConsent.status));

  const okConsent = await call("/consent", { method: "POST", body: { version: consentVersion } });
  check("согласие сохраняется у человека",
    okConsent.status === 200 && okConsent.data?.user?.settings?.consent?.version === consentVersion,
    JSON.stringify(okConsent.data?.user?.settings?.consent));

  const blockedInvite = await call("/block", { method: "POST", body: { code: partnerCode }, as: guestToken });
  check("блокировка по ID работает",
    blockedInvite.status === 200 && (blockedInvite.data?.blocked || []).some(b => b.code === partnerCode),
    JSON.stringify(blockedInvite.data?.blocked));

  const silentInvite = await call("/lists/invite", { method: "POST", body: { code: guestCode, nickname: "Гость" }, as: partnerToken });
  check("заблокированный не попадает в список незаметно для звавшего",
    silentInvite.status === 200 && !(silentInvite.data?.outgoing || []).some(o => o.toCode === guestCode),
    JSON.stringify(silentInvite.data?.outgoing));

  const unblocked = await call(`/block/${partnerCode}`, { method: "DELETE", as: guestToken });
  check("блокировку можно снять",
    unblocked.status === 200 && (unblocked.data?.blocked || []).every(b => b.code !== partnerCode),
    String(unblocked.status));

  /* —— Поддержка: переписка по id, без почты и телефона —— */

  const emptyThread = await call("/support");
  check("пустая переписка отдаётся без ошибки",
    emptyThread.status === 200 && Array.isArray(emptyThread.data?.messages) && emptyThread.data.unread === 0,
    JSON.stringify(emptyThread.data));

  const shortTicket = await call("/support", { method: "POST", body: { text: "ой" } });
  check("пустое обращение в поддержку отклонено", shortTicket.status === 400, String(shortTicket.status));

  const ticket = await call("/support", {
    method: "POST",
    body: { text: "Не пришло напоминание в 9:00, посмотрите пожалуйста", platform: "web", appVersion: "1.7.5" },
  });
  check("обращение в поддержку принято и легло в переписку",
    ticket.status === 200 && ticket.data?.messages?.length === 1 && ticket.data.messages[0].from === "user",
    JSON.stringify(ticket.data));

  const secondTicket = await call("/support", { method: "POST", body: { text: "И ещё будильник молчит по утрам" } });
  check("вторая реплика добавляется к той же переписке", secondTicket.data?.messages?.length === 2,
    String(secondTicket.data?.messages?.length));

  const threadState = await call("/state");
  check("состояние приносит счётчик поддержки",
    threadState.data?.support && threadState.data.support.unread === 0,
    JSON.stringify(threadState.data?.support));

  const readBack = await call("/support/read", { method: "POST" });
  check("отметка о прочтении не ломает переписку",
    readBack.status === 200 && readBack.data?.unread === 0 && readBack.data?.messages?.length === 2,
    JSON.stringify(readBack.data?.unread));

  const billing = await call("/billing");
  check(
    "тариф виден и по умолчанию бесплатный",
    billing.status === 200 && billing.data?.plan === "free" && (billing.data?.products || []).length === 2,
    JSON.stringify(billing.data).slice(0, 140));
  check(
    "по умолчанию тестовый режим выключен",
    billing.data?.testMode === false,
    JSON.stringify(billing.data?.testMode));

  await withServer({ VC_BILLING_TEST: "1" }, async api => {
    const me = (await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } })).data;
    const dev = await api("/billing", { as: me.token });
    check(
      "VC_BILLING_TEST=1 включает dev-флаг",
      dev.data?.testMode === true,
      JSON.stringify(dev.data?.testMode));
  });

  const restoreEmpty = await call("/billing/restore-purchases", { method: "POST", body: {} });
  check(
    "восстановление без покупок не ломает тариф",
    restoreEmpty.status === 200 && restoreEmpty.data?.plan === "free",
    JSON.stringify(restoreEmpty.data?.plan));

  const state = await call("/state");
  console.log("\n  Записи в итоге:");
  for (const i of state.data.items) console.log(`   - ${fmt(i)}`);
  console.log("");

  const privacy = await fetch(`${BASE}/privacy.html`);
  check("политика конфиденциальности открывается", privacy.status === 200, String(privacy.status));

  // Последней проверяем удаление: после него аккаунта уже нет.
  const wipe = await call("/account", { method: "DELETE" });
  check("аккаунт удаляется по требованию", wipe.status === 200, String(wipe.status));

  const afterWipe = await call("/state");
  check("после удаления доступ закрыт", afterWipe.status === 401, String(afterWipe.status));

  const restoreGone = await call("/restore", { method: "POST", body: { key: transferKey }, auth: false });
  check("удалённые записи не вернуть ключом", restoreGone.status === 401, String(restoreGone.status));

  console.log(failed ? `\n${failed} проверок не прошло` : "\nВсе проверки API прошли");
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error("Сбой прогона:", err.message);
  process.exit(1);
});
