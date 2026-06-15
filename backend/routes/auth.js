const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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
    discordId: u.discord_id || null,
  };
}

const TERMS_VERSION = '1.0';

// ============================================================
// Discord OAuth state helpers (HMAC-signed)
// ============================================================
function signState(payload) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
    .update(payload)
    .digest('hex')
    .slice(0, 16);
}

function buildState(kind, userIdOrCallback) {
  if (kind === 'login') {
    return 'login:' + crypto.randomBytes(8).toString('hex');
  }
  if (kind === 'link') {
    return `link:${userIdOrCallback}:${signState('link:' + userIdOrCallback)}`;
  }
  if (kind === 'app') {
    // app:base64(callback_url):hmac — callback is e.g. http://127.0.0.1:PORT/?state=NONCE
    const b64 = Buffer.from(String(userIdOrCallback), 'utf-8').toString('base64url');
    return `app:${b64}:${signState('app:' + b64)}`;
  }
  return 'login:' + crypto.randomBytes(8).toString('hex');
}

function parseState(state) {
  if (!state || typeof state !== 'string') return { kind: 'login' };
  const parts = state.split(':');
  if (parts[0] === 'link' && parts.length === 3) {
    const userId = parseInt(parts[1], 10);
    if (signState('link:' + userId) === parts[2]) {
      return { kind: 'link', userId };
    }
  }
  if (parts[0] === 'app' && parts.length === 3) {
    const b64 = parts[1];
    if (signState('app:' + b64) === parts[2]) {
      try {
        const callbackUrl = Buffer.from(b64, 'base64url').toString('utf-8');
        // Strict allowlist — only 127.0.0.1 / localhost callbacks
        const u = new URL(callbackUrl);
        if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
          return { kind: 'app', callbackUrl };
        }
      } catch {}
    }
  }
  return { kind: 'login' };
}

function discordAuthUrl(state) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirect = process.env.DISCORD_REDIRECT_URI;
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=identify%20email&state=${encodeURIComponent(state)}&prompt=consent`;
}

function discordAvatarUrl(userId, hash) {
  return hash ? `https://cdn.discordapp.com/avatars/${userId}/${hash}.png` : null;
}

