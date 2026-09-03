#!/usr/bin/env node
/**
 * Post-process OpenAI sport icons: resize 128×128, remove light bg, ensure PNG alpha.
 *
 * Usage:
 *   node scripts/postprocess-sport-icons.mjs <inputDir> [outputDir]
 *   node scripts/postprocess-sport-icons.mjs --fix [iconsDir]   # in-place, no resize
 */
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SIZE = 128;
/** Border flood: conservative threshold so anti-aliased edges stay intact. */
const BG_FLOOD_MIN = 195;
/** Enclosed fill removal: also clears light-gray interior pockets. */
const BG_FILL_MIN = 170;
const BG_CHROMA = 30;

const args = process.argv.slice(2);
const fixMode = args[0] === "--fix";
const inputDir = fixMode
  ? (args[1] || join(dirname(fileURLToPath(import.meta.url)), "../app/public/icons/sport"))
  : args[0];
const outputDir = fixMode
  ? inputDir
  : (args[1] || join(dirname(fileURLToPath(import.meta.url)), "../app/public/icons/sport"));

if (!inputDir) {
  console.error("Usage: node postprocess-sport-icons.mjs <inputDir> [outputDir]");
  console.error("       node postprocess-sport-icons.mjs --fix [iconsDir]");
  process.exit(1);
}

function isBackground(r, g, b, a, minLevel = BG_FLOOD_MIN) {
  if (a < 8) return true;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return min >= minLevel && max - min <= BG_CHROMA;
}

function isDark(r, g, b, a) {
  return a >= 8 && r + g + b < 350;
}

function removeBackground(pixels, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = [];

  for (let x = 0; x < width; x++) {
    queue.push(x, 0, x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push(0, y, width - 1, y);
  }

  while (queue.length) {
    const y = queue.pop();
    const x = queue.pop();
    const idx = y * width + x;
    if (visited[idx]) continue;

    const i = idx * 4;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (!isBackground(r, g, b, a)) continue;

    visited[idx] = 1;
    pixels[i + 3] = 0;

    if (x > 0) queue.push(x - 1, y);
    if (x < width - 1) queue.push(x + 1, y);
    if (y > 0) queue.push(x, y - 1);
    if (y < height - 1) queue.push(x, y + 1);
  }

  // Enclosed light-gray pockets (not touching line art — keeps anti-aliasing).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (!isBackground(r, g, b, a, BG_FILL_MIN)) continue;

      let nearDark = false;
      for (let dy = -1; dy <= 1 && !nearDark; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (isDark(pixels[j], pixels[j + 1], pixels[j + 2], pixels[j + 3])) {
            nearDark = true;
            break;
          }
        }
      }
      if (!nearDark) pixels[i + 3] = 0;
    }
  }

  // Pure/near-white anywhere (safe for line art).
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (r >= 240 && g >= 240 && b >= 240) pixels[i + 3] = 0;
  }
}

async function processFile(src, out) {
  let pipeline = sharp(src).ensureAlpha();
  if (!fixMode) {
    pipeline = pipeline.resize(SIZE, SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  removeBackground(data, info.width, info.height);

  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(out, png);

  const meta = await sharp(out).metadata();
  const { data: check } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let cornerOpaque = 0;
  const corners = [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]];
  for (const [x, y] of corners) {
    const i = (y * info.width + x) * 4;
    if (check[i + 3] > 10) cornerOpaque++;
  }

  return { meta, size: png.length, cornerOpaque };
}

await mkdir(outputDir, { recursive: true });

const files = (await readdir(inputDir)).filter(f => f.endsWith(".png")).sort();
let fixed = 0;

for (const file of files) {
  const src = join(inputDir, file);
  const out = join(outputDir, file);
  const { meta, size, cornerOpaque } = await processFile(src, out);
  const tag = cornerOpaque ? " WARN corners" : " OK";
  if (cornerOpaque) fixed++;
  console.log(`${file}  ${meta.width}x${meta.height}  alpha=${meta.hasAlpha}  ${size} bytes${tag}`);
}

console.log(`\nDone: ${files.length} icons → ${outputDir}${fixMode ? " (fix mode)" : ""}`);
if (fixed) console.log(`${fixed} icon(s) still have opaque corners — inspect manually.`);
