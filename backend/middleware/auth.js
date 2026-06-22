const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });

  const user = await db.queryOne(
    'SELECT id, email, username, role, avatar_url, discord_id FROM users WHERE id = ?',
    [payload.id]
  );
  if (!user) return res.status(401).json({ error: 'User not found' });

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// ============================================================
// Хелпер: имеет ли пользователь право видеть данные сервера X.
// Возвращает true если: admin/moderator, или multi_server feature, или это его закреплённый сервер.
// Если serverId не передан — true (роут сам обработает листинг).
// ============================================================
async function userCanAccessServer(user, serverId) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'moderator') return true;
  if (!serverId) return true;
  const fresh = await db.queryOne('SELECT locked_server_id FROM users WHERE id = ?', [user.id]);
  const locked = fresh && fresh.locked_server_id;
  if (locked && locked === serverId) return true;
  // Проверяем multi_server в активной подписке
  try {
    const { loadCurrentSubscription } = require('../routes/subscriptions');
    const sub = await loadCurrentSubscription(user.id);
    if (sub && Array.isArray(sub.plan.features) && sub.plan.features.includes('multi_server')) {
      return true;
    }
  } catch {}
  // Если нет закреплённого сервера вообще — разрешаем (миграционный случай)
  if (!locked) return true;
  return false;
}

// Возвращает ID сервера, к которому юзер привязан если у него нет multi_server.
// Если есть multi_server / нет lock / админ — null (без ограничений).
async function effectiveLockedServer(user) {
  if (!user) return null;
  if (user.role === 'admin' || user.role === 'moderator') return null;
  const fresh = await db.queryOne('SELECT locked_server_id FROM users WHERE id = ?', [user.id]);
  const locked = fresh && fresh.locked_server_id;
  if (!locked) return null;
  try {
    const { loadCurrentSubscription } = require('../routes/subscriptions');
    const sub = await loadCurrentSubscription(user.id);
    if (sub && Array.isArray(sub.plan.features) && sub.plan.features.includes('multi_server')) {
      return null;
    }
  } catch {}
  return locked;
}

// Опциональный requireAuth — если есть токен, прикрепляет req.user; иначе пропускает без ошибки
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload) return next();
  try {
    const user = await db.queryOne(
      'SELECT id, email, username, role, avatar_url, discord_id FROM users WHERE id = ?',
      [payload.id]
    );
    if (user) req.user = user;
  } catch {}
  next();
}

module.exports = {
  signToken, verifyToken,
  requireAuth, requireRole, optionalAuth,
  userCanAccessServer, effectiveLockedServer,
};
