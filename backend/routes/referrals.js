// ============================================================
// Реферальная программа (app-flow)
// Юзер регистрируется → ставит приложение → вводит чужой реферальный код
// в окне приложения. Приложение шлёт {code, hwid}. Бэк проверяет:
//   - юзер ещё не активировал реферал (one-time per account)
//   - HWID не привязан к другому аккаунту (один человек — одна награда)
//   - IP+HWID не были замечены под другим аккаунтом
//   - referrer != redeemer
// На успехе: Lite 7д юзеру, Premium +2д рефереру (стек), запись в referrals.
// ============================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { extendOrGrantBySlug, grantSubscription } = require('./subscriptions');

const router = express.Router();

// Параметры программы — все в одном месте
const CODE_LEN = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFEREE_PLAN = 'lite';
const REFEREE_DAYS = 7;
const REFERRER_PLAN = 'premium';
const REFERRER_DAYS = 2;

// ============================================================
// Helpers
// ============================================================
function makeCode() {
  let s = '';
  const bytes = crypto.randomBytes(CODE_LEN);
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

async function ensureUserCode(userId) {
  const u = await db.queryOne('SELECT referral_code FROM users WHERE id = ?', [userId]);
  if (!u) throw new Error('user not found');
  if (u.referral_code) return u.referral_code;
  for (let i = 0; i < 5; i++) {
    const code = makeCode();
    try {
      await db.query('UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL', [code, userId]);
      const check = await db.queryOne('SELECT referral_code FROM users WHERE id = ?', [userId]);
      if (check && check.referral_code) return check.referral_code;
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('cannot generate referral code');
}

function extractIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').toString();
  if (xff) return xff.split(',')[0].trim();
  return (req.ip || '').toString();
}

function validateHwid(hwid) {
  if (typeof hwid !== 'string') return null;
  const trimmed = hwid.trim().toLowerCase();
  if (!/^[a-f0-9]{32,128}$/.test(trimmed)) return null;
  return trimmed;
}

// ============================================================
// Anti-fraud для app-redeem.
// Возвращает {allowed: true} или {allowed: false, reason}.
// ============================================================
async function checkRedeemFraud({ refererUserId, refereeUserId, hwid, ip }) {
  if (refererUserId === refereeUserId) {
    return { allowed: false, reason: 'self_referral' };
  }
  // HWID юзера уже зарегистрирован под другим аккаунтом?
  const conflict = await db.queryOne(
    `SELECT user_id FROM user_devices WHERE hwid = ? AND user_id <> ? LIMIT 1`,
    [hwid, refereeUserId]
  );
  if (conflict) {
    return { allowed: false, reason: 'hwid_belongs_to_other_user', conflictUserId: conflict.user_id };
  }
  // Тот же HWID когда-то был у реферера?
  const refererHasHwid = await db.queryOne(
    `SELECT id FROM user_devices WHERE user_id = ? AND hwid = ? LIMIT 1`,
    [refererUserId, hwid]
  );
  if (refererHasHwid) {
    return { allowed: false, reason: 'same_hwid_as_referrer' };
  }
  // Тот же IP у реферера в момент его регистрации?
  if (ip) {
    const refererSameIp = await db.queryOne(
      `SELECT id FROM users WHERE id = ? AND registration_ip = ?`,
      [refererUserId, ip]
    );
    if (refererSameIp) {
      return { allowed: false, reason: 'same_ip_as_referrer' };
    }
    // Тот же IP уже был у реферера в его user_devices?
    const refererIpDevice = await db.queryOne(
      `SELECT id FROM user_devices WHERE user_id = ? AND (first_ip = ? OR last_ip = ?) LIMIT 1`,
      [refererUserId, ip, ip]
    );
    if (refererIpDevice) {
      return { allowed: false, reason: 'same_ip_as_referrer_device' };
    }
  }
  return { allowed: true };
}

// ============================================================
// POST /api/auth/device — приложение шлёт HWID при каждом старте.
// Молча обновляет last_seen / last_ip; добавляет новые HWID к юзеру.
// Используется для антифрод-истории.
// ============================================================
router.post('/device', requireAuth, async (req, res) => {
  try {
    const hwid = validateHwid(req.body && req.body.hwid);
    if (!hwid) return res.status(400).json({ success: false, error: 'Invalid hwid' });
    const platform = String((req.body && req.body.platform) || '').slice(0, 32);
    const ip = extractIp(req);
    await db.query(
      `INSERT INTO user_devices (user_id, hwid, platform, first_ip, last_ip)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_ip = VALUES(last_ip), platform = COALESCE(VALUES(platform), platform)`,
      [req.user.id, hwid, platform || null, ip || null, ip || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Referrals] /device error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/referrals/redeem — приложение шлёт код + HWID
// Body: { code, hwid, platform }
// ============================================================
router.post('/redeem', requireAuth, async (req, res) => {
  try {
    const code = String((req.body && req.body.code) || '').trim().toUpperCase();
    const hwid = validateHwid(req.body && req.body.hwid);
    const platform = String((req.body && req.body.platform) || '').slice(0, 32);
    if (!code) return res.status(400).json({ success: false, error: 'Введите реферальный код' });
    if (!hwid) return res.status(400).json({ success: false, error: 'Приложение не передало HWID' });

    // Уже использован?
    const me = await db.queryOne('SELECT id, referral_redeemed, referred_by_user_id FROM users WHERE id = ?', [req.user.id]);
    if (!me) return res.status(404).json({ success: false, error: 'User not found' });
    if (me.referral_redeemed) {
      return res.status(409).json({ success: false, error: 'Вы уже активировали реферальный код. Это можно сделать только один раз.' });
    }

    const referrer = await db.queryOne(
      'SELECT id, username, email FROM users WHERE referral_code = ? LIMIT 1',
      [code]
    );
    if (!referrer) {
      return res.status(404).json({ success: false, error: 'Реферальный код не найден' });
    }

    const ip = extractIp(req);
    const verdict = await checkRedeemFraud({
      refererUserId: referrer.id,
      refereeUserId: req.user.id,
      hwid, ip,
    });

    if (!verdict.allowed) {
      await db.query(
        `INSERT INTO referrals (referrer_user_id, referee_user_id, referee_ip, referee_user_agent,
                                status, block_reason, redeem_source, redeem_hwid,
                                referrer_reward_days, referee_reward_days)
         VALUES (?, ?, ?, ?, 'blocked', ?, 'app', ?, 0, 0)
         ON DUPLICATE KEY UPDATE block_reason = VALUES(block_reason), redeem_hwid = VALUES(redeem_hwid),
                                 redeem_source = VALUES(redeem_source)`,
        [referrer.id, req.user.id, ip || null, (req.headers['user-agent'] || '').slice(0, 255), verdict.reason, hwid]
      );
      console.warn(`[Referrals] REDEEM BLOCKED reason=${verdict.reason} referrer=${referrer.id} referee=${req.user.id} hwid=${hwid.slice(0, 12)}…`);
      const friendly = {
        self_referral: 'Нельзя активировать свой собственный код.',
        hwid_belongs_to_other_user: 'С этого устройства уже регистрировался другой аккаунт. Реферальная награда не выдана.',
        same_hwid_as_referrer: 'Этот код принадлежит вам же (то же устройство).',
        same_ip_as_referrer: 'С этой сети регистрировался автор кода. Награда не выдана.',
        same_ip_as_referrer_device: 'Эта сеть уже использовалась автором кода.',
      };
      return res.status(403).json({
        success: false,
        error: friendly[verdict.reason] || 'Активация заблокирована системой безопасности.',
        code: 'REFERRAL_BLOCKED',
        reason: verdict.reason,
      });
    }

    // Регистрируем HWID за юзером (или обновляем)
    await db.query(
      `INSERT INTO user_devices (user_id, hwid, platform, first_ip, last_ip)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_ip = VALUES(last_ip)`,
      [req.user.id, hwid, platform || null, ip || null, ip || null]
    );

    // Метим юзера и привязываем реферера
    await db.query(
      'UPDATE users SET referral_redeemed = 1, referred_by_user_id = ? WHERE id = ?',
      [referrer.id, req.user.id]
    );

    // Выдаём награды
    let refereeSubId = null;
    let referrerSubId = null;
    try {
      const lite = await db.queryOne("SELECT id FROM subscription_plans WHERE slug = ? AND is_active = 1", [REFEREE_PLAN]);
      if (lite) {
        refereeSubId = await grantSubscription({
          userId: req.user.id,
          planId: lite.id,
          durationDays: REFEREE_DAYS,
          notes: 'Referral redeem app (приглашён user#' + referrer.id + ')',
        });
      }
    } catch (e) {
      console.error('[Referrals] grant Lite failed:', e.message);
    }
    try {
      referrerSubId = await extendOrGrantBySlug({
        userId: referrer.id,
        planSlug: REFERRER_PLAN,
        days: REFERRER_DAYS,
        notes: 'Referral bonus (привёл user#' + req.user.id + ')',
      });
    } catch (e) {
      console.error('[Referrals] grant Premium failed:', e.message);
    }

    await db.query(
      `INSERT INTO referrals (referrer_user_id, referee_user_id, referee_ip, referee_user_agent,
                              status, redeem_source, redeem_hwid,
                              referrer_reward_days, referee_reward_days)
       VALUES (?, ?, ?, ?, 'granted', 'app', ?, ?, ?)
       ON DUPLICATE KEY UPDATE status='granted', referrer_reward_days=VALUES(referrer_reward_days),
                               referee_reward_days=VALUES(referee_reward_days), redeem_hwid=VALUES(redeem_hwid),
                               redeem_source='app'`,
      [referrer.id, req.user.id, ip || null, (req.headers['user-agent'] || '').slice(0, 255),
       hwid, REFERRER_DAYS, REFEREE_DAYS]
    );
    console.log(`[Referrals] REDEEM GRANTED referrer=${referrer.id} referee=${req.user.id}`);
    res.json({
      success: true,
      message: `Готово! Вам начислен ${REFEREE_PLAN.toUpperCase()} на ${REFEREE_DAYS} дней.`,
      refereeName: referrer.username || referrer.email,
      refereeBonusDays: REFEREE_DAYS,
      referrerBonusDays: REFERRER_DAYS,
    });
  } catch (err) {
    console.error('[Referrals] /redeem error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/referrals/me — мой код, статистика, список приглашённых
// ============================================================
router.get('/me', requireAuth, async (req, res) => {
  try {
    const code = await ensureUserCode(req.user.id);
    const stats = await db.queryOne(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'granted' THEN 1 ELSE 0 END) AS granted,
         SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
         COALESCE(SUM(CASE WHEN status = 'granted' THEN referrer_reward_days ELSE 0 END), 0) AS totalDays
       FROM referrals WHERE referrer_user_id = ?`,
      [req.user.id]
    );
    const list = await db.query(
      `SELECT r.id, r.status, r.referrer_reward_days AS rewardDays, r.created_at AS createdAt,
              r.redeem_source AS source,
              u.username AS refereeName, u.email AS refereeEmail
         FROM referrals r
         LEFT JOIN users u ON u.id = r.referee_user_id
        WHERE r.referrer_user_id = ?
        ORDER BY r.created_at DESC
        LIMIT 50`,
      [req.user.id]
    );
    const me = await db.queryOne('SELECT referral_redeemed FROM users WHERE id = ?', [req.user.id]);
    res.json({
      success: true,
      code,
      myRedeemed: !!(me && me.referral_redeemed),
      stats: {
        total: Number(stats?.total || 0),
        granted: Number(stats?.granted || 0),
        blocked: Number(stats?.blocked || 0),
        totalDays: Number(stats?.totalDays || 0),
      },
      referrals: list,
      programDescription: `Поделись своим кодом. Новый пользователь вводит его в приложении (Настройки → Реферальная программа) и получает ${REFEREE_PLAN.toUpperCase()} на ${REFEREE_DAYS} дн. Ты — ${REFERRER_PLAN.toUpperCase()} +${REFERRER_DAYS} дн. за каждого. Бонусы суммируются.`,
    });
  } catch (err) {
    console.error('[Referrals] /me error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.extractIp = extractIp;