async function exchangeCodeForUser(code) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirect = process.env.DISCORD_REDIRECT_URI;

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
    throw new Error('Discord token exchange failed');
  }
  const meRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const dUser = await meRes.json();
  if (!dUser.id) {
    throw new Error('Could not load Discord profile');
  }
  return dUser;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, acceptTerms } = req.body || {};
    if (!email || !username || !password) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Некорректный email' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Пароль должен быть не менее 6 символов' });
    }
    if (!acceptTerms) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо принять Условия использования и Политику конфиденциальности',
      });
    }

    const exists = await db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (exists) {
      return res.status(409).json({ success: false, error: 'Пользователь с таким email уже существует' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (email, username, password_hash, role, terms_accepted_at, terms_version)
       VALUES (?, ?, ?, ?, NOW(), ?)`,
      [email, username, hash, 'user', TERMS_VERSION]
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
  // Re-fetch full row to include created_at, etc.
  const u = await db.queryOne(
    'SELECT id, email, username, role, avatar_url, discord_id, created_at, last_login FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!u) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({
    success: true,
    user: {
      ...userPublic(u),
      created_at: u.created_at,
      last_login: u.last_login,
    },
  });
});

// PUT /api/auth/me — update own profile (username only for now)
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Имя пользователя должно быть не менее 2 символов' });
    }
    const clean = username.trim().slice(0, 100);
    await db.query('UPDATE users SET username = ? WHERE id = ?', [clean, req.user.id]);
    const u = await db.queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ success: true, user: userPublic(u) });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Заполните оба поля' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Новый пароль должен быть не менее 6 символов' });
    }

    const u = await db.queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!u || !u.password_hash) {
      return res.status(400).json({ success: false, error: 'У вашего аккаунта не задан пароль (вход через Discord). Обратитесь к администратору.' });
    }

    const ok = await bcrypt.compare(currentPassword, u.password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, error: 'Текущий пароль неверен' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/auth/logout (placeholder — JWT is stateless on server)
router.post('/logout', requireAuth, async (req, res) => {
  res.json({ success: true });
});

// POST /api/auth/logout-all — revoke all sessions (placeholder, requires session tracking)
router.post('/logout-all', requireAuth, async (req, res) => {
  // Without server-side session storage, JWT can't be revoked.
  // Real implementation would mark a token-version field on user and bump it here.
  // For now: signal client to clear local storage.
  res.json({ success: true });
});

function discordConfigError() {
  const missing = [];
  if (!process.env.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
  if (!process.env.DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
  if (!process.env.DISCORD_REDIRECT_URI) missing.push('DISCORD_REDIRECT_URI');
  return missing.length
    ? `Discord OAuth не настроен — не заданы переменные в Railway → Variables: ${missing.join(', ')}`
    : null;
}

// GET /api/auth/discord/status — публичный диагностический эндпойнт
router.get('/discord/status', (req, res) => {
  const err = discordConfigError();
  res.json({
    configured: !err,
    error: err,
    clientIdSet: !!process.env.DISCORD_CLIENT_ID,
    clientSecretSet: !!process.env.DISCORD_CLIENT_SECRET,
    redirectUriSet: !!process.env.DISCORD_REDIRECT_URI,
    redirectUri: process.env.DISCORD_REDIRECT_URI || null,
  });
});

// GET /api/auth/discord — start OAuth flow for LOGIN
//   ?app_callback=http://127.0.0.1:PORT/?state=NONCE → Electron app flow
//   (no param) → web flow
router.get('/discord', (req, res) => {
  const err = discordConfigError();
  if (err) return res.status(503).send(err);

  const appCallback = req.query.app_callback;
  let state;
  if (appCallback) {
    try {
      const u = new URL(appCallback);
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        return res.status(400).send('app_callback must point to 127.0.0.1');
      }
      state = buildState('app', appCallback);
    } catch {
      return res.status(400).send('Invalid app_callback');
    }
  } else {
    state = buildState('login');
  }
  res.redirect(discordAuthUrl(state));
});

// POST /api/auth/discord/link-url — returns OAuth URL for linking Discord to current user
router.post('/discord/link-url', requireAuth, async (req, res) => {
  const err = discordConfigError();
  if (err) return res.status(503).json({ success: false, error: err });
  const state = buildState('link', req.user.id);
  res.json({ success: true, url: discordAuthUrl(state) });
});

// POST /api/auth/discord/unlink — remove Discord binding from current user
router.post('/discord/unlink', requireAuth, async (req, res) => {
  try {
    const u = await db.queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!u) return res.status(404).json({ success: false, error: 'User not found' });
    if (!u.password_hash) {
      return res.status(400).json({
        success: false,
        error: 'Нельзя отвязать Discord: у вас не задан пароль. Сначала установите пароль для входа без Discord.',
      });
    }
    await db.query(
      'UPDATE users SET discord_id = NULL, avatar_url = CASE WHEN avatar_url LIKE ? THEN NULL ELSE avatar_url END WHERE id = ?',
      ['https://cdn.discordapp.com/%', req.user.id]
    );
    const updated = await db.queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ success: true, user: userPublic(updated) });
  } catch (err) {
    console.error('Discord unlink error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/auth/discord/callback — handles both login and link flows
router.get('/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect('/login.html?error=' + encodeURIComponent('Нет кода авторизации'));

  let dUser;
  try {
    dUser = await exchangeCodeForUser(code);
  } catch (err) {
    console.error('Discord exchange error:', err);
    return res.redirect('/login.html?error=' + encodeURIComponent(err.message));
  }

  const parsed = parseState(state);
  const avatar = discordAvatarUrl(dUser.id, dUser.avatar);

  try {
    // LINK flow: bind Discord to an existing logged-in user
    if (parsed.kind === 'link' && parsed.userId) {
      const targetUser = await db.queryOne('SELECT * FROM users WHERE id = ?', [parsed.userId]);
      if (!targetUser) {
        return res.redirect('/cabinet.html?discord=error&reason=' + encodeURIComponent('Пользователь не найден'));
      }
      // Check if this discord_id is already linked to someone else
      const existing = await db.queryOne(
        'SELECT id FROM users WHERE discord_id = ? AND id != ?',
        [dUser.id, parsed.userId]
      );
      if (existing) {
        return res.redirect('/cabinet.html?discord=error&reason=' + encodeURIComponent('Этот Discord уже привязан к другому аккаунту'));
      }
      await db.query(
        'UPDATE users SET discord_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
        [dUser.id, avatar, parsed.userId]
      );
      return res.redirect('/cabinet.html?discord=linked');
    }

    // LOGIN / REGISTER flow
    let user = await db.queryOne('SELECT * FROM users WHERE discord_id = ?', [dUser.id]);

    if (!user) {
      // Discord not linked yet — check by email
      const discordEmail = dUser.email || `${dUser.id}@discord.local`;
      const byEmail = dUser.email
        ? await db.queryOne('SELECT * FROM users WHERE email = ?', [dUser.email])
        : null;

      if (byEmail) {
        if (byEmail.discord_id && byEmail.discord_id !== dUser.id) {
          return res.redirect('/login.html?error=' + encodeURIComponent('Этот email уже привязан к другому Discord'));
        }
        // Auto-link Discord to existing email-based account
        await db.query(
          'UPDATE users SET discord_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
          [dUser.id, avatar, byEmail.id]
        );
        user = await db.queryOne('SELECT * FROM users WHERE id = ?', [byEmail.id]);
      } else {
        // Create brand-new account
        const username = (dUser.username || `user_${dUser.id}`).slice(0, 100);
        const result = await db.query(
          `INSERT INTO users (email, username, discord_id, avatar_url, role, terms_accepted_at, terms_version)
           VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
          [discordEmail, username, dUser.id, avatar, 'user', TERMS_VERSION]
        );
        user = await db.queryOne('SELECT * FROM users WHERE id = ?', [result.insertId]);
      }
    } else {
      // Update avatar to latest Discord one if user didn't customize
      if (avatar && (!user.avatar_url || user.avatar_url.includes('cdn.discordapp.com'))) {
        await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar, user.id]);
        user.avatar_url = avatar;
      }
    }

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    const token = signToken(user);

    // Electron app flow — redirect to local server with token, plus show a friendly page
    if (parsed.kind === 'app' && parsed.callbackUrl) {
      const sep = parsed.callbackUrl.includes('?') ? '&' : '?';
      const target = parsed.callbackUrl + sep + 'token=' + encodeURIComponent(token);
      // Show interstitial — auto-redirects and instructs to close tab
      const html = `<!DOCTYPE html><html lang="ru"><head>
<meta charset="UTF-8"/><title>Вход выполнен — GOS Assistant</title>
<style>
body{margin:0;font-family:-apple-system,Segoe UI,sans-serif;background:#0F0F0F;color:#FFF;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
.card{max-width:420px;background:#1A1A1A;border:1px solid #2A2A2A;border-radius:16px;padding:32px}
.icon{width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#10B981,#06B6D4);margin:0 auto 18px;display:flex;align-items:center;justify-content:center;font-size:28px}
h1{font-size:20px;margin:0 0 8px;font-weight:700}
p{color:#B0B0B0;font-size:14px;line-height:1.5;margin:6px 0}
small{color:#707070;font-size:12px;display:block;margin-top:14px}
</style></head><body>
<div class="card">
  <div class="icon">✓</div>
  <h1>Вход в GOS Assistant выполнен</h1>
  <p>Возвращаемся в приложение...</p>
  <small>Если приложение не открылось — закройте эту вкладку и вернитесь к нему вручную.</small>
</div>
<script>
  setTimeout(function(){
    location.replace(${JSON.stringify(target)});
    setTimeout(function(){ try { window.close(); } catch(e){} }, 1500);
  }, 300);
</script>
</body></html>`;
      return res.type('html').send(html);
    }

    res.redirect(`/login.html?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Discord callback error:', err);
    res.redirect('/login.html?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
