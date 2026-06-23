const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', async (req, res) => {
  const rows = await db.query(
    'SELECT id, name, short_name AS shortName, color, type FROM categories WHERE is_active = 1 ORDER BY sort_order, name'
  );
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
  res.json(rows);
});

router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  const rows = await db.query('SELECT * FROM categories ORDER BY sort_order, name');
  res.json(rows);
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id, name, short_name, color, type, sort_order, is_active } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    await db.query(
      'INSERT INTO categories (id, name, short_name, color, type, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, short_name || name, color || '#DF005B', type || 'laws', sort_order || 0, is_active !== false ? 1 : 0]
    );
    const row = await db.queryOne('SELECT * FROM categories WHERE id = ?', [id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, short_name, color, type, sort_order, is_active } = req.body;
    await db.query(
      'UPDATE categories SET name = ?, short_name = ?, color = ?, type = ?, sort_order = ?, is_active = ? WHERE id = ?',
      [name, short_name, color, type, sort_order || 0, is_active ? 1 : 0, req.params.id]
    );
    const row = await db.queryOne('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
