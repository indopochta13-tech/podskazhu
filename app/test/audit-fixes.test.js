#!/usr/bin/env node
/**
 * Находки проверки перед выкладкой: по одному сценарию на каждую.
 *
 * Каждый блок повторяет то, что было в отчёте: фразу, запрос или порядок
 * действий, на котором приложение вело себя не так. Тест писался до правки
 * и на старом коде падал — это его смысл.
 *
 * Запуск: node test/audit-fixes.test.js
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sign } from "../lib/prodamus.js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.VC_AUDIT_PORT || 8931);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "audit-secret";
const dir = mkdtempSync(join(tmpdir(), "vc-audit-"));
const dbFile = join(dir, "db.json");

let proc = null;
let passed = 0;
let failed = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(what, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ✓ ${what}`); }
  else { failed += 1; console.log(`  ✗ ${what}${detail ? "  → " + detail : ""}`); }
}
const note = (...a) => console.log("     ·", ...a);
const head = t => console.log(`\n── ${t} ──`);

function startServer(extra = {}) {
  proc = spawn(process.execPath, [join(APP, "server.js")], {
    cwd: APP,
    stdio: "ignore",
    env: {
      ...process.env,
      VC_PORT: String(PORT),
      VC_HOST: "127.0.0.1",
      VC_DATA_DIR: dir,
      VC_RATE_OFF: "1",
      VC_PRODAMUS_SECRET_KEY: SECRET,
      VC_PRODAMUS_FORM_URL: "https://pay.example.test",
      VC_PRODAMUS_NOTIFICATION_URL: `${BASE}/api/billing/prodamus/webhook`,
      VC_PRODAMUS_DEMO: "1",
      ...extra,
    },
  });
}

async function waitReady() {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/config`)).status === 200) return true;
    } catch { /* ждём */ }
    await sleep(100);
  }
  return false;
}

async function stopServer() {
  if (!proc) return;
  proc.kill("SIGKILL");
  await sleep(350);
  proc = null;
}

/** Перезапуск нужен там, где базу правим руками: сервер держит её в памяти. */
async function restart(extra) {
  await stopServer();
  startServer(extra);
  if (!await waitReady()) throw new Error("сервер не поднялся");
}

const readDb = () => JSON.parse(readFileSync(dbFile, "utf8"));
const writeDb = d => writeFileSync(dbFile, JSON.stringify(d));

