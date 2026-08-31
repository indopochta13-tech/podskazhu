/**
 * Реальные сценарии дублей: обрывок STT + полная фраза, повтор, параллель.
 * Запуск: node test/capture-dedupe.test.js  (нужен локальный или VC_BASE)
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
  // 1) short then long immediately
  {
    const t = await start();
    await capture(t, "Напомни завтра приготовить");
    const b = await capture(t, "Напомни завтра приготовить курицу");
    const notes = activeNotes(b);
    check("short→long = 1 note", notes.length === 1 && /куриц/i.test(notes[0].title), notes.map(n => n.title));
    check("short→long type note", notes[0]?.type === "note", notes[0]?.type);
  }

  // 2) exact duplicate
  {
    const t = await start();
    await capture(t, "Напомни завтра приготовить курицу");
    const b = await capture(t, "Напомни завтра приготовить курицу");
    const notes = activeNotes(b);
    check("exact dup = 1", notes.length === 1, notes.map(n => n.title));
    check("exact dup kind", b.reply?.kind === "duplicate", b.reply?.kind);
  }

  // 3) long then short (второе не плодит карточку)
  {
    const t = await start();
    await capture(t, "Напомни завтра приготовить курицу");
    const b = await capture(t, "Напомни завтра приготовить");
    const notes = activeNotes(b);
    check("long→short = 1", notes.length === 1 && /куриц/i.test(notes[0].title), notes.map(n => n.title));
  }

  // 4) parallel race
  {
    const t = await start();
    const phrase = "Напомни завтра приготовить курицу";
    const [a, b] = await Promise.all([capture(t, phrase), capture(t, phrase)]);
    const notes = activeNotes(a.items ? a : b);
    // take whichever response has items; merge unique by checking both
    const ids = new Set([
      ...activeNotes(a).map(n => n.id),
      ...activeNotes(b).map(n => n.id),
    ]);
    check("parallel = 1 id", ids.size === 1, [...ids]);
  }

  // 5) simulate delayed second session (~3s) with fragment
  {
    const t = await start();
    await capture(t, "Напомни завтра приготовить");
    await new Promise(r => setTimeout(r, 2500));
    const b = await capture(t, "Напомни завтра приготовить курицу");
    const notes = activeNotes(b);
    check("delayed 2.5s short→long = 1", notes.length === 1, notes.map(n => n.title));
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
