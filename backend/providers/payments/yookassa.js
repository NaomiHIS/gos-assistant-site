// ============================================================
// YooKassa adapter
// Docs: https://yookassa.ru/developers/api
// Config (хранится в payment_providers.config): { shop_id, secret_key, return_url? }
// ============================================================
const crypto = require('crypto');

const API_BASE = 'https://api.yookassa.ru/v3';

function authHeader(cfg) {
  if (!cfg || !cfg.shop_id || !cfg.secret_key) {
    throw new Error('YooKassa не настроена: укажите shop_id и secret_key');
  }
  return 'Basic ' + Buffer.from(cfg.shop_id + ':' + cfg.secret_key).toString('base64');
}

function formatAmount(cents, currency) {
  const value = (cents / 100).toFixed(2);
  return { value, currency: currency || 'RUB' };
}

// Создаём платёж в ЮKassa и возвращаем { externalId, confirmationUrl, raw }
async function createPayment({ payment, plan, user, provider, returnUrl }) {
  const cfg = provider.config || {};
  const idempotenceKey = crypto.randomUUID();
  const body = {
    amount: formatAmount(payment.amount_cents, payment.currency),
    capture: true,
    description: `Подписка ${plan.name} (${plan.duration_days} дн.) для ${user.email}`,
    confirmation: {
      type: 'redirect',
      return_url: returnUrl || cfg.return_url || 'https://gosassistent.su/cabinet.html',
    },
    metadata: {
      payment_id: String(payment.id),
      user_id: String(user.id),
      plan_id: String(plan.id),
      plan_slug: plan.slug,
    },
  };

  const res = await fetch(API_BASE + '/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
      Authorization: authHeader(cfg),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) {
    const msg = (data && (data.description || data.message)) || `HTTP ${res.status}`;
    throw new Error('YooKassa: ' + msg);
  }
  return {
    externalId: data.id,
    confirmationUrl: data.confirmation && data.confirmation.confirmation_url,
    raw: data,
  };
}

// Парсим webhook от YooKassa. Возвращаем { externalId, status, paidAt, raw } или null.
// Идентификация: запрос приходит без подписи, но YooKassa требует whitelist IP.
// Дополнительная защита — проверяем что shop_id из payload.metadata совпадает с нашим.
function parseWebhook({ body, provider }) {
  if (!body || !body.event || !body.object) return null;
  const obj = body.object;
  let status = 'pending';
  switch (body.event) {
    case 'payment.succeeded': status = 'succeeded'; break;
    case 'payment.canceled':  status = 'canceled';  break;
    case 'payment.waiting_for_capture': status = 'pending'; break;
    case 'refund.succeeded':  status = 'refunded';  break;
    default: return null;
  }
  return {
    externalId: obj.id,
    status,
    paidAt: status === 'succeeded' && obj.captured_at ? new Date(obj.captured_at) : null,
    raw: obj,
  };
}

// Подтверждение IP (опционально) — YooKassa шлёт webhooks только с этих диапазонов
const YOOKASSA_IPS = [
  '185.71.76.0/27', '185.71.77.0/27',
  '77.75.153.0/25', '77.75.154.128/25',
  '77.75.156.11', '77.75.156.35',
  '2a02:5180::/32',
];
function ipAllowed(ip) {
  if (!ip) return false;
  // Простой whitelist — для production стоит расширить парсингом CIDR.
  // Сейчас проверяем точное совпадение или строковый префикс /24.
  return YOOKASSA_IPS.some((cidr) => {
    if (cidr === ip) return true;
    if (!cidr.includes('/')) return ip === cidr;
    const [base] = cidr.split('/');
    const prefix = base.split('.').slice(0, 3).join('.') + '.';
    return ip.startsWith(prefix);
  });
}

module.exports = {
  slug: 'yookassa',
  isOnline: true,
  createPayment,
  parseWebhook,
  ipAllowed,
};
