/**
 * Микрофон: проверка разрешений в манифесте и в собранном APK.
 *
 * node tools/mic-permissions.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEEDED = ["android.permission.RECORD_AUDIO"];

test("манифест просит разрешение на микрофон", () => {
  const manifest = readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  for (const perm of NEEDED) {
    assert.ok(manifest.includes(`android:name="${perm}"`), `в манифесте нет ${perm}`);
  }
});

test("плагин микрофона подключён к приложению", () => {
  const main = readFileSync(path.join(root, "android/app/src/main/java/ru/soulvoice/app/MainActivity.java"), "utf8");
  assert.match(main, /registerPlugin\(MicBridge\.class\)/);
  const bridge = readFileSync(path.join(root, "android/app/src/main/java/ru/soulvoice/app/MicBridge.java"), "utf8");
  assert.match(bridge, /RECORD_AUDIO/);
  assert.match(bridge, /startWidgetStyleRecord/);
  assert.match(bridge, /WidgetRecordActivity\.widgetRecordIntent/);
  assert.match(bridge, /cancelListenGoogle/);
  assert.match(bridge, /ACTION_APPLICATION_DETAILS_SETTINGS/);
});

test("в собранном APK разрешения на месте", { skip: apkSkipReason() }, () => {
  const dump = execFileSync(aapt2(), ["dump", "permissions", apkPath()], { encoding: "utf8" });
  for (const perm of NEEDED) {
    assert.ok(dump.includes(perm), `в APK нет ${perm}`);
  }
});

function apkPath() {
  return path.join(root, "../app/public/download/soulvoice.apk");
}

function aapt2() {
  const base = path.join(homedir(), "Library/Android/sdk/build-tools");
  if (!existsSync(base)) return "";
  const [version] = readdirSorted(base);
  return version ? path.join(base, version, "aapt2") : "";
}

function readdirSorted(dir) {
  return execFileSync("ls", [dir], { encoding: "utf8" }).trim().split("\n").sort().reverse();
}

function apkSkipReason() {
  if (!existsSync(apkPath())) return "APK ещё не собран";
  const tool = aapt2();
  if (!tool || !existsSync(tool)) return "нет aapt2 из Android SDK";
  return false;
}

console.log("mic-permissions: ok");
