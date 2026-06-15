const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parseUrl, parseRawText } = require('../parsers');

// POST /api/parser/preview { url } — fetch and parse, return preview
router.post('/preview', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { url, rawText } = req.body || {};
    if (!url && !rawText) {
      return res.status(400).json({ error: 'Укажите URL или вставьте текст' });
    }
    let result;
    if (url) {
      result = await parseUrl(url);
    } else {
      const parsed = parseRawText(rawText);
      result = {
        parser: 'manual-text',
        url: null,
        articles: parsed.articles,
        detectedCategory: parsed.detectedCategory,
        articlesCount: parsed.articles.length,
      };
    }
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/parser/import { serverId, categoryId, articles: [...], mode: 'add'|'replace' }
router.post('/import', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { serverId, categoryId, articles, mode } = req.body || {};
    if (!serverId || !categoryId) {
      return res.status(400).json({ error: 'serverId и categoryId обязательны' });
    }
    if (!Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ error: 'Нет статей для импорта' });
    }

    const srv = await db.queryOne('SELECT id FROM servers WHERE id = ?', [serverId]);
    if (!srv) return res.status(400).json({ error: 'Сервер не найден' });
    const cat = await db.queryOne('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!cat) return res.status(400).json({ error: 'Категория не найдена' });

    let removed = 0;
    if (mode === 'replace') {
      const r = await db.query(
        'DELETE FROM articles WHERE server_id = ? AND category_id = ?',
        [serverId, categoryId]
      );
      removed = r.affectedRows || 0;
    }

    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      if (!a.code || !a.title || !a.text) {
        skipped++;
        continue;
      }
      try {
        await db.query(
          `INSERT INTO articles
           (server_id, category_id, code, title, text, penalty, wanted_stars, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            serverId,
            categoryId,
            String(a.code).slice(0, 32),
            String(a.title).slice(0, 500),
            String(a.text).slice(0, 5000),
            a.penalty ? String(a.penalty).slice(0, 500) : null,
            Math.max(0, Math.min(5, parseInt(a.wantedStars || a.wanted_stars || 0, 10))),
            i,
          ]
        );
        inserted++;
      } catch (e) {
        errors.push(`#${a.code}: ${e.message}`);
        skipped++;
      }
    }

    res.json({
      success: true,
      removed,
      inserted,
      skipped,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
