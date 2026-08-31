/** Общие настройки Yandex Cloud для YandexGPT. */

export function yandexConfigured() {
  return Boolean(apiKey() && folderId());
}

export function apiKey() {
  return String(process.env.VC_YC_API_KEY || process.env.YC_API_KEY || "").trim();
}

export function folderId() {
  return String(process.env.VC_YC_FOLDER_ID || process.env.YC_FOLDER_ID || "").trim();
}

export function authHeaders(extra = {}) {
  const key = apiKey();
  if (!key) throw new Error("YC_NOT_CONFIGURED");
  return {
    Authorization: `Api-Key ${key}`,
    ...extra,
  };
}

/** Частые опечатки в env → реальные ID в каталоге Yandex Cloud. */
const MODEL_ALIASES = {
  "yandexgpt-pro": "yandexgpt-5-pro",
  pro: "yandexgpt-5-pro",
  lite: "yandexgpt-lite",
};

export function normalizeModelSuffix(suffix) {
  const raw = String(suffix || "yandexgpt-lite").trim();
  return MODEL_ALIASES[raw] || raw;
}

export function modelUri(suffix) {
  const id = folderId();
  const model = normalizeModelSuffix(suffix);
  if (!id) throw new Error("YC_FOLDER_MISSING");
  return `gpt://${id}/${model}/latest`;
}

export const LLM_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";
