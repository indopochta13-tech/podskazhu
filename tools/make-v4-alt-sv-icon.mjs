#!/usr/bin/env node
/** Replace bottom "SoulVoice" wordmark with centered "SV" on v4 combined alt master. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createCanvas, loadImage, registerFont } from "../app/node_modules/canvas/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BRAND = path.join(ROOT, "brand", "icons");
const SRC = path.join(BRAND, "soulvoice_icon_v4_combined_alt_1024.png");
const OUT_BASE = path.join(BRAND, "soulvoice_icon_v4_alt_sv");
const FONT = "/System/Library/Fonts/Supplemental/Futura.ttc";

function isText(r, g, b, a) {
  if (a < 40) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 180 && Math.abs(r - g) < 40 && Math.abs(g - b) < 40;
}

function findTextBBox(data, size, yMin = Math.floor(size * 0.70)) {
  let minX = size, maxX = 0, minY = size, maxY = 0;
  for (let y = yMin; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!isText(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

function findCleanRefY(data, size, bbox) {
  for (let y = bbox.minY - 1; y >= Math.floor(size * 0.65); y--) {
    let textPx = 0;
    for (let x = bbox.minX; x <= bbox.maxX; x++) {
      const i = (y * size + x) * 4;
      if (isText(data[i], data[i + 1], data[i + 2], data[i + 3])) textPx++;
    }
    if (textPx === 0) return y;
  }
  return Math.max(0, bbox.minY - 40);
}

/** Clone clean background strip above the wordmark (preserves texture/glow). */
function removeText(canvas, size, bbox) {
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, size, size);
  const refY = findCleanRefY(data.data, size, bbox);
  const y0 = Math.max(0, bbox.minY - 4);
  const y1 = size - 1;
  let changed = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const ri = (refY * size + x) * 4;
      data.data[i] = data.data[ri];
      data.data[i + 1] = data.data[ri + 1];
      data.data[i + 2] = data.data[ri + 2];
      data.data[i + 3] = data.data[ri + 3];
      changed++;
    }
  }

  ctx.putImageData(data, 0, 0);
  console.log(`Cleared wordmark band y=${y0}..${y1} (${changed} px, refY=${refY})`);
}

function measureTextHeight(ctx, text, fontSize) {
  ctx.font = `500 ${fontSize}px SoulVoiceIcon`;
  const m = ctx.measureText(text);
  const ascent = m.actualBoundingBoxAscent || fontSize * 0.78;
  const descent = m.actualBoundingBoxDescent || fontSize * 0.22;
  return { width: m.width, height: ascent + descent, ascent, descent };
}

function drawSv(canvas, size, bbox) {
  const ctx = canvas.getContext("2d");
  const targetH = bbox.maxY - bbox.minY + 1;
  const cx = (bbox.minX + bbox.maxX) / 2;
  const baselineY = bbox.maxY - 2;

  let fontSize = targetH;
  let metrics = measureTextHeight(ctx, "SV", fontSize);
  for (let i = 0; i < 12; i++) {
    fontSize = (targetH / metrics.height) * fontSize;
    metrics = measureTextHeight(ctx, "SV", fontSize);
  }

  ctx.font = `500 ${fontSize}px SoulVoiceIcon`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.fillText("SV", cx, baselineY);
  console.log(`Drew SV: font=${fontSize.toFixed(1)}px, width=${metrics.width.toFixed(1)}px, targetH=${targetH}px`);
}

function writePng(canvas, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, canvas.toBuffer("image/png"));
  console.log("wrote", path.relative(ROOT, dest));
}

function resize(src, w, h, dest) {
  execSync(`sips -z ${h} ${w} "${src}" --out "${dest}"`, { stdio: "pipe" });
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("Source not found:", SRC);
    process.exit(1);
  }

  registerFont(FONT, { family: "SoulVoiceIcon", weight: "500" });

  const img = await loadImage(SRC);
  const size = 1024;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, size, size);

  const bbox = findTextBBox(ctx.getImageData(0, 0, size, size).data, size);
  if (bbox.maxX <= bbox.minX) {
    console.error("Could not detect SoulVoice wordmark");
    process.exit(1);
  }
  console.log("Text bbox:", bbox);

  removeText(canvas, size, bbox);
  drawSv(canvas, size, bbox);

  const out1024 = `${OUT_BASE}_1024.png`;
  writePng(canvas, out1024);
  resize(out1024, 512, 512, `${OUT_BASE}_512.png`);
  resize(out1024, 192, 192, `${OUT_BASE}_192.png`);
  console.log("\nDone.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
