const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// 8-символьный URL-safe код (без визуально похожих символов)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(len = 8) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

function parseSnapshot(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

async function ensureMyShare(userId) {
  const existing = await db.queryOne(
    'SELECT user_id AS userId, code, snapshot, notes_count AS notesCount, updated_at AS updatedAt FROM note_shares WHERE user_id = ?',
    [userId]
  );
  if (existing) return { ...existing, snapshot: parseSnapshot(existing.snapshot) };

  // Создаём с уникальным кодом — до 5 попыток
  for (let i = 0; i < 5; i++) {
    const code = generateCode(8);
    try {
      await db.query('INSERT INTO note_shares (user_id, code, snapshot, notes_count) VALUES (?, ?, ?, 0)', [userId, code, '[]']);
      return { userId, code, snapshot: [], notesCount: 0, updatedAt: new Date() };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('Не удалось сгенерировать уникальный код');
}

// ============================================================
// GET /api/notes/share — мой код + текущий снимок
// ============================================================
router.get('/share', requireAuth, async (req, res) => {
  try {
    const share = await ensureMyShare(req.user.id);
    res.json({
      success: true,
      code: share.code,
      notesCount: share.notesCount || 0,
      updatedAt: share.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// PUT /api/notes/share/snapshot — обновить снимок заметок (вызывает app при изменениях)
// body: { notes: [{id?, title, content, createdAt, updatedAt}] }
// ============================================================
router.put('/share/snapshot', requireAuth, async (req, res) => {
  try {
    const { notes } = req.body || {};
    if (!Array.isArray(notes)) return res.status(400).json({ error: 'notes должен быть массивом' });
    if (notes.length > 1000) return res.status(400).json({ error: 'Слишком много заметок' });

    // Валидация и обрезка
    const cleaned = notes.slice(0, 1000).map((n) => ({
      id: n && n.id ? String(n.id).slice(0, 64) : null,
      title: n && n.title ? String(n.title).slice(0, 200) : '',
      content: n && n.content ? String(n.content).slice(0, 20000) : '',
      createdAt: n && n.createdAt ? String(n.createdAt).slice(0, 32) : null,
      updatedAt: n && n.updatedAt ? String(n.updatedAt).slice(0, 32) : null,
    })).filter((n) => n.title || n.content);

    const share = await ensureMyShare(req.user.id);
    await db.query(
      'UPDATE note_shares SET snapshot = ?, notes_count = ? WHERE user_id = ?',
      [JSON.stringify(cleaned), cleaned.length, req.user.id]
    );
    res.json({ success: true, code: share.code, notesCount: cleaned.length });
  } catch (err) {
    console.error('[Notes] snapshot error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/notes/share/regenerate — сгенерить новый код
// ============================================================
router.post('/share/regenerate', requireAuth, async (req, res) => {
  try {
    await ensureMyShare(req.user.id);
    for (let i = 0; i < 5; i++) {
      const code = generateCode(8);
      try {
        await db.query('UPDATE note_shares SET code = ? WHERE user_id = ?', [code, req.user.id]);
        return res.json({ success: true, code });
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    res.status(500).json({ success: false, error: 'Не удалось сгенерировать код' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/notes/share/lookup/:code — получить снимок по коду
// ============================================================
router.get('/share/lookup/:code', requireAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!code || code.length < 4) return res.status(400).json({ error: 'Неверный код' });

    const row = await db.queryOne(
      `SELECT ns.user_id AS userId, ns.code, ns.snapshot, ns.notes_count AS notesCount, ns.updated_at AS updatedAt,
              u.username AS ownerName
         FROM note_shares ns
         JOIN users u ON u.id = ns.user_id
        WHERE ns.code = ?`,
      [code]
    );
    if (!row) return res.status(404).json({ error: 'Код не найден' });
    if (row.userId === req.user.id) {
      return res.status(400).json({ error: 'Это ваш собственный код — заметки уже на устройстве' });
    }

    const notes = parseSnapshot(row.snapshot);
    res.json({
      success: true,
      ownerName: row.ownerName,
      notesCount: row.notesCount || notes.length,
      notes,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
