/**
 * Свои звуки будильника и уведомлений.
 *
 * Ориентир — то, как звучат сигналы на дорогих телефонах: не пищалки, а живые
 * инструменты (маримба, глокеншпиль, калимба, колокол), ноты из мажорной гаммы,
 * мягкая атака и естественный хвост в небольшом зале. Всё синтезируется здесь,
 * поэтому лицензировать нечего и звук в настройках ровно тот же, что играет телефон.
 *
 * Запуск: node tools/make-sounds.mjs
 * Кладёт .mp3 в app/public/sounds и в mobile/android/app/src/main/res/raw.
 * Формат один на всех: mp3 играет и Safari на iPhone, и Android в канале уведомлений.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.join(APP_DIR, "public", "sounds");
const RAW_DIR = path.join(APP_DIR, "..", "mobile", "android", "app", "src", "main", "res", "raw");
const RATE = 44100;

function note(name) {
  // Равномерный строй от A4 = 440 Гц.
  const map = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const letter = name[0].toUpperCase();
  const sharp = name.includes("#");
  const octave = Number(name[name.length - 1]);
  const semis = map[letter] + (sharp ? 1 : 0) + (octave - 4) * 12 - 9;
  return 440 * Math.pow(2, semis / 12);
}

/* —— Тембры ——
 * У настоящего инструмента обертоны не кратны основному тону и гаснут с разной
 * скоростью: у дерева верх пропадает сразу, у металла тянется секундами.
 * Отсюда и берётся ощущение «живого» звука, ради которого всё это написано.
 */
const VOICES = {
  // Маримба: деревянный брусок, сильный обертон на четвёртой и десятой гармонике.
  marimba: {
    partials: [
      { ratio: 1, amp: 1, decay: 5.5 },
      { ratio: 3.93, amp: 0.3, decay: 11 },
      { ratio: 9.6, amp: 0.09, decay: 18 },
    ],
    attack: 0.002,
    click: { amp: 0.09, decay: 520, cutoff: 2400 },
  },
  // Глокеншпиль: стальная пластина, яркий верх и долгое сияние.
  glocken: {
    partials: [
      { ratio: 1, amp: 1, decay: 2.1 },
      { ratio: 2.74, amp: 0.45, decay: 3 },
      { ratio: 5.38, amp: 0.2, decay: 4.4 },
      { ratio: 8.9, amp: 0.07, decay: 6.5 },
    ],
    attack: 0.001,
    click: { amp: 0.05, decay: 700, cutoff: 5200 },
  },
  // Калимба: язычок, почти чистая гармоника с тёплым низом.
  kalimba: {
    partials: [
      { ratio: 1, amp: 1, decay: 3.8 },
      { ratio: 2.01, amp: 0.34, decay: 6 },
      { ratio: 3.03, amp: 0.13, decay: 9 },
      { ratio: 4.12, amp: 0.05, decay: 13 },
    ],
    attack: 0.004,
    click: { amp: 0.05, decay: 620, cutoff: 3000 },
  },
  // Колокол: гудящая октава снизу, терция и квинта — отсюда «церковный» характер.
  bell: {
    partials: [
      { ratio: 0.5, amp: 0.45, decay: 0.85 },
      { ratio: 1, amp: 1, decay: 1.15 },
      { ratio: 1.19, amp: 0.38, decay: 1.8 },
      { ratio: 1.5, amp: 0.42, decay: 1.7 },
      { ratio: 2, amp: 0.3, decay: 2.3 },
      { ratio: 2.51, amp: 0.14, decay: 3.2 },
      { ratio: 3.02, amp: 0.08, decay: 4 },
    ],
    attack: 0.003,
    click: { amp: 0.04, decay: 560, cutoff: 3800 },
  },
};

function makeBuffer(seconds) {
  return new Float64Array(Math.ceil(seconds * RATE));
}

