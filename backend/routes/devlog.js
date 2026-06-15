const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

function mapEntry(r) {
  return {
    id: r.id,
    version: r.version,
    title: r.title,
    content: r.content,
    tag: r.tag,
    isPublished: !!r.is_published,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    authorName: r.author_name || null,
  };
}

// GET /api/devlog — public, published only
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const rows = await db.query(
      `SELECT e.*, u.username AS author_name
       FROM devlog_entries e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.is_published = 1
       ORDER BY COALESCE(e.published_at, e.created_at) DESC
       LIMIT ${limit}`
    );
    res.json({ success: true, entries: rows.map(mapEntry) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/devlog/all — admin, all entries
router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT e.*, u.username AS author_name
       FROM devlog_entries e
       LEFT JOIN users u ON u.id = e.created_by
       ORDER BY COALESCE(e.published_at, e.created_at) DESC`
    );
    res.json({ success: true, entries: rows.map(mapEntry) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/devlog — admin
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { version, title, content, tag, isPublished } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'title и content обязательны' });
    const result = await db.query(
      `INSERT INTO devlog_entries (version, title, content, tag, is_published, published_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        (version || '').slice(0, 32) || null,
        title.slice(0, 255),
        content.slice(0, 20000),
        (tag || '').slice(0, 32) || null,
        isPublished === false ? 0 : 1,
        isPublished === false ? null : new Date(),
        req.user.id,
      ]
    );
    const row = await db.queryOne('SELECT * FROM devlog_entries WHERE id = ?', [result.insertId]);
    res.json({ success: true, entry: mapEntry(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/devlog/:id — admin
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { version, title, content, tag, isPublished } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'title и content обязательны' });
    const existing = await db.queryOne('SELECT * FROM devlog_entries WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Не найдено' });
    let publishedAt = existing.published_at;
    if (isPublished && !existing.is_published) publishedAt = new Date();
    if (isPublished === false) publishedAt = null;

    await db.query(
      `UPDATE devlog_entries
       SET version = ?, title = ?, content = ?, tag = ?, is_published = ?, published_at = ?
       WHERE id = ?`,
      [
        (version || '').slice(0, 32) || null,
        title.slice(0, 255),
        content.slice(0, 20000),
        (tag || '').slice(0, 32) || null,
        isPublished ? 1 : 0,
        publishedAt,
        req.params.id,
      ]
    );
    const row = await db.queryOne('SELECT * FROM devlog_entries WHERE id = ?', [req.params.id]);
    res.json({ success: true, entry: mapEntry(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/devlog/:id — admin
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM devlog_entries WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
