// ============================================================
// Codex-DB importer — uses pre-parsed JSON from kirikch72/codex-db
// Repo: https://hub.mos.ru/kirikch72/codex-db
// ============================================================
const fetch = require('node-fetch');

const BASE = 'https://hub.mos.ru/kirikch72/codex-db/raw/main';

// Maps codex-db section names to our category IDs
const SECTION_MAP = {
  UK: 'uk',
  AK: 'ak',
  DK: 'dk',
  PK: 'pk',
  UAK: 'uk',
};

// Available servers in codex-db (matches Codex app server list)
const AVAILABLE_SERVERS = [
  { id: 'new-york-1',     name: 'New York', file: 'new-york-1.json' },
  { id: 'detroit-2',      name: 'Detroit', file: 'detroit-2.json' },
  { id: 'chicago-3',      name: 'Chicago', file: 'chicago-3.json' },
  { id: 'san-francisco-4',name: 'San Francisco', file: 'san-francisco-4.json' },
  { id: 'atlanta-5',      name: 'Atlanta', file: 'atlanta-5.json' },
  { id: 'san-diego-6',    name: 'San Diego', file: 'san-diego-6.json' },
  { id: 'los-angeles-7',  name: 'Los Angeles', file: 'los-angeles-7.json' },
  { id: 'miami-8',        name: 'Miami', file: 'miami-8.json' },
  { id: 'las-vegas-9',    name: 'Las Vegas', file: 'las-vegas-9.json' },
  { id: 'washington-10',  name: 'Washington', file: 'washington-10.json' },
  { id: 'dallas-11',      name: 'Dallas', file: 'dallas-11.json' },
  { id: 'boston-12',      name: 'Boston', file: 'boston-12.json' },
  { id: 'houston-13',     name: 'Houston', file: 'houston-13.json' },
  { id: 'seattle-14',     name: 'Seattle', file: 'seattle-14.json' },
  { id: 'phoenix-15',     name: 'Phoenix', file: 'phoenix-15.json' },
  { id: 'denver-16',      name: 'Denver', file: 'denver-16.json' },
  { id: 'portland-17',    name: 'Portland', file: 'portland-17.json' },
];

async function fetchCodex(file) {
  const res = await fetch(`${BASE}/laws/${file}`, { timeout: 20000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} от codex-db (${file})`);
  return res.json();
}

// Convert raw codex-db format to flat list of articles
function flatten(rawData, categoryFilter) {
  const out = [];
  const data = rawData.data || rawData;
  for (const sectionKey of Object.keys(data)) {
    const section = data[sectionKey];
    const articles = section.articles || [];
    const ourCategoryId = SECTION_MAP[sectionKey.toUpperCase()] || 'uk';

    // Skip if filter doesn't match
    if (categoryFilter && categoryFilter !== ourCategoryId && categoryFilter !== sectionKey.toUpperCase()) continue;

    for (const a of articles) {
      out.push({
        sourceSection: sectionKey,
        suggestedCategoryId: ourCategoryId,
        code: a.code,
        title: a.title,
        text: a.text,
        penalty: a.penalty || null,
        wantedStars: a.wanted_stars || a.wantedStars || 0,
      });
    }
  }
  return out;
}

async function loadServer(serverFile, categoryFilter) {
  const raw = await fetchCodex(serverFile);
  const articles = flatten(raw, categoryFilter);
  return { articles, updatedAt: raw.updatedAt || null };
}

function listServers() {
  return AVAILABLE_SERVERS;
}

module.exports = { loadServer, listServers, BASE, SECTION_MAP };
