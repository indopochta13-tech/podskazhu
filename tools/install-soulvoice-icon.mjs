#!/usr/bin/env node
/**
 * Install SoulVoice app icon.
 *
 * Modes:
 *   full_bleed_v2 (default) — v4 alt SV master, scaled into adaptive safe circle
 *     (~66% diameter) with vertical inset so launchers do not crop checkmark/wave.
 *     Adaptive foreground = full padded composite (wave stays visible).
 *   safe_zone — legacy v6 path: scale upper emblem into 66% safe circle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createCanvas, loadImage } from "../app/node_modules/canvas/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BRAND = path.join(ROOT, "brand", "icons");
const PUBLIC = path.join(ROOT, "app", "public");
const ANDROID_RES = path.join(ROOT, "mobile", "android", "app", "src", "main", "res");
const SAFE_FRAC = 0.33;
const WAVE_BAND_FRAC = 0.62;
/** Android adaptive icon safe zone — inner ~66% diameter circle. */
const ADAPTIVE_SAFE_DIAM = 0.66;
/** Extra inset so squircle masks on OEM launchers do not clip top/bottom. */
const ADAPTIVE_SAFE_INSET = 0.90;
const ANDROID_BG = "#0a120a";

function isEmblem(r, g, b, a) {
  if (a < 30) return false;
  if (g > 60 && g > r * 1.2 && g > b * 1.1) return true;
  return false;
}

function isSvText(r, g, b, a) {
  if (a < 40) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 180 && Math.abs(r - g) < 40 && Math.abs(g - b) < 40;
}

/** Paint over small "SV" wordmark in bottom-right using nearby background. */
function removeSvText(canvas, size = 1024) {
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, size, size);
  const x0 = Math.floor(size * 0.72);
  const y0 = Math.floor(size * 0.82);
  let changed = 0;

  for (let y = y0; y < size; y++) {
    for (let x = x0; x < size; x++) {
      const i = (y * size + x) * 4;
      const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2], a = data.data[i + 3];
      if (!isSvText(r, g, b, a)) continue;
      const refX = Math.max(0, x0 - 24 - ((x - x0) % 7));
      const refY = y;
      const ri = (refY * size + refX) * 4;
      data.data[i] = data.data[ri];
      data.data[i + 1] = data.data[ri + 1];
      data.data[i + 2] = data.data[ri + 2];
      data.data[i + 3] = data.data[ri + 3];
      changed++;
    }
  }

  if (changed > 0) console.log(`Removed SV text (${changed} px)`);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function analyzeEmblem(data, w, h, yMax = h) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let count = 0;
  let outside = 0;
  let worstDist = 0;
  const cx = w / 2;
  const cy = h / 2;
  const safeR = Math.min(w, h) * SAFE_FRAC;

  for (let y = 0; y < yMax; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (!isEmblem(r, g, b, a)) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const d = Math.hypot(x - cx, y - cy);
      if (d > safeR) {
        outside++;
        if (d > worstDist) worstDist = d;
      }
    }
  }
  return { minX, maxX, minY, maxY, count, outside, worstDist, safeR, cx, cy };
}

function extractEmblemRegion(srcData, w, h, minX, minY, maxX, maxY, yMin = 0, yMax = h) {
  const embW = maxX - minX + 1;
  const embH = maxY - minY + 1;
  const embCanvas = createCanvas(embW, embH);
  const embCtx = embCanvas.getContext("2d");
  const embImg = embCtx.createImageData(embW, embH);
  for (let y = 0; y < embH; y++) {
    for (let x = 0; x < embW; x++) {
      const sx = minX + x;
      const sy = minY + y;
      if (sy < yMin || sy >= yMax) continue;
      const si = (sy * w + sx) * 4;
      const di = (y * embW + x) * 4;
      const r = srcData[si], g = srcData[si + 1], b = srcData[si + 2], a = srcData[si + 3];
      if (isEmblem(r, g, b, a)) {
        embImg.data[di] = r;
        embImg.data[di + 1] = g;
        embImg.data[di + 2] = b;
        embImg.data[di + 3] = a;
      }
    }
  }
  embCtx.putImageData(embImg, 0, 0);
  return embCanvas;
}

