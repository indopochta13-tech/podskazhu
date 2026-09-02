/**
 * Перенос по ключу — сценарии, которые ломались на телефонах:
 * - stale Bearer на /restore (клиент шлёт auth:false и чистит token до запроса)
 * - «Нужен вход» вместо «Ключ не подходит» при протухшем token в localStorage
 * - неверный/удалённый ключ → 401 с текстом, не новый пустой аккаунт
 * - нормализация ключа (регистр, дефисы, пробелы)
 * - второй телефон получает тот же user.code и записи, но новый token
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let failed = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withServer(env, fn) {
  const port = 8800 + Math.floor(Math.random() * 90);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-restore-"));
  const child = spawn(process.execPath, [path.join(APP_DIR, "server.js")], {
    cwd: APP_DIR,
    env: { ...process.env, VC_PORT: String(port), VC_HOST: "127.0.0.1", VC_DATA_DIR: dir, ...env },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, { method = "GET", body, auth = true, as = "" } = {}) => {
    const headers = { ...(body ? { "Content-Type": "application/json" } : {}) };
    if (auth && as) headers.Authorization = `Bearer ${as}`;
    const res = await fetch(`${base}/api${p}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        if ((await api("/config", { auth: false })).status === 200) break;
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
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

async function main() {
  console.log("Проверяю перенос по ключу\n");

  await withServer({}, async api => {
    const a = await api("/start", { method: "POST", body: { tz: "Europe/Moscow" }, auth: false });
    check("старт выдаёт ключ", a.status === 200 && a.data?.user?.transferKey, a.data?.user?.transferKey);
    const key = a.data.user.transferKey;
    const code = a.data.user.code;
    const stale = a.data.token;

    await api("/capture", {
      method: "POST",
      body: { text: "завтра в 10 совещание" },
      as: stale,
    });

    await api("/consent", { method: "POST", body: { version: "2026-08-31" }, as: stale });

    const restoreClean = await api("/restore", {
      method: "POST",
      body: { key, tz: "Europe/Moscow" },
      auth: false,
    });
    check("restore без Authorization", restoreClean.status === 200 && restoreClean.data?.token, String(restoreClean.status));
    check("тот же ID после restore", restoreClean.data?.user?.code === code, restoreClean.data?.user?.code);
    check("новый token после restore", restoreClean.data?.token && restoreClean.data.token !== stale);
    check("запись вернулась", restoreClean.data?.items?.some(i => /совещание/i.test(i.title)), JSON.stringify(restoreClean.data?.items?.map(i => i.title)));
    check(
      "согласие с сервера вернулось без body.consent",
      restoreClean.data?.user?.settings?.consent?.version === "2026-08-31",
      JSON.stringify(restoreClean.data?.user?.settings?.consent),
    );

    const fresh = await api("/start", { method: "POST", body: { tz: "Europe/Moscow" }, auth: false });
    const freshKey = fresh.data.user.transferKey;
    const noConsentRestore = await api("/restore", {
      method: "POST",
      body: { key: freshKey, tz: "Europe/Moscow" },
      auth: false,
    });
    check(
      "аккаунт без согласия — restore не подставляет его сам",
      !noConsentRestore.data?.user?.settings?.consent?.version,
      JSON.stringify(noConsentRestore.data?.user?.settings?.consent),
    );

    const withConsentBody = await api("/restore", {
      method: "POST",
      body: { key: freshKey, tz: "Europe/Moscow", consent: "2026-08-31" },
      auth: false,
    });
    check(
      "явный consent в restore записывает согласие",
      withConsentBody.data?.user?.settings?.consent?.version === "2026-08-31",
      JSON.stringify(withConsentBody.data?.user?.settings?.consent),
    );

    const lower = await api("/restore", {
      method: "POST",
      body: { key: key.toLowerCase(), tz: "Europe/Moscow" },
      auth: false,
    });
    check("ключ в нижнем регистре", lower.status === 200, String(lower.status));

    const spaced = await api("/restore", {
      method: "POST",
      body: { key: key.replace(/-/g, " "), tz: "Europe/Moscow" },
      auth: false,
    });
    check("ключ без дефисов", spaced.status === 200, String(spaced.status));

    const bad = await api("/restore", { method: "POST", body: { key: "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ" }, auth: false });
    check("чужой ключ → 401", bad.status === 401, String(bad.status));
    check("текст «Ключ не подходит»", bad.data?.error === "Ключ не подходит", bad.data?.error);

    const short = await api("/restore", { method: "POST", body: { key: "ABC" }, auth: false });
    check("короткий ключ отклонён", short.status === 401, String(short.status));

    // Stale token на /state → 401; restore всё ещё работает.
    const deadState = await api("/state", { as: `${stale}-expired` });
    check("протухший token не пускает на /state", deadState.status === 401, String(deadState.status));
    const afterDead = await api("/restore", {
      method: "POST",
      body: { key, tz: "Europe/Moscow" },
      auth: false,
    });
    check("restore после протухшего token", afterDead.status === 200 && afterDead.data?.user?.code === code, String(afterDead.status));

    const wipe = await api("/account", { method: "DELETE", as: restoreClean.data.token });
    check("аккаунт удалён", wipe.status === 200, String(wipe.status));
    const gone = await api("/restore", { method: "POST", body: { key }, auth: false });
    check("удалённый аккаунт не восстанавливается", gone.status === 401, String(gone.status));
  });

  console.log(failed ? `\n${failed} проверок не прошло` : "\nВсе проверки restore прошли");
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error("Сбой прогона:", err.message);
  process.exit(1);
});
