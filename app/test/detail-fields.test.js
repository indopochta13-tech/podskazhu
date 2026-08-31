/**
 * Поля who/place/phone/note в карточке записи (раздел 2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

async function withServer(fn) {
  const port = 8920 + Math.floor(Math.random() * 70);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-detail-"));
  const child = spawn(process.execPath, [path.join(APP_DIR, "server.js")], {
    cwd: APP_DIR,
    env: { ...process.env, VC_PORT: String(port), VC_HOST: "127.0.0.1", VC_DATA_DIR: dir },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, { method = "GET", body, token = "" } = {}) => {
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

console.log("Карточка записи: who / place / phone / note\n");

await withServer(async (api) => {
  const start = await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } });
  const token = start.data?.token;

  const cap = await api("/capture", {
    method: "POST",
    body: { text: "завтра в 14 встреча с Иваном на Ленина 15", source: "text" },
    token,
  });
  const item = cap.data?.reply?.items?.[0];
  check("parse: время, участник, место",
    item?.time?.hour === 14 && /Иван/i.test(item?.who || "") && /Ленина/i.test(item?.place || ""),
    JSON.stringify({ time: item?.time, who: item?.who, place: item?.place }));

  const patched = await api(`/items/${item.id}`, {
    method: "PATCH",
    body: { phone: "+7 900 123-45-67" },
    token,
  });
  check("телефон сохраняется", patched.data?.item?.phone === "+7 900 123-45-67",
    JSON.stringify(patched.data?.item?.phone));

  const longNote = "а".repeat(1500);
  const noted = await api(`/items/${item.id}`, {
    method: "PATCH",
    body: { note: longNote },
    token,
  });
  check("заметка 1500 символов целиком", noted.data?.item?.note?.length === 1500,
    String(noted.data?.item?.note?.length));

  const buy = await api("/capture", {
    method: "POST",
    body: { text: "купить хлеб", source: "text" },
    token,
  });
  const bread = buy.data?.reply?.items?.[0];
  check("простая покупка без who/place/phone",
    bread && !bread.who && !bread.place && !bread.phone,
    JSON.stringify({ who: bread?.who, place: bread?.place, phone: bread?.phone }));
});

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки detail-fields прошли");
