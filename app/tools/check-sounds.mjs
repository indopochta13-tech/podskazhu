/**
 * Проверка готовых звуков без ушей: декодируем mp3 и смотрим то, что можно измерить.
 *
 * Что важно:
 * — телефонный динамик отдаёт примерно 400 Гц … 8 кГц, и основная энергия должна быть там,
 *   иначе на кухне сигнал просто не услышат;
 * — у будильника громкость должна расти к концу, чтобы будить, а не пугать;
 * — уведомление должно быть короче полутора-трёх секунд и тише будильника.
 *
 * Запуск: node tools/check-sounds.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";

import { ALARM_SOUNDS, NOTIFY_SOUNDS } from "../public/sounds-catalog.js";

const APP_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const DIR = path.join(APP_DIR, "public", "sounds");
const RATE = 44100;

let problems = 0;

function pcm(file) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(RATE), "-"],
    { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
}

/** Доля энергии в полосе, которую телефон реально воспроизводит. */
function speakerShare(samples) {
  const size = 4096;
  let inBand = 0;
  let total = 0;
  for (let start = 0; start + size <= samples.length; start += size) {
    for (let k = 1; k < size / 2; k += 1) {
      const freq = (k * RATE) / size;
      let re = 0;
      let im = 0;
      // Одна точка Гёрцеля вместо полного БПФ: считаем только нужные полосы.
      if (freq > 12000 || (freq > 300 && freq < 400)) continue;
      const w = (2 * Math.PI * k) / size;
      for (let i = 0; i < size; i += 8) {
        const v = samples[start + i];
        re += v * Math.cos(w * i);
        im += v * Math.sin(w * i);
      }
      const power = re * re + im * im;
      total += power;
      if (freq >= 400 && freq <= 8000) inBand += power;
    }
  }
  return total > 0 ? inBand / total : 0;
}

function peakOf(samples) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
}

function rmsOf(samples, from, to) {
  let sum = 0;
  let n = 0;
  for (let i = Math.floor(from * RATE); i < Math.min(samples.length, Math.floor(to * RATE)); i += 1) {
    sum += samples[i] * samples[i];
    n += 1;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

function check(label, condition, detail = "") {
  if (!condition) problems += 1;
  console.log(`    ${condition ? "✓" : "✗"} ${label}${condition || !detail ? "" : ` → ${detail}`}`);
}

console.log("Звуки: что можно измерить\n");

let alarmLoud = 0;
for (const sound of ALARM_SOUNDS) {
  const file = path.join(DIR, `${sound.id}.mp3`);
  console.log(`  ${sound.name} (${sound.id})`);
  check("файл на месте", fs.existsSync(file));
  if (!fs.existsSync(file)) continue;

  const samples = pcm(file);
  const seconds = samples.length / RATE;
  const head = rmsOf(samples, 0, 1.2);
  const tail = rmsOf(samples, seconds - 2, seconds - 0.3);
  const loud = rmsOf(samples, 0, seconds);
  alarmLoud += loud;

  check("длится 5–9 секунд", seconds >= 5 && seconds <= 9, `${seconds.toFixed(1)} с`);
  check("начинается тише, чем заканчивается", tail > head * 1.15, `начало ${head.toFixed(3)}, конец ${tail.toFixed(3)}`);
  check("слышен на телефонном динамике", speakerShare(samples) > 0.55, speakerShare(samples).toFixed(2));
  check("не перегружен", peakOf(samples) < 0.99);
}
alarmLoud /= ALARM_SOUNDS.length;

let notifyLoud = 0;
for (const sound of NOTIFY_SOUNDS) {
  const file = path.join(DIR, `${sound.id}.mp3`);
  console.log(`  ${sound.name} (${sound.id})`);
  check("файл на месте", fs.existsSync(file));
  if (!fs.existsSync(file)) continue;

  const samples = pcm(file);
  const seconds = samples.length / RATE;
  const loud = rmsOf(samples, 0, seconds);
  notifyLoud += loud;

  check("длится 1–3 секунды", seconds >= 1 && seconds <= 3, `${seconds.toFixed(1)} с`);
  check("звук успевает угаснуть сам", rmsOf(samples, seconds - 0.15, seconds) < loud * 0.25);
  check("слышен на телефонном динамике", speakerShare(samples) > 0.55, speakerShare(samples).toFixed(2));
  check("не перегружен", peakOf(samples) < 0.99);
}
notifyLoud /= NOTIFY_SOUNDS.length;

console.log(`\n  Средняя громкость: будильники ${alarmLoud.toFixed(3)}, уведомления ${notifyLoud.toFixed(3)}`);
check("уведомления тише будильников", notifyLoud < alarmLoud * 0.8);

console.log(problems ? `\nПроблем: ${problems}` : "\nВсё в порядке");
process.exit(problems ? 1 : 0);