/** Удар по инструменту в заданный момент. */
function hit(buf, voiceName, { at, freq, gain = 0.5, dur = 0, decayScale = 1 }) {
  const voice = VOICES[voiceName];
  const start = Math.floor(at * RATE);
  const slowest = Math.min(...voice.partials.map(p => p.decay * decayScale));
  const length = Math.floor((dur || Math.min(6, 7 / slowest)) * RATE);

  // Стук молоточка: очень короткий шум, без него удар звучит «нарисованным».
  // Шум обязательно приглушённый: незадавленный верх превращает хвост в шипение.
  const click = voice.click;
  const smooth = click ? Math.exp((-2 * Math.PI * click.cutoff) / RATE) : 0;
  let noise = 0;

  for (let i = 0; i < length; i += 1) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const t = i / RATE;
    const attack = Math.min(1, t / voice.attack);
    let sample = 0;
    for (const p of voice.partials) {
      sample += p.amp * Math.exp(-p.decay * decayScale * t) * Math.sin(2 * Math.PI * freq * p.ratio * t);
    }
    if (click) {
      noise = noise * smooth + (Math.random() * 2 - 1) * (1 - smooth);
      sample += noise * click.amp * 3 * Math.exp(-click.decay * t);
    }
    buf[idx] += sample * attack * gain;
  }
}

/**
 * Тёплая подушка под будильником: медленно приходит и так же медленно уходит.
 * Держим её в среднем регистре — телефонный динамик ниже 200 Гц почти ничего не отдаёт,
 * а в общей громкости такой бас только съедает запас и глушит мелодию.
 */
function pad(buf, { at, freq, dur, gain = 0.2, rise = 0.9 }) {
  const start = Math.floor(at * RATE);
  const length = Math.floor(dur * RATE);
  const ratios = [1, 2, 3.01];
  const amps = [1, 0.32, 0.11];
  for (let i = 0; i < length; i += 1) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const t = i / RATE;
    const env = Math.min(1, t / rise) * Math.min(1, (dur - t) / (dur * 0.4));
    let sample = 0;
    for (let h = 0; h < ratios.length; h += 1) {
      sample += amps[h] * Math.sin(2 * Math.PI * freq * ratios[h] * t);
    }
    buf[idx] += sample * env * gain * 0.35;
  }
}

/** Капля: тон, съезжающий вниз, — так звучит вода, а не сигнал приборной панели. */
function drop(buf, { at, from, to, dur = 0.16, gain = 0.5, decay = 9 }) {
  const start = Math.floor(at * RATE);
  const length = Math.floor((dur + 0.5) * RATE);
  let phase = 0;
  for (let i = 0; i < length; i += 1) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const t = i / RATE;
    const k = Math.min(1, t / dur);
    const freq = from * Math.pow(to / from, k * k);
    phase += (2 * Math.PI * freq) / RATE;
    const env = Math.min(1, t / 0.002) * Math.exp(-decay * t);
    buf[idx] += Math.sin(phase) * env * gain;
  }
}

/* —— Небольшой зал ——
 * Схема Шрёдера: четыре гребёнки и два всепропускающих звена. Хвост даёт то самое
 * ощущение дорогого звука — сигнал не обрывается, а тает.
 */
function reverb(buf, { wet = 0.25, room = 0.82 }) {
  if (wet <= 0) return buf;
  const combs = [1557, 1617, 1491, 1422];
  const allpass = [225, 556];
  const out = new Float64Array(buf.length);

  for (const size of combs) {
    const line = new Float64Array(size);
    let pos = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const delayed = line[pos];
      out[i] += delayed / combs.length;
      line[pos] = buf[i] + delayed * room;
      pos = (pos + 1) % size;
    }
  }

  for (const size of allpass) {
    const line = new Float64Array(size);
    let pos = 0;
    for (let i = 0; i < out.length; i += 1) {
      const delayed = line[pos];
      const value = -out[i] + delayed;
      line[pos] = out[i] + delayed * 0.5;
      out[i] = value;
      pos = (pos + 1) % size;
    }
  }

  for (let i = 0; i < buf.length; i += 1) buf[i] = buf[i] * (1 - wet) + out[i] * wet;
  return buf;
}

/** Сведение: мягкий предел вместо клиппинга, ровная громкость, края без щелчков. */
function master(buf, { peak = 0.89 } = {}) {
  for (let i = 0; i < buf.length; i += 1) buf[i] = Math.tanh(buf[i] * 1.1);

  // Срез самого верха и подвала: телефонный динамик их всё равно не отдаёт,
  // зато без них звук перестаёт быть колючим и не гудит в bluetooth-колонке.
  const lp = Math.exp((-2 * Math.PI * 13000) / RATE);
  const hp = Math.exp((-2 * Math.PI * 45) / RATE);
  let low = 0;
  let sub = 0;
  for (let i = 0; i < buf.length; i += 1) {
    low = low * lp + buf[i] * (1 - lp);
    sub = sub * hp + low * (1 - hp);
    buf[i] = low - sub;
  }

  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const scale = max > 0 ? peak / max : 1;

  const fadeIn = Math.floor(0.003 * RATE);
  const fadeOut = Math.floor(0.05 * RATE);
  for (let i = 0; i < buf.length; i += 1) {
    let env = 1;
    if (i < fadeIn) env = i / fadeIn;
    const tail = buf.length - i;
    if (tail < fadeOut) env = Math.min(env, tail / fadeOut);
    buf[i] = buf[i] * scale * env;
  }
  return buf;
}

