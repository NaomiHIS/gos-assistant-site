const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ============================================================
// Helpers
// ============================================================
async function loadState() {
  const row = await db.queryOne(
    `SELECT enabled, message, starts_at AS startsAt, ends_at AS endsAt,
            updated_by AS updatedBy, updated_at AS updatedAt
       FROM maintenance WHERE id = 1`
  );
  if (!row) {
    return { active: false, enabled: false, message: null, startsAt: null, endsAt: null, updatedAt: null };
  }
  const now = Date.now();
  const endsAtMs = row.endsAt ? new Date(row.endsAt).getTime() : null;
  // Auto-expire: if endsAt is in the past, treat as inactive
  const expired = endsAtMs && endsAtMs < now;
  const active = Boolean(row.enabled) && !expired;
  return {
    active,
    enabled: Boolean(row.enabled),
    expired: Boolean(expired),
    message: row.message,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

// ============================================================
// GET /api/maintenance — public, used by app to know status
// ============================================================
router.get('/', async (req, res) => {
  try {
    const state = await loadState();
    res.json({ success: true, ...state });
  } catch (err) {
    console.error('[Maintenance] GET error:', err);
    res.status(500).json({ success: false, error: err.message, active: false });
  }
});

// ============================================================
// PUT /api/maintenance — admin only, update state
// body: { enabled: bool, message?: string, endsAt?: ISO-string|null }
// ============================================================
router.put('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { enabled, message, endsAt, startsAt } = req.body || {};

    let endsAtSql = null;
    if (endsAt) {
      const d = new Date(endsAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'endsAt должен быть валидной датой' });
      }
      endsAtSql = d.toISOString().slice(0, 19).replace('T', ' ');
    }

    let startsAtSql = null;
    if (startsAt) {
      const d = new Date(startsAt);
      if (!isNaN(d.getTime())) {
        startsAtSql = d.toISOString().slice(0, 19).replace('T', ' ');
      }
    } else if (enabled) {
      // If enabling without explicit start, mark "now" as start
      startsAtSql = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    const msg = (typeof message === 'string' ? message : '').slice(0, 1000) || null;
    const enabledInt = enabled ? 1 : 0;
    const updatedBy = req.user?.id || null;

    // Use upsert so a missing row (e.g. if the seed INSERT IGNORE never ran)
    // is created instead of silently affecting 0 rows.
    await db.query(
      `INSERT INTO maintenance (id, enabled, message, starts_at, ends_at, updated_by)
       VALUES (1, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         message = VALUES(message),
         starts_at = VALUES(starts_at),
         ends_at = VALUES(ends_at),
         updated_by = VALUES(updated_by)`,
      [enabledInt, msg, startsAtSql, endsAtSql, updatedBy]
    );

    const state = await loadState();
    res.json({ success: true, ...state });
  } catch (err) {
    console.error('[Maintenance] PUT error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
