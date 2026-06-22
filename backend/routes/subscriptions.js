const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Canonical list of feature keys the app/site knows about.
// Admin can still attach arbitrary strings — these are just suggestions for the UI.
const KNOWN_FEATURES = [
  { key: 'notes_unlimited',  label: 'Безлимитные заметки' },
  { key: 'notes_sync',       label: 'Синхронизация заметок между устройствами' },
  { key: 'themes_extra',     label: 'Дополнительные темы оформления' },
  { key: 'priority_support', label: 'Приоритетная поддержка' },
  { key: 'early_access',     label: 'Ранний доступ к новым функциям' },
  { key: 'no_ads',           label: 'Без рекламы' },
  { key: 'export_data',      label: 'Экспорт заметок и истории' },
  { key: 'custom_hotkeys',   label: 'Расширенная настройка горячих клавиш' },
  { key: 'ai_assistant',     label: 'AI-ассистент по законам и правилам' },
  { key: 'multi_server',     label: 'Просмотр законов любого сервера' },
];

const DURATIONS = { 7: 7, 14: 14, 30: 30 };

function parseFeatures(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadCurrentSubscription(userId) {
  const row = await db.queryOne(
    `SELECT us.id, us.plan_id AS planId, us.starts_at AS startsAt, us.expires_at AS expiresAt,
            us.is_active AS isActive, us.granted_by AS grantedBy, us.notes,
            p.slug, p.name AS planName, p.description AS planDescription,
            p.color AS planColor, p.features AS planFeatures,
            p.price_cents AS planPriceCents, p.currency AS planCurrency,
            p.duration_days AS planDurationDays
       FROM user_subscriptions us
       JOIN subscription_plans p ON p.id = us.plan_id
      WHERE us.user_id = ?
        AND us.is_active = 1
        AND us.expires_at > NOW()
      ORDER BY us.expires_at DESC
      LIMIT 1`,
    [userId]
  );
  if (!row) return null;
  const features = parseFeatures(row.planFeatures);
  const remainingMs = new Date(row.expiresAt).getTime() - Date.now();
  const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  return {
    id: row.id,
    plan: {
      id: row.planId,
      slug: row.slug,
      name: row.planName,
      description: row.planDescription,
      color: row.planColor,
      features,
      priceCents: row.planPriceCents || 0,
      currency: row.planCurrency || 'RUB',
      durationDays: row.planDurationDays || 30,
    },
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
    remainingDays,
    notes: row.notes,
  };
}

// ============================================================
// GET /api/subscriptions/features — known feature keys (public-ish)
// ============================================================
router.get('/features', requireAuth, (req, res) => {
  res.json({ success: true, features: KNOWN_FEATURES });
});

// ============================================================
// GET /api/subscriptions/me — current user's active subscription
// ============================================================
router.get('/me', requireAuth, async (req, res) => {
  try {
    const sub = await loadCurrentSubscription(req.user.id);
    res.json({ success: true, subscription: sub });
  } catch (err) {
    console.error('[Subs] me error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/subscriptions/plans — list plans (admin sees all, user sees active)
// ============================================================
router.get('/plans', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const baseCols = 'id, slug, name, description, color, features, price_cents AS priceCents, currency, duration_days AS durationDays, is_purchasable AS isPurchasable, sort_order AS sortOrder';
    const sql = isAdmin
      ? `SELECT ${baseCols}, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM subscription_plans ORDER BY sort_order ASC, id ASC`
      : `SELECT ${baseCols} FROM subscription_plans WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`;
    const rows = await db.query(sql);
    res.json({
      success: true,
      plans: rows.map((p) => ({ ...p, features: parseFeatures(p.features) })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/subscriptions/plans/public — без auth, только покупаемые планы
// для публичной страницы /pricing.html
// ============================================================
router.get('/plans/public', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, slug, name, description, color, features,
              price_cents AS priceCents, currency, duration_days AS durationDays,
              sort_order AS sortOrder
         FROM subscription_plans
        WHERE is_active = 1 AND is_purchasable = 1
        ORDER BY sort_order ASC, id ASC`
    );
    res.json({
      success: true,
      plans: rows.map((p) => ({ ...p, features: parseFeatures(p.features) })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/subscriptions/plans — admin: create plan
// body: { slug, name, description?, color?, features?: [], sortOrder?, isActive? }
// ============================================================
router.post('/plans', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { slug, name, description, color, features, priceCents, currency, durationDays, isPurchasable, sortOrder, isActive } = req.body || {};
    if (!slug || !name) return res.status(400).json({ error: 'slug и name обязательны' });
    const cleanSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
    if (!cleanSlug) return res.status(400).json({ error: 'Неверный slug' });
    const feats = Array.isArray(features) ? features.filter((f) => typeof f === 'string') : [];
    await db.query(
      `INSERT INTO subscription_plans (slug, name, description, color, features, price_cents, currency, duration_days, is_purchasable, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cleanSlug, String(name).slice(0, 128), description || null,
       color || '#DF005B', JSON.stringify(feats),
       Math.max(0, parseInt(priceCents, 10) || 0),
       (currency || 'RUB').toUpperCase().slice(0, 8),
       Math.max(1, parseInt(durationDays, 10) || 30),
       isPurchasable ? 1 : 0,
       sortOrder || 0, isActive === false ? 0 : 1]
    );
    const row = await db.queryOne(
      `SELECT id, slug, name, description, color, features, price_cents AS priceCents,
              currency, duration_days AS durationDays, is_purchasable AS isPurchasable,
              sort_order AS sortOrder, is_active AS isActive
         FROM subscription_plans WHERE slug = ?`,
      [cleanSlug]
    );
    res.json({ success: true, plan: { ...row, features: parseFeatures(row.features) } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'План с таким slug уже существует' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// PUT /api/subscriptions/plans/:id — admin: edit plan
// ============================================================
router.put('/plans/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    const { name, description, color, features, priceCents, currency, durationDays, isPurchasable, sortOrder, isActive } = req.body || {};
    const feats = Array.isArray(features) ? features.filter((f) => typeof f === 'string') : [];
    await db.query(
      `UPDATE subscription_plans
          SET name = COALESCE(?, name),
              description = ?,
              color = COALESCE(?, color),
              features = ?,
              price_cents = COALESCE(?, price_cents),
              currency = COALESCE(?, currency),
              duration_days = COALESCE(?, duration_days),
              is_purchasable = COALESCE(?, is_purchasable),
              sort_order = COALESCE(?, sort_order),
              is_active = COALESCE(?, is_active)
        WHERE id = ?`,
      [name || null, description || null, color || null, JSON.stringify(feats),
       priceCents != null ? Math.max(0, parseInt(priceCents, 10) || 0) : null,
       currency ? String(currency).toUpperCase().slice(0, 8) : null,
       durationDays != null ? Math.max(1, parseInt(durationDays, 10) || 30) : null,
       isPurchasable != null ? (isPurchasable ? 1 : 0) : null,
       sortOrder != null ? sortOrder : null,
       isActive != null ? (isActive ? 1 : 0) : null,
       id]
    );
    const row = await db.queryOne(
      `SELECT id, slug, name, description, color, features, price_cents AS priceCents,
              currency, duration_days AS durationDays, is_purchasable AS isPurchasable,
              sort_order AS sortOrder, is_active AS isActive
         FROM subscription_plans WHERE id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'План не найден' });
    res.json({ success: true, plan: { ...row, features: parseFeatures(row.features) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// DELETE /api/subscriptions/plans/:id — admin
// ============================================================
router.delete('/plans/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    // Check if any active grants exist
    const used = await db.queryOne('SELECT COUNT(*) AS cnt FROM user_subscriptions WHERE plan_id = ?', [id]);
    if (used && used.cnt > 0) {
      return res.status(400).json({ error: 'План используется в подписках — деактивируйте его вместо удаления' });
    }
    await db.query('DELETE FROM subscription_plans WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/subscriptions/grants — admin: list all grants
// query: ?active=1, ?userId=X, ?search=email-or-name
// ============================================================
router.get('/grants', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { active, userId, search } = req.query;
    const where = [];
    const params = [];
    if (active === '1') {
      where.push('us.is_active = 1 AND us.expires_at > NOW()');
    } else if (active === '0') {
      where.push('(us.is_active = 0 OR us.expires_at <= NOW())');
    }
    if (userId) { where.push('us.user_id = ?'); params.push(parseInt(userId, 10)); }
    if (search) { where.push('(u.email LIKE ? OR u.username LIKE ?)'); params.push('%' + search + '%', '%' + search + '%'); }
    const sql = `
      SELECT us.id, us.user_id AS userId, us.plan_id AS planId,
             us.starts_at AS startsAt, us.expires_at AS expiresAt,
             us.is_active AS isActive, us.revoked_at AS revokedAt,
             us.granted_by AS grantedBy, us.notes, us.created_at AS createdAt,
             u.email AS userEmail, u.username AS userName,
             p.slug AS planSlug, p.name AS planName, p.color AS planColor
        FROM user_subscriptions us
        JOIN users u ON u.id = us.user_id
        JOIN subscription_plans p ON p.id = us.plan_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY us.expires_at DESC, us.id DESC
        LIMIT 500
    `;
    const rows = await db.query(sql, params);
    res.json({ success: true, grants: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/subscriptions/grants — admin: grant subscription
// body: { userId, planId, durationDays (7|14|30) OR expiresAt, notes? }
// ============================================================
router.post('/grants', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { userId, planId, durationDays, expiresAt, notes } = req.body || {};
    if (!userId || !planId) return res.status(400).json({ error: 'userId и planId обязательны' });

    const user = await db.queryOne('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

    const plan = await db.queryOne('SELECT id, is_active FROM subscription_plans WHERE id = ?', [planId]);
    if (!plan) return res.status(400).json({ error: 'План не найден' });
    if (!plan.is_active) return res.status(400).json({ error: 'План неактивен' });

    let expiresAtSql;
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'Неверная дата окончания' });
      expiresAtSql = d.toISOString().slice(0, 19).replace('T', ' ');
    } else {
      const days = parseInt(durationDays, 10);
      if (!DURATIONS[days]) {
        return res.status(400).json({ error: 'durationDays должен быть 7, 14 или 30 (или укажите expiresAt)' });
      }
      const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      expiresAtSql = d.toISOString().slice(0, 19).replace('T', ' ');
    }

    // Deactivate other active subscriptions for the same user (single-active policy)
    await db.query(
      'UPDATE user_subscriptions SET is_active = 0, revoked_at = NOW() WHERE user_id = ? AND is_active = 1',
      [userId]
    );

    await db.query(
      `INSERT INTO user_subscriptions (user_id, plan_id, expires_at, is_active, granted_by, notes)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [userId, planId, expiresAtSql, req.user.id, notes ? String(notes).slice(0, 255) : null]
    );

    const sub = await loadCurrentSubscription(userId);
    res.json({ success: true, subscription: sub });
  } catch (err) {
    console.error('[Subs] grant error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/subscriptions/grants/:id/extend — admin: add days
// body: { days: 7|14|30 }
// ============================================================
router.post('/grants/:id/extend', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    const days = parseInt(req.body && req.body.days, 10);
    if (!DURATIONS[days]) return res.status(400).json({ error: 'days должен быть 7, 14 или 30' });
    const row = await db.queryOne('SELECT id, user_id AS userId, expires_at AS expiresAt FROM user_subscriptions WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Подписка не найдена' });
    // Extend from current expiry or from now, whichever is later
    const base = Math.max(Date.now(), new Date(row.expiresAt).getTime());
    const next = new Date(base + days * 24 * 60 * 60 * 1000);
    const sql = next.toISOString().slice(0, 19).replace('T', ' ');
    await db.query(
      'UPDATE user_subscriptions SET expires_at = ?, is_active = 1, revoked_at = NULL WHERE id = ?',
      [sql, id]
    );
    const sub = await loadCurrentSubscription(row.userId);
    res.json({ success: true, subscription: sub });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// PUT /api/subscriptions/grants/:id — admin: toggle active or change expiry
// body: { isActive?, expiresAt?, notes? }
// ============================================================
router.put('/grants/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    const { isActive, expiresAt, notes } = req.body || {};
    const row = await db.queryOne('SELECT id, user_id AS userId FROM user_subscriptions WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Подписка не найдена' });

    let expiresAtSql = null;
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'Неверная дата' });
      expiresAtSql = d.toISOString().slice(0, 19).replace('T', ' ');
    }
    await db.query(
      `UPDATE user_subscriptions
          SET is_active = COALESCE(?, is_active),
              expires_at = COALESCE(?, expires_at),
              notes = COALESCE(?, notes),
              revoked_at = CASE WHEN ? = 0 THEN NOW() ELSE revoked_at END
        WHERE id = ?`,
      [
        isActive != null ? (isActive ? 1 : 0) : null,
        expiresAtSql,
        notes !== undefined ? (notes ? String(notes).slice(0, 255) : null) : null,
        isActive != null ? (isActive ? 1 : 0) : 1,
        id,
      ]
    );
    const sub = await loadCurrentSubscription(row.userId);
    res.json({ success: true, subscription: sub });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// DELETE /api/subscriptions/grants/:id — admin: revoke (soft)
// ============================================================
router.delete('/grants/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    await db.query(
      'UPDATE user_subscriptions SET is_active = 0, revoked_at = NOW() WHERE id = ?',
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// Внутренний хелпер: выдать подписку (используется и админкой, и платежами)
// Возвращает id новой записи user_subscriptions.
// ============================================================
async function grantSubscription({ userId, planId, durationDays, expiresAt, grantedBy, notes }) {
  let expiresAtSql;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (isNaN(d.getTime())) throw new Error('Неверная дата окончания');
    expiresAtSql = d.toISOString().slice(0, 19).replace('T', ' ');
  } else {
    const days = Math.max(1, parseInt(durationDays, 10) || 30);
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    expiresAtSql = d.toISOString().slice(0, 19).replace('T', ' ');
  }
  // Single-active: отзываем старые
  await db.query(
    'UPDATE user_subscriptions SET is_active = 0, revoked_at = NOW() WHERE user_id = ? AND is_active = 1',
    [userId]
  );
  const result = await db.query(
    `INSERT INTO user_subscriptions (user_id, plan_id, expires_at, is_active, granted_by, notes)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [userId, planId, expiresAtSql, grantedBy || null, notes ? String(notes).slice(0, 255) : null]
  );
  return result.insertId;
}

module.exports = router;
module.exports.loadCurrentSubscription = loadCurrentSubscription;
module.exports.grantSubscription = grantSubscription;
module.exports.KNOWN_FEATURES = KNOWN_FEATURES;
