const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/servers — list active servers, опционально фильтр ?projectId=majestic
// Возвращаем project_id для клиента (сгруппировать в dropdown).
router.get('/', async (req, res) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    const where = ['is_active = 1'];
    const params = [];
    if (projectId) { where.push('project_id = ?'); params.push(projectId); }
    const rows = await db.query(
      `SELECT id, name, color, icon, description, project_id AS projectId
         FROM servers
        WHERE ${where.join(' AND ')}
        ORDER BY sort_order, name`,
      params
    );
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/servers/all — admin only (includes inactive)
router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  const rows = await db.query('SELECT s.*, s.project_id AS projectId FROM servers s ORDER BY project_id, sort_order, name');
  res.json(rows);
});

// POST /api/servers — admin
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id, name, color, icon, description, sort_order, is_active, projectId } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    await db.query(
      'INSERT INTO servers (id, name, color, icon, description, sort_order, is_active, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, color || '#DF005B', icon || 'GS', description || null, sort_order || 0, is_active !== false ? 1 : 0, projectId || 'majestic']
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
    const { name, color, icon, description, sort_order, is_active, projectId } = req.body;
    const fields = ['name = ?', 'color = ?', 'icon = ?', 'description = ?', 'sort_order = ?', 'is_active = ?'];
    const params = [name, color, icon, description || null, sort_order || 0, is_active ? 1 : 0];
    if (projectId !== undefined) {
      fields.push('project_id = ?');
      params.push(projectId);
    }
    params.push(req.params.id);
    await db.query(`UPDATE servers SET ${fields.join(', ')} WHERE id = ?`, params);
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
