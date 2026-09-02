/**
 * PRO lifecycle: Prodamus webhook, restore-purchases, transfer key, повторная подписка.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { sign } from "../lib/prodamus.js";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

function readDb(dir) {
  return JSON.parse(readFileSync(path.join(dir, "db.json"), "utf8"));
}

function writeDb(dir, db) {
  writeFileSync(path.join(dir, "db.json"), JSON.stringify(db));
}

function serverEnv(port, dir, secret, extra = {}) {
  return {
    ...process.env,
    VC_PORT: String(port),
    VC_HOST: "127.0.0.1",
    VC_DATA_DIR: dir,
    VC_RATE_OFF: "1",
    VC_PRODAMUS_SECRET_KEY: secret,
    VC_PRODAMUS_FORM_URL: "https://pay.example.test",
    VC_PRODAMUS_NOTIFICATION_URL: `http://127.0.0.1:${port}/api/billing/prodamus/webhook`,
    VC_PRODAMUS_DEMO: "1",
    ...extra,
  };
}

function startServer(port, dir, secret, extra = {}) {
  return spawn(process.execPath, [path.join(APP_DIR, "server.js")], {
    cwd: APP_DIR,
    env: serverEnv(port, dir, secret, extra),
    stdio: "ignore",
  });
}

async function waitReady(api) {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await api("/config", { auth: false })).status === 200) return true;
    } catch { /* wait */ }
    await sleep(100);
  }
  return false;
}

async function postWebhook(api, secret, payload) {
  const body = JSON.stringify(payload);
  const sig = sign(payload, `${secret}demo`);
  return api("/billing/prodamus/webhook", {
    method: "POST",
    auth: false,
    headers: { "Content-Type": "application/json", Sign: sig },
    body: Buffer.from(body),
  });
}

async function main() {
  console.log("PRO lifecycle\n");

  const port = 8940 + Math.floor(Math.random() * 50);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bill-"));
  const secret = "test-prodamus-secret";
  let child = startServer(port, dir, secret);
  const base = `http://127.0.0.1:${port}`;

  const api = async (p, { method = "GET", body, auth = true, as = "", headers = {} } = {}) => {
    const h = { ...(body ? { "Content-Type": "application/json" } : {}), ...headers };
    if (auth && as) h.Authorization = `Bearer ${as}`;
    const res = await fetch(`${base}/api${p}`, {
      method,
      headers: h,
      body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };

  try {
    if (!await waitReady(api)) throw new Error("сервер не поднялся");

    const start = await api("/start", { method: "POST", body: { tz: "Europe/Moscow" }, auth: false });
    const token = start.data.token;
    const uid = start.data.user.id;
    const key = start.data.user.transferKey;

    await api("/billing/create-payment-prodamus", {
      method: "POST",
      as: token,
      body: { productId: "pro_month" },
    });
    await sleep(400);

    let db = readDb(dir);
    const payId = Object.keys(db.billingPending || {})[0];
    check("pending в db", Boolean(payId), payId);

    const hook1 = await postWebhook(api, secret, {
      order_id: payId,
      payment_status: "success",
      sum: "299",
    });
    check("webhook → success", hook1.status === 200 && hook1.data === "success", String(hook1.data));
    await sleep(600);

    db = readDb(dir);
    check("billing plan pro", db.users[uid].billing?.plan === "pro", db.users[uid].billing?.plan);
    check("purchase сохранён", Boolean(db.purchases?.[payId]), payId);

    const hook2 = await postWebhook(api, secret, {
      order_id: payId,
      payment_status: "success",
      sum: "299",
    });
    check("повтор webhook идемпотентен", hook2.status === 200, String(hook2.status));

    const billing = await api("/billing", { as: token });
    check("API billing active", billing.data?.active === true, billing.data?.plan);

    const sport = await api("/items", {
      method: "POST",
      as: token,
      body: { type: "sport", shelf: "sport", title: "Пробежка" },
    });
    check("pro: sport создан", sport.status === 200, String(sport.status));

    // Истёкшая подписка: правим db и перезапускаем сервер (in-memory db).
    await sleep(400);
    db = readDb(dir);
    check("db перед restart: plan pro", db.users[uid].billing?.plan === "pro", db.users[uid].billing?.plan);
    db.users[uid].billing.until = Date.now() - 1000;
    writeDb(dir, db);
    child.kill("SIGKILL");
    await sleep(400);
    child = startServer(port, dir, secret);
    if (!await waitReady(api)) throw new Error("сервер не перезапустился");

    const expired = await api("/billing", { as: token });
    check("после expiry active false", expired.data?.active === false, String(expired.data?.active));

    const restore = await api("/billing/restore-purchases", { method: "POST", as: token, body: {} });
    check("restore-purchases → active", restore.data?.active === true, restore.data?.plan);

    db = readDb(dir);
    const sportItem = Object.values(db.items).find(i =>
      i.ownerId === uid && i.shelf === "sport" && i.title === "Пробежка");
    check("restore не отменил sport", sportItem && !sportItem.cancelled,
      sportItem ? String(sportItem.cancelled) : "нет");

    const xfer = await api("/restore", {
      method: "POST",
      body: { key, tz: "Europe/Moscow" },
      auth: false,
    });
    check("transfer key → тот же code", xfer.data?.user?.code === start.data.user.code, xfer.data?.user?.code);
    check("transfer key → PRO", xfer.data?.billing?.active === true, xfer.data?.billing?.plan);
    check("transfer key → записи", xfer.data?.items?.some(i => i.title === "Пробежка"),
      JSON.stringify(xfer.data?.items?.map(i => i.title)));

    const phone = await api("/start", { method: "POST", body: { tz: "Europe/Moscow" }, auth: false });
    const wrongRestore = await api("/billing/restore-purchases", {
      method: "POST",
      as: phone.data.token,
      body: {},
    });
    check("новый аккаунт без покупок", wrongRestore.data?.active === false, wrongRestore.data?.plan);
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(failed ? `\n${failed} проверок не прошло` : "\nВсе проверки billing-lifecycle прошли");
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error("Сбой прогона:", err.message);
  process.exit(1);
});
