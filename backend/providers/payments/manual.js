// ============================================================
// Manual provider — заявка на оплату.
// Юзер оставляет заявку → админ получает уведомление в Платежи →
// после поступления средств помечает платёж succeeded → выдаётся подписка.
// ============================================================

async function createPayment({ payment, plan, provider }) {
  const cfg = provider.config || {};
  return {
    externalId: 'manual-' + payment.id,
    confirmationUrl: null,
    raw: { instructions: cfg.instructions || '' },
  };
}

function parseWebhook() {
  // У ручного провайдера нет вебхуков
  return null;
}

module.exports = {
  slug: 'manual',
  isOnline: false,
  createPayment,
  parseWebhook,
};
