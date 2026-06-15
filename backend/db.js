const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Railway provides MYSQL_URL like: mysql://user:pass@host:port/dbname
function parseMysqlUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: parseInt(u.port || '3306', 10),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}

let config;
const mysqlUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (mysqlUrl) {
  config = parseMysqlUrl(mysqlUrl);
}
if (!config) {
  config = {
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '3306', 10),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'gos_assistant',
  };
}

const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: false,
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function ping() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  return true;
}

// Run multi-statement SQL (for schema/seed init)
async function runScript(sql) {
  const conn = await mysql.createConnection({ ...config, multipleStatements: true });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}

module.exports = { pool, query, queryOne, ping, runScript, config };
