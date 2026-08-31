/** Prodamus Payform — ссылка на оплату и проверка webhook (HMAC). По образцу psyche/core/prodamus.py */
import crypto from "node:crypto";

const PID_RE = /^pd_[0-9a-f]{32}$/;

function formUrl() {
  const u = (process.env.VC_PRODAMUS_FORM_URL || process.env.PRODAMUS_FORM_URL || "").trim();
  return u ? `${u.replace(/\/+$/, "")}/` : "";
}

function secret() {
  return (process.env.VC_PRODAMUS_SECRET_KEY || process.env.PRODAMUS_SECRET_KEY || "").trim();
}

function sysCode() {
  return (process.env.VC_PRODAMUS_SYS || process.env.PRODAMUS_SYS || "").trim();
}

function notifyUrl() {
  const explicit = (process.env.VC_PRODAMUS_NOTIFICATION_URL || process.env.PRODAMUS_NOTIFICATION_URL || "").trim();
  if (explicit) return explicit;
  const origin = (process.env.VC_ORIGIN || "").trim().replace(/\/+$/, "");
  if (origin) return `${origin}/api/billing/prodamus/webhook`;
  return "";
}

function returnUrl() {
  const explicit = (process.env.VC_PRODAMUS_RETURN_URL || process.env.PRODAMUS_RETURN_URL || "").trim();
  if (explicit) return explicit;
  const origin = (process.env.VC_ORIGIN || "").trim().replace(/\/+$/, "");
  return origin ? `${origin}/?billing=return` : "https://soulvoicee.ru/?billing=return";
}

export function isConfigured() {
  return Boolean(secret() && formUrl() && notifyUrl());
}

export function isDemo() {
  const v = (process.env.VC_PRODAMUS_DEMO || process.env.PRODAMUS_DEMO || "1").trim().toLowerCase();
  return !["0", "false", "no"].includes(v);
}

export function newOrderId() {
  return `pd_${crypto.randomBytes(16).toString("hex")}`;
}

export function isProdamusPid(pid) {
  return Boolean(pid) && String(pid).startsWith("pd_");
}

function stringify(obj) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k), stringify(v)]));
  }
  if (Array.isArray(obj)) return obj.map(stringify);
  if (obj == null) return "";
  if (typeof obj === "boolean") return obj ? "1" : "";
  return String(obj);
}

function sortKeys(obj) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.fromEntries(
      Object.keys(obj).sort().map(k => [k, sortKeys(obj[k])]),
    );
  }
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return obj;
}

function jsonPayload(data) {
  const prepared = sortKeys(stringify(structuredClone(data)));
  return JSON.stringify(prepared).replace(/\//g, "\\/");
}

export function sign(data, key = secret()) {
  const payload = jsonPayload(data);
  return crypto.createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

function signLoose(data, key) {
  const raw = JSON.stringify(sortKeys(data));
  return crypto.createHmac("sha256", key).update(raw, "utf8").digest("hex");
}

function safeEqHex(a, b) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  if (!x || !y || x.length !== y.length) return false;
  return crypto.timingSafeEqual(Buffer.from(x, "utf8"), Buffer.from(y, "utf8"));
}

export function verify(data, receivedSign, { allowDemo = null } = {}) {
  const got = String(receivedSign || "").trim().toLowerCase();
  const sec = secret();
  if (!got || !sec) return { ok: false, mode: "" };
  const payload = Object.fromEntries(
    Object.entries(data || {}).filter(([k]) => String(k).toLowerCase() !== "signature"),
  );
  const liveVariants = [sign(payload, sec), signLoose(payload, sec)];
  if (liveVariants.some(v => safeEqHex(v, got))) return { ok: true, mode: "live" };
  const demoOn = allowDemo == null ? isDemo() : allowDemo;
  if (demoOn) {
    const demoKey = `${sec}demo`;
    const demoVariants = [sign(payload, demoKey), signLoose(payload, demoKey)];
    if (demoVariants.some(v => safeEqHex(v, got))) return { ok: true, mode: "demo" };
  }
  return { ok: false, mode: "" };
}

function flatten(prefix, value, out) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      const key = prefix ? `${prefix}[${k}]` : String(k);
      flatten(key, v, out);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(`${prefix}[${i}]`, v, out));
  } else {
    out[prefix] = value == null ? "" : String(value);
  }
}

export function flattenForm(data) {
  const out = {};
  flatten("", data, out);
  return out;
}

function assignPath(root, idx, value) {
  let cur = root;
  for (let i = 0; i < idx.length; i += 1) {
    const part = idx[i];
    const last = i === idx.length - 1;
    const numeric = /^\d+$/.test(String(part));
    const key = numeric ? Number(part) : part;
    if (last) {
      if (Array.isArray(cur)) {
        while (cur.length <= key) cur.push({});
        cur[key] = value;
      } else {
        cur[key] = value;
      }
      return;
    }
    const nxtNumeric = /^\d+$/.test(String(idx[i + 1]));
    if (Array.isArray(cur)) {
      while (cur.length <= key) cur.push(nxtNumeric ? [] : {});
      if (typeof cur[key] !== "object" || cur[key] == null) cur[key] = nxtNumeric ? [] : {};
      cur = cur[key];
    } else {
      if (!(key in cur) || typeof cur[key] !== "object" || cur[key] == null) {
        cur[key] = nxtNumeric ? [] : {};
      }
      cur = cur[key];
    }
  }
}

