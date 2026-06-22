const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole, optionalAuth, effectiveLockedServer } = require('../middleware/auth');

function mapArticle(row) {
  return {
    id: String(row.id),
    serverId: row.server_id,
    categoryId: row.category_id,
    code: row.code,
    title: row.title,
    text: row.text,
    penalty: row.penalty,
    wantedStars: row.wanted_stars,
  };
}

// Принудительно прижимаем serverId к закреплённому если у юзера нет multi_server.
// Если запросил чужой сервер — пересиливаем своим (НЕ возвращаем 403, чтобы старые клиенты не падали).
async function enforceServerLock(req) {
  const locked = await effectiveLockedServer(req.user);
  if (!locked) return req.query.serverId || null;
  // У юзера есть локированный сервер и нет multi_server.
  // Если ничего не указано — отдаём locked. Если указано другое — заменяем на locked.
  return locked;
}

// GET /api/articles?serverId=...&categoryId=...
router.get('/', optionalAuth, async (req, res) => {
  try {
    const serverId = await enforceServerLock(req);
    const { categoryId } = req.query;
    let sql = 'SELECT * FROM articles WHERE is_active = 1';
    const params = [];
    if (serverId) {
      sql += ' AND server_id = ?';
      params.push(serverId);
    }
    if (categoryId && categoryId !== 'all') {
      sql += ' AND category_id = ?';
      params.push(categoryId);
    }
    sql += ' ORDER BY category_id, sort_order, code';
    const rows = await db.query(sql, params);
    res.json(rows.map(mapArticle));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/articles/search?q=...&serverId=...
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const serverId = await enforceServerLock(req);
    const { q, categoryId } = req.query;
    const pattern = `%${(q || '').trim()}%`;
    let sql = `
      SELECT * FROM articles
      WHERE is_active = 1
        AND (code LIKE ? OR title LIKE ? OR text LIKE ?)
    `;
    const params = [pattern, pattern, pattern];
    if (serverId) {
      sql += ' AND server_id = ?';
      params.push(serverId);
    }
    if (categoryId && categoryId !== 'all') {
      sql += ' AND category_id = ?';
      params.push(categoryId);
    }
    sql += ' ORDER BY category_id, sort_order, code LIMIT 200';
    const rows = await db.query(sql, params);
    res.json(rows.map(mapArticle));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/articles/:id
router.get('/:id', async (req, res) => {
  const row = await db.queryOne('SELECT * FROM articles WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(mapArticle(row));
});

// POST /api/articles — admin
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { serverId, categoryId, code, title, text, penalty, wantedStars, sortOrder, isActive } = req.body;
    if (!serverId || !categoryId || !code || !title || !text) {
      return res.status(400).json({ error: 'serverId, categoryId, code, title, text required' });
    }
    const result = await db.query(
      'INSERT INTO articles (server_id, category_id, code, title, text, penalty, wanted_stars, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [serverId, categoryId, code, title, text, penalty || null, wantedStars || 0, sortOrder || 0, isActive === false ? 0 : 1]
    );
    const row = await db.queryOne('SELECT * FROM articles WHERE id = ?', [result.insertId]);
    res.json(mapArticle(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/articles/:id — admin
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { serverId, categoryId, code, title, text, penalty, wantedStars, sortOrder, isActive } = req.body;
    await db.query(
      'UPDATE articles SET server_id = ?, category_id = ?, code = ?, title = ?, text = ?, penalty = ?, wanted_stars = ?, sort_order = ?, is_active = ? WHERE id = ?',
      [serverId, categoryId, code, title, text, penalty || null, wantedStars || 0, sortOrder || 0, isActive ? 1 : 0, req.params.id]
    );
    const row = await db.queryOne('SELECT * FROM articles WHERE id = ?', [req.params.id]);
    res.json(mapArticle(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/articles/:id — admin
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM articles WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
