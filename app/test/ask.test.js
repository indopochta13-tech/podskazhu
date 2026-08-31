/**
 * Переспрашивание времени (раздел 1): ask → fill → created.
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
  const port = 8910 + Math.floor(Math.random() * 80);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-ask-"));
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

console.log("Переспрашивание времени\n");

await withServer(async (api) => {
  const start = await api("/start", { method: "POST", body: { tz: "Europe/Moscow" } });
  const token = start.data?.token;
  check("аккаунт для ask", Boolean(token));

  const voice = (text) => api("/capture", { method: "POST", body: { text, source: "voice" }, token });
  const textCap = (text) => api("/capture", { method: "POST", body: { text, source: "text" }, token });

  const ask = await voice("встреча с Иваном завтра");
  check("голос: спрашивает время", ask.data?.reply?.kind === "ask" && Boolean(ask.data?.reply?.message),
    JSON.stringify(ask.data?.reply));

  const filled = await voice("в пятнадцать");
  const meet = filled.data?.reply?.items?.[0];
  check("ответ «в пятнадцать» → 15:00", filled.data?.reply?.kind === "created" && meet?.time?.hour === 15,
    JSON.stringify({ kind: filled.data?.reply?.kind, time: meet?.time }));

  const ask2 = await voice("встреча с Петром завтра");
  check("второй ask", ask2.data?.reply?.kind === "ask");

  const dismiss = await voice("неважно");
  const noTime = dismiss.data?.reply?.items?.[0];
  check("«неважно» → без времени", dismiss.data?.reply?.kind === "created" && !noTime?.time,
    JSON.stringify({ kind: dismiss.data?.reply?.kind, time: noTime?.time }));

  const ask3 = await voice("созвон с клиентом завтра");
  const offTopic = await voice("купить хлеб");
  const items = offTopic.data?.reply?.items || [];
  check("не по делу: встреча без времени + покупка",
    offTopic.data?.reply?.kind === "created"
    && items.length >= 2
    && items.some(i => /встреч|созвон|клиент/i.test(i.title) && !i.time)
    && items.some(i => /хлеб/i.test(i.title)),
    JSON.stringify(items.map(i => ({ title: i.title, time: i.time }))));

  const buy = await voice("купить молоко");
  check("покупки: вопроса нет", buy.data?.reply?.kind === "created",
    JSON.stringify(buy.data?.reply?.kind));

  const withTime = await voice("позвонить маме завтра в 10");
  check("со временем: вопроса нет", withTime.data?.reply?.kind === "created" && withTime.data?.reply?.items?.[0]?.time?.hour === 10,
    JSON.stringify(withTime.data?.reply));

  const typed = await textCap("встреча с Иваном завтра");
  check("текстом: вопроса нет", typed.data?.reply?.kind === "created" && typed.data?.reply?.kind !== "ask",
    JSON.stringify(typed.data?.reply?.kind));
});

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки ask прошли");
