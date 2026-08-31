/**
 * Собирает папку www для мобильного приложения:
 * берёт веб-версию из ../app/public, добавляет мост к телефону и адрес сервера.
 * Веб-часть остаётся единственным источником правды — руками www не правим.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "app", "public");
const outDir = join(here, "www");

const API_BASE = process.env.VC_API_BASE || "https://soulvoicee.ru";

const appJsSrc = await readFile(join(webDir, "app.js"), "utf8");
const assetMatch = /const SW_VERSION = (\d+)/.exec(appJsSrc);
const ASSET_V = assetMatch ? assetMatch[1] : "0";

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// Внутрь пакета не тащим то, что нужно только сайту: service worker (файлы и так лежат
// в приложении), собственный установочный файл и подтверждение владения адресом для Android.
const onlyForSite = new Set(["sw.js", "download", ".well-known", "mockups"]);

await cp(webDir, outDir, {
  recursive: true,
  filter: src => {
    const rel = relative(webDir, src);
    return rel === "" || !onlyForSite.has(rel.split(sep)[0]);
  },
});

// icons.js, voice.js и cloud.js лежат в app/public и копируются вместе со всей
// папкой выше. Отдельная строка для них была нужна, пока они жили в app/lib.

let html = await readFile(join(webDir, "index.html"), "utf8");

html = html
  .replace(/<script src="\/app\.js[^"]*" type="module"><\/script>/, '<script src="/native.js" type="module"></script>')
  .replace(/<link rel="manifest"[^>]*>\s*/g, "")
  .replace("</head>", `  <script>window.VC_API_BASE = ${JSON.stringify(API_BASE)};window.__VC_SHELL_V = ${ASSET_V};</script>\n</head>`);

if (!html.includes("native.js")) {
  throw new Error("Не нашла тег подключения app.js в index.html — проверьте разметку");
}

await writeFile(join(outDir, "index.html"), html);

await build({
  entryPoints: [join(here, "native", "native.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: join(outDir, "native.js"),
  external: ["./app.js"],
  legalComments: "none",
  minify: false,
});

console.log(`www собрана · сервер: ${API_BASE}`);
