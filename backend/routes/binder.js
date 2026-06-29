const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loadCurrentSubscription } = require('./subscriptions');

const FEATURE_KEY = 'binder_share';

// Тот же алфавит, что и у заметок — визуально различимые символы
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(len = 8) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

function parseSnapshot(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

const STEP_TYPES = new Set(['text', 'key', 'combo', 'delay']);
const MAX_MACROS = 200;
const MAX_STEPS_PER_MACRO = 50;

function cleanStep(s) {
  if (!s || typeof s !== 'object') return null;
  const type = STEP_TYPES.has(s.type) ? s.type : null;
  if (!type) return null;
  const out = { type };
  if (type === 'text') {
    out.value = String(s.value || '').slice(0, 500);
    out.enter = !!s.enter;
  } else if (type === 'key') {
    out.key = String(s.key || '').slice(0, 32);
    if (!out.key) return null;
  } else if (type === 'combo') {
    const mods = Array.isArray(s.modifiers) ? s.modifiers : [];
    out.modifiers = mods
      .map((m) => String(m).toLowerCase())
      .filter((m) => ['ctrl', 'shift', 'alt', 'meta'].includes(m))
      .slice(0, 4);
    out.key = String(s.key || '').slice(0, 32);
    if (!out.key) return null;
  } else if (type === 'delay') {
    const ms = parseInt(s.ms, 10);
    if (!Number.isFinite(ms) || ms < 0) return null;
    out.ms = Math.min(ms, 60000); // максимум 60 секунд паузы
  }
  return out;
}

function cleanMacro(m) {
  if (!m || typeof m !== 'object') return null;
  const steps = Array.isArray(m.steps)
    ? m.steps.slice(0, MAX_STEPS_PER_MACRO).map(cleanStep).filter(Boolean)
    : [];
  return {
    id: m.id ? String(m.id).slice(0, 64) : null,
    name: m.name ? String(m.name).slice(0, 100) : '',
    hotkey: m.hotkey ? String(m.hotkey).slice(0, 64) : null,
    enabled: m.enabled !== false,
    steps,
    createdAt: m.createdAt ? String(m.createdAt).slice(0, 32) : null,
    updatedAt: m.updatedAt ? String(m.updatedAt).slice(0, 32) : null,
  };
}

async function hasShareFeature(userId) {
  const sub = await loadCurrentSubscription(userId);
  return !!(sub && Array.isArray(sub.plan.features) && sub.plan.features.includes(FEATURE_KEY));
}

async function requireShareFeature(req, res, next) {
  try {
    if (!(await hasShareFeature(req.user.id))) {
      return res.status(403).json({
        success: false,
        error: 'Поделиться биндером можно только с подпиской Lite или Premium.',
        code: 'BINDER_SHARE_REQUIRED',
        feature: FEATURE_KEY,
      });
    }
    next();
  } catch (err) {
    console.error('[Binder] subscription check error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function ensureMyShare(userId) {
  const existing = await db.queryOne(
    'SELECT user_id AS userId, code, snapshot, macros_count AS macrosCount, updated_at AS updatedAt FROM binder_shares WHERE user_id = ?',
    [userId]
  );
  if (existing) return { ...existing, snapshot: parseSnapshot(existing.snapshot) };

  for (let i = 0; i < 5; i++) {
    const code = generateCode(8);
    try {
      await db.query(
        'INSERT INTO binder_shares (user_id, code, snapshot, macros_count) VALUES (?, ?, ?, 0)',
        [userId, code, '[]']
      );
      return { userId, code, snapshot: [], macrosCount: 0, updatedAt: new Date() };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('Не удалось сгенерировать уникальный код');
}

// ============================================================
// GET /api/binder/share — статус фичи + (если есть) мой код
// Юзеры без фичи получают { hasFeature: false }, чтобы UI скрыл share.
// ============================================================
router.get('/share', requireAuth, async (req, res) => {
  try {
    const hasFeature = await hasShareFeature(req.user.id);
    if (!hasFeature) {
      return res.json({ success: true, hasFeature: false, feature: FEATURE_KEY });
    }
    const share = await ensureMyShare(req.user.id);
    res.json({
      success: true,
      hasFeature: true,
      code: share.code,
      macrosCount: share.macrosCount || 0,
      updatedAt: share.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// PUT /api/binder/share/snapshot — обновить снимок (вызывает app debounced)
// body: { macros: [{id, name, hotkey, enabled, steps[]}, ...] }
// ============================================================
router.put('/share/snapshot', requireAuth, requireShareFeature, async (req, res) => {
  try {
    const { macros } = req.body || {};
    if (!Array.isArray(macros)) return res.status(400).json({ success: false, error: 'macros должен быть массивом' });
    if (macros.length > MAX_MACROS) return res.status(400).json({ success: false, error: 'Слишком много макросов' });

    const cleaned = macros
      .slice(0, MAX_MACROS)
      .map(cleanMacro)
      .filter((m) => m && (m.name || m.steps.length));

    const share = await ensureMyShare(req.user.id);
    await db.query(
      'UPDATE binder_shares SET snapshot = ?, macros_count = ? WHERE user_id = ?',
      [JSON.stringify(cleaned), cleaned.length, req.user.id]
    );
    res.json({ success: true, code: share.code, macrosCount: cleaned.length });
  } catch (err) {
    console.error('[Binder] snapshot error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/binder/share/regenerate — новый код
// ============================================================
router.post('/share/regenerate', requireAuth, requireShareFeature, async (req, res) => {
  try {
    await ensureMyShare(req.user.id);
    for (let i = 0; i < 5; i++) {
      const code = generateCode(8);
      try {
        await db.query('UPDATE binder_shares SET code = ? WHERE user_id = ?', [code, req.user.id]);
        return res.json({ success: true, code });
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    res.status(500).json({ success: false, error: 'Не удалось сгенерировать код' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/binder/share/lookup/:code — получить чужой биндер
// Импорт доступен любому юзеру; делиться может только с подпиской.
// ============================================================
router.get('/share/lookup/:code', requireAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!code || code.length < 4) return res.status(400).json({ success: false, error: 'Неверный код' });

    const row = await db.queryOne(
      `SELECT bs.user_id AS userId, bs.code, bs.snapshot, bs.macros_count AS macrosCount, bs.updated_at AS updatedAt,
              u.username AS ownerName
         FROM binder_shares bs
         JOIN users u ON u.id = bs.user_id
        WHERE bs.code = ?`,
      [code]
    );
    if (!row) return res.status(404).json({ success: false, error: 'Код не найден' });
    if (row.userId === req.user.id) {
      return res.status(400).json({ success: false, error: 'Это ваш собственный код — биндер уже у вас' });
    }

    const macros = parseSnapshot(row.snapshot);
    res.json({
      success: true,
      ownerName: row.ownerName,
      macrosCount: row.macrosCount || macros.length,
      macros,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
