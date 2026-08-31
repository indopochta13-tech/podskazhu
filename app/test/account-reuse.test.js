/**
 * Повторный вход не должен создавать новый аккаунт.
 *
 * Так была потеряна почти вся история одного человека: приложение при запуске
 * вызывало /api/start, потому что данные ещё не загрузились, сервер послушно
 * заводил нового пользователя, старый токен затирался — и записи оставались
 * в аккаунте, к которому больше нет доступа.
 *
 * За неделю у одного человека набежало 76 брошенных аккаунтов и 72 записи в них.
 * Если бы приложение было у людей, каждый терял бы дела при каждом заходе.
 *
 * Требуется поднятый сервер: VC_DATA_DIR=/tmp/vc VC_PORT=8791 node server.js
 */
const BASE = process.env.VC_TEST_URL || "http://127.0.0.1:8791";

let failed = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label} → ${detail}`); }
}

async function start(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tz: "Europe/Moscow" }),
  });
  return res.json();
}

async function capture(token, text) {
  await fetch(`${BASE}/api/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  });
}

async function run() {
  console.log("Повторный вход не заводит новый аккаунт\n");

  const first = await start();
  const token = first.token;
  const code = first.user.code;
  check("первый вход создаёт аккаунт", Boolean(token && code), "нет токена или кода");

  await capture(token, "купить хлеб");
  await capture(token, "завтра в 10 встреча с врачом");

  // Приложение вызывает /start при каждом запуске — сервер обязан узнать своего.
  for (let i = 1; i <= 4; i += 1) {
    const again = await start(token);
    check(`заход ${i}: тот же аккаунт`, again.user?.code === code,
      `был ${code}, стал ${again.user?.code}`);
    check(`заход ${i}: токен не сменился`, again.token === token, "токен другой");
    check(`заход ${i}: записи на месте`, (again.items || []).length === 2,
      `записей ${(again.items || []).length}, ждали 2`);
  }

  // Новый человек без токена по-прежнему получает свой аккаунт.
  const stranger = await start();
  check("новый человек получает отдельный аккаунт", stranger.user?.code !== code,
    "выдан чужой аккаунт");
  check("у нового человека записей нет", (stranger.items || []).length === 0,
    `записей ${(stranger.items || []).length}`);

  // Просроченный или чужой токен не должен пускать в чужой аккаунт.
  const fake = await start("no-such-token-12345");
  check("несуществующий токен заводит новый аккаунт", fake.user?.code !== code,
    "пустил в чужой аккаунт");

  console.log(failed ? `\nПровалено: ${failed}` : "\nВсе проверки прошли");
  process.exit(failed ? 1 : 0);
}

run().catch(err => {
  console.error("Сбой прогона:", err.message);
  console.error(`Нужен поднятый сервер на ${BASE}`);
  process.exit(1);
});
