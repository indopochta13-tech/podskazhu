// Подписка «Про»: оплата через Prodamus, сервер держит срок по webhook.
import { isConfigured as prodamusConfigured } from "./prodamus.js";
import { db, save, findUserByCode, nextId } from "./store.js";
import { clearProShelfData } from "./pro-cleanup.js";

const DAY = 86400000;
const MONTH = 31 * DAY;

export const PRODUCTS = [
  {
    id: "pro_month",
    title: "Месяц",
    period: "месяц",
    days: 31,
    price: 299,
    priceLabel: "299 ₽",
    hint: "Общие списки без ограничений, приоритетная поддержка.",
  },
  {
    id: "pro_year",
    title: "Год",
    period: "год",
    days: 366,
    price: 1990,
    priceLabel: "1 990 ₽",
    monthlyEquiv: "166 ₽ в месяц",
    saveBadge: "Выгоднее на 45%",
    hint: "То же самое, но выгоднее: год без лимитов.",
  },
];

export const FAMILY_BASE_MONTH = 299;

/** Доля скидки соло-года от 12× месяц (299→1990 ≈ 45%). */
export function soloYearSaveRate() {
  const month = PRODUCTS.find(p => p.id === "pro_month");
  const year = PRODUCTS.find(p => p.id === "pro_year");
  if (!month?.price || !year?.price) return 0.45;
  const fullYear = month.price * 12;
  return Math.max(0, 1 - year.price / fullYear);
}

function buildFamilyTerms() {
  const y = soloYearSaveRate();
  return [
    { id: "family_1m", months: 1, extraDiscount: 0, period: "1 мес", days: 31 },
    { id: "family_6m", months: 6, extraDiscount: y * 0.5, period: "6 мес", days: 186 },
    { id: "family_12m", months: 12, extraDiscount: y, period: "1 год", days: 366 },
  ];
}

export const FAMILY_TERMS = buildFamilyTerms();

/** Скидка на N-го участника (0-based): 1-й 0%, 2-й −10%, … макс −50%. */
export function familySlotDiscount(slotIndex) {
  if (slotIndex <= 0) return 0;
  return Math.min(0.50, slotIndex * 0.05 + 0.05);
}

export function familyMonthlyTotal(memberCount) {
  const n = Math.max(1, Number(memberCount) || 1);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += FAMILY_BASE_MONTH * (1 - familySlotDiscount(i));
  }
  return Math.round(sum);
}

export function familyTermById(termId) {
  return FAMILY_TERMS.find(t => t.id === String(termId || "")) || FAMILY_TERMS[0];
}

export function familyTotalPrice(memberCount, termId) {
  const term = familyTermById(termId);
  const monthly = familyMonthlyTotal(memberCount);
  return Math.round(monthly * term.months * (1 - term.extraDiscount));
}

export function familyPriceBreakdown(memberCount, termId) {
  const term = familyTermById(termId);
  const slots = [];
  for (let i = 0; i < memberCount; i += 1) {
    const discount = familySlotDiscount(i);
    const price = Math.round(FAMILY_BASE_MONTH * (1 - discount));
    slots.push({ index: i + 1, discountPct: Math.round(discount * 100), price });
  }
  const monthly = slots.reduce((s, x) => s + x.price, 0);
  const subtotal = monthly * term.months;
  const extraOff = Math.round(subtotal * term.extraDiscount);
  return {
    term,
    slots,
    monthly,
    subtotal,
    extraOff,
    total: subtotal - extraOff,
  };
}

export function productById(id) {
  return PRODUCTS.find(p => p.id === String(id || "")) || null;
}

function prodamusProductName(product) {
  return `SoulVoice Pro — ${product.period}`;
}

function prodamusFamilyName(term, count) {
  return `SoulVoice Pro Семья (${count}) — ${term.period}`;
}

function prodamusSku(productId) {
  return `sv_${String(productId || "").replace(/[^a-z0-9_]/gi, "")}`;
}

/** Оплата включена: Prodamus настроен на сервере. */
export function billingPayEnabled() {
  return prodamusConfigured();
}

/** Локальный прогон без Prodamus — подписка без реальной оплаты. */
export function billingTestMode() {
  if (billingPayEnabled()) return false;
  return process.env.VC_RUSTORE_TEST === "1" || !process.env.VC_RUSTORE_KEY;
}

