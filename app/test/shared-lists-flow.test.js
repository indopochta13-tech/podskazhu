#!/usr/bin/env node
/**
 * Общие списки: сквозная проверка между несколькими людьми.
 *
 * Не логика по отдельности, а весь путь целиком: Аня зовёт Бориса,
 * Борис принимает, оба пишут задачи, отмечают выполненное, один уходит.
 *
 * Проверяем то, что видно только на нескольких участниках: доходит ли
 * запись до всех, не путаются ли отметки, кто что видит, что остаётся
 * после ухода.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8971;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "vc-lists-"));

let passed = 0;
let failed = 0;

function check(what, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ✓ ${what}`); }
  else { failed += 1; console.log(`  ✗ ${what}${detail ? "  → " + detail : ""}`); }
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* пусто */ }
  return { status: res.status, data };
}

async function makePerson(name) {
  const r = await call("/api/start", {
    method: "POST",
    body: { tz: "Europe/Moscow", consent: "2026-08-31" },
  });
  if (r.status !== 200) throw new Error(`${name}: аккаунт не создан (${r.status})`);
  return { name, token: r.data.token, code: r.data.user.code, id: r.data.user.id };
}

/**
 * Выдаёт подписку прямо в базе: общие списки платные, а маршрута
 * для тестовой выдачи в приложении нет. Сервер при этом остановлен —
 * иначе он перезапишет файл своей копией из памяти.
 */
function grantPro(ids) {
  const f = join(dir, "db.json");
  const db = JSON.parse(readFileSync(f, "utf8"));
  const until = Date.now() + 30 * 86400000;
  for (const id of ids) {
    if (!db.users[id]) continue;
    db.users[id].billing = {
      plan: "pro", until, productId: "pro_1m",
      purchaseId: "test", updatedAt: Date.now(),
    };
  }
  writeFileSync(f, JSON.stringify(db));
}

let server = null;

async function waitReady() {
  for (let i = 0; i < 40; i += 1) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return true;
    } catch { /* ждём */ }
  }
  return false;
}

