const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const TYPES = ['question', 'suggestion', 'bug'];
const STATUSES = ['open', 'in_progress', 'answered', 'closed'];

// ============================================================
// Helpers
// ============================================================
async function loadTicketWithMessages(ticketId, requesterUserId, isAdmin) {
  const ticket = await db.queryOne(
    `SELECT t.id, t.user_id AS userId, t.type, t.subject, t.status, t.source,
            t.app_version AS appVersion, t.created_at AS createdAt, t.updated_at AS updatedAt,
            t.unread_for_user AS unreadForUser, t.unread_for_admin AS unreadForAdmin,
            u.email AS userEmail, u.username AS userName
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
      WHERE t.id = ?`,
    [ticketId]
  );
  if (!ticket) return null;
  if (!isAdmin && ticket.userId !== requesterUserId) return 'forbidden';

  const messages = await db.query(
    `SELECT m.id, m.author_id AS authorId, m.is_admin AS isAdmin, m.body, m.created_at AS createdAt,
            u.username AS authorName
       FROM support_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = ?
      ORDER BY m.created_at ASC, m.id ASC`,
    [ticketId]
  );

  // Mark as read for the side that's viewing it
  if (isAdmin && ticket.unreadForAdmin) {
    await db.query('UPDATE support_tickets SET unread_for_admin = 0 WHERE id = ?', [ticketId]);
    ticket.unreadForAdmin = 0;
  } else if (!isAdmin && ticket.unreadForUser) {
    await db.query('UPDATE support_tickets SET unread_for_user = 0 WHERE id = ?', [ticketId]);
    ticket.unreadForUser = 0;
  }

  return { ...ticket, messages };
}

function sanitizeBody(s) {
  return String(s || '').trim().slice(0, 5000);
}

