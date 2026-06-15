const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parseUrl, parseRawText, codexdb, lawsdb } = require('../parsers');

// ============================================================
// Helpers for ensuring server/category exist before insert
// ============================================================
async function ensureServer({ id, name, color, icon, sortOrder }) {
  const existing = await db.queryOne('SELECT id FROM servers WHERE id = ?', [id]);
  if (existing) return existing;
  await db.query(
    'INSERT INTO servers (id, name, color, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [id, name, color || '#DF005B', icon || (name || '?').slice(0, 4), sortOrder || 0]
  );
  return { id };
}

async function ensureCategory({ id, name, short_name, color, type, sortOrder }) {
  const existing = await db.queryOne('SELECT id FROM categories WHERE id = ?', [id]);
  if (existing) return existing;
  await db.query(
    'INSERT INTO categories (id, name, short_name, color, type, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [id, name, short_name || name, color || '#DF005B', type || 'laws', sortOrder || 0]
  );
  return { id };
}

async function recordSyncState(source, resource, sourceUpdatedAt, articlesCount) {
  try {
    await db.query(
      `INSERT INTO sync_state (source, resource, source_updated_at, articles_count, imported_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         source_updated_at = VALUES(source_updated_at),
         articles_count = VALUES(articles_count),
         imported_at = NOW()`,
      [source, resource, sourceUpdatedAt || null, articlesCount || 0]
    );
  } catch (err) {
    console.warn('sync_state write failed:', err.message);
  }
}

