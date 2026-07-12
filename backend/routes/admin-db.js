const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { escape } = require('mysql2');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// ============================================================
// Экспорт: стримит SQL-дамп текущей БД в ответ.
// Формат совместим с `mysql < file.sql` — можно импортировать
// стандартным клиентом. Работает без внешнего mysqldump.
// ============================================================

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return '_binary 0x' + v.toString('hex');
  if (v instanceof Date) {
    // 'YYYY-MM-DD HH:MM:SS'
    const iso = v.toISOString();
    return "'" + iso.slice(0, 19).replace('T', ' ') + "'";
  }
  if (typeof v === 'object') return escape(JSON.stringify(v));
  return escape(String(v));
}

async function generateDump(res) {
  const now = new Date().toISOString();
  const dbName = db.config.database;

  res.write(`-- GOS Assistant DB dump\n`);
  res.write(`-- Database: ${dbName}\n`);
  res.write(`-- Generated: ${now}\n`);
  res.write(`-- Compatible with mysql < file.sql\n\n`);

  res.write(`SET NAMES utf8mb4;\n`);
  res.write(`SET FOREIGN_KEY_CHECKS = 0;\n`);
  res.write(`SET UNIQUE_CHECKS = 0;\n`);
  res.write(`SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n`);
  res.write(`SET time_zone = "+00:00";\n\n`);

  // Список таблиц
  const tables = await db.query('SHOW TABLES');
  const tableKey = Object.keys(tables[0] || {})[0];
  const tableNames = tables.map((t) => t[tableKey]);

  for (const table of tableNames) {
    res.write(`-- -----------------------------\n`);
    res.write(`-- Table: ${table}\n`);
    res.write(`-- -----------------------------\n\n`);
    res.write(`DROP TABLE IF EXISTS \`${table}\`;\n`);

    const createRows = await db.query(`SHOW CREATE TABLE \`${table}\``);
    const createSql = createRows[0]['Create Table'];
    res.write(createSql + ';\n\n');

    // Данные — считаем построчно через отдельный connection чтобы стримить
    // (для больших таблиц — articles ~24k строк это важно)
    const conn = await mysql.createConnection({
      ...db.config,
      // rowsAsArray: false — по умолчанию, получаем объекты
    });
    try {
      const [rows, fields] = await conn.query(`SELECT * FROM \`${table}\``);
      if (rows.length) {
        const colNames = fields.map((f) => '`' + f.name + '`').join(', ');
        // Пишем блоками по 500 строк — чтобы одна INSERT-строка не была гигабайтной
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          res.write(`INSERT INTO \`${table}\` (${colNames}) VALUES\n`);
          const vals = batch.map((row) => {
            const cells = fields.map((f) => esc(row[f.name]));
            return '(' + cells.join(', ') + ')';
          });
          res.write(vals.join(',\n') + ';\n');
        }
        res.write('\n');
      }
    } finally {
      await conn.end();
    }
  }

  res.write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
  res.write(`SET UNIQUE_CHECKS = 1;\n`);
  res.write(`-- Dump completed on ${now}\n`);
  res.end();
}

// GET /api/admin/db/export
router.get('/export', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gos-dump-${stamp}.sql"`);
    res.setHeader('Cache-Control', 'no-store');
    await generateDump(res);
  } catch (err) {
    console.error('[AdminDB] export error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.end(`\n-- ERROR: ${err.message}\n`);
    }
  }
});

// ============================================================
// Импорт: multer temp-файл в /tmp, потом db.runScript(sql).
// runScript использует connection с multipleStatements: true.
// ============================================================
const tmpDir = os.tmpdir();
const uploadImport = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (_req, file, cb) => cb(null, `gos-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB — с запасом
});

router.post('/import', requireAuth, requireRole('admin'), (req, res) => {
  uploadImport.single('dump')(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: 'Файл не загружен' });

    const filePath = req.file.path;
    try {
      const sql = fs.readFileSync(filePath, 'utf-8');
      if (!sql.trim()) throw new Error('Файл пустой');

      // Санити-чек: должен быть SQL-дамп, а не что-то другое
      const lower = sql.slice(0, 500).toLowerCase();
      if (!/create\s+table|insert\s+into|drop\s+table/i.test(lower)) {
        throw new Error('Файл не похож на SQL-дамп (нет CREATE TABLE / INSERT / DROP TABLE в начале)');
      }

      console.log(`[AdminDB] import: running ${(sql.length / 1024 / 1024).toFixed(2)} MB from ${req.user.email}`);
      await db.runScript(sql);
      console.log(`[AdminDB] import: done`);

      res.json({
        success: true,
        sizeMB: (sql.length / 1024 / 1024).toFixed(2),
        message: 'База успешно импортирована. Перезапустите сервер если начались странности.',
      });
    } catch (err2) {
      console.error('[AdminDB] import error:', err2);
      res.status(500).json({ success: false, error: err2.message });
    } finally {
      // Всегда чистим temp-файл — в нём весь дамп с данными
      try { fs.unlinkSync(filePath); } catch {}
    }
  });
});

// GET /api/admin/db/info — размер БД и число строк по таблицам
router.get('/info', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const tables = await db.query(
      `SELECT table_name AS name,
              table_rows AS rows,
              ROUND((data_length + index_length) / 1024 / 1024, 2) AS sizeMB
         FROM information_schema.tables
        WHERE table_schema = ?
        ORDER BY table_rows DESC`,
      [db.config.database]
    );
    const total = tables.reduce((s, t) => s + Number(t.sizeMB || 0), 0);
    res.json({
      success: true,
      database: db.config.database,
      tables,
      totalSizeMB: total.toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
