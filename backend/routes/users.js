const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const rows = await db.query(
    'SELECT id, email, username, role, avatar_url, discord_id, last_login, created_at FROM users ORDER BY created_at DESC LIMIT 200'
  );
  res.json(rows);
});

router.put('/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin', 'moderator'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  if (parseInt(req.params.id, 10) === req.user.id) {
    return res.status(400).json({ error: 'Нельзя удалить себя' });
  }
  await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
