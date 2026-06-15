const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
// Load .env from backend/ directory (works regardless of cwd at startup)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ============================================================
// Middleware
// ============================================================
// Trust Railway / nginx reverse proxy — required for rate-limiter to see real IP
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================
// API routes
// ============================================================
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/servers', require('./routes/servers'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/users', require('./routes/users'));
app.use('/api/parser', require('./routes/parser'));
app.use('/api/releases', require('./routes/releases'));
app.use('/api/donate', require('./routes/donate'));
app.use('/api/devlog', require('./routes/devlog'));

// Health check
app.get('/api/health', async (req, res) => {
  const cfg = db.config;
  const info = {
    uptime: Math.round(process.uptime()),
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    database: cfg.database,
    mysql_url_set: !!process.env.MYSQL_URL,
    database_url_set: !!process.env.DATABASE_URL,
  };
  try {
    await db.ping();
    let tablesCount = 0;
    try {
      const rows = await db.query(
        'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE()'
      );
      tablesCount = rows[0]?.cnt || 0;
    } catch {}
    res.json({ status: 'ok', db: 'connected', tables: tablesCount, ...info });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db: 'disconnected',
      error: err.code || err.message,
      hint: 'Check Railway → app service → Variables → MYSQL_URL must reference your MySQL service',
      ...info,
    });
  }
});

// Manual DB init trigger (use ?key=YOUR_JWT_SECRET to authorize)
app.post('/api/init-db', async (req, res) => {
  const providedKey = req.query.key || req.body?.key;
  if (!providedKey || providedKey !== process.env.JWT_SECRET) {
    return res.status(403).json({ error: 'Forbidden. Pass ?key=YOUR_JWT_SECRET' });
  }
  try {
    const { initDatabase } = require('./init-db');
    await initDatabase(true);
    res.json({ success: true, message: 'Database initialized' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

// ============================================================
// Frontend static files
// ============================================================
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

// Fallback to landing for unknown paths (so deep links work)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// ============================================================
// Error handler
// ============================================================
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============================================================
// Start
// ============================================================
async function start() {
  // Show config (without secrets) so it's obvious if env vars missing
  const cfg = db.config;
  console.log(`[DB] Config: host=${cfg.host} port=${cfg.port} user=${cfg.user} db=${cfg.database}`);
  console.log(`[DB] MYSQL_URL set: ${!!process.env.MYSQL_URL}, DATABASE_URL set: ${!!process.env.DATABASE_URL}`);

  try {
    await db.ping();
    console.log('[DB] ✓ Connected to MySQL');
  } catch (err) {
    console.error('[DB] ✗ Could not connect to MySQL:', err.code || err.message);
    console.error('[DB] Check that MYSQL_URL env var is set and points to your MySQL service.');
  }

  if (process.env.AUTO_INIT_DB !== 'false') {
    try {
      const { initDatabase } = require('./init-db');
      await initDatabase();
    } catch (err) {
      console.error('[InitDB] ✗ Failed:', err.message);
      console.error('[InitDB] Stack:', err.stack);
    }
  }

  app.listen(PORT, () => {
    console.log(`[Server] GOS Assistant API running on http://localhost:${PORT}`);
    console.log(`[Server] Frontend: http://localhost:${PORT}/`);
    console.log(`[Server] API: http://localhost:${PORT}/api/health`);
  });
}

start();
