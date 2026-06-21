-- ============================================================
-- GOS Assistant — Database Schema
-- MySQL 8.0+ / MariaDB 10.5+
-- ============================================================

CREATE DATABASE IF NOT EXISTS gos_assistant
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gos_assistant;

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NULL,
  discord_id VARCHAR(64) NULL UNIQUE,
  avatar_url VARCHAR(500) NULL,
  role ENUM('user', 'admin', 'moderator') NOT NULL DEFAULT 'user',
  terms_accepted_at TIMESTAMP NULL,
  terms_version VARCHAR(16) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL,
  INDEX idx_email (email),
  INDEX idx_discord (discord_id)
) ENGINE=InnoDB;

-- ============================================================
-- Servers (RP servers)
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#DF005B',
  icon VARCHAR(8) NOT NULL DEFAULT 'GS',
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- Categories (УК / АК / правила и т.д.)
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(32) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#DF005B',
  type ENUM('laws', 'rules', 'other') NOT NULL DEFAULT 'laws',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- Articles (статьи / правила)
-- ============================================================
CREATE TABLE IF NOT EXISTS articles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  server_id VARCHAR(64) NOT NULL,
  category_id VARCHAR(64) NOT NULL,
  code VARCHAR(32) NOT NULL,
  title VARCHAR(500) NOT NULL,
  text TEXT NOT NULL,
  penalty VARCHAR(500) NULL,
  wanted_stars TINYINT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  INDEX idx_server (server_id),
  INDEX idx_category (category_id),
  INDEX idx_search (code, title),
  FULLTEXT idx_fulltext (title, text)
) ENGINE=InnoDB;

-- ============================================================
-- Sessions (для логирования и отзыва токенов)
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  user_agent VARCHAR(500) NULL,
  ip_address VARCHAR(64) NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_token (token_hash),
  INDEX idx_user (user_id)
) ENGINE=InnoDB;

-- ============================================================
-- Releases: uploaded installer/portable files for download
-- ============================================================
CREATE TABLE IF NOT EXISTS releases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('installer', 'portable') NOT NULL,
  version VARCHAR(32) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  size BIGINT NOT NULL,
  sha512 VARCHAR(255) NULL,
  notes TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  uploaded_by INT NULL,
  download_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_type_active (type, is_active, created_at)
) ENGINE=InnoDB;

-- ============================================================
-- DevLog: changelog entries (news, updates, features)
-- ============================================================
CREATE TABLE IF NOT EXISTS devlog_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version VARCHAR(32) NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  tag VARCHAR(32) NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  published_at TIMESTAMP NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_published (is_published, published_at)
) ENGINE=InnoDB;

-- ============================================================
-- Donate links: admin-managed list of donation URLs
-- ============================================================
CREATE TABLE IF NOT EXISTS donate_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  description VARCHAR(500) NULL,
  icon VARCHAR(50) NULL,
  color VARCHAR(16) NULL DEFAULT '#DF005B',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  click_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- Subscription plans: admin-editable tiers with feature flags
-- ============================================================
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
) ENGINE=InnoDB;

-- ============================================================
-- User subscriptions: granted access with expiry
-- ============================================================
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_active (user_id, is_active, expires_at),
  INDEX idx_expires (expires_at, is_active)
) ENGINE=InnoDB;

-- ============================================================
-- Support tickets: user-submitted questions/suggestions/bug reports
-- ============================================================
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_status (status, updated_at),
  INDEX idx_user (user_id, updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  author_id INT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ticket (ticket_id, created_at)
) ENGINE=InnoDB;

-- ============================================================
-- Maintenance: single-row flag for app-wide tech work mode
-- ============================================================
CREATE TABLE IF NOT EXISTS maintenance (
  id TINYINT PRIMARY KEY DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  message TEXT NULL,
  starts_at TIMESTAMP NULL,
  ends_at TIMESTAMP NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_maintenance_single CHECK (id = 1),
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO maintenance (id, enabled) VALUES (1, 0);

-- ============================================================
-- Sync state: per-source/file last imported timestamp
-- Used to detect when alamantik/majestic-laws-db has fresh data
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_state (
  source VARCHAR(64) NOT NULL,        -- e.g. 'lawsdb'
  resource VARCHAR(255) NOT NULL,     -- e.g. 'laws/atlanta-5.json'
  source_updated_at BIGINT NULL,      -- ms since epoch from source
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  articles_count INT DEFAULT 0,
  PRIMARY KEY (source, resource)
) ENGINE=InnoDB;
