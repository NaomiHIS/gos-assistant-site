const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

function computeSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
    stream.on('error', reject);
  });
}

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || (200 * 1024 * 1024), 10); // 200MB

// Ensure uploads directory exists
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (err) {
  console.warn('Could not create uploads dir:', err.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(exe|zip|7z|msi)$/i;
    if (allowed.test(file.originalname)) cb(null, true);
    else cb(new Error('Только .exe, .msi, .zip, .7z файлы разрешены'));
  },
});

function mapRelease(r) {
  return {
    id: r.id,
    type: r.type,
    version: r.version,
    filename: r.filename,
    originalName: r.original_name,
    size: r.size,
    sizeFormatted: formatSize(r.size),
    notes: r.notes,
    isActive: !!r.is_active,
    downloadCount: r.download_count,
    createdAt: r.created_at,
    downloadUrl: `/api/releases/download/${r.id}`,
  };
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(v < 10 ? 1 : 0) + ' ' + units[i];
}

// ============================================================
// GET /api/releases/latest — публичный, возвращает последние активные релизы
// ============================================================
router.get('/latest', async (req, res) => {
  try {
    const installer = await db.queryOne(
      "SELECT * FROM releases WHERE type='installer' AND is_active=1 ORDER BY created_at DESC LIMIT 1"
    );
    const portable = await db.queryOne(
      "SELECT * FROM releases WHERE type='portable' AND is_active=1 ORDER BY created_at DESC LIMIT 1"
    );
    res.json({
      success: true,
      installer: installer ? mapRelease(installer) : null,
      portable: portable ? mapRelease(portable) : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/releases/download/:id — публичный, отдаёт файл (требует логин)
// ============================================================
router.get('/download/:id', requireAuth, async (req, res) => {
  try {
    const release = await db.queryOne(
      'SELECT * FROM releases WHERE id = ? AND is_active = 1',
      [req.params.id]
    );
    if (!release) return res.status(404).json({ error: 'Файл не найден' });

    const filePath = path.join(UPLOADS_DIR, release.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Файл утерян на сервере' });
    }

    await db.query('UPDATE releases SET download_count = download_count + 1 WHERE id = ?', [release.id]);

    res.download(filePath, release.original_name, (err) => {
      if (err) console.error('Download stream error:', err);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/releases — admin only, list all
// ============================================================
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT r.*, u.username AS uploader_name FROM releases r LEFT JOIN users u ON u.id = r.uploaded_by ORDER BY r.created_at DESC'
    );
    res.json({
      success: true,
      releases: rows.map((r) => ({
        ...mapRelease(r),
        uploaderName: r.uploader_name,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/releases/upload — admin only
// ============================================================
router.post('/upload', requireAuth, requireRole('admin'), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Файл не получен' });
    }

    const { type, version, notes } = req.body;
    if (!type || !['installer', 'portable'].includes(type)) {
      // Cleanup uploaded file
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ success: false, error: 'type должен быть installer или portable' });
    }
    if (!version || !version.trim()) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ success: false, error: 'Версия обязательна' });
    }

    try {
      // Compute sha512 for auto-updater verification
      let sha512 = null;
      try {
        sha512 = await computeSha512(req.file.path);
      } catch (hashErr) {
        console.warn('sha512 compute failed:', hashErr.message);
      }
      const result = await db.query(
        `INSERT INTO releases (type, version, filename, original_name, size, sha512, notes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type,
          version.trim().slice(0, 32),
          req.file.filename,
          req.file.originalname,
          req.file.size,
          sha512,
          (notes || '').slice(0, 1000) || null,
          req.user.id,
        ]
      );
      const row = await db.queryOne('SELECT * FROM releases WHERE id = ?', [result.insertId]);
      res.json({ success: true, release: mapRelease(row) });
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ success: false, error: e.message });
    }
  });
});

// ============================================================
// PUT /api/releases/:id — admin only — toggle active / edit notes
// ============================================================
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { isActive, notes, version } = req.body;
    const updates = [];
    const params = [];
    if (typeof isActive === 'boolean') {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }
    if (typeof notes === 'string') {
      updates.push('notes = ?');
      params.push(notes.slice(0, 1000));
    }
    if (typeof version === 'string' && version.trim()) {
      updates.push('version = ?');
      params.push(version.trim().slice(0, 32));
    }
    if (!updates.length) return res.status(400).json({ error: 'Нечего обновлять' });
    params.push(req.params.id);
    await db.query(`UPDATE releases SET ${updates.join(', ')} WHERE id = ?`, params);
    const row = await db.queryOne('SELECT * FROM releases WHERE id = ?', [req.params.id]);
    res.json({ success: true, release: mapRelease(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// DELETE /api/releases/:id — admin only
// ============================================================
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const release = await db.queryOne('SELECT * FROM releases WHERE id = ?', [req.params.id]);
    if (!release) return res.status(404).json({ error: 'Релиз не найден' });

    const filePath = path.join(UPLOADS_DIR, release.filename);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (err) {
      console.warn('Failed to delete file:', err.message);
    }
    await db.query('DELETE FROM releases WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// Auto-updater feed (electron-updater "generic" provider)
// The app polls /feed/latest.yml, parses it, downloads the file
// referenced by URL (relative path) from the same directory.
// ============================================================

function escapeYaml(s) {
  return String(s || '').replace(/'/g, "''");
}

// GET /api/releases/feed/latest.yml — manifest for electron-updater
// PUBLIC: electron-updater needs to download files without auth headers
// (the secondary file request often loses requestHeaders).
// This is the standard pattern (GitHub Releases is public too).
router.get('/feed/latest.yml', async (req, res) => {
  try {
    const r = await db.queryOne(
      "SELECT * FROM releases WHERE type='installer' AND is_active=1 AND sha512 IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    );
    if (!r) return res.status(404).type('text/plain').send('# No installer release available');

    const releaseDate = new Date(r.created_at).toISOString();
    const yml = [
      `version: ${r.version}`,
      `files:`,
      `  - url: ${r.original_name}`,
      `    sha512: ${r.sha512}`,
      `    size: ${r.size}`,
      `path: ${r.original_name}`,
      `sha512: ${r.sha512}`,
      `releaseDate: '${releaseDate}'`,
    ].join('\n');

    res.type('text/yaml').send(yml);
  } catch (err) {
    console.error('latest.yml error:', err);
    res.status(500).type('text/plain').send('# ' + err.message);
  }
});

// GET /api/releases/feed/:filename — serve actual file for electron-updater
// PUBLIC (see /feed/latest.yml comment above)
router.get('/feed/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    // Try by original name first, then by stored filename
    const r = await db.queryOne(
      'SELECT * FROM releases WHERE (original_name = ? OR filename = ?) AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
      [filename, filename]
    );
    if (!r) return res.status(404).send('Not found');
    const filePath = path.join(UPLOADS_DIR, r.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File missing on server');
    await db.query('UPDATE releases SET download_count = download_count + 1 WHERE id = ?', [r.id]);
    res.download(filePath, r.original_name);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
