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

    await db.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('question', 'suggestion', 'bug') NOT NULL DEFAULT 'question',
        subject VARCHAR(255) NOT NULL,
        status ENUM('open', 'in_progress', 'answered', 'closed') NOT NULL DEFAULT 'open',
        source VARCHAR(16) NOT NULL DEFAULT 'site',
        app_version VARCHAR(32) NULL,
        unread_for_user TINYINT(1) NOT NULL DEFAULT 0,
        unread_for_admin TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status, updated_at),
        INDEX idx_user (user_id, updated_at)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(128) NOT NULL,
        description TEXT NULL,
        color VARCHAR(16) NULL DEFAULT '#DF005B',
        features JSON NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        plan_id INT NOT NULL,
        starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        granted_by INT NULL,
        revoked_at TIMESTAMP NULL,
        notes VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_active (user_id, is_active, expires_at),
        INDEX idx_expires (expires_at, is_active)
      ) ENGINE=InnoDB
    `);
    // Default Premium plan with sensible feature set
    await db.query(
      `INSERT IGNORE INTO subscription_plans (slug, name, description, color, features, sort_order)
       VALUES ('premium', 'Premium',
               'Расширенный доступ к функциям приложения и сайта',
               '#DF005B',
               JSON_ARRAY('notes_unlimited', 'themes_extra', 'priority_support', 'early_access', 'no_ads', 'export_data'),
               10)`
    );
    console.log('[InitDB] ✓ subscription tables ensured');

    await db.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id INT NOT NULL,
        author_id INT NULL,
        is_admin TINYINT(1) NOT NULL DEFAULT 0,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ticket (ticket_id, created_at)
      ) ENGINE=InnoDB
    `);
    console.log('[InitDB] ✓ support tables ensured');
  } catch (err) {
    console.warn('[InitDB] migration warning:', err.message);
  }
}

module.exports = { initDatabase };