async function importArticles(serverId, categoryId, articles, mode) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return { inserted: 0, removed: 0, skipped: 0 };
  }
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
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    if (!a.code || !a.title || !a.text) { skipped++; continue; }
    try {
      await db.query(
        `INSERT INTO articles
         (server_id, category_id, code, title, text, penalty, wanted_stars, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          serverId, categoryId,
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
      skipped++;
    }
  }
  return { inserted, removed, skipped };
}

// GET /api/parser/codexdb/servers — список доступных серверов в codex-db
router.get('/codexdb/servers', requireAuth, requireRole('admin'), async (req, res) => {
  res.json({ success: true, servers: codexdb.listServers() });
});

// POST /api/parser/codexdb/preview { serverFile, categoryFilter? }
router.post('/codexdb/preview', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { serverFile, categoryFilter } = req.body || {};
    if (!serverFile) return res.status(400).json({ error: 'serverFile обязателен' });
    const { articles, updatedAt } = await codexdb.loadServer(serverFile, categoryFilter);
    res.json({
      success: true,
      parser: 'codex-db',
      url: null,
      detectedCategory: null,
      articlesCount: articles.length,
      articles,
      updatedAt,
    });
  } catch (err) {
    console.error('CodexDB load error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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

// ============================================================
// alamantik/majestic-laws-db endpoints
// ============================================================

// GET /api/parser/lawsdb/structure — список доступных файлов и updatedAt каждого
router.get('/lawsdb/structure', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const [servers, rules] = await Promise.all([
      lawsdb.listServers(),
      lawsdb.listRules(),
    ]);
    res.json({ success: true, source: lawsdb.BASE, servers, rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/parser/lawsdb/versions — все updatedAt разом (для diff с локальными данными)
router.get('/lawsdb/versions', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const versions = await lawsdb.getAllVersions();
    res.json({ success: true, ...versions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/parser/lawsdb/import-server — импорт одного сервера
//   body: { file, mode: 'add'|'replace' }
router.post('/lawsdb/import-server', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { file, mode } = req.body || {};
    if (!file) return res.status(400).json({ error: 'file обязателен' });

    const info = lawsdb.parseServerFile(file);
    const { articles, updatedAt } = await lawsdb.loadServerLaws(file);

    // Ensure server exists in DB
    await ensureServer({
      id: info.id,
      name: info.name,
      color: '#DF005B',
      icon: 'S' + (info.number || '?'),
      sortOrder: info.number || 0,
    });

    // Group by category and import each
    const groups = {};
    for (const a of articles) {
      const cat = a.suggestedCategoryId || 'uk';
      (groups[cat] = groups[cat] || []).push(a);
    }

    let totalInserted = 0, totalRemoved = 0, totalSkipped = 0;
    for (const [catId, arts] of Object.entries(groups)) {
      // Ensure category exists (uk/ak/dk/pk should be from seed, but verify)
      const catNames = { uk: 'Уголовный кодекс', ak: 'Административный кодекс',
                          dk: 'Дорожный кодекс', pk: 'Процессуальный кодекс' };
      const catColors = { uk: '#DF005B', ak: '#F59E0B', dk: '#0070F3', pk: '#10B981' };
      await ensureCategory({
        id: catId,
        name: catNames[catId] || catId.toUpperCase(),
        short_name: catId.toUpperCase(),
        color: catColors[catId] || '#8B5CF6',
        type: 'laws',
      });
      const r = await importArticles(info.id, catId, arts, mode);
      totalInserted += r.inserted;
      totalRemoved += r.removed;
      totalSkipped += r.skipped;
    }

    await recordSyncState('lawsdb', `laws/${file}`, updatedAt, totalInserted);

    res.json({
      success: true,
      server: info,
      sourceUpdatedAt: updatedAt,
      inserted: totalInserted,
      removed: totalRemoved,
      skipped: totalSkipped,
    });
  } catch (err) {
    console.error('Import server error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/parser/lawsdb/sync-status — diff между импортированными и источником
router.get('/lawsdb/sync-status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const versions = await lawsdb.getAllVersions();
    const stateRows = await db.query(
      "SELECT resource, source_updated_at, articles_count, imported_at FROM sync_state WHERE source = 'lawsdb'"
    );
    const stateMap = {};
    for (const r of stateRows) stateMap[r.resource] = r;

    const status = { servers: [], rules: [] };
    for (const v of Object.values(versions.laws || {})) {
      const key = `laws/${v.file}`;
      const local = stateMap[key];
      status.servers.push({
        file: v.file,
        serverId: v.serverId,
        serverName: v.serverName,
        sourceUpdatedAt: v.updatedAt,
        localUpdatedAt: local ? local.source_updated_at : null,
        importedAt: local ? local.imported_at : null,
        hasUpdate: !local || (v.updatedAt && v.updatedAt > (local.source_updated_at || 0)),
      });
    }
    for (const v of Object.values(versions.rules || {})) {
      const key = `rules/${v.file}`;
      const local = stateMap[key];
      status.rules.push({
        file: v.file,
        sourceUpdatedAt: v.updatedAt,
        localUpdatedAt: local ? local.source_updated_at : null,
        importedAt: local ? local.imported_at : null,
        hasUpdate: !local || (v.updatedAt && v.updatedAt > (local.source_updated_at || 0)),
      });
    }
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/parser/lawsdb/import-rules — импорт правил (общие для всех серверов)
//   body: { targetServerId, mode: 'add'|'replace' }
router.post('/lawsdb/import-rules', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { targetServerId, mode } = req.body || {};
    if (!targetServerId) return res.status(400).json({ error: 'targetServerId обязателен' });

    // Verify target server exists
    const srv = await db.queryOne('SELECT id FROM servers WHERE id = ?', [targetServerId]);
    if (!srv) return res.status(400).json({ error: 'Сервер не найден' });

    const ruleFiles = await lawsdb.listRules();
    const results = [];

    for (const file of ruleFiles) {
      try {
        const { articles, updatedAt } = await lawsdb.loadRulesFile(file);
        // Group by suggestedCategoryId
        const groups = {};
        for (const a of articles) {
          const cat = a.suggestedCategoryId;
          (groups[cat] = groups[cat] || []).push(a);
        }
        let totalForFile = 0;
        for (const [catId, arts] of Object.entries(groups)) {
          if (!arts.length) continue;
          const mapping = arts[0];
          await ensureCategory({
            id: catId,
            name: mapping.suggestedCategoryName,
            short_name: mapping.suggestedCategoryShort,
            color: mapping.suggestedCategoryColor,
            type: 'rules',
          });
          const r = await importArticles(targetServerId, catId, arts, mode);
          results.push({ file, categoryId: catId, ...r });
          totalForFile += r.inserted;
        }
        await recordSyncState('lawsdb', `rules/${file}`, updatedAt, totalForFile);
      } catch (e) {
        results.push({ file, error: e.message });
      }
    }

    const totals = results.reduce((acc, r) => ({
      inserted: acc.inserted + (r.inserted || 0),
      removed: acc.removed + (r.removed || 0),
      skipped: acc.skipped + (r.skipped || 0),
    }), { inserted: 0, removed: 0, skipped: 0 });

    res.json({ success: true, results, totals });
  } catch (err) {
    console.error('Import rules error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/parser/lawsdb/import-all — импорт ВСЕХ серверов + правил одним запросом
//   body: { mode: 'add'|'replace', includeRules: bool, rulesTarget: 'default' }
router.post('/lawsdb/import-all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { mode, includeRules, rulesTarget } = req.body || {};
    const servers = await lawsdb.listServers();
    const serverResults = [];

    for (const info of servers) {
      try {
        const { articles, updatedAt } = await lawsdb.loadServerLaws(info.file);
        await ensureServer({
          id: info.id, name: info.name,
          color: '#DF005B', icon: 'S' + (info.number || '?'),
          sortOrder: info.number || 0,
        });
        const catNames = { uk: 'Уголовный кодекс', ak: 'Административный кодекс',
                            dk: 'Дорожный кодекс', pk: 'Процессуальный кодекс' };
        const catColors = { uk: '#DF005B', ak: '#F59E0B', dk: '#0070F3', pk: '#10B981' };
        const groups = {};
        for (const a of articles) {
          const cat = a.suggestedCategoryId || 'uk';
          (groups[cat] = groups[cat] || []).push(a);
        }
        let inserted = 0, removed = 0, skipped = 0;
        for (const [catId, arts] of Object.entries(groups)) {
          await ensureCategory({
            id: catId,
            name: catNames[catId] || catId.toUpperCase(),
            short_name: catId.toUpperCase(),
            color: catColors[catId] || '#8B5CF6',
            type: 'laws',
          });
          const r = await importArticles(info.id, catId, arts, mode);
          inserted += r.inserted; removed += r.removed; skipped += r.skipped;
        }
        await recordSyncState('lawsdb', `laws/${info.file}`, updatedAt, inserted);
        serverResults.push({ id: info.id, name: info.name, inserted, removed, skipped, updatedAt });
      } catch (e) {
        serverResults.push({ id: info.id, name: info.name, error: e.message });
      }
    }

    let rulesResults = null;
    if (includeRules) {
      const target = rulesTarget || servers[0]?.id || 'default';
      await ensureServer({
        id: target, name: 'Правила (общие)', color: '#8B5CF6', icon: 'RU', sortOrder: 0,
      }).catch(() => {});
      const ruleFiles = await lawsdb.listRules();
      const items = [];
      for (const file of ruleFiles) {
        try {
          const { articles, updatedAt } = await lawsdb.loadRulesFile(file);
          const groups = {};
          for (const a of articles) (groups[a.suggestedCategoryId] = groups[a.suggestedCategoryId] || []).push(a);
          let totalForFile = 0;
          for (const [catId, arts] of Object.entries(groups)) {
            if (!arts.length) continue;
            const m = arts[0];
            await ensureCategory({
              id: catId,
              name: m.suggestedCategoryName,
              short_name: m.suggestedCategoryShort,
              color: m.suggestedCategoryColor,
              type: 'rules',
            });
            const r = await importArticles(target, catId, arts, mode);
            items.push({ file, categoryId: catId, ...r });
            totalForFile += r.inserted;
          }
          await recordSyncState('lawsdb', `rules/${file}`, updatedAt, totalForFile);
        } catch (e) {
          items.push({ file, error: e.message });
        }
      }
      rulesResults = items;
    }

    res.json({ success: true, servers: serverResults, rules: rulesResults });
  } catch (err) {
    console.error('Import all error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
