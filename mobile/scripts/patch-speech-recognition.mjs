/**
 * Патч @capacitor-community/speech-recognition: потоковый SpeechRecognizer
 * должен идти к серверной модели Google, как системный диалог с виджета.
 *
 * node scripts/patch-speech-recognition.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  root,
  "node_modules/@capacitor-community/speech-recognition/android/src/main/java/com/getcapacitor/community/speechrecognition/SpeechRecognition.java",
);

const marker = "        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);";
const patch = `        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.setPackage("com.google.android.googlequicksearchbox");
        }`;

let src = readFileSync(target, "utf8");
if (src.includes("EXTRA_PREFER_OFFLINE")) {
  console.log("patch-speech-recognition: already applied");
  process.exit(0);
}
if (!src.includes(marker)) {
  console.error("patch-speech-recognition: marker not found — plugin version changed?");
  process.exit(1);
}
src = src.replace(marker, patch);
writeFileSync(target, src);
console.log("patch-speech-recognition: applied EXTRA_PREFER_OFFLINE=false");