function ensureBilling(user) {
  if (!user.billing || typeof user.billing !== "object") {
    user.billing = { plan: "free", until: 0, productId: "", purchaseId: "", updatedAt: 0 };
  }
  return user.billing;
}

function ensurePending() {
  if (!db.billingPending || typeof db.billingPending !== "object") db.billingPending = {};
  return db.billingPending;
}

function ensureFamilySubs() {
  if (!db.familySubs || typeof db.familySubs !== "object") db.familySubs = {};
  return db.familySubs;
}

export function planFor(user) {
  const billing = ensureBilling(user);
  const active = billing.plan === "pro" && Number(billing.until || 0) > Date.now();
  return {
    plan: active ? "pro" : "free",
    active,
    until: active ? billing.until : 0,
    productId: active ? billing.productId : "",
    familySubId: billing.familySubId || "",
    familyOwnerId: billing.familyOwnerId || "",
  };
}

export function isPro(user) {
  return planFor(user).active;
}

export function validateBillingUserCode(code, requesterId) {
  const wanted = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(wanted)) {
    return { ok: false, valid: false, error: "ID — 6 символов" };
  }
  const user = findUserByCode(wanted);
  if (!user) return { ok: true, valid: false, code: wanted };
  if (user.id === requesterId) {
    return { ok: true, valid: true, self: true, code: wanted, userId: user.id };
  }
  // Сообщаем, есть ли у человека подписка. Раньше отвечали только «ID верный»,
  // и приглашающий узнавал о проблеме уже после отправки: приглашение уходило,
  // а принять его было нельзя. Теперь можно сразу предложить подарить подписку.
  return {
    ok: true,
    valid: true,
    code: wanted,
    userId: user.id,
    hasPro: isPro(user),
  };
}

function verifyPurchaseWithStore(_purchase) {
  console.error("[billing] сверка чека с RuStore не реализована — покупка отклонена");
  return false;
}

function grantedUntil(seen, product) {
  return Number(seen.until || 0) || Number(seen.at || 0) + product.days * DAY;
}

function grantProUntil(user, until, purchaseId, productId, extra = {}) {
  const billing = ensureBilling(user);
  const wasActive = billing.plan === "pro" && Number(billing.until || 0) > Date.now();
  billing.plan = "pro";
  billing.until = Math.max(Number(billing.until || 0), until);
  billing.productId = productId;
  billing.purchaseId = purchaseId;
  billing.updatedAt = Date.now();
  if (extra.familySubId) billing.familySubId = extra.familySubId;
  if (extra.familyOwnerId) billing.familyOwnerId = extra.familyOwnerId;
  if (extra.autoRenew != null) billing.autoRenew = extra.autoRenew;
  if (!wasActive) clearProShelfData(user, db.items);
}

function grantProduct(user, product, purchaseId, { seen = null } = {}) {
  const id = String(purchaseId || "").trim().slice(0, 120);
  if (!id) return { ok: false, error: "Нет номера покупки" };

  if (!db.purchases) db.purchases = {};
  const prev = db.purchases[id];
  if (prev && prev.userId !== user.id && db.users[prev.userId]) {
    return { ok: false, error: "Покупка уже использована" };
  }

  const billing = ensureBilling(user);
  const base = Math.max(Date.now(), Number(billing.until || 0));
  const granted = prev || seen
    ? grantedUntil(prev || seen, product)
    : base + product.days * DAY;

  grantProUntil(user, granted, id, product.id);
  db.purchases[id] = { userId: user.id, productId: product.id, at: prev?.at || seen?.at || Date.now(), until: granted };
  save();
  return { ok: true, plan: planFor(user) };
}

function resolveFamilyMembers(codes, payerId) {
  const normalized = [];
  const seen = new Set();
  for (const raw of codes || []) {
    const code = String(raw || "").trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    normalized.push(code);
  }
  if (!normalized.length) return { ok: false, error: "Укажите хотя бы один ID" };
  if (normalized.length > 12) return { ok: false, error: "Не больше 12 участников" };

  const members = [];
  for (const code of normalized) {
    const check = validateBillingUserCode(code, payerId);
    if (!check.valid) return { ok: false, error: `ID ${code} не найден` };
    members.push({ code, userId: check.userId });
  }
  return { ok: true, members };
}