function phpNested(array) {
  const root = {};
  for (const [key, value] of Object.entries(array)) {
    const m = key.match(/^([^\[]+)(\[.+\])?$/);
    if (!m) {
      root[key] = value;
      continue;
    }
    const head = m[1];
    const rest = m[2] || "";
    const idx = [head, ...[...rest.matchAll(/\[([^\]]*)\]/g)].map(x => x[1])];
    assignPath(root, idx, value);
  }
  return root;
}

export function parseBody(raw, contentType = "") {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8").trim() : String(raw || "").trim();
  if (!text) return {};
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("json") || text.startsWith("{") || text.startsWith("[")) {
    try {
      const obj = JSON.parse(text);
      return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
    } catch {
      // fall through
    }
  }
  const flat = {};
  for (const [k, v] of new URLSearchParams(text)) flat[k] = v;
  return phpNested(flat);
}

export function rubToKopecks(val) {
  const s = String(val ?? "0").replace(",", ".").replace(/\s/g, "").trim();
  if (!s) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function extractUrl(text) {
  if (!text) return "";
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === "object") {
        for (const k of ["link", "url", "payment_link", "result"]) {
          const v = obj[k];
          if (typeof v === "string" && v.startsWith("http")) return v.trim();
        }
      }
      if (typeof obj === "string" && obj.startsWith("http")) return obj.trim();
    } catch {
      // ignore
    }
  }
  for (const line of t.split("\n")) {
    const lineTrim = line.trim();
    if (lineTrim.startsWith("http://") || lineTrim.startsWith("https://")) return lineTrim.split(/\s/)[0];
  }
  return "";
}

/** @param {{ amountRub: number, name: string, sku?: string, productType?: string, extra?: string, orderId?: string }} opts */
export async function createPaymentLink({
  amountRub,
  name,
  sku = "",
  productType = "service",
  extra = "",
  orderId = null,
}) {
  if (!isConfigured()) return { ok: false, error: "PRODAMUS_SECRET_KEY не задан" };
  const pid = orderId || newOrderId();
  const price = Number(amountRub) === Math.floor(Number(amountRub))
    ? String(Math.floor(Number(amountRub)))
    : String(amountRub);
  const product = { name, price, quantity: "1", type: productType };
  if (sku) product.sku = sku;
  const data = {
    do: "link",
    order_id: pid,
    order_sum: price,
    customer_extra: String(extra || "").slice(0, 240),
    products: [product],
    currency: "rub",
    locale: "ru-RU",
    npd_income_type: "FROM_INDIVIDUAL",
    installments_disabled: "1",
    payments_limit: "1",
    callbackType: "json",
    urlNotification: notifyUrl(),
    urlSuccess: returnUrl(),
  };
  const sys = sysCode();
  if (sys) data.sys = sys;
  if (isDemo()) {
    data.demo_mode = "1";
  }
  // SoulVoice: все способы оплаты в payform (РФ + СНГ + зарубеж), без фильтра FOREIGN_METHODS как в Psyche.
  const toSign = { ...data };
  data.signature = sign(toSign);
  const form = new URLSearchParams(flattenForm(data));
  try {
    const res = await fetch(formUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: form.toString(),
    });
    const text = await res.text();
    const url = extractUrl(text);
    if (!url) {
      console.warn("[prodamus] link fail status=%s body=%s", res.status, text.slice(0, 240));
      return { ok: false, error: "Prodamus не вернул ссылку" };
    }
    return { ok: true, payment_id: pid, url };
  } catch (err) {
    console.warn("[prodamus] link exception:", err.message);
    return { ok: false, error: "Не удалось создать ссылку Prodamus" };
  }
}

export function webhookOrderId(payload) {
  const num = String(payload?.order_num || "").trim();
  const oid = String(payload?.order_id || "").trim();
  if (PID_RE.test(num) || num.startsWith("pd_")) return num;
  if (PID_RE.test(oid) || oid.startsWith("pd_")) return oid;
  return num || oid;
}

export function webhookPaid(payload) {
  const st = String(payload?.payment_status || "").trim().toLowerCase();
  return st === "success" || st === "successful";
}

export function headerSign(headers) {
  if (!headers) return "";
  const get = typeof headers.get === "function"
    ? k => headers.get(k) || ""
    : k => headers[k] || headers[k.toLowerCase()] || "";
  return (get("Sign") || get("sign") || get("X-Sign") || get("x-sign") || "").trim();
}
