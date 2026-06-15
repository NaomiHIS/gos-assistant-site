const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

function mapLink(r) {
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    description: r.description,
    icon: r.icon,
    color: r.color || '#DF005B',
    sortOrder: r.sort_order,
    isActive: !!r.is_active,
    clickCount: r.click_count,
  };
}

// GET /api/donate — public, list active links
router.get('/', async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT * FROM donate_links WHERE is_active = 1 ORDER BY sort_order, id'
    );
    res.json({ success: true, links: rows.map(mapLink) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/donate/all — admin, list all (including inactive)
router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM donate_links ORDER BY sort_order, id');
    res.json({ success: true, links: rows.map(mapLink) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/donate — admin, create
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { title, url, description, icon, color, sortOrder, isActive } = req.body || {};
    if (!title || !url) return res.status(400).json({ error: 'title и url обязательны' });
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL должен начинаться с http:// или https://' });

    const result = await db.query(
      `INSERT INTO donate_links (title, url, description, icon, color, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title.slice(0, 255),
        url.slice(0, 500),
        (description || '').slice(0, 500) || null,
        (icon || '').slice(0, 50) || null,
        color || '#DF005B',
        parseInt(sortOrder || 0, 10),
        isActive === false ? 0 : 1,
      ]
    );
    const row = await db.queryOne('SELECT * FROM donate_links WHERE id = ?', [result.insertId]);
    res.json({ success: true, link: mapLink(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/donate/:id — admin, update
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { title, url, description, icon, color, sortOrder, isActive } = req.body || {};
    if (!title || !url) return res.status(400).json({ error: 'title и url обязательны' });
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL должен начинаться с http:// или https://' });

    await db.query(
      `UPDATE donate_links
       SET title = ?, url = ?, description = ?, icon = ?, color = ?, sort_order = ?, is_active = ?
       WHERE id = ?`,
      [
        title.slice(0, 255),
        url.slice(0, 500),
        (description || '').slice(0, 500) || null,
        (icon || '').slice(0, 50) || null,
        color || '#DF005B',
        parseInt(sortOrder || 0, 10),
        isActive ? 1 : 0,
        req.params.id,
      ]
    );
    const row = await db.queryOne('SELECT * FROM donate_links WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Не найдено' });
    res.json({ success: true, link: mapLink(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/donate/:id — admin
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM donate_links WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/donate/:id/click — public, track click
router.post('/:id/click', async (req, res) => {
  try {
    await db.query('UPDATE donate_links SET click_count = click_count + 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