/** RuStore SDK (legacy): в боевом режиме без сверки не выдаём. */
export function applyPurchase(user, { productId, purchaseId, status }) {
  const product = productById(productId);
  if (!product) return { ok: false, error: "Неизвестный продукт" };
  const confirmed = String(status || "").toUpperCase();
  if (!billingTestMode()) {
    if (!verifyPurchaseWithStore({ productId: product.id, purchaseId, status: confirmed })) {
      return { ok: false, error: "Покупка не подтверждена платформой" };
    }
  }
  return grantProduct(user, product, purchaseId);
}

export function createPendingPayment(user, productId, paymentId, amountKopecks) {
  const product = productById(productId);
  if (!product) return { ok: false, error: "Неизвестный продукт" };
  if (!billingPayEnabled()) return { ok: false, error: "Оплата пока недоступна" };
  const pending = ensurePending();
  pending[paymentId] = {
    type: "solo",
    userId: user.id,
    productId: product.id,
    amountKopecks: Number(amountKopecks) || product.price * 100,
    status: "pending",
    createdAt: Date.now(),
  };
  save();
  return {
    ok: true,
    product,
    name: prodamusProductName(product),
    sku: prodamusSku(product.id),
    extra: `u${user.id}:p${product.id}`,
    amountRub: product.price,
  };
}

export function createFamilyPendingPayment(user, codes, termId, paymentId) {
  if (!billingPayEnabled()) return { ok: false, error: "Оплата пока недоступна" };
  const term = familyTermById(termId);
  const resolved = resolveFamilyMembers(codes, user.id);
  if (!resolved.ok) return resolved;

  const amountRub = familyTotalPrice(resolved.members.length, term.id);
  const pending = ensurePending();
  pending[paymentId] = {
    type: "family",
    userId: user.id,
    payerId: user.id,
    productId: term.id,
    termMonths: term.months,
    termDays: term.days,
    beneficiaryCodes: resolved.members.map(m => m.code),
    beneficiaryIds: resolved.members.map(m => m.userId),
    amountKopecks: amountRub * 100,
    status: "pending",
    createdAt: Date.now(),
  };
  save();
  return {
    ok: true,
    term,
    name: prodamusFamilyName(term, resolved.members.length),
    sku: prodamusSku(term.id),
    extra: `u${user.id}:f${term.id}:n${resolved.members.length}`,
    amountRub,
    memberCount: resolved.members.length,
  };
}

export function pendingPaymentRow(paymentId) {
  return ensurePending()[paymentId] || null;
}

