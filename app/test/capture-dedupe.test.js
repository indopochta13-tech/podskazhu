/**
 * Реальные сценарии дублей: обрывок STT + полная фраза, повтор, параллель.
 * Запуск: node test/capture-dedupe.test.js  (нужен локальный или VC_BASE)
 *
 * Фраза «Напомни завтра приготовить» без часа теперь не создаёт запись сразу,
 * а вызывает вопрос «Во сколько?»: полка дел просит время. Поэтому каждый
 * сценарий доигрывается до конца — на вопрос отвечаем, и только потом смотрим,
 * сколько записей осталось. Проверяем ровно то же, что и раньше: обрывок и
 * полная фраза дают одну запись, а не две.
 */
const BASE = process.env.VC_BASE || "http://127.0.0.1:8790";

async function start() {
  const r = await fetch(`${BASE}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tz: "Europe/Moscow" }),
  });
  const data = await r.json();
  if (!data.token) throw new Error("no token");
  return data.token;
}

async function capture(token, text, source = "voice") {
  const r = await fetch(`${BASE}/api/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, source }),
  });
  return r.json();
}

/** Ответ на «Во сколько?». Если вопроса не было — ничего не делаем. */
async function answerTime(token, data, at = "в 18") {
  if (data?.reply?.kind !== "ask") return data;
  return capture(token, at);
}

async function state(token) {
  const r = await fetch(`${BASE}/api/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.json();
}

function activeNotes(data) {
  return (data.items || []).filter(i =>
    !i.cancelled && !i.deleted && !i.archived && !i.done
    && (i.type === "note" || i.type === "task")
    && /приготовить|куриц/i.test(`${i.title} ${i.source || ""}`));
}

function check(name, ok, detail) {
  if (!ok) {
    console.error("FAIL:", name, detail || "");
    process.exitCode = 1;
  } else {
    console.log("ok:", name);
  }
}

async function main() {
  // 1) обрывок, следом полная фраза
  {
    const t = await start();
    await capture(t, "Напомни завтра приготовить");
    await capture(t, "Напомни завтра приготовить курицу");
    await answerTime(t, { reply: { kind: "ask" } });
    const notes = activeNotes(await state(t));
    check("short→long = 1 note", notes.length === 1 && /куриц/i.test(notes[0]?.title || ""),
      notes.map(n => n.title));
    check("short→long: обрывок не остался отдельной записью",
      !notes.some(n => /^приготовить$/i.test(n.title)), notes.map(n => n.title));
  }

  // 2) та же фраза дважды подряд
  {
    const t = await start();
    const first = await capture(t, "Напомни завтра приготовить курицу");
    await answerTime(t, first);
    const again = await capture(t, "Напомни завтра приготовить курицу");
    const notes = activeNotes(await state(t));
    check("exact dup = 1", notes.length === 1, notes.map(n => n.title));
    check("exact dup kind", again.reply?.kind === "duplicate", again.reply?.kind);
  }

  // 3) полная фраза, следом обрывок
  {
    const t = await start();
    const first = await capture(t, "Напомни завтра приготовить курицу");
    await answerTime(t, first);
    await capture(t, "Напомни завтра приготовить");
    const notes = activeNotes(await state(t));
    check("long→short = 1", notes.length === 1 && /куриц/i.test(notes[0]?.title || ""),
      notes.map(n => n.title));
  }

  // 4) две одинаковые фразы одновременно
  {
    const t = await start();
    const phrase = "Напомни завтра приготовить курицу";
    await Promise.all([capture(t, phrase), capture(t, phrase)]);
    await answerTime(t, { reply: { kind: "ask" } });
    const notes = activeNotes(await state(t));
    check("parallel = 1 id", notes.length === 1, notes.map(n => n.title));
  }

  // 5) обрывок, пауза, полная фраза
  {
    const t = await start();
    await capture(t, "Напомни завтра приготовить");
    await new Promise(r => setTimeout(r, 2500));
    await capture(t, "Напомни завтра приготовить курицу");
    await answerTime(t, { reply: { kind: "ask" } });
    const notes = activeNotes(await state(t));
    check("delayed 2.5s short→long = 1", notes.length === 1 && /куриц/i.test(notes[0]?.title || ""),
      notes.map(n => n.title));
  }

  if (process.exitCode) {
    console.error("\nDEDUP TESTS FAILED");
    process.exit(1);
  }
  console.log("\nALL DEDUP TESTS PASSED");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
