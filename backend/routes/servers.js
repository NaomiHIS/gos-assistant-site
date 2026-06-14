const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/servers — list active servers (public for app)
router.get('/', async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT id, name, color, icon, description FROM servers WHERE is_active = 1 ORDER BY sort_order, name'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/servers/all — admin only (includes inactive)
router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  const rows = await db.query('SELECT * FROM servers ORDER BY sort_order, name');
  res.json(rows);
});

// POST /api/servers — admin
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id, name, color, icon, description, sort_order, is_active } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    await db.query(
      'INSERT INTO servers (id, name, color, icon, description, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, color || '#DF005B', icon || 'GS', description || null, sort_order || 0, is_active !== false ? 1 : 0]
    );
    const row = await db.queryOne('SELECT * FROM servers WHERE id = ?', [id]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/servers/:id — admin
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, color, icon, description, sort_order, is_active } = req.body;
    await db.query(
      'UPDATE servers SET name = ?, color = ?, icon = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?',
      [name, color, icon, description || null, sort_order || 0, is_active ? 1 : 0, req.params.id]
    );
    const row = await db.queryOne('SELECT * FROM servers WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/servers/:id — admin
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM servers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