function grantFamilySubscription(row, paymentId) {
  const term = familyTermById(row.productId);
  const base = Math.max(Date.now(), 0);
  const payer = db.users[row.payerId || row.userId];
  if (!payer) return "no_user";

  const payerUntil = Math.max(Number(ensureBilling(payer).until || 0), base);
  const granted = payerUntil + term.days * DAY;
  const subId = nextId("fs");

  const sub = {
    id: subId,
    payerId: payer.id,
    beneficiaryIds: [...(row.beneficiaryIds || [])],
    beneficiaryCodes: [...(row.beneficiaryCodes || [])],
    termId: term.id,
    termMonths: term.months,
    until: granted,
    paymentId,
    autoRenew: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  ensureFamilySubs()[subId] = sub;

  const ids = new Set([payer.id, ...(row.beneficiaryIds || [])]);
  for (const uid of ids) {
    const u = db.users[uid];
    if (!u) continue;
    grantProUntil(u, granted, paymentId, term.id, {
      familySubId: subId,
      familyOwnerId: payer.id,
      autoRenew: uid === payer.id,
    });
  }

  if (!db.purchases) db.purchases = {};
  db.purchases[paymentId] = {
    userId: payer.id,
    productId: term.id,
    type: "family",
    familySubId: subId,
    at: Date.now(),
    until: granted,
  };
  save();
  console.info("[billing] семейная Prodamus: payer=%s sub=%s n=%s pid=%s",
    payer.id, subId, ids.size, paymentId);
  return "succeeded";
}

/** Webhook Prodamus: грант только по локальной pending-записи. */
export function grantProdamusPaid(paymentId, paidKopecks) {
  const row = pendingPaymentRow(paymentId);
  if (!row) {
    console.warn("[billing] prodamus: нет pending pid=%s", paymentId);
    return "no_record";
  }
  const expected = Number(row.amountKopecks || 0);
  if (expected && Number(paidKopecks || 0) < expected) {
    console.warn("[billing] prodamus: недоплата pid=%s paid=%s expected=%s", paymentId, paidKopecks, expected);
    return "amount_mismatch";
  }
  if (row.status === "succeeded") return "succeeded";

  if (row.type === "family") {
    const status = grantFamilySubscription(row, paymentId);
    if (status === "succeeded") {
      row.status = "succeeded";
      row.grantedAt = Date.now();
      save();
    }
    return status;
  }

  const user = db.users[row.userId];
  if (!user) return "no_user";
  const product = productById(row.productId);
  if (!product) return "bad_product";

  const res = grantProduct(user, product, paymentId);
  if (!res.ok) return res.error || "grant_failed";

  row.status = "succeeded";
  row.grantedAt = Date.now();
  save();
  console.info("[billing] Prodamus зачтено: user=%s product=%s pid=%s", user.id, product.id, paymentId);
  return "succeeded";
}

export function verifyProdamusLocal(paymentId, expectedUserId = null) {
  const row = pendingPaymentRow(paymentId);
  if (!row) return "no_record";
  if (expectedUserId != null && row.userId !== expectedUserId) return "foreign";
  if (row.status === "succeeded") return "succeeded";
  if (row.status === "canceled") return "canceled";
  return row.status || "pending";
}

function familySubsForPayer(payerId) {
  return Object.values(ensureFamilySubs()).filter(s => s.payerId === payerId);
}

function activeFamilySubForUser(user) {
  const billing = ensureBilling(user);
  if (billing.familySubId && ensureFamilySubs()[billing.familySubId]) {
    return ensureFamilySubs()[billing.familySubId];
  }
  return null;
}

export function restorePurchasesForUser(user) {
  let restored = 0;
  const now = Date.now();

  for (const purchase of Object.values(db.purchases || {})) {
    if (purchase.userId !== user.id) continue;
    if (Number(purchase.until || 0) <= now) continue;
    const u = db.users[purchase.userId];
    if (!u) continue;
    grantProUntil(u, purchase.until, purchase.at?.toString?.() || "restore", purchase.productId || "");
    restored += 1;
  }

  for (const sub of familySubsForPayer(user.id)) {
    if (Number(sub.until || 0) <= now) continue;
    for (const uid of new Set([sub.payerId, ...(sub.beneficiaryIds || [])])) {
      const u = db.users[uid];
      if (!u) continue;
      grantProUntil(u, sub.until, sub.paymentId || sub.id, sub.termId || "family_1m", {
        familySubId: sub.id,
        familyOwnerId: sub.payerId,
        autoRenew: uid === sub.payerId ? sub.autoRenew !== false : false,
      });
      restored += 1;
    }
  }

  if (restored) save();
  return restored;
}

export function cancelFamilySubscription(user) {
  const sub = activeFamilySubForUser(user);
  if (!sub || sub.payerId !== user.id) {
    return { ok: false, error: "Нет активной семейной подписки" };
  }
  sub.autoRenew = false;
  sub.updatedAt = Date.now();
  const billing = ensureBilling(user);
  billing.autoRenew = false;
  billing.updatedAt = Date.now();
  save();
  return { ok: true, sub };
}

export function billingState(user) {
  const plan = planFor(user);
  const fam = activeFamilySubForUser(user);
  return {
    ...plan,
    products: PRODUCTS,
    familyTerms: FAMILY_TERMS,
    familyBaseMonth: FAMILY_BASE_MONTH,
    testMode: billingTestMode(),
    payEnabled: billingPayEnabled(),
    familySub: fam && Number(fam.until || 0) > Date.now() ? {
      id: fam.id,
      until: fam.until,
      memberCount: (fam.beneficiaryIds || []).length,
      autoRenew: fam.autoRenew !== false,
      isOwner: fam.payerId === user.id,
    } : null,
  };
}

export function dropSubscription(user) {
  const billing = ensureBilling(user);
  billing.plan = "free";
  billing.until = 0;
  billing.productId = "";
  billing.familySubId = "";
  billing.familyOwnerId = "";
  billing.autoRenew = false;
  billing.updatedAt = Date.now();
  save();
  return planFor(user);
}
