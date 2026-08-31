#!/usr/bin/env node
/**
 * Статичный рендер иконки: облако в режиме listening (раскрыто, level ~0.62).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createCanvas } from "../app/node_modules/canvas/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "app", "public");
const ANDROID_RES = path.join(ROOT, "mobile", "android", "app", "src", "main", "res");

const BG = "#f3f0eb";
const COLOR = "92, 82, 72";
const ANDROID_BG = "#f3f0eb";

function particleCount() {
  return 1200;
}

/** Один кадр listening с зафиксированным t и smoothLevel ≈ level. */
function renderCloud(size, { bg = BG, color = COLOR, level = 0.62, t = 2.35, vivid = true } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const W = size;
  const H = size;
  const CX = W / 2;
  const CY = H / 2;
  const R = Math.min(W, H) * 0.34;
  const smoothLevel = level;

  const N = particleCount();
  const parts = [];
  for (let i = 0; i < N; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());
    parts.push({
      angle,
      radius,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.8,
      size: 0.7 + Math.random() * 1.2,
      x: CX + Math.cos(angle) * radius * R,
      y: CY + Math.sin(angle) * radius * R,
    });
  }

  // Прогон частиц к раскрытому состоянию (без RAF — синхронно).
  for (let step = 0; step < 140; step += 1) {
    const tt = step * 0.016;
    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i];
      const reach = 14 + smoothLevel * 40;
      let radius = p.radius * R + Math.sin(tt * 0.7 + p.phase) * 3;
      radius += Math.sin(tt * p.speed * 4 + p.phase) * reach * p.radius;
      let angle = p.angle + Math.sin(tt * 1.3 + p.phase) * 0.06;
      const tx = CX + Math.cos(angle) * radius;
      const ty = CY + Math.sin(angle) * radius;
      p.x += (tx - p.x) * 0.09;
      p.y += (ty - p.y) * 0.09;
    }
  }

  if (bg === "transparent") {
    ctx.clearRect(0, 0, W, H);
  } else {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    const reach = 14 + smoothLevel * 40;
    let radius = p.radius * R + Math.sin(t * 0.7 + p.phase) * 3;
    radius += Math.sin(t * p.speed * 4 + p.phase) * reach * p.radius;
    let angle = p.angle + Math.sin(t * 1.3 + p.phase) * 0.06;
    let alpha = 0.35 + Math.abs(Math.sin(t * 3 + p.phase)) * 0.6;
    let size = p.size * (1 + Math.abs(Math.sin(t * 3 + p.phase)) * 0.5);
    if (vivid) {
      alpha = Math.min(0.98, alpha * 1.22);
      size *= 1.1;
    }
    const tx = CX + Math.cos(angle) * radius;
    const ty = CY + Math.sin(angle) * radius;
    ctx.fillStyle = `rgba(${color},${alpha.toFixed(3)})`;
    if (vivid) {
      ctx.shadowColor = `rgba(${color},${Math.min(0.55, alpha * 0.65).toFixed(3)})`;
      ctx.shadowBlur = size * 1.6;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.fillRect(tx, ty, size, size);
    ctx.shadowBlur = 0;
  }

  return canvas;
}

function resize(src, w, h, dest) {
  execSync(`sips -z ${h} ${w} "${src}" --out "${dest}"`, { stdio: "pipe" });
}

function writeCanvas(canvas, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, canvas.toBuffer("image/png"));
  console.log("wrote", path.relative(ROOT, dest));
}

async function main() {
  const tmp = path.join(ROOT, "tools", ".icon-tmp");
  fs.mkdirSync(tmp, { recursive: true });

  const masterPath = path.join(tmp, "master-1024.png");
  writeCanvas(renderCloud(1024), masterPath);

  writeCanvas(renderCloud(432, { bg: "transparent", level: 0.58 }), path.join(tmp, "fg-432.png"));

  for (const [size, dest] of [
    [512, path.join(PUBLIC, "icon-512.png")],
    [192, path.join(PUBLIC, "icon-192.png")],
    [180, path.join(PUBLIC, "apple-touch-icon.png")],
  ]) {
    resize(masterPath, size, size, dest);
    console.log("wrote", path.relative(ROOT, dest));
  }

  for (const [folder, size] of [
    ["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192],
  ]) {
    const base = path.join(ANDROID_RES, `mipmap-${folder}`);
    resize(masterPath, size, size, path.join(base, "ic_launcher.png"));
    resize(masterPath, size, size, path.join(base, "ic_launcher_round.png"));
    console.log("wrote mipmap", folder);
  }

  const fgSrc = path.join(tmp, "fg-432.png");
  for (const [folder, size] of [
    ["mdpi", 108], ["hdpi", 162], ["xhdpi", 216], ["xxhdpi", 324], ["xxxhdpi", 432],
  ]) {
    resize(fgSrc, size, size, path.join(ANDROID_RES, `mipmap-${folder}`, "ic_launcher_foreground.png"));
  }

  fs.writeFileSync(
    path.join(ANDROID_RES, "values", "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ANDROID_BG}</color>\n</resources>\n`,
  );

  console.log("\nDone — listening cloud icon.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
