/**
 * PRO unlock без живой покупки: выдача подписки через db.json + проверка
 * серверных и клиентских путей разблокировки.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isPro, billingState } from "../lib/billing.js";
import { createUser } from "../lib/store.js";
import { isProShelf } from "../lib/pro-shelves.js";
import { PRO_SHELF_PROMO } from "../public/pro-shelf-promo.js";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(path.join(APP_DIR, "public/app.js"), "utf8");

let failed = 0;
let server = null;
let dir = "";
let port = 0;
let base = "";

function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

function grantPro(userId) {
  const f = path.join(dir, "db.json");
  const db = JSON.parse(readFileSync(f, "utf8"));
  db.users[userId].billing = {
    plan: "pro",
    until: Date.now() + 30 * 86400000,
    productId: "pro_month",
    purchaseId: "test-grant",
    updatedAt: Date.now(),
  };
  writeFileSync(f, JSON.stringify(db));
}

async function call(p, { method = "GET", body, token = "" } = {}) {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await call("/config")).status === 200) return true;
    } catch { /* wait */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

function startServer(extraEnv = {}) {
  port = 8930 + Math.floor(Math.random() * 60);
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(APP_DIR, "server.js")], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      VC_PORT: String(port),
      VC_HOST: "127.0.0.1",
      VC_DATA_DIR: dir,
      VC_RATE_OFF: "1",
      VC_BILLING_TEST: "1",
      ...extraEnv,
    },
    stdio: "ignore",
  });
}

async function restartWithPro(userId) {
  server.kill("SIGKILL");
  await new Promise(r => setTimeout(r, 1200));
  grantPro(userId);
  startServer();
  if (!await waitReady()) throw new Error("сервер не поднялся после grantPro");
}

console.log("PRO unlock (без живой покупки)\n");

console.log("── billing.js ──");
const freeUser = createUser("Europe/Moscow");
check("free: isPro false", !isPro(freeUser));
check("free: billingState.active false", !billingState(freeUser).active);

freeUser.billing = { plan: "pro", until: Date.now() + 86400000, productId: "pro_month" };
check("pro: isPro true", isPro(freeUser));
check("pro: billingState.active true", billingState(freeUser).active);

console.log("\n── Клиент: замки и промо снимаются при active ──");
check("isPro учитывает active и until",
  /function isPro\(\)[\s\S]*?if \(!b\?\.active\) return false[\s\S]*?until <= Date\.now\(\)/.test(appJs));
check("замок только когда !isPro()",
  /const locked = !isPro\(\)/.test(appJs));
check("proShelfGated: pro снимает блок",
  /function proShelfGated[\s\S]*?if \(isPro\(\)\) return false/.test(appJs));
check("renderDaily: промо только при proShelfGated",
  /if \(proShelfGated\(state\.shelf\)\)[\s\S]*?proShelfPromoScreenHtml/.test(appJs));
check("renderLists: промо только при proShelfGated shared",
  /if \(proShelfGated\("shared"\)\)[\s\S]*?proShelfPromoScreenHtml/.test(appJs));
check("renderCare / renderHealth: промо за proShelfGated",
  /if \(proShelfGated\("care"\)\)/.test(appJs) && /if \(proShelfGated\("health"\)\)/.test(appJs));
check("FAB не блокируется при isPro",
  /function shelfFabDemoBlocked[\s\S]*?if \(isPro\(\)\) return false/.test(appJs));

for (const id of ["shared", "care", "sport", "health", "meters", "bills"]) {
  check(`полка ${id} — PRO + промо-текст`, isProShelf(id) && Boolean(PRO_SHELF_PROMO[id]));
}

console.log("\n── API: free блокирует, grantPro разблокирует ──");
dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-pro-"));
startServer();
if (!await waitReady()) throw new Error("сервер не стартовал");

const start = (await call("/start", { method: "POST", body: { tz: "Europe/Moscow" } })).data;
const token = start.token;
const uid = start.user.id;

const freeBilling = (await call("/billing", { token })).data;
check("до выдачи: active false", freeBilling?.active === false);
check("VC_BILLING_TEST не даёт PRO сам по себе",
  freeBilling?.testMode === true && freeBilling?.active === false);

const blocked = await call("/capture", {
  method: "POST",
  token,
  body: { text: "каждый день в 8 утра витамины" },
});
check("free: витамины → pro_required", blocked.data?.reply?.kind === "pro_required",
  blocked.data?.reply?.kind);

await new Promise(r => setTimeout(r, 500));
await restartWithPro(uid);

const proBilling = (await call("/billing", { token })).data;
check("после grantPro: active true", proBilling?.active === true, proBilling?.plan);

const vitamins = await call("/capture", {
  method: "POST",
  token,
  body: { text: "каждый день в 8 утра витамины" },
});
check("pro: витамины создаются", vitamins.data?.reply?.kind === "created",
  vitamins.data?.reply?.kind);

const invite = await call("/lists/invite", {
  method: "POST",
  token,
  body: { code: start.user.code, nickname: "Тест" },
});
check("pro: общие списки не 403", invite.status !== 403, String(invite.status));

server.kill("SIGKILL");
fs.rmSync(dir, { recursive: true, force: true });

console.log(failed ? `\n${failed} проверок не прошло` : "\nВсе проверки pro-unlock прошли");
process.exit(failed ? 1 : 0);
