const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { grantSubscription } = require('./subscriptions');
const providers = require('../providers/payments');

// ============================================================
// Helpers
// ============================================================
function parseJson(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function loadProvider(slug) {
  const row = await db.queryOne(
    'SELECT id, slug, name, description, config, is_enabled AS isEnabled, sort_order AS sortOrder FROM payment_providers WHERE slug = ?',
    [slug]
  );
  if (!row) return null;
  return { ...row, config: parseJson(row.config) };
}

async function loadEnabledProviders() {
  const rows = await db.query(
    `SELECT slug, name, description, sort_order AS sortOrder
       FROM payment_providers
      WHERE is_enabled = 1
      ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

async function loadPlan(planId) {
  return db.queryOne(
    `SELECT id, slug, name, description, color, price_cents AS priceCents,
            currency, duration_days AS durationDays, is_purchasable AS isPurchasable,
            is_active AS isActive
       FROM subscription_plans WHERE id = ?`,
    [planId]
  );
}

// Маскируем секреты (config) для не-админов
function sanitizeProviderForPublic(p) {
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    sortOrder: p.sortOrder,
  };
}

// ============================================================
// PUBLIC: список включённых провайдеров (для страницы покупки)
// ============================================================
router.get('/providers', requireAuth, async (req, res) => {
  try {
    const rows = await loadEnabledProviders();
    res.json({ success: true, providers: rows.map(sanitizeProviderForPublic) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// ADMIN: CRUD провайдеров
// ============================================================
router.get('/providers/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, slug, name, description, config, is_enabled AS isEnabled, sort_order AS sortOrder,
              created_at AS createdAt, updated_at AS updatedAt
         FROM payment_providers ORDER BY sort_order ASC, id ASC`
    );
    res.json({
      success: true,
      providers: rows.map((r) => ({ ...r, config: parseJson(r.config) })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/providers', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { slug, name, description, config, isEnabled, sortOrder } = req.body || {};
    if (!slug || !name) return res.status(400).json({ error: 'slug и name обязательны' });
    const cleanSlug = String(slug).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    if (!cleanSlug) return res.status(400).json({ error: 'Неверный slug' });
    await db.query(
      `INSERT INTO payment_providers (slug, name, description, config, is_enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cleanSlug, String(name).slice(0, 128), description || null,
       JSON.stringify(config || {}), isEnabled ? 1 : 0, sortOrder || 0]
    );
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Провайдер с таким slug уже есть' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/providers/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    const { name, description, config, isEnabled, sortOrder } = req.body || {};
    await db.query(
      `UPDATE payment_providers
          SET name = COALESCE(?, name),
              description = ?,
              config = COALESCE(?, config),
              is_enabled = COALESCE(?, is_enabled),
              sort_order = COALESCE(?, sort_order)
        WHERE id = ?`,
      [name || null, description || null,
       config !== undefined ? JSON.stringify(config) : null,
       isEnabled != null ? (isEnabled ? 1 : 0) : null,
       sortOrder != null ? sortOrder : null,
       id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/providers/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    const used = await db.queryOne(
      `SELECT p.slug FROM payment_providers p WHERE p.id = ?`, [id]
    );
    if (used && (used.slug === 'yookassa' || used.slug === 'robokassa' || used.slug === 'manual')) {
      return res.status(400).json({ error: 'Этот провайдер встроенный — его можно только отключить' });
    }
    await db.query('DELETE FROM payment_providers WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/payments/create — пользователь инициирует оплату
// body: { planId, providerSlug, returnUrl? }
// ============================================================
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { planId, providerSlug, returnUrl } = req.body || {};
    if (!planId || !providerSlug) return res.status(400).json({ error: 'planId и providerSlug обязательны' });

    const plan = await loadPlan(planId);
    if (!plan || !plan.isActive || !plan.isPurchasable) {
      return res.status(400).json({ error: 'План недоступен для покупки' });
    }
    if (!plan.priceCents || plan.priceCents <= 0) {
      return res.status(400).json({ error: 'Цена плана не задана' });
    }

    const providerRow = await loadProvider(providerSlug);
    if (!providerRow || !providerRow.isEnabled) {
      return res.status(400).json({ error: 'Способ оплаты недоступен' });
    }
    const adapter = providers.get(providerSlug);
    if (!adapter) {
      return res.status(400).json({ error: 'Неизвестный провайдер' });
    }

    // Создаём pending платёж в БД
    const insertRes = await db.query(
      `INSERT INTO payments (user_id, plan_id, provider_slug, amount_cents, currency, status, metadata)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [req.user.id, plan.id, providerSlug, plan.priceCents, plan.currency || 'RUB',
       JSON.stringify({ returnUrl: returnUrl || null })]
    );
    const paymentId = insertRes.insertId;
    const payment = {
      id: paymentId,
      amount_cents: plan.priceCents,
      currency: plan.currency || 'RUB',
    };

    // Зовём провайдера
    let externalId = null;
    let confirmationUrl = null;
    try {
      const result = await adapter.createPayment({
        payment, plan, user: req.user, provider: providerRow, returnUrl,
      });
      externalId = result.externalId || null;
      confirmationUrl = result.confirmationUrl || null;
      await db.query(
        `UPDATE payments SET external_id = ?, confirmation_url = ? WHERE id = ?`,
        [externalId, confirmationUrl, paymentId]
      );
    } catch (err) {
      console.error('[Payments] create error:', err);
      await db.query(`UPDATE payments SET status = 'failed' WHERE id = ?`, [paymentId]);
      return res.status(502).json({ error: 'Не удалось создать платёж: ' + err.message });
    }

    res.json({
      success: true,
      payment: {
        id: paymentId,
        status: 'pending',
        amountCents: plan.priceCents,
        currency: plan.currency || 'RUB',
        externalId,
        confirmationUrl,
        providerSlug,
        planId: plan.id,
      },
    });
  } catch (err) {
    console.error('[Payments] create error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/payments/mine — история платежей пользователя
// ============================================================
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT pmt.id, pmt.plan_id AS planId, pmt.provider_slug AS providerSlug,
              pmt.amount_cents AS amountCents, pmt.currency, pmt.status,
              pmt.confirmation_url AS confirmationUrl, pmt.created_at AS createdAt,
              pmt.paid_at AS paidAt,
              p.name AS planName, p.color AS planColor
         FROM payments pmt
         LEFT JOIN subscription_plans p ON p.id = pmt.plan_id
        WHERE pmt.user_id = ?
        ORDER BY pmt.created_at DESC
        LIMIT 50`,
      [req.user.id]
    );
    res.json({ success: true, payments: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// ADMIN: GET /api/payments/all — все платежи с фильтрами
// query: ?status=&providerSlug=&search=
// ============================================================
router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status, providerSlug, search } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('pmt.status = ?'); params.push(status); }
    if (providerSlug) { where.push('pmt.provider_slug = ?'); params.push(providerSlug); }
    if (search) {
      where.push('(u.email LIKE ? OR u.username LIKE ? OR pmt.external_id LIKE ?)');
      params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
    }
    const sql = `
      SELECT pmt.id, pmt.user_id AS userId, pmt.plan_id AS planId,
             pmt.provider_slug AS providerSlug, pmt.amount_cents AS amountCents,
             pmt.currency, pmt.status, pmt.external_id AS externalId,
             pmt.confirmation_url AS confirmationUrl, pmt.created_at AS createdAt,
             pmt.paid_at AS paidAt,
             u.email AS userEmail, u.username AS userName,
             p.name AS planName, p.color AS planColor
        FROM payments pmt
        LEFT JOIN users u ON u.id = pmt.user_id
        LEFT JOIN subscription_plans p ON p.id = pmt.plan_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY pmt.created_at DESC
        LIMIT 500
    `;
    const rows = await db.query(sql, params);
    res.json({ success: true, payments: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// ADMIN: PUT /api/payments/:id/mark — вручную пометить succeeded/canceled
// body: { status: 'succeeded'|'canceled' }
// При 'succeeded' выдаём подписку юзеру.
// ============================================================
router.put('/:id/mark', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    const { status } = req.body || {};
    if (!['succeeded', 'canceled', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Неверный статус' });
    }
    const payment = await db.queryOne(
      `SELECT id, user_id AS userId, plan_id AS planId, status, granted_subscription_id AS grantedId
         FROM payments WHERE id = ?`,
      [id]
    );
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });

    if (status === 'succeeded' && payment.status !== 'succeeded') {
      const plan = await loadPlan(payment.planId);
      if (!plan) return res.status(400).json({ error: 'План платежа не найден' });
      const subId = await grantSubscription({
        userId: payment.userId,
        planId: plan.id,
        durationDays: plan.durationDays,
        grantedBy: req.user.id,
        notes: 'Payment #' + id,
      });
      await db.query(
        `UPDATE payments SET status = 'succeeded', paid_at = NOW(), granted_subscription_id = ? WHERE id = ?`,
        [subId, id]
      );
    } else {
      await db.query(`UPDATE payments SET status = ? WHERE id = ?`, [status, id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Payments] mark error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/payments/webhook/:slug — провайдеры присылают сюда события
// Без auth. Внутри — провайдер проверяет подпись/IP.
// ============================================================
router.post('/webhook/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const adapter = providers.get(slug);
    const providerRow = await loadProvider(slug);
    if (!adapter || !providerRow) return res.status(404).json({ error: 'Unknown provider' });

    // Опциональная проверка IP (YooKassa whitelist)
    if (adapter.ipAllowed) {
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
      if (!adapter.ipAllowed(ip)) {
        console.warn(`[Payments] webhook ${slug} from unknown IP: ${ip}`);
        // не блокируем 403-м, чтобы не палить логику атакующему, но не обрабатываем
        return res.status(200).json({ ok: true });
      }
    }

    const parsed = adapter.parseWebhook({ body: req.body, headers: req.headers, provider: providerRow });
    if (!parsed) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const payment = await db.queryOne(
      `SELECT id, user_id AS userId, plan_id AS planId, status
         FROM payments
        WHERE provider_slug = ? AND external_id = ?
        LIMIT 1`,
      [slug, parsed.externalId]
    );
    if (!payment) {
      console.warn(`[Payments] webhook ${slug}: payment not found for external_id=${parsed.externalId}`);
      return res.status(200).json({ ok: true, notFound: true });
    }

    // Идемпотентность: уже обработан. Для Robokassa важно ответить тем же OK<InvId>,
    // иначе она продолжит ретраи.
    if (payment.status === parsed.status) {
      if (parsed.webhookResponse !== undefined) {
        return res.type('text/plain').send(String(parsed.webhookResponse));
      }
      return res.json({ ok: true, alreadyApplied: true });
    }

    if (parsed.status === 'succeeded') {
      const plan = await loadPlan(payment.planId);
      if (plan) {
        const subId = await grantSubscription({
          userId: payment.userId,
          planId: plan.id,
          durationDays: plan.durationDays,
          notes: 'Auto: ' + slug + ' #' + parsed.externalId,
        });
        await db.query(
          `UPDATE payments SET status = 'succeeded', paid_at = ?, granted_subscription_id = ? WHERE id = ?`,
          [parsed.paidAt ? parsed.paidAt.toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' '),
           subId, payment.id]
        );
      }
    } else {
      await db.query(`UPDATE payments SET status = ? WHERE id = ?`, [parsed.status, payment.id]);
    }

    // Robokassa и другие провайдеры могут требовать конкретный формат ответа.
    if (parsed.webhookResponse !== undefined) {
      return res.type('text/plain').send(String(parsed.webhookResponse));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Payments] webhook error:', err);
    // Возвращаем 200 чтобы провайдер не ретраил при ошибке внутри нас
    res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
