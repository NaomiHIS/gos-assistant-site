// ============================================================
// Admin-only статистика использования приложения.
// Данные берутся из user_devices — приложение шлёт ping на /api/referrals/device
// при каждом старте (см. main.js → device-tracking). last_seen обновляется
// явно в UPSERT, ping_count += 1 на каждом пинге.
// ============================================================
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

// ============================================================
// GET /api/admin/stats/app-usage — сводная статистика использования
// ============================================================
router.get('/app-usage', async (req, res) => {
  try {
    // DAU / WAU / MAU: уникальные user_id с last_seen в окне
    const windows = await db.queryOne(`
      SELECT
        (SELECT COUNT(DISTINCT user_id) FROM user_devices WHERE last_seen >= (NOW() - INTERVAL 1 DAY))   AS dau,
        (SELECT COUNT(DISTINCT user_id) FROM user_devices WHERE last_seen >= (NOW() - INTERVAL 7 DAY))   AS wau,
        (SELECT COUNT(DISTINCT user_id) FROM user_devices WHERE last_seen >= (NOW() - INTERVAL 30 DAY))  AS mau,
        (SELECT COUNT(DISTINCT user_id) FROM user_devices)                                               AS totalUsers,
        (SELECT COUNT(*)                FROM user_devices)                                               AS totalDevices,
        (SELECT COALESCE(SUM(ping_count), 0) FROM user_devices)                                          AS totalPings,
        (SELECT COUNT(*)                FROM user_devices WHERE ping_count = 0 OR ping_count IS NULL)    AS neverPinged
    `);

    // Распределение по версиям
    const versions = await db.query(`
      SELECT COALESCE(app_version, 'unknown') AS version,
             COUNT(DISTINCT user_id) AS users,
             COUNT(*) AS devices
        FROM user_devices
       WHERE last_seen >= (NOW() - INTERVAL 30 DAY)
       GROUP BY app_version
       ORDER BY users DESC
       LIMIT 20
    `);

    // Топ активных юзеров за последние 30 дней (по количеству пингов)
    const topActive = await db.query(`
      SELECT u.id, u.username, u.email, u.role,
             SUM(d.ping_count) AS pings,
             COUNT(d.id)       AS devices,
             MAX(d.last_seen)  AS lastSeen,
             MIN(d.first_seen) AS firstSeen,
             GROUP_CONCAT(DISTINCT d.app_version ORDER BY d.last_seen DESC SEPARATOR ',') AS versions
        FROM user_devices d
        JOIN users u ON u.id = d.user_id
       WHERE d.last_seen >= (NOW() - INTERVAL 30 DAY)
       GROUP BY u.id, u.username, u.email, u.role
       ORDER BY pings DESC
       LIMIT 25
    `);

    // Недавно активные (сортировка по последнему пингу)
    const recentActive = await db.query(`
      SELECT u.id, u.username, u.email, u.role,
             SUM(d.ping_count) AS pings,
             COUNT(d.id)       AS devices,
             MAX(d.last_seen)  AS lastSeen,
             GROUP_CONCAT(DISTINCT d.app_version ORDER BY d.last_seen DESC SEPARATOR ',') AS versions
        FROM user_devices d
        JOIN users u ON u.id = d.user_id
       GROUP BY u.id, u.username, u.email, u.role
       ORDER BY MAX(d.last_seen) DESC
       LIMIT 25
    `);

    // Точки последних 14 дней — простая гистограмма DAU
    const daily = await db.query(`
      SELECT DATE(last_seen) AS day, COUNT(DISTINCT user_id) AS users
        FROM user_devices
       WHERE last_seen >= (NOW() - INTERVAL 14 DAY)
       GROUP BY DATE(last_seen)
       ORDER BY day ASC
    `);

    res.json({
      success: true,
      windows: {
        dau: Number(windows?.dau || 0),
        wau: Number(windows?.wau || 0),
        mau: Number(windows?.mau || 0),
        totalUsers: Number(windows?.totalUsers || 0),
        totalDevices: Number(windows?.totalDevices || 0),
        totalPings: Number(windows?.totalPings || 0),
        neverPinged: Number(windows?.neverPinged || 0),
      },
      versions,
      topActive,
      recentActive,
      daily,
    });
  } catch (err) {
    console.error('[AdminStats] app-usage error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
