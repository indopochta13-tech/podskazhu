/**
 * Два случая, найденные после этапа 1. Оба тихие — приложение не падает, но делает не то.
 *
 * 1. Полки, скрытые по умолчанию, продолжают принимать записи. «День рождения мамы»
 *    уезжал на скрытую полку, ассистент отвечал «записала», а открыть было нельзя:
 *    закладки нет, экрана «Сегодня» в приложении тоже нет. Запись пропадала из виду
 *    до наступления даты — у дня рождения это могло быть через полгода.
 *
 * 2. Ответ на «Во сколько?» разбирался отдельно от исходной фразы. «В три» решалось
 *    как ближайшее наступление трёх часов, поэтому после 15:00 давало 03:00 следующего
 *    дня. Встреча уезжала на ночь. Проявлялось только во второй половине дня.
 *
 * Требуется поднятый сервер: VC_DATA_DIR=/tmp/vc VC_PORT=8791 node server.js
 */
const BASE = process.env.VC_TEST_URL || "http://127.0.0.1:8791";

let failed = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label} → ${detail}`);
  }
}

async function newUser() {
  const res = await fetch(`${BASE}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tz: "Europe/Moscow", consent: "2026-08-04" }),
  });
  return (await res.json()).token;
}

async function capture(token, text, source) {
  const res = await fetch(`${BASE}/api/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(source ? { text, source } : { text }),
  });
  return res.json();
}

async function state(token) {
  const res = await fetch(`${BASE}/api/state`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function run() {
  console.log("Скрытые полки и ответ на вопрос о времени\n");

  // --- 1. Полка открывается, как только в неё попала запись ---
  const t1 = await newUser();
  const before = (await state(t1)).user.settings.hiddenShelves || [];
  check("по умолчанию часть полок скрыта", before.length > 0, JSON.stringify(before));

  for (const text of [
    "день рождения мамы восьмого марта",
    "оплатить квартиру до 10 числа",
    "выпить витамин д утром",
  ]) {
    await capture(t1, text);
  }

  const after = await state(t1);
  const hidden = new Set(after.user.settings.hiddenShelves || []);
  const stranded = (after.items || []).filter(i => hidden.has(i.shelf || i.type));

  check("ни одна запись не осталась на скрытой полке", stranded.length === 0,
    stranded.map(i => `${i.title} → ${i.shelf}`).join("; "));

  check("нетронутые полки остались скрытыми", hidden.size > 0,
    "скрытых не осталось вовсе — значит открыли лишнее");

  // --- 2. Ответ на «Во сколько?» ---
  const t2 = await newUser();
  const asked = await capture(t2, "встреча с Иваном завтра", "voice");
  check("на встречу без времени задаётся вопрос", asked.reply?.kind === "ask", asked.reply?.kind);

  const answered = await capture(t2, "в три", "voice");
  const item = (answered.reply?.items || [])[0] || {};
  check("«в три» понято как день, а не как ночь", item.time?.hour === 15,
    `получилось ${item.time?.hour}:00`);

  // Ночь, названная явно, остаётся ночью.
  const t3 = await newUser();
  await capture(t3, "будильник завтра", "voice");
  const night = await capture(t3, "в три ночи", "voice");
  const nightItem = (night.reply?.items || [])[0] || {};
  check("«в три ночи» остаётся ночью", nightItem.time?.hour === 3,
    `получилось ${nightItem.time?.hour}:00`);

  // Отказ от времени по-прежнему работает.
  const t4 = await newUser();
  await capture(t4, "встреча с Петром завтра", "voice");
  const skipped = await capture(t4, "неважно", "voice");
  const skippedItem = (skipped.reply?.items || [])[0] || {};
  check("«неважно» создаёт запись без времени", !skippedItem.time,
    `время ${JSON.stringify(skippedItem.time)}`);

  console.log(failed ? `\nПровалено: ${failed}` : "\nВсе проверки прошли");
  process.exit(failed ? 1 : 0);
}

run().catch(err => {
  console.error("Сбой прогона:", err.message);
  console.error(`Нужен поднятый сервер на ${BASE}`);
  process.exit(1);
});
