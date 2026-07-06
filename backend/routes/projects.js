const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ============================================================
// GET /api/projects — публично, активные проекты
// ============================================================
router.get('/', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, name, description, color, icon, parser_source AS parserSource, sort_order AS sortOrder
         FROM projects
        WHERE is_active = 1
        ORDER BY sort_order ASC, name ASC`
    );
    res.json({ success: true, projects: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/all (admin) — все проекты, включая выключенные
router.get('/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, name, description, color, icon, parser_source AS parserSource,
              sort_order AS sortOrder, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
         FROM projects
        ORDER BY sort_order ASC, name ASC`
    );
    res.json({ success: true, projects: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/projects (admin) — создать
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id, name, description, color, icon, parserSource, sortOrder, isActive } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id и name обязательны' });
    if (!/^[a-z0-9-]{2,64}$/.test(id)) return res.status(400).json({ error: 'id должен быть slug (a-z, 0-9, дефис)' });
    await db.query(
      `INSERT INTO projects (id, name, description, color, icon, parser_source, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, description || null, color || '#DF005B', icon || 'GP', parserSource || null, sortOrder || 0, isActive === false ? 0 : 1]
    );
    res.json({ success: true, id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Проект с таким id уже есть' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/projects/:id (admin)
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, color, icon, parserSource, sortOrder, isActive } = req.body || {};
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (color !== undefined) { fields.push('color = ?'); params.push(color); }
    if (icon !== undefined) { fields.push('icon = ?'); params.push(icon); }
    if (parserSource !== undefined) { fields.push('parser_source = ?'); params.push(parserSource); }
    if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(sortOrder); }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive ? 1 : 0); }
    if (!fields.length) return res.json({ success: true });
    params.push(req.params.id);
    await db.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/projects/:id (admin) — только если нет серверов
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const cnt = await db.queryOne('SELECT COUNT(*) AS n FROM servers WHERE project_id = ?', [req.params.id]);
    if (cnt && cnt.n > 0) {
      return res.status(400).json({ error: 'В проекте есть сервера — сначала перенеси или удали их' });
    }
    await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
