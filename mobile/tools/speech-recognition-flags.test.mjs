/**
 * Потоковое распознавание: флаги серверной модели Google.
 *
 * node tools/speech-recognition-flags.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("native.js просит ru-RU и несколько гипотез", () => {
  const native = readFileSync(path.join(root, "native/native.js"), "utf8");
  assert.match(native, /language:\s*"ru-RU"/);
  assert.match(native, /maxResults:\s*3/);
  assert.match(native, /partialResults:\s*true/);
});

test("GoogleSpeech запрещает офлайн-модель", () => {
  const google = readFileSync(
    path.join(root, "android/app/src/main/java/ru/soulvoice/app/GoogleSpeech.java"),
    "utf8",
  );
  assert.match(google, /EXTRA_PREFER_OFFLINE,\s*false/);
  assert.match(google, /EXTRA_LANGUAGE,\s*"ru-RU"/);
});

test("патч плагина ставит EXTRA_PREFER_OFFLINE=false", () => {
  execFileSync("node", ["scripts/patch-speech-recognition.mjs"], { cwd: root });
  const plugin = readFileSync(
    path.join(
      root,
      "node_modules/@capacitor-community/speech-recognition/android/src/main/java/com/getcapacitor/community/speechrecognition/SpeechRecognition.java",
    ),
    "utf8",
  );
  assert.match(plugin, /EXTRA_PREFER_OFFLINE,\s*false/);
  assert.match(plugin, /googlequicksearchbox/);
});

console.log("speech-recognition-flags: ok");
