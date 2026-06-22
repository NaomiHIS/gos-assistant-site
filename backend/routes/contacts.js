const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

function parseJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function sanitizeCustomLinks(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((l) => l && typeof l === 'object' && typeof l.url === 'string' && l.url.trim())
    .slice(0, 20)
    .map((l) => ({
      label: String(l.label || l.url || '').slice(0, 64),
      url: String(l.url).slice(0, 512),
      icon: l.icon ? String(l.icon).slice(0, 8) : null,
    }));
}

function strOrNull(v, max = 255) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

async function loadContacts() {
  const row = await db.queryOne(
    `SELECT owner_name AS ownerName, owner_role AS ownerRole, about,
            avatar_url AS avatarUrl, email, telegram, discord, vk, github, website,
            custom_links AS customLinks, updated_at AS updatedAt
       FROM site_contacts WHERE id = 1`
  );
  if (!row) return null;
  return { ...row, customLinks: parseJson(row.customLinks) };
}

// ============================================================
// GET /api/contacts — публично
// ============================================================
router.get('/', async (req, res) => {
  try {
    const contacts = await loadContacts();
    res.json({ success: true, contacts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// PUT /api/contacts — admin
// ============================================================
router.put('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const ownerName = strOrNull(b.ownerName, 128);
    const ownerRole = strOrNull(b.ownerRole, 128);
    const about = b.about != null ? String(b.about).slice(0, 4000) : null;
    const avatarUrl = strOrNull(b.avatarUrl, 500);
    const email = strOrNull(b.email, 255);
    const telegram = strOrNull(b.telegram, 255);
    const discord = strOrNull(b.discord, 255);
    const vk = strOrNull(b.vk, 255);
    const github = strOrNull(b.github, 255);
    const website = strOrNull(b.website, 255);
    const customLinks = sanitizeCustomLinks(b.customLinks);

    await db.query(
      `INSERT INTO site_contacts (id, owner_name, owner_role, about, avatar_url, email,
                                  telegram, discord, vk, github, website, custom_links, updated_by)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         owner_name = VALUES(owner_name),
         owner_role = VALUES(owner_role),
         about = VALUES(about),
         avatar_url = VALUES(avatar_url),
         email = VALUES(email),
         telegram = VALUES(telegram),
         discord = VALUES(discord),
         vk = VALUES(vk),
         github = VALUES(github),
         website = VALUES(website),
         custom_links = VALUES(custom_links),
         updated_by = VALUES(updated_by)`,
      [ownerName, ownerRole, about, avatarUrl, email, telegram, discord, vk, github, website,
       JSON.stringify(customLinks), req.user.id]
    );
    const contacts = await loadContacts();
    res.json({ success: true, contacts });
  } catch (err) {
    console.error('[Contacts] update error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
