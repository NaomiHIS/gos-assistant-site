// ============================================================
// Notifications: админ отправляет уведомления всем или конкретному юзеру.
// Клиенты (сайт + Electron-приложение) поллят GET /notifications/mine.
// ============================================================
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const KIND_VALUES = new Set(['info', 'promo', 'sale', 'warning']);
const AUDIENCE_VALUES = new Set(['all', 'user']);

function mapNotification(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: row.kind,
    audience: row.audience,
    targetUserId: row.target_user_id,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    isActive: !!row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// GET /api/notifications/mine (auth) — активные уведомления для этого юзера
// Query: ?includeDismissed=1 — вернуть и скрытые (для показа в истории)
// ============================================================
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const includeDismissed = String(req.query.includeDismissed || '') === '1';
    const rows = await db.query(
      `SELECT n.*, r.read_at, r.dismissed_at
         FROM notifications n
         LEFT JOIN notification_reads r
                ON r.notification_id = n.id AND r.user_id = ?
        WHERE n.is_active = 1
          AND (n.starts_at IS NULL OR n.starts_at <= NOW())
          AND (n.expires_at IS NULL OR n.expires_at >= NOW())
          AND (n.audience = 'all' OR (n.audience = 'user' AND n.target_user_id = ?))
          ${includeDismissed ? '' : "AND (r.dismissed_at IS NULL)"}
        ORDER BY n.created_at DESC
        LIMIT 100`,
      [req.user.id, req.user.id]
    );
    const items = rows.map((r) => ({
      ...mapNotification(r),
      isRead: !!r.read_at,
      isDismissed: !!r.dismissed_at,
      readAt: r.read_at,
      dismissedAt: r.dismissed_at,
    }));
    const unread = items.filter((i) => !i.isRead && !i.isDismissed).length;
    res.json({ success: true, notifications: items, unread });
  } catch (err) {
    console.error('[Notifications] /mine error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/notifications/:id/read (auth) — отметить прочитанным
// ============================================================
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    await db.query(
      `INSERT INTO notification_reads (notification_id, user_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE read_at = CURRENT_TIMESTAMP`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/notifications/:id/dismiss (auth) — скрыть уведомление
// ============================================================
router.post('/:id/dismiss', requireAuth, async (req, res) => {
  try {
    await db.query(
      `INSERT INTO notification_reads (notification_id, user_id, dismissed_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE dismissed_at = CURRENT_TIMESTAMP`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// Admin: CRUD + статистика
// ============================================================
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT n.*,
              u.username AS targetUsername,
              u.email    AS targetEmail,
              c.username AS creatorUsername,
              (SELECT COUNT(*) FROM notification_reads r WHERE r.notification_id = n.id AND r.read_at IS NOT NULL)      AS readsCount,
              (SELECT COUNT(*) FROM notification_reads r WHERE r.notification_id = n.id AND r.dismissed_at IS NOT NULL) AS dismissedCount
         FROM notifications n
         LEFT JOIN users u ON u.id = n.target_user_id
         LEFT JOIN users c ON c.id = n.created_by
        ORDER BY n.created_at DESC
        LIMIT 500`
    );
    res.json({
      success: true,
      notifications: rows.map((r) => ({
        ...mapNotification(r),
        targetUsername: r.targetUsername,
        targetEmail: r.targetEmail,
        creatorUsername: r.creatorUsername,
        readsCount: Number(r.readsCount || 0),
        dismissedCount: Number(r.dismissedCount || 0),
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function validatePayload(b) {
  const title = String((b && b.title) || '').trim().slice(0, 255);
  if (!title) return { error: 'Заголовок обязателен' };
  const body = String((b && b.body) || '').slice(0, 4000) || null;
  const kind = KIND_VALUES.has(b && b.kind) ? b.kind : 'info';
  const audience = AUDIENCE_VALUES.has(b && b.audience) ? b.audience : 'all';
  let targetUserId = null;
  if (audience === 'user') {
    targetUserId = parseInt(b && b.targetUserId, 10);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return { error: 'Для audience=user нужен targetUserId' };
    }
  }
  const ctaLabel = String((b && b.ctaLabel) || '').trim().slice(0, 64) || null;
  const ctaUrl = String((b && b.ctaUrl) || '').trim().slice(0, 500) || null;
  const startsAt = (b && b.startsAt) ? new Date(b.startsAt) : null;
  const expiresAt = (b && b.expiresAt) ? new Date(b.expiresAt) : null;
  if (startsAt && isNaN(startsAt.getTime())) return { error: 'startsAt: неверная дата' };
  if (expiresAt && isNaN(expiresAt.getTime())) return { error: 'expiresAt: неверная дата' };
  const isActive = b && b.isActive != null ? !!b.isActive : true;
  return {
    payload: { title, body, kind, audience, targetUserId, ctaLabel, ctaUrl, startsAt, expiresAt, isActive },
  };
}

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const v = validatePayload(req.body || {});
    if (v.error) return res.status(400).json({ success: false, error: v.error });
    const p = v.payload;
    const result = await db.query(
      `INSERT INTO notifications
         (title, body, kind, audience, target_user_id, cta_label, cta_url, starts_at, expires_at, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.title, p.body, p.kind, p.audience, p.targetUserId, p.ctaLabel, p.ctaUrl,
       p.startsAt, p.expiresAt, p.isActive ? 1 : 0, req.user.id]
    );
    const row = await db.queryOne('SELECT * FROM notifications WHERE id = ?', [result.insertId]);
    res.json({ success: true, notification: mapNotification(row) });
  } catch (err) {
    console.error('[Notifications] create error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const v = validatePayload(req.body || {});
    if (v.error) return res.status(400).json({ success: false, error: v.error });
    const p = v.payload;
    await db.query(
      `UPDATE notifications
          SET title = ?, body = ?, kind = ?, audience = ?, target_user_id = ?,
              cta_label = ?, cta_url = ?, starts_at = ?, expires_at = ?, is_active = ?
        WHERE id = ?`,
      [p.title, p.body, p.kind, p.audience, p.targetUserId, p.ctaLabel, p.ctaUrl,
       p.startsAt, p.expiresAt, p.isActive ? 1 : 0, req.params.id]
    );
    const row = await db.queryOne('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ success: false, error: 'Уведомление не найдено' });
    res.json({ success: true, notification: mapNotification(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM notification_reads WHERE notification_id = ?', [req.params.id]);
    await db.query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
