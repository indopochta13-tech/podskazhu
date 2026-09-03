/**
 * Сумма платежа доезжает до записи и обратно.
 *
 * Разбор речи достаёт сумму из фразы («поставь платеж 3000 за детский сад»),
 * но до этой правки поле в записи не жило: сервер молча выбрасывал его при
 * создании, а карточка не могла его исправить. Тест сторожит весь путь —
 * голос → запись → state → правка → state.
 *
 * Сервер поднимаем свой, на своей папке: прогон не должен зависеть от того,
 * что уже накопилось в чужой базе.
 *
 * Запуск: node test/bills-amount.test.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`); }
}

// Платежи — полка по подписке, без неё запись туда не ляжет. Выдаём PRO так же,
// как pro-unlock.test.js: правкой db.json между двумя запусками — живая покупка
// для этого не нужна.
function grantPro(dir, userId) {
  const f = path.join(dir, "db.json");
  const db = JSON.parse(fs.readFileSync(f, "utf8"));
  db.users[userId].billing = {
    plan: "pro",
    until: Date.now() + 30 * 86400000,
    productId: "pro_month",
    purchaseId: "test-grant",
    updatedAt: Date.now(),
  };
  fs.writeFileSync(f, JSON.stringify(db));
}

async function withServer(fn) {
  const port = 8820 + Math.floor(Math.random() * 60);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-amount-"));
  const base = `http://127.0.0.1:${port}`;
  let token = "";
  let child = null;

  const api = async (p, { method = "GET", body } = {}) => {
    const res = await fetch(`${base}/api${p}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  const boot = () => {
    child = spawn(process.execPath, [path.join(APP_DIR, "server.js")], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        VC_PORT: String(port), VC_HOST: "127.0.0.1", VC_DATA_DIR: dir,
        VC_RATE_OFF: "1", VC_BILLING_TEST: "1",
      },
      stdio: "ignore",
    });
  };
  const waitReady = async () => {
    for (let i = 0; i < 80; i += 1) {
      try { if ((await api("/config")).status === 200) return; } catch { /* сервер ещё не встал */ }
      await sleep(100);
    }
    throw new Error("сервер не поднялся");
  };

  try {
    boot();
    await waitReady();
    const start = await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } });
    if (!start.data?.token) throw new Error("сервер не выдал токен");
    token = start.data.token;

    // SIGTERM, а не SIGKILL: у сервера на нём стоит сброс базы на диск.
    // Убитый наотмашь процесс db.json не оставит, и выдавать PRO будет некому.
    child.kill("SIGTERM");
    for (let i = 0; i < 60 && !fs.existsSync(path.join(dir, "db.json")); i += 1) await sleep(100);
    await sleep(400);
    grantPro(dir, start.data.user.id);
    boot();
    await waitReady();

    await fn(api);
  } finally {
    child?.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("Сумма платежа в записи\n");

await withServer(async (api) => {
  const itemById = async (id) => (await api("/state")).data?.items?.find(i => i.id === id);

  // ── голос → запись ────────────────────────────────────────────────
  const said = await api("/capture", { method: "POST", body: { text: "поставь платеж 3000 за детский сад" } });
  const created = said.data?.reply?.items?.[0];
  check("платёж из речи создан", created?.type === "bills", JSON.stringify(said.data?.reply).slice(0, 160));
  if (!created) throw new Error("запись не создана — дальше проверять нечего");
  check("сумма сохранена при создании", created.amount === 3000, String(created.amount));
  check("сумма отделена от названия", /Детский сад/i.test(created.title || ""), created.title);

  // ── запись → state ────────────────────────────────────────────────
  check("сумма возвращается в state", (await itemById(created.id))?.amount === 3000);

  // ── правка суммы ──────────────────────────────────────────────────
  await api(`/items/${created.id}`, { method: "PATCH", body: { amount: 4200 } });
  check("сумму можно исправить", (await itemById(created.id))?.amount === 4200);

  // ── правка соседнего поля сумму не теряет ─────────────────────────
  await api(`/items/${created.id}`, { method: "PATCH", body: { title: "Садик" } });
  const afterTitle = await itemById(created.id);
  check("правка названия не сбивает сумму", afterTitle?.amount === 4200 && afterTitle?.title === "Садик",
    `${afterTitle?.title} / ${afterTitle?.amount}`);

  // ── сумму можно убрать ────────────────────────────────────────────
  await api(`/items/${created.id}`, { method: "PATCH", body: { amount: null } });
  check("сумму можно стереть", (await itemById(created.id))?.amount === null);

  // ── мусор в поле не роняет запись ─────────────────────────────────
  await api(`/items/${created.id}`, { method: "PATCH", body: { amount: "много" } });
  check("строка вместо числа обнуляет, а не ломает", (await itemById(created.id))?.amount === null);

  await api(`/items/${created.id}`, { method: "PATCH", body: { amount: -50 } });
  check("отрицательная сумма подрезана до нуля", (await itemById(created.id))?.amount === 0);

  await api(`/items/${created.id}`, { method: "PATCH", body: { amount: 99999999999 } });
  check("слишком большая сумма подрезана", (await itemById(created.id))?.amount === 9999999);

  // ── запись руками, без голоса ─────────────────────────────────────
  await api("/items", { method: "POST", body: { type: "bills", title: "Интернет", amount: 750, shelf: "bills" } });
  const manual = (await api("/state")).data?.items?.find(i => i.title === "Интернет");
  check("сумма принимается и при ручном создании", manual?.amount === 750, String(manual?.amount));

  // ── без суммы поле остаётся пустым, а не нулём ────────────────────
  const plain = (await api("/capture", { method: "POST", body: { text: "оплатить коммуналку" } }))
    .data?.reply?.items?.[0];
  check("без суммы поле пустое", plain && plain.amount === null, String(plain?.amount));
});

console.log(failed ? `\nПровалено: ${failed}` : "\nСумма платежа доезжает");
process.exit(failed ? 1 : 0);
