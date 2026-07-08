const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { extendOrGrantBySlug } = require('./subscriptions');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(len = 8) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

// Нормализация кода: uppercase, убираем пробелы/дефисы (юзер может ввести "abc-def")
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================================
// POST /api/promo/redeem — активировать промокод
// body: { code }
// ============================================================
router.post('/redeem', requireAuth, async (req, res) => {
  try {
    const code = normalizeCode(req.body && req.body.code);
    if (!code || code.length < 3) {
      return res.status(400).json({ success: false, error: 'Введите промокод' });
    }

    const promo = await db.queryOne(
      `SELECT p.id, p.code, p.plan_id AS planId, p.duration_days AS durationDays,
              p.max_uses AS maxUses, p.uses_count AS usesCount,
              p.starts_at AS startsAt, p.expires_at AS expiresAt, p.is_active AS isActive,
              sp.slug AS planSlug, sp.name AS planName
         FROM promo_codes p
         JOIN subscription_plans sp ON sp.id = p.plan_id
        WHERE p.code = ?`,
      [code]
    );
    if (!promo) return res.status(404).json({ success: false, error: 'Промокод не найден' });
    if (!promo.isActive) return res.status(400).json({ success: false, error: 'Промокод отключён' });

    const now = new Date();
    if (promo.startsAt && new Date(promo.startsAt) > now) {
      return res.status(400).json({ success: false, error: 'Промокод ещё не активен' });
    }
    if (promo.expiresAt && new Date(promo.expiresAt) < now) {
      return res.status(400).json({ success: false, error: 'Срок действия промокода истёк' });
    }
    if (promo.maxUses != null && promo.usesCount >= promo.maxUses) {
      return res.status(400).json({ success: false, error: 'Все использования промокода исчерпаны' });
    }

    // Проверяем что юзер ещё не активировал этот код
    const already = await db.queryOne(
      'SELECT id FROM promo_redemptions WHERE promo_code_id = ? AND user_id = ?',
      [promo.id, req.user.id]
    );
    if (already) {
      return res.status(400).json({ success: false, error: 'Вы уже активировали этот промокод' });
    }

    // Выдаём подписку. extendOrGrantBySlug стекает если план тот же,
    // иначе создаёт новую (отзывая старую).
    const grantedId = await extendOrGrantBySlug({
      userId: req.user.id,
      planSlug: promo.planSlug,
      days: promo.durationDays,
      grantedBy: null, // системная выдача
      notes: `Promo: ${promo.code}`,
    });

    // Регистрируем активацию + инкремент. UNIQUE защищает от гонки.
    try {
      await db.query(
        'INSERT INTO promo_redemptions (promo_code_id, user_id, granted_subscription_id) VALUES (?, ?, ?)',
        [promo.id, req.user.id, grantedId || null]
      );
      await db.query('UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = ?', [promo.id]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ success: false, error: 'Вы уже активировали этот промокод' });
      }
      throw err;
    }

    // Отдаём информацию о выданной подписке для UI
    const sub = await db.queryOne(
      `SELECT us.id, us.expires_at AS expiresAt, sp.slug AS planSlug, sp.name AS planName, sp.color AS planColor
         FROM user_subscriptions us JOIN subscription_plans sp ON sp.id = us.plan_id
        WHERE us.user_id = ? AND us.is_active = 1
        ORDER BY us.expires_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({
      success: true,
      subscription: sub || null,
      grantedDays: promo.durationDays,
      planName: promo.planName,
    });
  } catch (err) {
    console.error('[Promo] redeem error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// Admin CRUD
// ============================================================

// GET /api/promo — список всех промокодов
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT p.id, p.code, p.plan_id AS planId, sp.name AS planName, sp.slug AS planSlug,
              p.duration_days AS durationDays, p.max_uses AS maxUses, p.uses_count AS usesCount,
              p.starts_at AS startsAt, p.expires_at AS expiresAt, p.is_active AS isActive,
              p.notes, p.created_at AS createdAt
         FROM promo_codes p
         JOIN subscription_plans sp ON sp.id = p.plan_id
        ORDER BY p.created_at DESC`
    );
    res.json({ success: true, promos: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/promo — создать
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { code, planId, durationDays, maxUses, startsAt, expiresAt, isActive, notes } = req.body || {};
    let finalCode = normalizeCode(code);
    if (!finalCode) finalCode = generateCode(8);
    if (!planId) return res.status(400).json({ error: 'planId обязателен' });
    const days = parseInt(durationDays, 10);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return res.status(400).json({ error: 'durationDays должен быть от 1 до 3650' });
    }
    const plan = await db.queryOne('SELECT id FROM subscription_plans WHERE id = ?', [planId]);
    if (!plan) return res.status(400).json({ error: 'План не найден' });
    const startsSql = toDate(startsAt) ? toDate(startsAt).toISOString().slice(0, 19).replace('T', ' ') : null;
    const expiresSql = toDate(expiresAt) ? toDate(expiresAt).toISOString().slice(0, 19).replace('T', ' ') : null;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await db.query(
          `INSERT INTO promo_codes (code, plan_id, duration_days, max_uses, starts_at, expires_at, is_active, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [finalCode, planId, days, maxUses ? parseInt(maxUses, 10) : null, startsSql, expiresSql,
            isActive === false ? 0 : 1, notes ? String(notes).slice(0, 500) : null, req.user.id]
        );
        return res.json({ success: true, id: r.insertId, code: finalCode });
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        if (code) return res.status(409).json({ error: 'Такой код уже существует' });
        finalCode = generateCode(8); // auto-generated — пробуем другой
      }
    }
    res.status(500).json({ error: 'Не удалось сгенерировать уникальный код' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/promo/:id — редактировать (нельзя менять code и plan_id — они влияют на UNIQUE и логику)
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { durationDays, maxUses, startsAt, expiresAt, isActive, notes } = req.body || {};
    const fields = [];
    const params = [];
    if (durationDays !== undefined) {
      const d = parseInt(durationDays, 10);
      if (!Number.isFinite(d) || d <= 0) return res.status(400).json({ error: 'Некорректный durationDays' });
      fields.push('duration_days = ?'); params.push(d);
    }
    if (maxUses !== undefined) { fields.push('max_uses = ?'); params.push(maxUses ? parseInt(maxUses, 10) : null); }
    if (startsAt !== undefined) {
      const d = toDate(startsAt);
      fields.push('starts_at = ?'); params.push(d ? d.toISOString().slice(0, 19).replace('T', ' ') : null);
    }
    if (expiresAt !== undefined) {
      const d = toDate(expiresAt);
      fields.push('expires_at = ?'); params.push(d ? d.toISOString().slice(0, 19).replace('T', ' ') : null);
    }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive ? 1 : 0); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes ? String(notes).slice(0, 500) : null); }
    if (!fields.length) return res.json({ success: true });
    params.push(req.params.id);
    await db.query(`UPDATE promo_codes SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/promo/:id
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM promo_redemptions WHERE promo_code_id = ?', [req.params.id]);
    await db.query('DELETE FROM promo_codes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/promo/:id/redemptions — история активаций
router.get('/:id/redemptions', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT r.id, r.user_id AS userId, u.email, u.username, r.redeemed_at AS redeemedAt
         FROM promo_redemptions r
         JOIN users u ON u.id = r.user_id
        WHERE r.promo_code_id = ?
        ORDER BY r.redeemed_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, redemptions: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
