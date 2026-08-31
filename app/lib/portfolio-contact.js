/**
 * Заявки с портфолио-лендинга: файл + опционально Telegram админу.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VC_DATA_DIR || path.join(ROOT_DIR, "data");
const LEADS_FILE = path.join(DATA_DIR, "portfolio-leads.jsonl");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePortfolioContact(body = {}) {
  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 160);
  const message = String(body.message || "").trim().slice(0, 4000);
  const consent = body.consent === true || body.consent === "true" || body.consent === 1;
  if (!name || name.length < 2) return { error: "Укажите имя" };
  if (!EMAIL_RE.test(email)) return { error: "Некорректный email" };
  if (!message || message.length < 10) return { error: "Сообщение слишком короткое" };
  if (!consent) return { error: "Нужно согласие на обработку данных" };
  return { name, email, message, consent: true };
}

export async function savePortfolioLead(lead, meta = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const row = {
    at: new Date().toISOString(),
    ...lead,
    ip: meta.ip || null,
    ua: meta.ua ? String(meta.ua).slice(0, 240) : null,
  };
  fs.appendFileSync(LEADS_FILE, JSON.stringify(row) + "\n", "utf8");
  await notifyTelegram(row).catch(err => console.error("[portfolio]", err.message));
  return row;
}

async function notifyTelegram(row) {
  const token = String(process.env.VC_TG_BOT_TOKEN || "").trim();
  const chat = String(process.env.VC_TG_CHAT_ID || "").trim();
  if (!token || !chat) return;
  const text = [
    "📩 Заявка с portfolio-лендинга",
    "",
    `Имя: ${row.name}`,
    `Email: ${row.email}`,
    "",
    row.message,
  ].join("\n");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(data?.description || "telegram failed");
}
