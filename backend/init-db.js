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
async function ensureColumn(table, column, definition) {
  try {
    const rows = await db.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column]
    );
    if (rows[0]?.cnt > 0) return;
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`[InitDB] ✓ added column ${table}.${column}`);
  } catch (err) {
    console.warn(`[InitDB] ensureColumn ${table}.${column} warning:`, err.message);
  }
}

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
        price_cents INT NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'RUB',
        duration_days INT NOT NULL DEFAULT 30,
        is_purchasable TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    // Идемпотентные ALTER — для существующих БД без новых колонок
    await ensureColumn('subscription_plans', 'price_cents', 'INT NOT NULL DEFAULT 0');
    await ensureColumn('subscription_plans', 'currency', "VARCHAR(8) NOT NULL DEFAULT 'RUB'");
    await ensureColumn('subscription_plans', 'duration_days', 'INT NOT NULL DEFAULT 30');
    await ensureColumn('subscription_plans', 'is_purchasable', 'TINYINT(1) NOT NULL DEFAULT 0');
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
    // Default plans: Lite (без AI) и Premium (с AI)
    await db.query(
      `INSERT IGNORE INTO subscription_plans (slug, name, description, color, features, price_cents, currency, duration_days, is_purchasable, sort_order)
       VALUES ('lite', 'Lite',
               'Базовая подписка: безлимит заметок, темы, без рекламы',
               '#7B2BFF',
               JSON_ARRAY('notes_unlimited', 'themes_extra', 'no_ads', 'multi_server'),
               14900, 'RUB', 30, 1, 5)`
    );
    await db.query(
      `INSERT IGNORE INTO subscription_plans (slug, name, description, color, features, price_cents, currency, duration_days, is_purchasable, sort_order)
       VALUES ('premium', 'Premium',
               'Полный доступ: AI-ассистент, приоритетная поддержка, ранний доступ',
               '#DF005B',
               JSON_ARRAY('notes_unlimited', 'themes_extra', 'priority_support', 'early_access', 'no_ads', 'export_data', 'ai_assistant', 'multi_server'),
               29900, 'RUB', 30, 1, 10)`
    );
    console.log('[InitDB] ✓ subscription tables ensured');

    // ============================================================
    // Payments: providers (YooKassa, manual, ...) + transactions
    // ============================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS payment_providers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(32) NOT NULL UNIQUE,
        name VARCHAR(128) NOT NULL,
        description TEXT NULL,
        config JSON NULL,
        is_enabled TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        plan_id INT NOT NULL,
        provider_slug VARCHAR(32) NOT NULL,
        amount_cents INT NOT NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'RUB',
        status ENUM('pending','succeeded','canceled','failed','refunded') NOT NULL DEFAULT 'pending',
        external_id VARCHAR(128) NULL,
        confirmation_url VARCHAR(1024) NULL,
        metadata JSON NULL,
        granted_subscription_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        paid_at TIMESTAMP NULL,
        INDEX idx_user (user_id, created_at),
        INDEX idx_status (status, created_at),
        INDEX idx_external (provider_slug, external_id)
      ) ENGINE=InnoDB
    `);

    // Сидим базовых провайдеров — оба выключены, админ включит через UI
    await db.query(
      `INSERT IGNORE INTO payment_providers (slug, name, description, config, is_enabled, sort_order)
       VALUES ('yookassa', 'ЮKassa',
               'Онлайн-оплата картами и СБП через ЮKassa',
               JSON_OBJECT('shop_id', '', 'secret_key', '', 'return_url', ''),
               0, 10)`
    );
    await db.query(
      `INSERT IGNORE INTO payment_providers (slug, name, description, config, is_enabled, sort_order)
       VALUES ('manual', 'Ручная выдача',
               'Заявка на оплату — админ выдаёт подписку после поступления средств',
               JSON_OBJECT('instructions', ''),
               1, 90)`
    );
    console.log('[InitDB] ✓ payment tables ensured');

    // ============================================================
    // Site contacts (single-row): информация о владельце
    // ============================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS site_contacts (
        id TINYINT PRIMARY KEY DEFAULT 1,
        owner_name VARCHAR(128) NULL,
        owner_role VARCHAR(128) NULL,
        about TEXT NULL,
        avatar_url VARCHAR(500) NULL,
        email VARCHAR(255) NULL,
        telegram VARCHAR(255) NULL,
        discord VARCHAR(255) NULL,
        vk VARCHAR(255) NULL,
        github VARCHAR(255) NULL,
        website VARCHAR(255) NULL,
        custom_links JSON NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await db.query('INSERT IGNORE INTO site_contacts (id) VALUES (1)');
    console.log('[InitDB] ✓ site_contacts ensured');

    // ============================================================
    // Users.locked_server_id — закреплённый сервер (без multi_server только он доступен)
    // ============================================================
    await ensureColumn('users', 'locked_server_id', 'VARCHAR(64) NULL');

    // ============================================================
    // Notes share: один снимок заметок на пользователя + публичный код
    // ============================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS note_shares (
        user_id INT PRIMARY KEY,
        code VARCHAR(16) NOT NULL UNIQUE,
        snapshot JSON NULL,
        notes_count INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_code (code)
      ) ENGINE=InnoDB
    `);
    console.log('[InitDB] ✓ note_shares ensured');

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
