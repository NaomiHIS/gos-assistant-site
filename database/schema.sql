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
