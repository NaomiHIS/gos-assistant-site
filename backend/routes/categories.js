const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/categories — глобальные (project_id NULL) + категории конкретного проекта.
// Если проект не передан — возвращаем все глобальные (fallback для лендинга без проекта).
router.get('/', async (req, res) => {
  const projectId = req.query.projectId ? String(req.query.projectId) : null;
  const where = ['is_active = 1'];
  const params = [];
  if (projectId) {
    where.push('(project_id IS NULL OR project_id = ?)');
    params.push(projectId);
  }
  const rows = await db.query(
    `SELECT id, name, short_name AS shortName, color, type, project_id AS projectId
       FROM categories
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order, name`,
    params
  );
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
  res.json(rows);
});

router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  const rows = await db.query('SELECT c.*, c.project_id AS projectId FROM categories c ORDER BY project_id, sort_order, name');
  res.json(rows);
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id, name, short_name, color, type, sort_order, is_active, projectId } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    await db.query(
      'INSERT INTO categories (id, name, short_name, color, type, sort_order, is_active, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, short_name || name, color || '#DF005B', type || 'laws', sort_order || 0, is_active !== false ? 1 : 0, projectId || null]
    );
    const row = await db.queryOne('SELECT * FROM categories WHERE id = ?', [id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, short_name, color, type, sort_order, is_active, projectId } = req.body;
    const fields = ['name = ?', 'short_name = ?', 'color = ?', 'type = ?', 'sort_order = ?', 'is_active = ?'];
    const params = [name, short_name, color, type, sort_order || 0, is_active ? 1 : 0];
    if (projectId !== undefined) {
      fields.push('project_id = ?');
      params.push(projectId || null);
    }
    params.push(req.params.id);
    await db.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, params);
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