async function fitToSafeZone(srcPath, size = 1024) {
  const img = await loadImage(srcPath);
  const w = size, h = size;
  const waveY = Math.floor(h * WAVE_BAND_FRAC);
  const srcCanvas = createCanvas(w, h);
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.drawImage(img, 0, 0, w, h);
  const srcData = srcCtx.getImageData(0, 0, w, h);

  let upperAnalysis = analyzeEmblem(srcData.data, w, h, waveY);
  let scale = 1.0;

  if (upperAnalysis.outside > 0 && upperAnalysis.worstDist > 0) {
    scale = (upperAnalysis.safeR * 0.98) / upperAnalysis.worstDist;
    console.log(`Scaling upper emblem ${(scale * 100).toFixed(1)}% to fit safe zone`);
  }

  const out = createCanvas(w, h);
  const ctx = out.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const cleared = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = srcData.data[i], g = srcData.data[i + 1], b = srcData.data[i + 2], a = srcData.data[i + 3];
      if (isEmblem(r, g, b, a)) {
        cleared.data[i] = cleared.data[i + 1] = cleared.data[i + 2] = cleared.data[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(cleared, 0, 0);

  const waveCanvas = extractEmblemRegion(
    srcData.data, w, h,
    0, waveY, w - 1, h - 1,
    waveY, h,
  );
  ctx.drawImage(waveCanvas, 0, waveY, w, h - waveY);

  if (upperAnalysis.count > 0) {
    const upperCanvas = extractEmblemRegion(
      srcData.data, w, h,
      upperAnalysis.minX, upperAnalysis.minY, upperAnalysis.maxX, upperAnalysis.maxY,
      0, waveY,
    );
    const embW = upperAnalysis.maxX - upperAnalysis.minX + 1;
    const embH = upperAnalysis.maxY - upperAnalysis.minY + 1;
    const scaledW = embW * scale;
    const scaledH = embH * scale;
    const destX = upperAnalysis.cx - scaledW / 2;
    const destY = Math.max(20, upperAnalysis.cy - scaledH / 2);
    ctx.drawImage(upperCanvas, destX, destY, scaledW, scaledH);
  }

  const finalData = ctx.getImageData(0, 0, w, h);
  const analysis = analyzeEmblem(finalData.data, w, h);
  return { canvas: out, analysis, scale };
}

/** Scale full composite into adaptive safe circle; keeps wave + checkmark inside mask. */
function fitToAdaptiveSafeZone(srcCanvas, size = 1024) {
  const scale = ADAPTIVE_SAFE_DIAM * ADAPTIVE_SAFE_INSET;
  const drawSize = size * scale;
  const offset = (size - drawSize) / 2;
  const out = createCanvas(size, size);
  const ctx = out.getContext("2d");
  ctx.fillStyle = ANDROID_BG;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(srcCanvas, offset, offset, drawSize, drawSize);
  return out;
}

/** v4 alt SV master: strip SV wordmark, pad into adaptive safe zone. */
async function loadFullBleedV2(srcPath, size = 1024) {
  const img = await loadImage(srcPath);
  const raw = createCanvas(size, size);
  const rawCtx = raw.getContext("2d");
  rawCtx.drawImage(img, 0, 0, size, size);
  removeSvText(raw, size);
  const scale = ADAPTIVE_SAFE_DIAM * ADAPTIVE_SAFE_INSET;
  const canvas = fitToAdaptiveSafeZone(raw, size);
  const analysis = analyzeEmblem(canvas.getContext("2d").getImageData(0, 0, size, size).data, size, size);
  return { canvas, analysis, scale };
}

function makeForeground(fullCanvas, size) {
  const fg = createCanvas(size, size);
  const ctx = fg.getContext("2d");
  const data = fullCanvas.getContext("2d").getImageData(0, 0, size, size);
  const out = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2], a = data.data[i + 3];
      if (isEmblem(r, g, b, a)) {
        out.data[i] = r;
        out.data[i + 1] = g;
        out.data[i + 2] = b;
        out.data[i + 3] = a;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
  return fg;
}

function writeCanvas(canvas, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, canvas.toBuffer("image/png"));
  console.log("wrote", path.relative(ROOT, dest));
}

function resize(src, w, h, dest) {
  execSync(`sips -z ${h} ${w} "${src}" --out "${dest}"`, { stdio: "pipe" });
}

async function main() {
  const args = process.argv.slice(2);
  let mode = "full_bleed_v2";
  let srcArg = null;
  for (const arg of args) {
    if (arg === "full_bleed_v2" || arg === "safe_zone") mode = arg;
    else srcArg = arg;
  }

  const defaultSrc = mode === "full_bleed_v2"
    ? path.join(BRAND, "soulvoice_icon_v4_alt_sv_1024.png")
    : path.join(BRAND, "soulvoice_icon_v6_wave_bottom_1024.png");

  const src = srcArg ? path.resolve(srcArg) : defaultSrc;

  if (!fs.existsSync(src)) {
    console.error("Source not found:", src);
    process.exit(1);
  }

  console.log(`Mode: ${mode}`);
  console.log(`Source: ${src}`);

  const loader = mode === "full_bleed_v2" ? loadFullBleedV2 : fitToSafeZone;
  const { canvas, analysis, scale } = await loader(src, 1024);

  if (mode === "safe_zone") {
    const imgData = canvas.getContext("2d").getImageData(0, 0, 1024, 1024);
    const waveY = Math.floor(1024 * WAVE_BAND_FRAC);
    const upperCheck = analyzeEmblem(imgData.data, 1024, 1024, waveY);
    const pass = upperCheck.outside === 0;
    console.log(`Safe zone (upper emblem): ${pass ? "PASS" : "FAIL"} (px=${upperCheck.count}, outside=${upperCheck.outside})`);
    if (!pass) process.exit(2);
  } else {
    console.log(`Full-bleed v2: emblem bbox ${analysis.maxX - analysis.minX}x${analysis.maxY - analysis.minY}, scale=${scale.toFixed(3)} (no downscale)`);
  }

  const tmp = path.join(__dirname, ".icon-tmp");
  fs.mkdirSync(tmp, { recursive: true });
  const master = path.join(tmp, "master-1024.png");
  writeCanvas(canvas, master);

  const brandBase = mode === "full_bleed_v2"
    ? "soulvoice_icon_v4_alt_sv"
    : "soulvoice_icon_v6_wave_bottom";

  writeCanvas(canvas, path.join(BRAND, `${brandBase}_1024.png`));
  resize(master, 512, 512, path.join(BRAND, `${brandBase}_512.png`));
  resize(master, 192, 192, path.join(BRAND, `${brandBase}_192.png`));

  for (const [size, dest] of [
    [512, path.join(PUBLIC, "icon-512.png")],
    [192, path.join(PUBLIC, "icon-192.png")],
    [180, path.join(PUBLIC, "apple-touch-icon.png")],
  ]) {
    resize(master, size, size, dest);
  }

  // Adaptive foreground: full composite for v2 (wave + bg stay together under mask).
  const fgMaster = mode === "full_bleed_v2" ? canvas : makeForeground(canvas, 1024);
  const fgPath = path.join(tmp, "fg-1024.png");
  writeCanvas(fgMaster, fgPath);

  for (const [folder, size] of [
    ["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192],
  ]) {
    const base = path.join(ANDROID_RES, `mipmap-${folder}`);
    resize(master, size, size, path.join(base, "ic_launcher.png"));
    resize(master, size, size, path.join(base, "ic_launcher_round.png"));
  }

  for (const [folder, size] of [
    ["mdpi", 108], ["hdpi", 162], ["xhdpi", 216], ["xxhdpi", 324], ["xxxhdpi", 432],
  ]) {
    resize(fgPath, size, size, path.join(ANDROID_RES, `mipmap-${folder}`, "ic_launcher_foreground.png"));
  }

  fs.writeFileSync(
    path.join(ANDROID_RES, "values", "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ANDROID_BG}</color>\n</resources>\n`,
  );

  console.log(`\nDone — SoulVoice icon installed (${mode}).`);
  console.log(`Preview: ${path.join(BRAND, `${brandBase}_512.png`)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