function writeWav(file, buffer) {
  const data = Buffer.alloc(buffer.length * 2);
  for (let i = 0; i < buffer.length; i += 1) {
    const v = Math.max(-1, Math.min(1, buffer[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  fs.writeFileSync(file, Buffer.concat([header, data]));
}

/* —— Уведомления ——
 * Короткие, из трёх нот максимум, негромкие: должны быть слышны на улице
 * и не резать ухо в тихой комнате.
 */

const NOTIFY = {
  // Три ноты вверх на маримбе — тон, к которому все привыкли по хорошим телефонам.
  notify_marimba() {
    const buf = makeBuffer(2);
    hit(buf, "marimba", { at: 0, freq: note("C5"), gain: 0.55 });
    hit(buf, "marimba", { at: 0.13, freq: note("G5"), gain: 0.5 });
    hit(buf, "marimba", { at: 0.26, freq: note("C6"), gain: 0.52 });
    return reverb(buf, { wet: 0.2, room: 0.8 });
  },
  // Одна нота глокеншпиля: спокойная и заметная, с долгим сиянием.
  notify_glass() {
    const buf = makeBuffer(2.6);
    hit(buf, "glocken", { at: 0, freq: note("C6"), gain: 0.6 });
    hit(buf, "glocken", { at: 0.008, freq: note("C5"), gain: 0.16, decayScale: 1.3 });
    return reverb(buf, { wet: 0.32, room: 0.85 });
  },
  // Калимба: тёплый мажорный росчерк, хорошо звучит в тишине.
  notify_kalimba() {
    const buf = makeBuffer(2.4);
    hit(buf, "kalimba", { at: 0, freq: note("F5"), gain: 0.5 });
    hit(buf, "kalimba", { at: 0.085, freq: note("A5"), gain: 0.47 });
    hit(buf, "kalimba", { at: 0.17, freq: note("C6"), gain: 0.5 });
    return reverb(buf, { wet: 0.26, room: 0.83 });
  },
  // Капля в пустой комнате: тон уходит вниз, хвост остаётся.
  notify_drop() {
    const buf = makeBuffer(1.9);
    drop(buf, { at: 0, from: note("E7"), to: note("A5"), dur: 0.11, gain: 0.5, decay: 11 });
    hit(buf, "glocken", { at: 0.05, freq: note("E6"), gain: 0.2, decayScale: 1.4 });
    return reverb(buf, { wet: 0.38, room: 0.86 });
  },
  // Вполголоса: две ноты вниз для ночи и совещаний.
  notify_soft() {
    const buf = makeBuffer(2.2);
    hit(buf, "kalimba", { at: 0, freq: note("A5"), gain: 0.34, decayScale: 0.85 });
    hit(buf, "kalimba", { at: 0.13, freq: note("E5"), gain: 0.3, decayScale: 0.8 });
    pad(buf, { at: 0, freq: note("A4"), dur: 1.4, gain: 0.08, rise: 0.25 });
    return reverb(buf, { wet: 0.34, room: 0.85 });
  },
  // Vertu-inspired: Аллегро — живой короткий росчерк.
  notify_allegro() {
    const buf = makeBuffer(2.0);
    hit(buf, "glocken", { at: 0, freq: note("E6"), gain: 0.42, decayScale: 1.1 });
    hit(buf, "marimba", { at: 0.07, freq: note("G6"), gain: 0.38 });
    hit(buf, "glocken", { at: 0.14, freq: note("B6"), gain: 0.4, decayScale: 1.3 });
    return reverb(buf, { wet: 0.28, room: 0.8 });
  },
  // Vertu-inspired: Пиццикато — щипок струны.
  notify_pizzicato() {
    const buf = makeBuffer(1.7);
    hit(buf, "kalimba", { at: 0, freq: note("D6"), gain: 0.48, decayScale: 0.55 });
    hit(buf, "glocken", { at: 0.02, freq: note("A6"), gain: 0.22, decayScale: 0.9 });
    return reverb(buf, { wet: 0.22, room: 0.72 });
  },
  // Vertu-inspired: Брио — яркий двунотный акцент.
  notify_brio() {
    const buf = makeBuffer(1.9);
    hit(buf, "marimba", { at: 0, freq: note("C6"), gain: 0.45 });
    hit(buf, "glocken", { at: 0.1, freq: note("E6"), gain: 0.5, decayScale: 1.5 });
    pad(buf, { at: 0, freq: note("C5"), dur: 0.9, gain: 0.06, rise: 0.08 });
    return reverb(buf, { wet: 0.3, room: 0.82 });
  },
};

/* —— Будильники ——
 * Начинаются тихо и разгоняются: человека надо разбудить, а не напугать.
 * Рисунок повторяется, чтобы звук работал и когда телефон крутит его по кругу.
 */

const ALARMS = {
  // Рассвет: подушка приходит первой, поверх неё арпеджио, каждый круг громче.
  alarm_sunrise() {
    const buf = makeBuffer(7.4);
    pad(buf, { at: 0, freq: note("C4"), dur: 7, gain: 0.14, rise: 1.6 });
    pad(buf, { at: 0.3, freq: note("G4"), dur: 6.5, gain: 0.08, rise: 1.8 });
    const line = ["C5", "E5", "G5", "B5", "C6"];
    for (let round = 0; round < 3; round += 1) {
      const base = 0.9 + round * 2.1;
      const gain = 0.34 + round * 0.16;
      line.forEach((n, i) => {
        hit(buf, "marimba", { at: base + i * 0.19, freq: note(n), gain });
      });
    }
    return reverb(buf, { wet: 0.3, room: 0.85 });
  },
  // Колокола: редкие удары, между ними хвост — не даёт заснуть обратно.
  // Строй выше среднего: у телефонного динамика низ колокола просто пропадает.
  alarm_bells() {
    const buf = makeBuffer(7.4);
    for (let round = 0; round < 5; round += 1) {
      const at = round * 1.35;
      const gain = 0.34 + round * 0.1;
      hit(buf, "bell", { at, freq: note("E5"), gain, dur: 3 });
      hit(buf, "bell", { at: at + 0.03, freq: note("B5"), gain: gain * 0.35, dur: 2.4 });
    }
    return reverb(buf, { wet: 0.36, room: 0.87 });
  },
  // Маяк: пара нот через ровные паузы, к концу — настойчивее.
  alarm_radar() {
    const buf = makeBuffer(7);
    for (let round = 0; round < 5; round += 1) {
      const base = round * 1.35;
      const gain = 0.32 + round * 0.11;
      hit(buf, "glocken", { at: base, freq: note("A5"), gain, decayScale: 1.6 });
      hit(buf, "glocken", { at: base + 0.26, freq: note("E6"), gain, decayScale: 1.4 });
      pad(buf, { at: base, freq: note("A4"), dur: 1.1, gain: 0.07, rise: 0.3 });
    }
    return reverb(buf, { wet: 0.3, room: 0.84 });
  },
  // Калимба: спокойный узор, который повторяется и постепенно уплотняется.
  alarm_kalimba() {
    const buf = makeBuffer(7.2);
    const line = ["C5", "G5", "A5", "G5", "E5", "G5"];
    for (let round = 0; round < 4; round += 1) {
      const base = round * 1.7;
      const gain = 0.3 + round * 0.13;
      const step = 0.24 - round * 0.015;
      line.forEach((n, i) => {
        hit(buf, "kalimba", { at: base + i * step, freq: note(n), gain });
      });
    }
    pad(buf, { at: 0, freq: note("C4"), dur: 7, gain: 0.07, rise: 1.2 });
    return reverb(buf, { wet: 0.28, room: 0.84 });
  },
  // Подъём: быстрый мажорный бег вверх с ярким акцентом — для крепкого сна.
  alarm_rise() {
    const buf = makeBuffer(6.8);
    const line = ["C5", "E5", "G5", "C6", "G5", "E5"];
    for (let round = 0; round < 6; round += 1) {
      const base = round * 1.05;
      const gain = 0.3 + round * 0.1;
      line.forEach((n, i) => {
        hit(buf, "marimba", { at: base + i * 0.12, freq: note(n), gain });
      });
      hit(buf, "glocken", { at: base, freq: note("C7"), gain: gain * 0.4, decayScale: 2.4 });
    }
    hit(buf, "glocken", { at: 6.1, freq: note("C6"), gain: 0.6 });
    return reverb(buf, { wet: 0.26, room: 0.82 });
  },
  // Vertu-inspired: Форте — уверенный оркестровый акцент.
  alarm_forte() {
    const buf = makeBuffer(7.2);
    for (let round = 0; round < 5; round += 1) {
      const base = round * 1.35;
      const gain = 0.36 + round * 0.1;
      hit(buf, "bell", { at: base, freq: note("G4"), gain: gain * 0.55, dur: 2.2 });
      hit(buf, "glocken", { at: base + 0.04, freq: note("D6"), gain, decayScale: 1.8 });
      hit(buf, "marimba", { at: base + 0.18, freq: note("G5"), gain: gain * 0.85 });
      hit(buf, "glocken", { at: base + 0.34, freq: note("B5"), gain: gain * 0.9, decayScale: 1.5 });
    }
    return reverb(buf, { wet: 0.34, room: 0.88 });
  },
  // Vertu-inspired: Пиачеволе — мягкий приятный подъём.
  alarm_piacevole() {
    const buf = makeBuffer(7.4);
    pad(buf, { at: 0, freq: note("D4"), dur: 7.2, gain: 0.11, rise: 1.8 });
    const line = ["D5", "F#5", "A5", "D6", "A5"];
    for (let round = 0; round < 4; round += 1) {
      const base = 0.7 + round * 1.6;
      const gain = 0.28 + round * 0.12;
      line.forEach((n, i) => {
        hit(buf, "kalimba", { at: base + i * 0.2, freq: note(n), gain });
      });
    }
    return reverb(buf, { wet: 0.32, room: 0.86 });
  },
  // Vertu-inspired: Плачидо — спокойные волны.
  alarm_placido() {
    const buf = makeBuffer(7.5);
    for (let round = 0; round < 4; round += 1) {
      const base = round * 1.75;
      const gain = 0.26 + round * 0.1;
      pad(buf, { at: base, freq: note("A4"), dur: 1.6, gain: 0.09, rise: 0.5 });
      hit(buf, "kalimba", { at: base + 0.15, freq: note("E5"), gain, decayScale: 1.2 });
      hit(buf, "kalimba", { at: base + 0.45, freq: note("A5"), gain: gain * 0.9, decayScale: 1.1 });
      hit(buf, "glocken", { at: base + 0.75, freq: note("E6"), gain: gain * 0.45, decayScale: 1.8 });
    }
    return reverb(buf, { wet: 0.36, room: 0.9 });
  },
};

function build() {
  fs.mkdirSync(WEB_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const all = { ...ALARMS, ...NOTIFY };
  const keep = new Set(Object.keys(all).map(name => `${name}.mp3`));
  // Старые звуки не должны уезжать ни в apk, ни на сайт.
  for (const dir of [WEB_DIR, RAW_DIR]) {
    for (const file of fs.readdirSync(dir)) {
      if (!/^(alarm|notify)_.*\.(mp3|ogg|wav)$/.test(file) || keep.has(file)) continue;
      fs.rmSync(path.join(dir, file));
      console.log(`  убрал ${path.basename(dir)}/${file}`);
    }
  }

  for (const [name, make] of Object.entries(all)) {
    const wav = path.join(WEB_DIR, `${name}.wav`);
    const mp3 = path.join(WEB_DIR, `${name}.mp3`);
    // Уведомления держим тише будильников: они приходят весь день.
    const buffer = master(make(), { peak: name.startsWith("notify") ? 0.78 : 0.92 });
    writeWav(wav, buffer);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-b:a", "112k", "-ar", "44100", "-ac", "1", mp3]);
    fs.rmSync(wav);
    fs.copyFileSync(mp3, path.join(RAW_DIR, `${name}.mp3`));

    let sum = 0;
    for (const v of buffer) sum += v * v;
    const rms = Math.sqrt(sum / buffer.length);
    const size = fs.statSync(mp3).size;
    console.log(`  ${name}.mp3 — ${(buffer.length / RATE).toFixed(1)} с, RMS ${rms.toFixed(3)}, ${(size / 1024).toFixed(1)} КБ`);
  }
  console.log(`\nГотово: ${Object.keys(all).length} звуков в ${path.relative(APP_DIR, WEB_DIR)} и в res/raw`);
}

build();
