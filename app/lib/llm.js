import {
  authHeaders,
  folderId,
  LLM_URL,
  modelUri,
  yandexConfigured,
} from "./yandex.js";

const OPENAI_KEY = () => process.env.VC_OPENAI_KEY || process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL_ROLE = () => process.env.VC_OPENAI_MODEL_ROLE || "gpt-4o-mini";
const YC_MODEL_ROLE = () => process.env.VC_YC_MODEL_ROLE || "yandexgpt-lite";

export function simLlmProvider() {
  const forced = String(process.env.VC_SIM_PROVIDER || "").trim().toLowerCase();
  if (forced === "openai") return OPENAI_KEY() ? "openai" : null;
  if (forced === "yandex") return yandexConfigured() ? "yandex" : null;
  if (yandexConfigured()) return "yandex";
  if (OPENAI_KEY()) return "openai";
  return null;
}

export function llmConfigured() {
  return simLlmProvider() !== null;
}

function toYandexMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: "system", text: String(system) });
  for (const m of messages || []) {
    const role = m.role === "assistant" ? "assistant" : "user";
    out.push({ role, text: String(m.content || m.text || "") });
  }
  return out;
}

async function chatCompletionOpenAI({ system, messages, model, temperature, maxTokens, timeoutMs }) {
  const key = OPENAI_KEY();
  if (!key) throw new Error("LLM_NOT_CONFIGURED");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || OPENAI_MODEL_ROLE(),
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        ...messages,
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI HTTP ${res.status}`;
    throw new Error(msg);
  }
  const text = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("Пустой ответ модели");
  return { text, usage: data.usage || null };
}

async function chatCompletionYandex({ system, messages, model, temperature, maxTokens, timeoutMs }) {
  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": "application/json",
      "x-folder-id": folderId(),
    }),
    body: JSON.stringify({
      modelUri: modelUri(model || YC_MODEL_ROLE()),
      completionOptions: {
        stream: false,
        temperature,
        maxTokens: String(maxTokens),
      },
      messages: toYandexMessages(system, messages),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `YandexGPT HTTP ${res.status}`;
    throw new Error(msg);
  }
  const text = String(
    data?.result?.alternatives?.[0]?.message?.text
    || data?.result?.alternatives?.[0]?.text
    || "",
  ).trim();
  if (!text) throw new Error("Пустой ответ модели");
  return { text, usage: data?.result?.usage || null };
}

export async function chatCompletion(opts) {
  const provider = simLlmProvider();
  if (provider === "yandex") return chatCompletionYandex(opts);
  if (provider === "openai") return chatCompletionOpenAI(opts);
  throw new Error("LLM_NOT_CONFIGURED");
}