// ============================================================
// POST /api/support/tickets — create new ticket
// body: { type, subject, body, source?, appVersion? }
// ============================================================
router.post('/tickets', requireAuth, async (req, res) => {
  try {
    const { type, subject, body, source, appVersion } = req.body || {};
    if (!TYPES.includes(type)) {
      return res.status(400).json({ error: 'Неверный тип. Допустимо: ' + TYPES.join(', ') });
    }
    const subj = String(subject || '').trim().slice(0, 255);
    if (!subj) return res.status(400).json({ error: 'Укажите тему' });
    const text = sanitizeBody(body);
    if (!text) return res.status(400).json({ error: 'Опишите проблему или предложение' });

    const src = source === 'app' ? 'app' : 'site';
    const ver = appVersion ? String(appVersion).slice(0, 32) : null;

    const result = await db.query(
      `INSERT INTO support_tickets (user_id, type, subject, status, source, app_version, unread_for_admin)
       VALUES (?, ?, ?, 'open', ?, ?, 1)`,
      [req.user.id, type, subj, src, ver]
    );
    const ticketId = result.insertId;

    await db.query(
      `INSERT INTO support_messages (ticket_id, author_id, is_admin, body)
       VALUES (?, ?, 0, ?)`,
      [ticketId, req.user.id, text]
    );

    const data = await loadTicketWithMessages(ticketId, req.user.id, false);
    res.json({ success: true, ticket: data });
  } catch (err) {
    console.error('[Support] create error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/support/tickets/mine — current user's tickets
// ============================================================
router.get('/tickets/mine', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, type, subject, status, source, created_at AS createdAt, updated_at AS updatedAt,
              unread_for_user AS unreadForUser
         FROM support_tickets
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC`,
      [req.user.id]
    );
    res.json({ success: true, tickets: rows });
  } catch (err) {
    console.error('[Support] mine error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/support/tickets/all — admin only
// query: ?status=open&type=bug&search=...&unread=1
// ============================================================
router.get('/tickets/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status, type, search, unread } = req.query;
    const where = [];
    const params = [];
    if (status && STATUSES.includes(status)) { where.push('t.status = ?'); params.push(status); }
    if (type && TYPES.includes(type)) { where.push('t.type = ?'); params.push(type); }
    if (search) { where.push('(t.subject LIKE ? OR u.email LIKE ?)'); params.push('%' + search + '%', '%' + search + '%'); }
    if (unread === '1') { where.push('t.unread_for_admin = 1'); }
    const sql = `
      SELECT t.id, t.type, t.subject, t.status, t.source, t.app_version AS appVersion,
             t.created_at AS createdAt, t.updated_at AS updatedAt,
             t.unread_for_admin AS unreadForAdmin,
             t.user_id AS userId, u.email AS userEmail, u.username AS userName, u.role AS userRole
        FROM support_tickets t
        LEFT JOIN users u ON u.id = t.user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY t.updated_at DESC, t.id DESC
        LIMIT 500
    `;
    const rows = await db.query(sql, params);
    res.json({ success: true, tickets: rows });
  } catch (err) {
    console.error('[Support] all error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/support/tickets/:id — single ticket with messages
// User can only read own; admin can read any
// ============================================================
router.get('/tickets/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    const isAdmin = req.user.role === 'admin' || req.user.role === 'moderator';
    const data = await loadTicketWithMessages(id, req.user.id, isAdmin);
    if (!data) return res.status(404).json({ error: 'Тикет не найден' });
    if (data === 'forbidden') return res.status(403).json({ error: 'Нет доступа' });
    res.json({ success: true, ticket: data });
  } catch (err) {
    console.error('[Support] get error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/support/tickets/:id/messages — reply
// body: { body }
// ============================================================
router.post('/tickets/:id/messages', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    const text = sanitizeBody(req.body && req.body.body);
    if (!text) return res.status(400).json({ error: 'Сообщение пустое' });

    const ticket = await db.queryOne(
      'SELECT id, user_id AS userId, status FROM support_tickets WHERE id = ?',
      [id]
    );
    if (!ticket) return res.status(404).json({ error: 'Тикет не найден' });

    const isAdmin = req.user.role === 'admin' || req.user.role === 'moderator';
    if (!isAdmin && ticket.userId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ error: 'Тикет закрыт' });
    }

    await db.query(
      `INSERT INTO support_messages (ticket_id, author_id, is_admin, body)
       VALUES (?, ?, ?, ?)`,
      [id, req.user.id, isAdmin ? 1 : 0, text]
    );

    // Update unread flags and status
    if (isAdmin) {
      await db.query(
        `UPDATE support_tickets
            SET unread_for_user = 1, unread_for_admin = 0,
                status = CASE WHEN status IN ('open', 'in_progress') THEN 'answered' ELSE status END,
                updated_at = NOW()
          WHERE id = ?`,
        [id]
      );
    } else {
      await db.query(
        `UPDATE support_tickets
            SET unread_for_admin = 1, unread_for_user = 0,
                status = CASE WHEN status = 'answered' THEN 'in_progress' ELSE status END,
                updated_at = NOW()
          WHERE id = ?`,
        [id]
      );
    }

    const data = await loadTicketWithMessages(id, req.user.id, isAdmin);
    res.json({ success: true, ticket: data });
  } catch (err) {
    console.error('[Support] reply error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// PUT /api/support/tickets/:id/status — admin only
// body: { status }
// ============================================================
router.put('/tickets/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Неверный статус' });
    }
    const result = await db.query(
      'UPDATE support_tickets SET status = ?, updated_at = NOW() WHERE id = ?',
      [status, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Тикет не найден' });
    const data = await loadTicketWithMessages(id, req.user.id, true);
    res.json({ success: true, ticket: data });
  } catch (err) {
    console.error('[Support] status error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/support/unread-count — for badges
// User: count of own tickets with unread_for_user=1
// Admin: count of tickets with unread_for_admin=1
// ============================================================
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'moderator';
    let count = 0;
    if (isAdmin) {
      const row = await db.queryOne(
        'SELECT COUNT(*) AS cnt FROM support_tickets WHERE unread_for_admin = 1'
      );
      count = row ? row.cnt : 0;
    } else {
      const row = await db.queryOne(
        'SELECT COUNT(*) AS cnt FROM support_tickets WHERE user_id = ? AND unread_for_user = 1',
        [req.user.id]
      );
      count = row ? row.cnt : 0;
    }
    res.json({ success: true, count, isAdmin });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, count: 0 });
  }
});

module.exports = router;