function startServer() {
  server = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      VC_PORT: String(PORT), VC_HOST: "127.0.0.1",
      VC_DATA_DIR: dir, VC_BILLING_TEST: "1", VC_RATE_OFF: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/** Останавливает сервер, выдаёт подписку, поднимает заново. */
async function restartWithPro(ids) {
  server.kill();
  await new Promise(r => setTimeout(r, 1200));
  grantPro(ids);
  startServer();
  if (!await waitReady()) throw new Error("сервер не поднялся после перезапуска");
}

async function main() {
  console.log("Общие списки: несколько человек\n");

  console.log("── Знакомство ──");
  const anya = await makePerson("Аня");
  const boris = await makePerson("Борис");
  const vera = await makePerson("Вера");
  check("три аккаунта заведены", Boolean(anya.token && boris.token && vera.token));
  check("коды разные", new Set([anya.code, boris.code, vera.code]).size === 3);

  // Общие списки — платная функция. Выдаём подписку всем троим.
  await restartWithPro([anya.id, boris.id, vera.id]);
  const proCheck = await call("/api/billing", { token: anya.token });
  check("подписка выдана", proCheck.data?.active === true,
    JSON.stringify(proCheck.data?.plan));

  console.log("\n── Приглашение ──");

  const selfInvite = await call("/api/lists/invite", {
    method: "POST", token: anya.token,
    body: { code: anya.code, nickname: "Я сам" },
  });
  check("нельзя позвать самого себя", selfInvite.status !== 200,
    `вернулось ${selfInvite.status}`);

  const badCode = await call("/api/lists/invite", {
    method: "POST", token: anya.token,
    body: { code: "ZZZZZZ", nickname: "Никто" },
  });
  check("несуществующий код отклонён", badCode.status !== 200);

  const inv = await call("/api/lists/invite", {
    method: "POST", token: anya.token,
    body: { code: boris.code, nickname: "Борис" },
  });
  check("Аня позвала Бориса", inv.status === 200, `статус ${inv.status}`);

  const again = await call("/api/lists/invite", {
    method: "POST", token: anya.token,
    body: { code: boris.code, nickname: "Борис ещё раз" },
  });
  check("повторное приглашение не создаёт второй список",
    again.status !== 200 || (again.data?.incoming || []).length <= 1);

  console.log("\n── Что видит приглашённый ──");

  const borisState = await call("/api/state", { token: boris.token });
  const incoming = borisState.data?.incoming || [];
  check("Борис видит приглашение", incoming.length === 1,
    `приглашений: ${incoming.length}`);
  check("в приглашении видно, от кого", Boolean(incoming[0]?.fromCode || incoming[0]?.nickname));

  const anyaState = await call("/api/state", { token: anya.token });
  check("Аня видит своё отправленное", (anyaState.data?.outgoing || []).length === 1);

  console.log("\n── Принятие ──");

  const inviteId = incoming[0]?.id;
  const accept = await call(`/api/lists/invites/${inviteId}/accept`, {
    method: "POST", token: boris.token, body: { nickname: "Аня" },
  });
  check("Борис принял приглашение", accept.status === 200, `статус ${accept.status}`);

  const anyaAfter = await call("/api/state", { token: anya.token });
  const borisAfter = await call("/api/state", { token: boris.token });
  const anyaLists = anyaAfter.data?.lists || anyaAfter.data?.pairs || [];
  const borisLists = borisAfter.data?.lists || borisAfter.data?.pairs || [];
  check("список появился у Ани", anyaLists.length === 1);
  check("список появился у Бориса", borisLists.length === 1);
  check("это один и тот же список", anyaLists[0]?.id === borisLists[0]?.id);
  check("приглашение исчезло из входящих", (borisAfter.data?.incoming || []).length === 0);

  const listId = anyaLists[0]?.id;

  console.log("\n── Задачи ──");

  const post1 = await call(`/api/lists/${listId}/items`, {
    method: "POST", token: anya.token, body: { title: "Купить молоко" },
  });
  const post2 = await call(`/api/lists/${listId}/items`, {
    method: "POST", token: anya.token, body: { title: "Забрать посылку" },
  });
  check("Аня добавила две задачи", post1.status === 200 && post2.status === 200,
    `статусы ${post1.status}, ${post2.status}`);

  const borisSees = await call("/api/state", { token: boris.token });
  const borisList = (borisSees.data?.lists || borisSees.data?.pairs || [])[0];
  const borisItems = borisList?.items || [];
  check("Борис видит обе задачи", borisItems.length === 2,
    `видит ${borisItems.length}`);
  check("у задач видно, кто добавил",
    borisItems.every(i => i.by), JSON.stringify(borisItems[0]?.by));

  const veraSees = await call("/api/state", { token: vera.token });
  check("Вера чужой список не видит",
    (veraSees.data?.lists || veraSees.data?.pairs || []).length === 0);

  console.log("\n── Отметки ──");

  const firstId = borisItems[0]?.id;
  const done = await call(`/api/lists/${listId}/items/${firstId}/done`, {
    method: "POST", token: boris.token, body: {},
  });
  check("Борис отметил выполненной", done.status === 200, `статус ${done.status}`);

  const anyaSeesDone = await call("/api/state", { token: anya.token });
  const anyaList2 = (anyaSeesDone.data?.lists || anyaSeesDone.data?.pairs || [])[0];
  const doneItem = (anyaList2?.items || []).find(i => i.id === firstId);
  check("Аня видит отметку Бориса", Boolean(doneItem?.done || doneItem?.doneAt),
    JSON.stringify({ done: doneItem?.done, doneAt: doneItem?.doneAt }));

  const secondId = borisItems[1]?.id;
  const laterNoTime = await call(`/api/lists/${listId}/items/${secondId}/later`, {
    method: "POST", token: boris.token, body: {},
  });
  check("«Позже» без времени отвечает понятно, а не падает",
    laterNoTime.status === 400, `статус ${laterNoTime.status}`);

  const soon = Date.now() + 3600000;
  const later = await call(`/api/lists/${listId}/items/${secondId}/later`, {
    method: "POST", token: boris.token, body: { at: soon },
  });
  check("«Позже» со временем работает", later.status === 200, `статус ${later.status}`);

  const alien = await call(`/api/lists/${listId}/items/${firstId}/done`, {
    method: "POST", token: vera.token, body: {},
  });
  check("посторонний не может отметить чужое", alien.status !== 200,
    `статус ${alien.status}`);

  console.log("\n── Удаление задачи ──");

  const del = await call(`/api/lists/${listId}/items/${firstId}`, {
    method: "DELETE", token: anya.token,
  });
  check("автор удалил свою задачу", del.status === 200, `статус ${del.status}`);

  const afterDel = await call("/api/state", { token: boris.token });
  const listAfterDel = (afterDel.data?.lists || afterDel.data?.pairs || [])[0];
  check("у Бориса задача тоже исчезла",
    !(listAfterDel?.items || []).some(i => i.id === firstId));

  console.log("\n── Выход из списка ──");

  const leave = await call(`/api/lists/${listId}/leave`, {
    method: "POST", token: boris.token, body: {},
  });
  check("Борис вышел из списка", leave.status === 200, `статус ${leave.status}`);

  const anyaAlone = await call("/api/state", { token: anya.token });
  check("список пропал и у Ани",
    (anyaAlone.data?.lists || anyaAlone.data?.pairs || []).length === 0,
    "список остался висеть");

  console.log("\n── Блокировка ──");

  const inv2 = await call("/api/lists/invite", {
    method: "POST", token: vera.token,
    body: { code: anya.code, nickname: "Вера" },
  });
  check("Вера позвала Аню", inv2.status === 200);

  const anyaInv = await call("/api/state", { token: anya.token });
  const veraInvite = (anyaInv.data?.incoming || [])[0];
  if (veraInvite) {
    const decline = await call(`/api/lists/invites/${veraInvite.id}/decline`, {
      method: "POST", token: anya.token, body: { block: true },
    });
    check("Аня отказалась и заблокировала", decline.status === 200);

    const inv3 = await call("/api/lists/invite", {
      method: "POST", token: vera.token,
      body: { code: anya.code, nickname: "Вера снова" },
    });
    // Ответ 200 намеренно: отправитель не должен узнать, что его
    // заблокировали, иначе поймёт и станет искать обход.
    const anyaQuiet = await call("/api/state", { token: anya.token });
    check("приглашение от заблокированного не доходит",
      (anyaQuiet.data?.incoming || []).length === 0,
      `у Ани ${(anyaQuiet.data?.incoming || []).length} приглашений`);
    check("отправитель не узнаёт о блокировке", inv3.status === 200,
      `статус ${inv3.status}`);
  } else {
    check("приглашение от Веры дошло", false, "не найдено");
  }

  console.log(`\n${failed ? `Провалено: ${failed} из ${passed + failed}` : `Все ${passed} проверок прошли`}`);
  return failed;
}

startServer();
if (!await waitReady()) {
  console.error("сервер не поднялся");
  server?.kill();
  process.exit(1);
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error("\nОШИБКА:", err.message);
} finally {
  server?.kill();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* занято */ }
}
process.exit(code ? 1 : 0);