async function call(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function newUser() {
  const r = await call("/start", { method: "POST", body: { tz: "Europe/Moscow", consent: "2026-08-31" } });
  return { token: r.data.token, id: r.data.user.id, code: r.data.user.code };
}

const say = (user, text) => call("/capture", { method: "POST", token: user.token, body: { text } });
/** Вопрос «Во сколько?» задаётся только на голосовой ввод. */
const sayVoice = (user, text) =>
  call("/capture", { method: "POST", token: user.token, body: { text, source: "voice" } });
const stateOf = user => call("/state", { token: user.token });

async function webhook(orderId, sumRub) {
  const payload = { order_id: orderId, payment_status: "success", sum: String(sumRub) };
  const res = await fetch(`${BASE}/api/billing/prodamus/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Sign: sign(payload, `${SECRET}demo`) },
    body: JSON.stringify(payload),
  });
  return { status: res.status, text: await res.text() };
}

/** Ссылку Prodamus не создать без сети, но pending-запись маршрут кладёт до этого. */
async function pendingSolo(user, productId) {
  await call("/billing/create-payment-prodamus", { method: "POST", token: user.token, body: { productId } });
  await sleep(300);
  const rows = Object.entries(readDb().billingPending || {})
    .filter(([, r]) => r.status === "pending" && r.productId === productId);
  return rows.at(-1)?.[0];
}

async function pendingFamily(user, codes, termId) {
  const resp = await call("/billing/create-family-payment-prodamus", {
    method: "POST", token: user.token, body: { codes, termId },
  });
  await sleep(300);
  const rows = Object.entries(readDb().billingPending || {})
    .filter(([, r]) => r.type === "family" && r.status === "pending");
  return { pid: rows.at(-1)?.[0], row: rows.at(-1)?.[1], resp };
}

async function grantPro(user, productId = "pro_year", sum = 1990) {
  const pid = await pendingSolo(user, productId);
  await webhook(pid, sum);
  await sleep(350);
  return pid;
}

const DAY = 86400000;

/**
 * Проверки, которым нужен фоновый обход сервера (уборка старого, повторы,
 * рассылка напоминаний). Он ходит раз в 30 секунд, поэтому все такие сценарии
 * копятся здесь и ждут один общий тик, а не по одному каждый.
 */
const tickCases = [];

async function runTickCases() {
  if (!tickCases.length) return;
  head("Общий тик сервера");
  // Сервер пишет базу с задержкой в четверть секунды — даём ему дописать,
  // иначе перезапуск потеряет последние записи.
  await sleep(800);
  await stopServer();
  const d = readDb();
  for (const c of tickCases) c.setup(d);
  writeDb(d);
  await restart();
  note(`жду обход сервера (35 с), проверок: ${tickCases.length}`);
  await sleep(35000);
  await sleep(1000);
  for (const c of tickCases) c.run();
}

const appJs = readFileSync(join(APP, "public/app.js"), "utf8");
const privacyHtml = readFileSync(join(APP, "public/privacy.html"), "utf8");
const offerHtml = readFileSync(join(APP, "public/offer.html"), "utf8");

// ───────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Находки проверки перед выкладкой\n");
  startServer();
  if (!await waitReady()) throw new Error("сервер не поднялся");

  // ═══ №1. Семейная подписка раздавала ПРО тому, за кого не платили ═══
  head("№1 Семейная подписка: ПРО ровно тем, за кого заплатили");
  {
    const payer = await newUser();
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();

    const quote = await call("/billing/family-quote", {
      method: "POST", token: payer.token,
      body: { codes: [a.code, b.code, c.code], termId: "family_1m" },
    });
    note("три ID, месяц:", quote.data.total, "₽", JSON.stringify(quote.data.breakdown?.slots?.map(s => s.price)));

    const { pid } = await pendingFamily(payer, [a.code, b.code, c.code], "family_1m");
    const hook = await webhook(pid, quote.data.total);
    check("webhook семейной оплаты принят без ошибки",
      hook.status === 200 && hook.text === "success", `${hook.status} ${hook.text}`);
    await sleep(400);

    for (const [name, u] of [["A", a], ["B", b], ["C", c]]) {
      const st = (await call("/billing", { token: u.token })).data;
      check(`участник ${name} получил ПРО`, st.active === true, JSON.stringify(st.plan));
    }
    const payerState = (await call("/billing", { token: payer.token })).data;
    check("плательщик, не вписавший свой ID, ПРО не получает",
      payerState.active === false,
      `active=${payerState.active} — оплачено три слота, подписок выдано четыре`);

    const untils = [a, b, c].map(u => readDb().users[u.id].billing.until);
    check("срок у всех троих одинаковый", new Set(untils).size === 1, JSON.stringify(untils));
    const days = (untils[0] - Date.now()) / DAY;
    check("срок family_1m — 31 день", Math.abs(days - 31) < 0.05, `${days.toFixed(3)} дн`);

    // Повтор того же webhook не должен выдавать второй срок.
    await webhook(pid, quote.data.total);
    await sleep(400);
    const again = [a, b, c].map(u => readDb().users[u.id].billing.until);
    check("повтор webhook не продлевает семейную подписку",
      JSON.stringify(again) === JSON.stringify(untils), `${JSON.stringify(untils)} → ${JSON.stringify(again)}`);
    check("вторая семейная подписка не заводится",
      Object.keys(readDb().familySubs).length === 1,
      String(Object.keys(readDb().familySubs).length));
  }

  {
    const payer = await newUser();
    const a = await newUser();
    const b = await newUser();
    const quote = await call("/billing/family-quote", {
      method: "POST", token: payer.token,
      body: { codes: [payer.code, a.code, b.code], termId: "family_1m" },
    });
    const { pid } = await pendingFamily(payer, [payer.code, a.code, b.code], "family_1m");
    await webhook(pid, quote.data.total);
    await sleep(400);
    const st = (await call("/billing", { token: payer.token })).data;
    check("плательщик со своим ID в списке ПРО получает", st.active === true, JSON.stringify(st.plan));
    check("он же видит карточку семейной подписки как владелец",
      st.familySub?.isOwner === true && st.familySub?.memberCount === 3,
      JSON.stringify(st.familySub));
  }

  {
    // Плательщик купил только другим: карточка «Семья» всё равно должна быть его.
    const payer = await newUser();
    const a = await newUser();
    const quote = await call("/billing/family-quote", {
      method: "POST", token: payer.token, body: { codes: [a.code], termId: "family_1m" },
    });
    const { pid } = await pendingFamily(payer, [a.code], "family_1m");
    await webhook(pid, quote.data.total);
    await sleep(400);
    const st = (await call("/billing", { token: payer.token })).data;
    check("купивший только другим видит свою семейную подписку",
      st.familySub?.isOwner === true, JSON.stringify(st.familySub));
    check("но ПРО у него при этом нет", st.active === false, JSON.stringify(st.plan));
  }

  check("в форме «Семья» свой ID подставляется первой строкой",
    /function seedFamilyDraft/.test(appJs) && /seedFamilyDraft\(\)/.test(appJs),
    "public/app.js: state.familyDraft.ids начинается с пустой строки, свой код не подставляется");
  check("свою строку из списка можно убрать",
    !/draft\.ids\.length > 1 \? `<button type="button" class="icon-btn" data-family-rm/.test(appJs),
    "кнопка удаления строки спрятана, пока строка одна — свой ID убрать нельзя");

  // ═══ №10/№11. Название лекарства оставалось на сервере ═══
  head("№10/№11 Названия лекарств и косметики не остаются на сервере");
  {
    const u = await newUser();
    await grantPro(u);

    // Полка health: название стиралось, а исходная фраза — нет.
    const care = await say(u, "каждый вечер в 22 наносить ретиноевую мазь 0,1");
    const careId = care.data.reply.items?.[0]?.id;
    // Полка «дела»: маршрут забывания раньше отказывался её трогать.
    const drug = await say(u, "каждый день в 9 утра принимать флуоксетин 20 миллиграмм");
    const drugId = drug.data.reply.items?.[0]?.id;
    // Обычное дело — забывать нечего, трогать нельзя.
    const plain = await call("/items", {
      method: "POST", token: u.token,
      body: { type: "task", title: "Позвонить в банк", note: "по кредиту", place: "Тверская" },
    });
    const plainId = plain.data.item.id;
    await sleep(400);

    const before = readDb().items;
    note("до забывания:", JSON.stringify({
      мазь: `${before[careId].shelf}: "${before[careId].title}"`,
      флуоксетин: `${before[drugId].shelf}: "${before[drugId].title}"`,
    }));

    const forget = await call("/items/forget-titles", {
      method: "POST", token: u.token, body: { ids: [careId, drugId, plainId] },
    });
    await sleep(500);
    const rows = readDb().items;

    const textFields = ["title", "place", "who", "phone", "note", "source"];
    const dirty = (id, word) => textFields.filter(f => new RegExp(word, "i").test(String(rows[id]?.[f] || "")));

    check("у косметики стёрты все текстовые поля, включая исходную фразу",
      dirty(careId, "ретино").length === 0,
      `название осталось в: ${dirty(careId, "ретино").join(", ")}`);
    check("название лекарства не остаётся нигде, даже если запись ушла в «дела»",
      dirty(drugId, "флуоксетин").length === 0,
      `полка ${rows[drugId]?.shelf}, название осталось в: ${dirty(drugId, "флуоксетин").join(", ")}`);
    check("забыты обе записи", forget.data.forgotten === 2, String(forget.data.forgotten));
    check("обычное дело не трогается",
      rows[plainId].title === "Позвонить в банк" && rows[plainId].note === "по кредиту"
        && rows[plainId].place === "Тверская",
      JSON.stringify({ t: rows[plainId].title, n: rows[plainId].note, p: rows[plainId].place }));

    // Ни одного упоминания препарата во всей базе.
    const whole = JSON.stringify(readDb());
    check("во всей db.json нет слова «флуоксетин»", !/флуоксетин/i.test(whole));
    check("во всей db.json нет слова «ретиноевую»", !/ретиноев/i.test(whole));

    check("клиент отправляет на забывание и записи вне полок health/care",
      /looksPrivate/.test(appJs),
      "public/app.js фильтрует только по PRIVATE_SHELVES");
  }

  // ═══ №12. Обычное удаление не стиралось с диска ═══
  head("№12 Удалённая запись помечается к стиранию");
  {
    const u = await newUser();
    const made = await call("/items", {
      method: "POST", token: u.token,
      body: { type: "task", title: "Секретное дело", note: "тайна" },
    });
    const id = made.data.item.id;
    await call(`/items/${id}/cancel`, { method: "POST", token: u.token, body: {} });
    await sleep(400);
    let row = readDb().items[id];
    check("удаление в приложении ставит и cancelled, и deleted",
      row.cancelled === true && row.deleted === true,
      `cancelled=${row.cancelled} deleted=${row.deleted}`);

    await call(`/items/${id}/cancel`, { method: "POST", token: u.token, body: { cancelled: false } });
    await sleep(400);
    row = readDb().items[id];
    check("возврат после случайного смахивания снимает обе отметки",
      row.cancelled === false && row.deleted === false,
      `cancelled=${row.cancelled} deleted=${row.deleted}`);

    // Удаление голосом — то же самое удаление.
    const v = await newUser();
    await say(v, "созвон с банком завтра в 15:00");
    await sleep(200);
    const cancelled = await say(v, "отмени созвон с банком");
    await sleep(400);
    const vRow = Object.values(readDb().items).find(i => i.ownerId === v.id);
    check("удаление голосом тоже помечает запись к стиранию",
      cancelled.data.reply.kind === "cancelled" && vRow.cancelled === true && vRow.deleted === true,
      `${cancelled.data.reply.kind}: cancelled=${vRow.cancelled} deleted=${vRow.deleted}`);

    const undone = await say(v, "не то");
    await sleep(400);
    const vBack = readDb().items[vRow.id];
    check("«не то» возвращает удалённую голосом запись",
      undone.data.reply.kind !== "not_found" && vBack.cancelled === false && vBack.deleted === false,
      `${undone.data.reply.kind}: cancelled=${vBack.cancelled} deleted=${vBack.deleted}`);

    // Отмена по потере подписки — не удаление: такие записи должны вернуться.
    const p = await newUser();
    await grantPro(p);
    await call("/care/seed", { method: "POST", token: p.token, body: {} });
    await sleep(500);
    await stopServer();
    { const d = readDb(); d.users[p.id].billing.until = Date.now() - 1000; writeDb(d); }
    await restart();
    await stateOf(p);
    await sleep(600);
    const seeds = Object.values(readDb().items).filter(i => i.ownerId === p.id && i.source === "care-routine-v1");
    check("записи шаблона при потере подписки отменяются, но не помечаются к стиранию",
      seeds.length > 0 && seeds.every(i => i.cancelled && !i.deleted),
      `всего ${seeds.length}, помечено к стиранию ${seeds.filter(i => i.deleted).length}`);

    // Через 30 дней запись должна исчезнуть с диска — проверяем после тика.
    const old = await newUser();
    const gone = await call("/items", {
      method: "POST", token: old.token, body: { type: "task", title: "Забыть через месяц", note: "тайна" },
    });
    tickCases.push({
      setup: d => { d.items[gone.data.item.id].updatedAt = Date.now() - 31 * DAY; },
      run: () => {
        check("удалённая обычным способом запись через 30 дней исчезает из db.json",
          !readDb().items[gone.data.item.id],
          "запись всё ещё в базе");
      },
    });
    await call(`/items/${gone.data.item.id}/cancel`, { method: "POST", token: old.token, body: {} });
    await sleep(300);
  }

  // ═══ №13. Интерфейс обещал автопродление, которого нет ═══
  head("№13 Автопродления нет — и в приложении о нём ни слова");
  {
    const payer = await newUser();
    const a = await newUser();
    const quote = await call("/billing/family-quote", {
      method: "POST", token: payer.token, body: { codes: [payer.code, a.code], termId: "family_1m" },
    });
    const { pid } = await pendingFamily(payer, [payer.code, a.code], "family_1m");
    await webhook(pid, quote.data.total);
    await sleep(400);

    const st = (await call("/billing", { token: payer.token })).data;
    check("в ответе про подписку нет поля autoRenew",
      !("autoRenew" in (st.familySub || {})) && !("autoRenew" in st),
      JSON.stringify(st.familySub));
    await sleep(400);
    const billing = readDb().users[payer.id].billing;
    check("в базе у человека нет отметки об автопродлении",
      !("autoRenew" in billing), JSON.stringify(billing));
    const sub = Object.values(readDb().familySubs)[0];
    check("в базе у семейной подписки нет отметки об автопродлении",
      !("autoRenew" in sub), JSON.stringify(Object.keys(sub)));

    const cancel = await call("/billing/cancel-family", { method: "POST", token: payer.token, body: {} });
    check("маршрута отмены автопродления больше нет", cancel.status === 404,
      `вернулось ${cancel.status}`);

    check("в приложении нет кнопки «Отменить автопродление»",
      !/автопродлен/i.test(appJs), "public/app.js");
    check("в политике конфиденциальности нет речи об автопродлении",
      !/автопродлен|продлевается автоматически/i.test(privacyHtml), "public/privacy.html");
    check("оферта по-прежнему говорит, что подписка не продлевается автоматически",
      /не продлевается автоматически/.test(offerHtml), "public/offer.html");
  }

  // ═══ №15. Счётчики напоминали в день срока, а обещано за сутки ═══
  head("№15 Счётчики напоминают за сутки");
  {
    const u = await newUser();
    await grantPro(u);

    const said = await say(u, "передать показания счётчика воды 25 числа");
    const item = said.data.reply.items?.[0];
    note("«передать показания 25 числа» →", JSON.stringify({
      shelf: item?.shelf, date: item?.date, time: item?.time, remind: item?.remind,
    }));
    check("запись легла на полку счётчиков", item?.shelf === "meters", String(item?.shelf));
    check("напоминание приходит за сутки (remind = 1440)", item?.remind === 1440, String(item?.remind));
    check("срок записи — 25 число", item?.date?.day === 25, JSON.stringify(item?.date));

    await call("/meters/seed", { method: "POST", token: u.token, body: {} });
    await sleep(500);
    const seeded = Object.values(readDb().items)
      .filter(i => i.ownerId === u.id && i.source === "meters-preset-v1");
    check("готовые счётчики тоже напоминают за сутки",
      seeded.length > 0 && seeded.every(i => i.remind === 1440),
      `remind = ${[...new Set(seeded.map(i => i.remind))].join(", ")}`);

    const bills = await call("/items", {
      method: "POST", token: u.token,
      body: { type: "bills", shelf: "bills", title: "Интернет", amount: 700, time: { hour: 10, minute: 0 } },
    });
    check("платежи по-прежнему за сутки", bills.data.item.remind === 1440, String(bills.data.item.remind));
  }

  // ═══ №2. Уход собеседника уносил общий список целиком ═══
  head("№2 Общий список переживает удаление аккаунта собеседником");
  {
    const anya = await newUser();
    const boris = await newUser();
    await grantPro(anya);
    await grantPro(boris);

    await call("/lists/invite", { method: "POST", token: anya.token, body: { code: boris.code, nickname: "Борис" } });
    const incoming = (await stateOf(boris)).data.incoming || [];
    await call(`/lists/invites/${incoming[0].id}/accept`, {
      method: "POST", token: boris.token, body: { nickname: "Аня" },
    });
    const listId = ((await stateOf(anya)).data.lists || [])[0]?.id;
    check("список создан", Boolean(listId), String(listId));

    await call(`/lists/${listId}/items`, { method: "POST", token: anya.token, body: { title: "Молоко" } });
    await call(`/lists/${listId}/items`, { method: "POST", token: anya.token, body: { title: "Масло" } });
    await call(`/lists/${listId}/items`, { method: "POST", token: boris.token, body: { title: "Хлеб" } });
    const before = ((await stateOf(anya)).data.lists || [])[0];
    check("в списке три строки", (before?.items || []).length === 3,
      JSON.stringify(before?.items?.map(i => i.title)));

    await call("/account", { method: "DELETE", token: boris.token });
    await sleep(500);

    const after = ((await stateOf(anya)).data.lists || [])[0];
    check("список у Ани остался", Boolean(after),
      "весь список удалён вместе с задачами Ани");
    check("строки Ани на месте",
      (after?.items || []).some(i => i.title === "Молоко") && (after?.items || []).some(i => i.title === "Масло"),
      JSON.stringify(after?.items?.map(i => i.title)));
    const hleb = (after?.items || []).find(i => i.title === "Хлеб");
    check("строка ушедшего осталась, но обезличена",
      Boolean(hleb) && hleb.by !== "вы" && !/Борис/i.test(String(hleb.by)),
      JSON.stringify(hleb));
    note("строка Бориса подписана:", JSON.stringify(hleb?.by), "| список подписан:", JSON.stringify(after?.nickname));

    const dbAfter = readDb();
    const pair = dbAfter.lists[listId];
    check("ушедшего нет среди участников списка",
      Array.isArray(pair?.members) && !pair.members.includes(boris.id),
      JSON.stringify(pair?.members));
    check("следов ушедшего в списке не осталось",
      !JSON.stringify(pair).includes(boris.id) && !JSON.stringify(pair).includes(boris.code),
      "id или код ушедшего всё ещё в списке");

    // Аня продолжает пользоваться списком одна.
    const add = await call(`/lists/${listId}/items`, { method: "POST", token: anya.token, body: { title: "Сыр" } });
    check("в осиротевший список можно писать дальше", add.status === 200,
      `${add.status} ${JSON.stringify(add.data?.error)}`);

    // Когда уходит последний — список исчезает.
    await call("/account", { method: "DELETE", token: anya.token });
    await sleep(500);
    check("список без живых участников удаляется", !readDb().lists[listId],
      "пустой список остался в базе");
  }

  // ═══ №5. Прошедшее время молча закрывало запись ═══
  head("№5 Прошедшее время: спрашиваем, а не закрываем молча");
  {
    const now = new Date();
    const past = new Date(now.getTime() - 3 * 3600000);
    const pastHour = past.getHours();
    const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };

    const u = await newUser();
    const said = await say(u, `напомни сегодня в ${pastHour} позвонить маме`);
    note(`сейчас ${now.getHours()}:00, сказано «сегодня в ${pastHour}» →`,
      said.data.reply.kind, "|", said.data.reply.message);
    check("на прошедшее время приложение задаёт вопрос, а не отвечает «напомню»",
      said.data.reply.kind === "confirm" && /прош/i.test(said.data.reply.message || ""),
      `${said.data.reply.kind}: ${said.data.reply.message}`);

    const id = said.data.reply.items?.[0]?.id
      || Object.values(readDb().items).find(i => i.ownerId === u.id)?.id;
    await sleep(400);
    let row = readDb().items[id];
    check("запись не помечена выполненной и не убрана в архив",
      row && !row.done && !row.archived,
      `done=${row?.done} archived=${row?.archived}`);
    check("запись видна человеку в списке",
      (await stateOf(u)).data.items.some(i => i.id === id), "запись пропала из списка");

    const yes = await say(u, "да");
    await sleep(400);
    row = readDb().items[id];
    check("«да» переносит запись на завтра",
      row.date.day === new Date(now.getTime() + DAY).getDate() && row.time.hour === pastHour,
      `${JSON.stringify(row.date)} ${JSON.stringify(row.time)} — ответ: ${yes.data.reply.message}`);
    check("напоминание по перенесённой записи не отправлено заранее",
      row.remindedAt == null, String(row.remindedAt));

    // «Нет» — оставляем как есть, но запись всё равно не исчезает.
    const v = await newUser();
    const said2 = await say(v, `напомни сегодня в ${pastHour} забрать посылку`);
    check("вопрос задан и во второй раз", said2.data.reply.kind === "confirm", said2.data.reply.kind);
    const no = await say(v, "нет");
    await sleep(400);
    const vRow = Object.values(readDb().items).find(i => i.ownerId === v.id);
    check("после «нет» запись остаётся на сегодня и живой",
      vRow && vRow.date.day === today.day && !vRow.done && !vRow.archived,
      `${JSON.stringify(vRow?.date)} done=${vRow?.done} archived=${vRow?.archived} — ${no.data.reply.message}`);

    // Ручной перенос времени назад в карточке.
    const m = await newUser();
    const made = await call("/items", {
      method: "POST", token: m.token,
      body: {
        type: "task", title: "Позвонить врачу", date: today,
        time: { hour: (now.getHours() + 2) % 24, minute: 0 },
      },
    });
    const mid = made.data.item.id;
    const moved = await call(`/items/${mid}`, {
      method: "PATCH", token: m.token, body: { time: { hour: pastHour, minute: 0 } },
    });
    const inList = moved.data.items?.find(i => i.id === mid);
    check("перенос времени назад не закрывает запись молча",
      Boolean(inList) && !inList.done && !inList.archived,
      inList ? `done=${inList.done} archived=${inList.archived}` : "запись исчезла из списка");
    await sleep(400);
    const mRow = readDb().items[mid];
    check("в базе запись тоже осталась открытой",
      !mRow.done && !mRow.archived, `done=${mRow.done} archived=${mRow.archived}`);
    check("человеку сказано, что время уже прошло",
      /прош/i.test(String(moved.data.notice || moved.data.message || "")),
      `notice=${JSON.stringify(moved.data.notice)}`);

    // Обычная запись со сроком в будущем архивируется как раньше.
    const ok = await newUser();
    const fut = await call("/items", {
      method: "POST", token: ok.token,
      body: { type: "task", title: "Обычное дело", date: today, time: { hour: 23, minute: 59 } },
    });
    await call(`/items/${fut.data.item.id}/done`, { method: "POST", token: ok.token, body: { done: true } });
    await sleep(400);
    const futRow = readDb().items[fut.data.item.id];
    check("выполненная запись по-прежнему уходит в архив",
      futRow.archived === true, `archived=${futRow.archived}`);
  }

  // ═══ №3. «Удали запись на 21:30» удаляла запись на 17:00 ═══
  head("№3 Удаление по времени не хватает чужую запись");
  {
    const u = await newUser();
    await say(u, "напомнить про отчёт в 17:00");
    await say(u, "созвон с банком в 17:00");
    await say(u, "забрать посылку в 17:00");

    const miss = await say(u, "удали запись на 21:30");
    note("«удали запись на 21:30» →", miss.data.reply.kind, "|", miss.data.reply.message);
    check("на пустое время приложение отвечает «ничего нет», а не предлагает чужую запись",
      miss.data.reply.kind === "not_found",
      `${miss.data.reply.kind}: ${miss.data.reply.message}`);
    check("в ответе названо время, на котором ничего нет",
      /21[:.]30/.test(String(miss.data.reply.message || "")),
      JSON.stringify(miss.data.reply.message));

    const yes = await say(u, "да");
    await sleep(400);
    const left = (await stateOf(u)).data.items.filter(i => i.time?.hour === 17);
    check("после «да» ни одна запись на 17:00 не удалена", left.length === 3,
      `осталось ${left.length}: ${JSON.stringify(left.map(i => i.title))} — ${yes.data.reply.message}`);

    // На занятое время — по-прежнему спрашивает, какую именно.
    const many = await say(u, "удали запись на 17:00");
    check("когда записей несколько, приложение спрашивает, какую",
      ["ambiguous", "confirm"].includes(many.data.reply.kind)
        && (many.data.reply.candidates || []).length >= 2,
      `${many.data.reply.kind}, кандидатов ${(many.data.reply.candidates || []).length}`);

    // Одна запись на названное время — удаляется сразу.
    const s = await newUser();
    await say(s, "напомнить про отчёт в 17:00");
    const alone = await say(s, "удали запись на 17:00");
    check("одну запись на названное время удаляет сразу",
      alone.data.reply.kind === "cancelled",
      `${alone.data.reply.kind}: ${alone.data.reply.message}`);

    // Соседнее время в пределах часа — можно предложить, но спросив явно.
    const n = await newUser();
    await say(n, "созвон с банком в 17:00");
    const near = await say(n, "удали запись на 17:30");
    note("«удали запись на 17:30» при записи на 17:00 →", near.data.reply.kind, "|", near.data.reply.message);
    check("близкое время предлагается вопросом, а не удаляется",
      near.data.reply.kind !== "cancelled",
      `${near.data.reply.kind}: ${near.data.reply.message}`);
    await sleep(300);
    check("пока не ответили — запись на месте",
      (await stateOf(n)).data.items.some(i => i.title === "Созвон с банком"),
      "запись удалили без подтверждения");
  }

  // ═══ №19. После истечения подписки платные полки продолжали звонить ═══
  head("№19 Истёкшая подписка — платные полки молчат");
  {
    const u = await newUser();
    await grantPro(u);
    const now = new Date();
    const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
    // Ставим срок в будущее, а в прошлое двигаем перед самым тиком: иначе
    // напоминание успевает уйти раньше, пока подписка ещё действует.
    const later = new Date(now.getTime() + 3 * 3600000);
    const past = { hour: later.getHours(), minute: later.getMinutes() };
    const dueSoon = () => {
      const t = new Date(Date.now() - 2 * 60000);
      return { hour: t.getHours(), minute: t.getMinutes() };
    };

    const sport = await call("/items", {
      method: "POST", token: u.token,
      body: { type: "sport", shelf: "sport", title: "Пробежка", date: today, time: past },
    });
    const bills = await call("/items", {
      method: "POST", token: u.token,
      body: { type: "bills", shelf: "bills", title: "Интернет", date: today, time: past, remind: 0 },
    });
    const task = await call("/items", {
      method: "POST", token: u.token,
      body: { type: "task", title: "Позвонить в банк", date: today, time: past },
    });
    check("записи созданы",
      sport.status === 200 && bills.status === 200 && task.status === 200,
      `${sport.status}/${bills.status}/${task.status}`);

    // Ещё один человек — с действующей подпиской: ему платные полки звонить должны.
    const paid = await newUser();
    await grantPro(paid);
    const paidSport = await call("/items", {
      method: "POST", token: paid.token,
      body: { type: "sport", shelf: "sport", title: "Зарядка", date: today, time: past },
    });

    tickCases.push({
      setup: d => {
        d.users[u.id].billing.until = Date.now() - 1000;
        const due = dueSoon();
        for (const id of [sport.data.item.id, bills.data.item.id, task.data.item.id, paidSport.data.item.id]) {
          d.items[id].date = today;
          d.items[id].time = { hour: due.hour, minute: due.minute };
          d.items[id].remindedAt = null;
        }
      },
      run: () => {
        const rows = readDb().items;
        check("по платной полке без подписки напоминание не отправлено",
          rows[sport.data.item.id]?.remindedAt == null,
          `remindedAt=${rows[sport.data.item.id]?.remindedAt}`);
        check("по второй платной полке тоже молчит",
          rows[bills.data.item.id]?.remindedAt == null,
          `remindedAt=${rows[bills.data.item.id]?.remindedAt}`);
        check("по бесплатной полке напоминание пришло как обычно",
          rows[task.data.item.id]?.remindedAt != null,
          `remindedAt=${rows[task.data.item.id]?.remindedAt}`);
        check("у человека с подпиской платная полка звонит",
          rows[paidSport.data.item.id]?.remindedAt != null,
          `remindedAt=${rows[paidSport.data.item.id]?.remindedAt}`);
      },
    });
  }

  // ═══ №4. Второй таймер переносил первый вместо того, чтобы создаться ═══
  head("№4 Два таймера живут одновременно");
  {
    const u = await newUser();
    const first = await say(u, "таймер на 5 минут чай");
    check("первый таймер создан", first.data.reply.kind === "created",
      `${first.data.reply.kind}: ${first.data.reply.message}`);
    const second = await say(u, "таймер на 10 минут выключить курицу");
    note("второй таймер →", second.data.reply.kind, "|", second.data.reply.message);
    check("вторая фраза создаёт таймер, а не переносит первый",
      second.data.reply.kind === "created",
      `${second.data.reply.kind}: ${second.data.reply.message}`);

    const items = (await stateOf(u)).data.items;
    check("на полке два таймера", items.length === 2,
      JSON.stringify(items.map(i => `${i.title} ${i.time?.hour}:${String(i.time?.minute).padStart(2, "0")}`)));
    check("название второго не потерялось",
      items.some(i => /куриц/i.test(i.title)) && items.some(i => /чай/i.test(i.title)),
      JSON.stringify(items.map(i => i.title)));
    const chai = items.find(i => /чай/i.test(i.title));
    const kura = items.find(i => /куриц/i.test(i.title));
    const mins = (a, b) => (b.time.hour * 60 + b.time.minute) - (a.time.hour * 60 + a.time.minute);
    check("у таймеров разное время: 5 и 10 минут",
      chai && kura && mins(chai, kura) === 5,
      `разница ${chai && kura ? mins(chai, kura) : "?"} мин`);

    // Пауза между фразами ничего не меняет.
    const p = await newUser();
    await say(p, "таймер на 5 минут чай");
    await sleep(2500);
    await say(p, "таймер на 15 минут выключить курицу");
    check("пауза между фразами тоже даёт два таймера",
      (await stateOf(p)).data.items.length === 2,
      JSON.stringify((await stateOf(p)).data.items.map(i => i.title)));

    // Перенос таймера словами «перенеси» по-прежнему работает.
    const m = await newUser();
    await say(m, "таймер на 5 минут чай");
    const moved = await say(m, "перенеси таймер на 20 минут");
    check("«перенеси таймер» по-прежнему переносит, а не плодит",
      moved.data.reply.kind === "moved" && (await stateOf(m)).data.items.length === 1,
      `${moved.data.reply.kind}, записей ${(await stateOf(m)).data.items.length}`);

    // Третий таймер поверх двух.
    const t = await newUser();
    await say(t, "таймер на 5 минут чай");
    await say(t, "таймер на 10 минут курица");
    await say(t, "таймер на 3 минуты яйца");
    check("три таймера подряд — три записи",
      (await stateOf(t)).data.items.length === 3,
      JSON.stringify((await stateOf(t)).data.items.map(i => i.title)));
  }

  // ═══ №7. Повтор с 31 числа после февраля навсегда съезжал на 28-е ═══
  head("№7 Ежемесячный повтор возвращается на своё число");
  {
    const u = await newUser();
    const made = await call("/items", {
      method: "POST", token: u.token,
      body: { type: "task", title: "Платить за квартиру", time: { hour: 9, minute: 0 }, repeat: { kind: "monthly" } },
    });
    const id = made.data.item.id;
    // Ставим на 31 января будущего года: срок в будущем, шаг делаем вручную.
    await call(`/items/${id}`, {
      method: "PATCH", token: u.token, body: { date: { year: 2027, month: 0, day: 31 } },
    });

    const fmt = d => `${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    const step = async () => {
      const r = await call(`/items/${id}/done`, { method: "POST", token: u.token, body: { done: true } });
      return r.data.items.find(i => i.id === id)?.date;
    };

    const feb = await step();
    check("31 января → 28 февраля (в феврале 31-го нет)",
      feb && feb.month === 1 && feb.day === 28, fmt(feb || {}));
    const mar = await step();
    check("28 февраля → 31 марта, а не 28-е",
      mar && mar.month === 2 && mar.day === 31,
      `${fmt(mar || {})} — повтор запомнил 31 число, а не последнее сработавшее`);
    const apr = await step();
    check("31 марта → 30 апреля (в апреле 31-го нет)",
      apr && apr.month === 3 && apr.day === 30, fmt(apr || {}));
    const may = await step();
    check("30 апреля → 31 мая: число восстановилось",
      may && may.month === 4 && may.day === 31, fmt(may || {}));

    // Обычное число не ломается.
    const v = await newUser();
    const m15 = await call("/items", {
      method: "POST", token: v.token,
      body: { type: "task", title: "Интернет", time: { hour: 9, minute: 0 }, repeat: { kind: "monthly" } },
    });
    await call(`/items/${m15.data.item.id}`, {
      method: "PATCH", token: v.token, body: { date: { year: 2027, month: 0, day: 15 } },
    });
    const next = (await call(`/items/${m15.data.item.id}/done`, { method: "POST", token: v.token, body: { done: true } }))
      .data.items.find(i => i.id === m15.data.item.id)?.date;
    check("повтор с 15 числа остаётся на 15-м", next && next.day === 15, fmt(next || {}));

    // 29 января → февраль 29-го нет → 28-е → обратно на 29-е в марте.
    const w = await newUser();
    const m29 = await call("/items", {
      method: "POST", token: w.token,
      body: { type: "task", title: "Абонемент", time: { hour: 9, minute: 0 }, repeat: { kind: "monthly" } },
    });
    await call(`/items/${m29.data.item.id}`, {
      method: "PATCH", token: w.token, body: { date: { year: 2027, month: 0, day: 29 } },
    });
    const s1 = (await call(`/items/${m29.data.item.id}/done`, { method: "POST", token: w.token, body: { done: true } }))
      .data.items.find(i => i.id === m29.data.item.id)?.date;
    const s2 = (await call(`/items/${m29.data.item.id}/done`, { method: "POST", token: w.token, body: { done: true } }))
      .data.items.find(i => i.id === m29.data.item.id)?.date;
    check("29 января → 28 февраля → 29 марта",
      s1?.day === 28 && s2?.day === 29 && s2?.month === 2,
      `${fmt(s1 || {})} → ${fmt(s2 || {})}`);

    // Прочие повторы не задеты.
    const d2 = await newUser();
    const daily = await call("/items", {
      method: "POST", token: d2.token,
      body: { type: "task", title: "Зарядка", time: { hour: 9, minute: 0 }, repeat: { kind: "daily" } },
    });
    await call(`/items/${daily.data.item.id}`, {
      method: "PATCH", token: d2.token, body: { date: { year: 2027, month: 0, day: 31 } },
    });
    const nextDay = (await call(`/items/${daily.data.item.id}/done`, { method: "POST", token: d2.token, body: { done: true } }))
      .data.items.find(i => i.id === daily.data.item.id)?.date;
    check("ежедневный повтор через границу месяца: 31 января → 1 февраля",
      nextDay && nextDay.month === 1 && nextDay.day === 1, fmt(nextDay || {}));
  }

  // ═══ Платные полки не отдаются в /api/state без подписки ═══
  head("Без подписки записи с платных полок не показываются, но и не пропадают");
  {
    const u = await newUser();
    await grantPro(u);
    const now = new Date();
    const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };

    const made = {};
    for (const [shelf, body] of Object.entries({
      health: { type: "health", shelf: "health", title: "Витамин D", time: { hour: 9, minute: 0 } },
      care: { type: "care", shelf: "care", title: "Крем", time: { hour: 22, minute: 0 } },
      sport: { type: "sport", shelf: "sport", title: "Пробежка", time: { hour: 19, minute: 0 } },
      bills: { type: "bills", shelf: "bills", title: "Интернет", amount: 700, time: { hour: 10, minute: 0 } },
      meters: { type: "bills", shelf: "meters", title: "Вода", time: { hour: 10, minute: 0 } },
      tasks: { type: "task", title: "Позвонить в банк", date: today, time: { hour: 12, minute: 0 } },
    })) {
      const r = await call("/items", { method: "POST", token: u.token, body });
      made[shelf] = r.data?.item?.id;
    }
    const withPro = (await stateOf(u)).data.items;
    check("с подпиской видны все шесть записей",
      Object.values(made).every(id => withPro.some(i => i.id === id)),
      JSON.stringify(withPro.map(i => i.shelf)));

    await sleep(500);
    await stopServer();
    { const d = readDb(); d.users[u.id].billing.until = Date.now() - 1000; writeDb(d); }
    await restart();

    const free = (await stateOf(u)).data;
    const shown = free.items.map(i => i.id);
    for (const shelf of ["health", "care", "sport", "bills", "meters"]) {
      check(`полка ${shelf} без подписки не отдаётся в /api/state`,
        !shown.includes(made[shelf]),
        `запись всё ещё в списке: ${JSON.stringify(free.items.find(i => i.id === made[shelf])?.shelf)}`);
    }
    check("бесплатная полка отдаётся как обычно", shown.includes(made.tasks),
      JSON.stringify(free.items.map(i => i.shelf)));
    check("во входящих платных записей тоже нет",
      !(free.incoming || []).some(i => Object.values(made).includes(i.id)),
      JSON.stringify((free.incoming || []).map(i => i.shelf)));

    await sleep(500);
    const hidden = readDb().items;
    check("скрытые записи остаются в базе целыми",
      Object.values(made).every(id => hidden[id] && !hidden[id].deleted && !hidden[id].cancelled),
      JSON.stringify(Object.entries(made).map(([s, id]) =>
        `${s}: del=${hidden[id]?.deleted} canc=${hidden[id]?.cancelled}`)));

    // Оплатил снова — записи вернулись на свои полки.
    await grantPro(u, "pro_month", 299);
    const back = (await stateOf(u)).data.items;
    check("после оплаты все записи вернулись",
      Object.values(made).every(id => back.some(i => i.id === id)),
      JSON.stringify(back.map(i => i.shelf)));
    check("названия и полки не изменились",
      back.find(i => i.id === made.sport)?.title === "Пробежка"
        && back.find(i => i.id === made.bills)?.shelf === "bills",
      JSON.stringify(back.map(i => `${i.shelf}:${i.title}`)));

    check("приложение не стирает названия лекарств, пока полки скрыты",
      /isPro\(\)[\s\S]{0,80}privateTitles\.keepOnly|keepOnly[\s\S]{0,120}подписк/.test(appJs)
        || /if \(isPro\(\)\) privateTitles\.keepOnly/.test(appJs),
      "public/app.js: keepOnly вычистит названия скрытых записей из телефона");
  }

  // ═══ №9. Ответ новой фразой на «Во сколько?» оставлял лишнюю запись ═══
  head("№9 Новая фраза вместо ответа отменяет незаконченную запись");
  {
    const u = await newUser();
    const asked = await sayVoice(u, "встреча с Иваном завтра");
    note("«встреча с Иваном» →", asked.data.reply.kind, "|", asked.data.reply.message);
    check("на встречу без времени задаётся вопрос", asked.data.reply.kind === "ask",
      `${asked.data.reply.kind}: ${asked.data.reply.message}`);

    const other = await sayVoice(u, "купить хлеб");
    note("вместо ответа — «купить хлеб» →", other.data.reply.kind, "|", other.data.reply.message);
    const items = (await stateOf(u)).data.items;
    check("новое дело создано", items.some(i => /хлеб/i.test(i.title)),
      JSON.stringify(items.map(i => i.title)));
    check("незаконченная встреча не осталась висеть без времени",
      !items.some(i => /иван/i.test(i.title)),
      `осталась: ${JSON.stringify(items.map(i => i.title))}`);
    check("на полке ровно одна запись", items.length === 1, JSON.stringify(items.map(i => i.title)));
    await sleep(400);
    check("встречи нет и в базе — она не создавалась",
      !Object.values(readDb().items).some(i => i.ownerId === u.id && /иван/i.test(i.title)),
      JSON.stringify(Object.values(readDb().items).filter(i => i.ownerId === u.id).map(i => i.title)));

    // Настоящий ответ про время работает и ничего не отменяет.
    const v = await newUser();
    await sayVoice(v, "встреча с Иваном завтра");
    const filled = await sayVoice(v, "в три");
    note("«в три» →", filled.data.reply.kind, "|", filled.data.reply.message);
    const vItems = (await stateOf(v)).data.items;
    check("ответ «в три» заполняет время, а не создаёт новое",
      filled.data.reply.kind === "created" && vItems.length === 1,
      `${filled.data.reply.kind}, записей ${vItems.length}: ${JSON.stringify(vItems.map(i => i.title))}`);
    check("встреча на месте и со временем",
      /иван/i.test(vItems[0]?.title || "") && vItems[0]?.time?.hour === 15,
      JSON.stringify({ title: vItems[0]?.title, time: vItems[0]?.time }));

    // «Неважно» по-прежнему создаёт запись без времени.
    const w = await newUser();
    await sayVoice(w, "встреча с Иваном завтра");
    const skip = await sayVoice(w, "неважно");
    const wItems = (await stateOf(w)).data.items;
    check("«неважно» оставляет встречу без времени",
      skip.data.reply.kind === "created" && wItems.length === 1 && !wItems[0]?.time,
      `${skip.data.reply.kind}, ${JSON.stringify(wItems.map(i => `${i.title} ${JSON.stringify(i.time)}`))}`);

    // Мычание вместо ответа — не новое дело: запись остаётся без времени.
    const m = await newUser();
    await sayVoice(m, "встреча с Иваном завтра");
    await sayVoice(m, "не знаю");
    const mItems = (await stateOf(m)).data.items;
    check("«не знаю» не заводит дело с таким названием",
      !mItems.some(i => /не знаю/i.test(i.title)),
      JSON.stringify(mItems.map(i => i.title)));
    check("встреча при этом сохраняется без времени",
      mItems.some(i => /иван/i.test(i.title)),
      JSON.stringify(mItems.map(i => i.title)));

    // Уточнение времени словом — тоже ответ, а не новое дело.
    const e = await newUser();
    await sayVoice(e, "встреча с Иваном завтра");
    await sayVoice(e, "вечером");
    const eItems = (await stateOf(e)).data.items;
    check("«вечером» — ответ, а не новая запись",
      eItems.length === 1 && /иван/i.test(eItems[0]?.title || ""),
      JSON.stringify(eItems.map(i => `${i.title} ${JSON.stringify(i.time)}`)));
  }

  // ───────────────────────────────────────────────────────────────────────
  await runTickCases();
  await stopServer();
  console.log(`\n${failed ? "Провалено" : "Все проверки прошли"}: ${passed} прошло, ${failed} провалено`);
  process.exit(failed ? 1 : 0);
}

main().catch(async err => {
  console.error("Сбой прогона:", err.message);
  await stopServer();
  process.exit(1);
});
