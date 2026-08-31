const BASE = process.argv[2] || "http://127.0.0.1:8790";
const PEOPLE = Number(process.argv[3]) || 100;

const PHRASES = [
  "купить хлеб", "молоко и яйца", "корм коту заканчивается",
  "позвонить маме", "перезвонить в банк", "забрать посылку",
  "встреча с Иваном завтра в 10", "показ квартиры в субботу в 12",
  "к врачу во вторник в 9", "созвон с клиентом в 15",
  "поставь будильник на 7", "разбуди в половине седьмого",
  "день рождения мамы 12 марта", "у Пети днюха 3 июня",
  "вынести мусор", "погладить рубашку", "продлить страховку",
  "записаться к стоматологу", "отвезти документы в налоговую",
  "починить кран на кухне", "проверить почту",
  "каждый понедельник планерка в 9", "по будням зарядка в 7",
  "запиши что пароль от вайфая 12345", "идея для сайта",
  "напомни завтра позвонить Игорю", "важно сдать отчет в пятницу",
  "встреча в четверть одиннадцатого", "созвон в без пятнадцати два",
  "сходить в зал", "выпить витамины в 9", "заплатить за интернет",
  "передать показания счетчика",
];

const stats = { started:0, ok:0, failed:0, captures:0, created:0,
  proBlocked:0, asked:0, empty:0, errors:new Map(), slowest:0, shelves:new Map() };

const note = (m,k) => m.set(k,(m.get(k)||0)+1);

async function call(path, opts = {}) {
  const t = Date.now();
  const res = await fetch(BASE+path, {
    method: opts.method || "GET",
    headers: { "Content-Type":"application/json",
      ...(opts.token ? { Authorization: "Bearer "+opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ms = Date.now()-t;
  if (ms > stats.slowest) stats.slowest = ms;
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

async function person() {
  stats.started++;
  try {
    const s = await call("/api/start", { method:"POST",
      body:{ tz:"Europe/Moscow", consent:"2026-08-27" } });
    if (s.status !== 200 || !s.data?.token) {
      stats.failed++; note(stats.errors, "start "+s.status); return;
    }
    const token = s.data.token;
    const n = 3 + Math.floor(Math.random()*6);
    for (let i=0;i<n;i++) {
      const text = PHRASES[Math.floor(Math.random()*PHRASES.length)];
      const r = await call("/api/capture", { method:"POST", token,
        body:{ text, source:"voice" } });
      stats.captures++;
      if (r.status !== 200) { note(stats.errors, "capture "+r.status); continue; }
      const k = r.data?.reply?.kind;
      if (k==="created") stats.created++;
      else if (k==="pro_required") stats.proBlocked++;
      else if (k==="ask") stats.asked++;
      else if (k==="empty") stats.empty++;
      for (const it of r.data?.reply?.items || []) note(stats.shelves, it.shelf||it.type||"?");
      await new Promise(r2=>setTimeout(r2, 100+Math.random()*400));
    }
    const st = await call("/api/state", { token });
    if (st.status !== 200) { note(stats.errors,"state "+st.status); stats.failed++; return; }
    const alien = (st.data?.items||[]).filter(i => i.ownerId && i.ownerId !== s.data.user?.id);
    if (alien.length) note(stats.errors, "ЧУЖИЕ ЗАПИСИ В СПИСКЕ");
    stats.ok++;
  } catch (e) { stats.failed++; note(stats.errors, e.message.slice(0,40)); }
}

(async () => {
  console.log("Сто человек одновременно: "+BASE+"\n");
  const t0 = Date.now();
  // Регистрируем по восемь человек в окно, потом ждём.
  // Сервер разрешает десять с одного адреса за десять минут — это защита
  // от того, кто наделает аккаунтов пачкой. Реальные люди приходят
  // с разных адресов и в неё не упираются, а нам приходится ждать.
  const GROUP = 8;
  const PAUSE_MS = 10 * 60000 + 15000;
  for (let i=0;i<PEOPLE;i+=GROUP) {
    const batch = [];
    for (let j=i;j<Math.min(i+GROUP,PEOPLE);j++) batch.push(person());
    await Promise.all(batch);
    const done = Math.min(i+GROUP,PEOPLE);
    console.log("  "+done+" из "+PEOPLE+" · дошли "+stats.ok+" · сорвались "+stats.failed);
    if (done < PEOPLE) {
      console.log("  ждём 10 минут, чтобы не упереться в защиту...");
      await new Promise(r=>setTimeout(r, PAUSE_MS));
    }
  }
  console.log("\n\nПрошло "+((Date.now()-t0)/1000).toFixed(1)+" с\n");
  console.log("  людей: "+stats.started+", дошли "+stats.ok+", сорвались "+stats.failed);
  console.log("  фраз сказано:    "+stats.captures);
  console.log("  записей создано: "+stats.created);
  console.log("  упёрлись в ПРО:  "+stats.proBlocked);
  console.log("  переспрошено:    "+stats.asked);
  console.log("  не расслышано:   "+stats.empty);
  console.log("  самый долгий ответ: "+stats.slowest+" мс");
  console.log("\n  куда легли записи:");
  for (const [k,v] of [...stats.shelves].sort((a,b)=>b[1]-a[1])) console.log("    "+k.padEnd(12)+v);
  if (stats.errors.size) {
    console.log("\n  ошибки:");
    for (const [k,v] of [...stats.errors].sort((a,b)=>b[1]-a[1])) console.log("    "+k.padEnd(30)+v);
  } else console.log("\n  ошибок нет");
})();
