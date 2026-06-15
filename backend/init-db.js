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
    console.log('[InitDB] Schema already exists, skipping.');
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

  console.log('[InitDB] ✓ Database initialized successfully');
}

module.exports = { initDatabase };
