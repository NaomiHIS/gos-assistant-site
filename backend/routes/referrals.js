// ============================================================
// Реферальная программа
// Новый юзер по ?ref=CODE: Lite 7 дней.
// Реферер (владелец кода): Premium +2 дня за каждого валидного.
// Анти-фрод: совпадение IP, самоприглашение, дубль-регистрации с одного IP.
// ============================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { extendOrGrantBySlug, grantSubscription, loadCurrentSubscription } = require('./subscriptions');

const router = express.Router();

// Параметры программы (легко поменять при изменении промо)
const CODE_LEN = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFEREE_PLAN = 'lite';
const REFEREE_DAYS = 7;
const REFERRER_PLAN = 'premium';
const REFERRER_DAYS = 2;
const SAME_IP_WINDOW_DAYS = 30; // блокируем если этот же IP уже регистрировался по реф-коду за N дней
const MAX_REFERRALS_PER_IP_30D = 1; // на один внешний IP — максимум одна валидная награда в 30 дней

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
  // Генерим, пока не получим уникальный (коллизии практически невозможны на 32^8)
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

// ============================================================
// Анти-фрод: возвращает { allowed: true } или { allowed: false, reason }
// Вызывается ПОСЛЕ создания нового юзера, ПЕРЕД выдачей наград.
// ============================================================
async function checkReferralFraud({ refererUserId, refereeUserId, refereeIp }) {
  if (refererUserId === refereeUserId) {
    return { allowed: false, reason: 'self_referral' };
  }
  // Сам себе ссылку отдать нельзя: реферер не может зарегистрировать сам себя.
  if (!refereeIp) {
    return { allowed: false, reason: 'no_ip' };
  }
  // 1. Реферер с этого IP когда-то регистрировался?
  const refererSameIp = await db.queryOne(
    `SELECT id FROM users WHERE id = ? AND registration_ip = ?`,
    [refererUserId, refereeIp]
  );
  if (refererSameIp) {
    return { allowed: false, reason: 'same_ip_as_referrer' };
  }
  // 2. С этого IP уже регистрировались по реф-ссылке за SAME_IP_WINDOW_DAYS дней
  const recent = await db.queryOne(
    `SELECT COUNT(*) AS cnt FROM referrals
       WHERE referee_ip = ?
         AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
         AND status = 'granted'`,
    [refereeIp, SAME_IP_WINDOW_DAYS]
  );
  if (recent && Number(recent.cnt) >= MAX_REFERRALS_PER_IP_30D) {
    return { allowed: false, reason: 'ip_quota_exceeded' };
  }
  // 3. Этот IP когда-либо принадлежал самому рефереру (входы/регистрация)
  // (мы пока храним только registration_ip — это покрывает основной кейс)
  return { allowed: true };
}

// ============================================================
// processReferral — вызывается из /auth/register сразу после INSERT users.
// Может тихо упасть — не должен ломать регистрацию.
// ============================================================
async function processReferral({ referralCode, newUserId, ip, userAgent }) {
  if (!referralCode || typeof referralCode !== 'string') return null;
  const code = referralCode.trim().toUpperCase();
  if (!code) return null;
  try {
    const referrer = await db.queryOne(
      'SELECT id FROM users WHERE referral_code = ? LIMIT 1',
      [code]
    );
    if (!referrer) {
      console.warn('[Referrals] code not found:', code);
      return null;
    }
    const verdict = await checkReferralFraud({
      refererUserId: referrer.id,
      refereeUserId: newUserId,
      refereeIp: ip,
    });

    // Фиксируем связь в users
    await db.query(
      'UPDATE users SET referred_by_user_id = ? WHERE id = ?',
      [referrer.id, newUserId]
    );

    if (!verdict.allowed) {
      // Не выдаём награды, но логируем попытку для админ-просмотра
      await db.query(
        `INSERT INTO referrals (referrer_user_id, referee_user_id, referee_ip, referee_user_agent,
                                status, block_reason, referrer_reward_days, referee_reward_days)
         VALUES (?, ?, ?, ?, 'blocked', ?, 0, 0)`,
        [referrer.id, newUserId, ip || null, (userAgent || '').slice(0, 255), verdict.reason]
      );
      console.warn(`[Referrals] BLOCKED reason=${verdict.reason} referrer=${referrer.id} referee=${newUserId} ip=${ip}`);
      return { blocked: true, reason: verdict.reason };
    }

    // Выдаём награды
    let refereeSubId = null;
    let referrerSubId = null;
    try {
      const lite = await db.queryOne("SELECT id FROM subscription_plans WHERE slug = ? AND is_active = 1", [REFEREE_PLAN]);
      if (lite) {
        refereeSubId = await grantSubscription({
          userId: newUserId,
          planId: lite.id,
          durationDays: REFEREE_DAYS,
          notes: 'Referral bonus (по приглашению user#' + referrer.id + ')',
        });
      }
    } catch (e) {
      console.error('[Referrals] grant Lite to referee failed:', e.message);
    }
    try {
      referrerSubId = await extendOrGrantBySlug({
        userId: referrer.id,
        planSlug: REFERRER_PLAN,
        days: REFERRER_DAYS,
        notes: 'Referral bonus (привёл user#' + newUserId + ')',
      });
    } catch (e) {
      console.error('[Referrals] grant Premium to referrer failed:', e.message);
    }

    await db.query(
      `INSERT INTO referrals (referrer_user_id, referee_user_id, referee_ip, referee_user_agent,
                              status, referrer_reward_days, referee_reward_days)
       VALUES (?, ?, ?, ?, 'granted', ?, ?)`,
      [referrer.id, newUserId, ip || null, (userAgent || '').slice(0, 255), REFERRER_DAYS, REFEREE_DAYS]
    );
    console.log(`[Referrals] GRANTED referrer=${referrer.id} (+${REFERRER_DAYS}d Premium) referee=${newUserId} (+${REFEREE_DAYS}d Lite)`);
    return { granted: true, refereeSubId, referrerSubId };
  } catch (err) {
    console.error('[Referrals] processReferral error:', err);
    return null;
  }
}

// ============================================================
// GET /api/referrals/me — мой код, статистика, последние приглашённые
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
              u.username AS refereeName, u.email AS refereeEmail
         FROM referrals r
         LEFT JOIN users u ON u.id = r.referee_user_id
        WHERE r.referrer_user_id = ?
        ORDER BY r.created_at DESC
        LIMIT 50`,
      [req.user.id]
    );
    res.json({
      success: true,
      code,
      stats: {
        total: Number(stats?.total || 0),
        granted: Number(stats?.granted || 0),
        blocked: Number(stats?.blocked || 0),
        totalDays: Number(stats?.totalDays || 0),
      },
      referrals: list,
      programDescription: `Поделись ссылкой: новый юзер получит ${REFEREE_PLAN.toUpperCase()} на ${REFEREE_DAYS} дн., ты — ${REFERRER_PLAN.toUpperCase()} на ${REFERRER_DAYS} дн. за каждого. Бонусы суммируются.`,
    });
  } catch (err) {
    console.error('[Referrals] /me error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.processReferral = processReferral;
module.exports.extractIp = extractIp;
