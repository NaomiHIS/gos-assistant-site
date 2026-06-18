const fs = require('fs');
const path = require('path');
const db = require('./db');

async function initDatabase(force = false) {
  // Check if `users` table exists
  let hasTables = false;
  try {
    const rows = await db.query(
      'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['users']
    );
    hasTables = rows[0]?.cnt > 0;
  } catch (err) {
    console.error('[InitDB] Could not check schema:', err.message);
    if (!force) throw err;
  }

  if (hasTables && !force) {
    console.log('[InitDB] Schema already exists, running migrations...');
    await runMigrations();
    return;
  }

  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const seedPath = path.join(__dirname, '..', 'database', 'seed.sql');

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema.sql not found at ${schemaPath}`);
  }

  console.log('[InitDB] Applying schema.sql...');
  let schema = fs.readFileSync(schemaPath, 'utf-8');
  // Strip CREATE DATABASE and USE (Railway provides DB already)
  schema = schema
    .replace(/CREATE\s+DATABASE[^;]+;/gi, '')
    .replace(/USE\s+[^;]+;/gi, '');
  await db.runScript(schema);
  console.log('[InitDB] ✓ Schema applied');

  if (fs.existsSync(seedPath)) {
    console.log('[InitDB] Applying seed.sql...');
    let seed = fs.readFileSync(seedPath, 'utf-8');
    seed = seed.replace(/USE\s+[^;]+;/gi, '');
    await db.runScript(seed);
    console.log('[InitDB] ✓ Seed applied');
  }

  await runMigrations();

  console.log('[InitDB] ✓ Database initialized successfully');
}

// ============================================================
// Idempotent migrations — run on every startup, safe to re-run.
// Use these to add new tables/columns introduced after first install.
// ============================================================
async function runMigrations() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS maintenance (
        id TINYINT PRIMARY KEY DEFAULT 1,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        message TEXT NULL,
        starts_at TIMESTAMP NULL,
        ends_at TIMESTAMP NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await db.query('INSERT IGNORE INTO maintenance (id, enabled) VALUES (1, 0)');
    console.log('[InitDB] ✓ maintenance table ensured');
  } catch (err) {
    console.warn('[InitDB] migration warning:', err.message);
  }
}

module.exports = { initDatabase };
