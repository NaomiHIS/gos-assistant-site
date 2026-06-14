const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function userPublic(u) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    avatar: u.avatar_url || null,
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if (!email || !username || !password) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Некорректный email' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Пароль должен быть не менее 6 символов' });
    }

    const exists = await db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (exists) {
      return res.status(409).json({ success: false, error: 'Пользователь с таким email уже существует' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [email, username, hash, 'user']
    );

    const user = await db.queryOne('SELECT * FROM users WHERE id = ?', [result.insertId]);
    const token = signToken(user);

    res.json({ success: true, token, user: userPublic(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Введите email и пароль' });
    }

    const user = await db.queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !user.password_hash) {
      return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
    }

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    const token = signToken(user);

    res.json({ success: true, token, user: userPublic(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  res.json({ success: true, user: userPublic(req.user) });
});

// POST /api/auth/logout (placeholder — JWT is stateless on server)
router.post('/logout', requireAuth, async (req, res) => {
  res.json({ success: true });
});

// GET /api/auth/discord — start OAuth flow
router.get('/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirect = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !redirect) {
    return res.status(503).json({ success: false, error: 'Discord OAuth не настроен' });
  }
  const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=identify%20email`;
  res.redirect(url);
});

// GET /api/auth/discord/callback
router.get('/discord/callback', async (req, res) => {
  const code = req.query.code;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirect = process.env.DISCORD_REDIRECT_URI;

  if (!code || !clientId || !clientSecret) {
    return res.status(400).send('Missing code or config');
  }

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return res.status(400).send('Discord token exchange failed');
    }

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const dUser = await meRes.json();

    let user = await db.queryOne('SELECT * FROM users WHERE discord_id = ?', [dUser.id]);
    if (!user) {
      const email = dUser.email || `${dUser.id}@discord.local`;
      const username = dUser.username || `user_${dUser.id}`;
      const avatar = dUser.avatar
        ? `https://cdn.discordapp.com/avatars/${dUser.id}/${dUser.avatar}.png`
        : null;
      const result = await db.query(
        'INSERT INTO users (email, username, discord_id, avatar_url, role) VALUES (?, ?, ?, ?, ?)',
        [email, username, dUser.id, avatar, 'user']
      );
      user = await db.queryOne('SELECT * FROM users WHERE id = ?', [result.insertId]);
    }

    const token = signToken(user);
    res.redirect(`/auth-success.html?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Discord callback error:', err);
    res.status(500).send('Discord auth failed');
  }
});

module.exports = router;
