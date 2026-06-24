// ============================================================
// Robokassa adapter
// Docs:
//   https://docs.robokassa.ru/ru/pay-interface
//   https://docs.robokassa.ru/ru/fiscalization
//   https://docs.robokassa.ru/ru/testing-mode
//
// Config (payment_providers.config JSON):
// {
//   "merchant_login": "your_login",
//   "password_1":     "live password 1",   // подписывает запрос
//   "password_2":     "live password 2",   // проверяет ResultURL
//   "test_password_1":"test password 1",   // используются при is_test=true
//   "test_password_2":"test password 2",
//   "is_test":        false,               // включает IsTest=1
//   "hash_algo":      "md5",               // md5 | sha256 | sha384 | sha512 — должен совпадать с настройкой в кабинете
//   "send_receipt":   false,               // включить блок Receipt для фискализации
//   "tax_system":     "usn_income",        // sno: osn | usn_income | usn_income_outcome | esn | patent
//   "vat":            "none",              // none | vat0 | vat10 | vat20 | vat110 | vat120
//   "payment_object": "service",           // commodity | service | payment | ...
//   "result_url":     null                 // переопределение (если не задано — генерится из текущего хоста)
// }
// ============================================================
const crypto = require('crypto');

const PAY_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';

function pickPassword(cfg, n) {
  if (cfg.is_test) {
    return n === 1 ? (cfg.test_password_1 || '') : (cfg.test_password_2 || '');
  }
  return n === 1 ? (cfg.password_1 || '') : (cfg.password_2 || '');
}

function hashAlgo(cfg) {
  const a = String(cfg.hash_algo || 'md5').toLowerCase();
  if (['md5', 'sha256', 'sha384', 'sha512'].includes(a)) return a;
  return 'md5';
}

function sign(cfg, parts) {
  // parts — массив строк, склеиваем через ":" и хешируем
  return crypto.createHash(hashAlgo(cfg)).update(parts.join(':'), 'utf8').digest('hex').toUpperCase();
}

function formatSum(cents) {
  // Robokassa ждёт число с точкой и двумя знаками
  return (cents / 100).toFixed(2);
}

function ensureCreds(cfg) {
  if (!cfg.merchant_login) throw new Error('Robokassa не настроена: укажите merchant_login');
  const p1 = pickPassword(cfg, 1);
  const p2 = pickPassword(cfg, 2);
  if (!p1 || !p2) {
    throw new Error('Robokassa не настроена: укажите ' + (cfg.is_test ? 'test_password_1 и test_password_2' : 'password_1 и password_2'));
  }
}

// ============================================================
// Receipt (54-ФЗ). Собираем один item на всю сумму = название тарифа.
// ============================================================
function buildReceipt(cfg, plan, payment) {
  return {
    sno: cfg.tax_system || 'usn_income',
    items: [
      {
        name: ('Подписка ' + (plan.name || ('#' + plan.id)) + ', ' + plan.duration_days + ' дн.').slice(0, 128),
        quantity: 1,
        sum: Number(formatSum(payment.amount_cents)),
        payment_method: 'full_prepayment',
        payment_object: cfg.payment_object || 'service',
        tax: cfg.vat || 'none',
      },
    ],
  };
}

// ============================================================
// createPayment — возвращает URL с уже встроенными параметрами и подписью.
// Robokassa не выдаёт «pending payment id» — мы сами используем наш payment.id
// в качестве InvId, и он же возвращается в ResultURL.
// ============================================================
async function createPayment({ payment, plan, user, provider }) {
  const cfg = provider.config || {};
  ensureCreds(cfg);

  const merchant = cfg.merchant_login;
  const outSum = formatSum(payment.amount_cents);
  const invId = String(payment.id);
  const password1 = pickPassword(cfg, 1);

  const params = new URLSearchParams();
  params.set('MerchantLogin', merchant);
  params.set('OutSum', outSum);
  params.set('InvId', invId);
  params.set('Description', `Подписка ${plan.name} (${plan.duration_days} дн.)`.slice(0, 100));
  if (user && user.email) params.set('Email', user.email);
  params.set('Culture', 'ru');
  params.set('Encoding', 'utf-8');
  if (cfg.is_test) params.set('IsTest', '1');

  // Receipt — обязательно URL-encoded и в JSON. Подпись считается от URL-encoded строки.
  let receiptEncoded = null;
  if (cfg.send_receipt) {
    const receipt = buildReceipt(cfg, plan, payment);
    receiptEncoded = encodeURIComponent(JSON.stringify(receipt));
    params.set('Receipt', receiptEncoded);
  }

  // Формула подписи запроса:
  //   MerchantLogin:OutSum:InvId[:Receipt(url-encoded)]:Password1
  // Shp_* параметры мы НЕ используем — если добавятся, надо приклеить отсортированно.
  const sigParts = [merchant, outSum, invId];
  if (receiptEncoded) sigParts.push(receiptEncoded);
  sigParts.push(password1);

  const signature = sign(cfg, sigParts);
  params.set('SignatureValue', signature);

  const confirmationUrl = PAY_URL + '?' + params.toString();

  return {
    // Robokassa возвращает свой OperationId только после оплаты —
    // на стадии создания у нас единственный устойчивый идентификатор это наш InvId.
    externalId: invId,
    confirmationUrl,
    raw: { url: PAY_URL, isTest: !!cfg.is_test, hashAlgo: hashAlgo(cfg) },
  };
}

// ============================================================
// parseWebhook — Robokassa шлёт x-www-form-urlencoded на ResultURL.
// Подпись: MD5(OutSum:InvId:Password2[:Shp_*])
// Ответ магазина ОБЯЗАН быть plain text "OK<InvId>" — иначе ретраи.
// ============================================================
function parseWebhook({ body, provider }) {
  if (!body) return null;
  const cfg = provider.config || {};

  const outSum = body.OutSum || body.outSum;
  const invId = body.InvId || body.invId;
  const sig = (body.SignatureValue || body.signatureValue || '').toString().toUpperCase();
  if (!outSum || !invId || !sig) return null;

  const password2 = pickPassword(cfg, 2);
  if (!password2) {
    console.error('[Robokassa] password_2 не настроен — невозможно проверить подпись');
    return null;
  }

  // Соберём Shp_* отсортированно
  const shpEntries = Object.entries(body)
    .filter(([k]) => /^Shp_/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);

  const parts = [outSum, invId, password2, ...shpEntries];
  const expected = sign(cfg, parts);

  if (expected !== sig) {
    console.warn('[Robokassa] invalid signature for InvId=' + invId);
    return null;
  }

  // Robokassa шлёт ResultURL ТОЛЬКО при успешной оплате.
  // Отмены/возвраты — через OpStateExt / refund-api (не реализовано в MVP).
  return {
    externalId: String(invId),
    status: 'succeeded',
    paidAt: new Date(),
    raw: body,
    webhookResponse: 'OK' + invId, // plain text для ResultURL
  };
}

// ============================================================
// IP-фильтр опционален. Robokassa публикует диапазоны, но подпись + Password2
// уже даёт достаточную защиту. Не задействуем.
// ============================================================

module.exports = {
  slug: 'robokassa',
  isOnline: true,
  createPayment,
  parseWebhook,
};
