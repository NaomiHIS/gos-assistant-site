// ============================================================
// Adapter for alamantik/majestic-laws-db (GitHub)
// Source: https://github.com/alamantik/majestic-laws-db
// Format:
//   - repo_structure.json — index of files
//   - laws/{name}-{id}.json — { updatedAt, data: { UK, AK, DK, PK } }
//   - rules/{file}.json — { updatedAt, data: { main-rules, game-zones, ... } }
// ============================================================
const fetch = require('node-fetch');
const { splitInlineParts, removeEmptyParents } = require('./generic');

const BASE = 'https://raw.githubusercontent.com/NaomiHIS/majestic-laws-db/main';

// Maps source codex sections to our category IDs
const LAW_CATEGORY_MAP = {
  UK: 'uk',
  AK: 'ak',
  DK: 'dk',
  PK: 'pk',
  UAK: 'uk', // Уголовно-Административный Кодекс → УК
};

// Maps source rule sections to our category IDs
// (these categories will be auto-created when importing)
const RULE_CATEGORY_MAP = {
  // general.json
  'main-rules':         { id: 'rules-main',         name: 'Основные правила',          short: 'Общие',    color: '#8B5CF6' },
  'game-zones':         { id: 'rules-zones',        name: 'Игровые зоны',              short: 'Зоны',     color: '#EC4899' },
  'faction-leaders':    { id: 'rules-leaders',      name: 'Правила лидеров',           short: 'Лидеры',   color: '#06B6D4' },
  'forum-rules':        { id: 'rules-forum',        name: 'Правила форума',            short: 'Форум',    color: '#10B981' },
  'cheat-check':        { id: 'rules-cheat',        name: 'Проверки на ПО',            short: 'ПО',       color: '#F59E0B' },
  'admin-rules':        { id: 'rules-admin',        name: 'Внутренние правила',        short: 'Адм.',     color: '#DF005B' },
  // events.json
  'workshops-dealers':  { id: 'events-workshops',   name: 'Воркшопы и дилеры',         short: 'Воркшопы', color: '#0070F3' },
  'supply-hijack':      { id: 'events-supply',      name: 'Захват грузов',             short: 'Грузы',    color: '#F97316' },
  'fort-zancudo':       { id: 'events-zancudo',     name: 'Форт Занкудо',              short: 'Занкудо',  color: '#84CC16' },
  'cayo-perico':        { id: 'events-cayo',        name: 'Кайо-Перико',               short: 'Кайо',     color: '#14B8A6' },
  'material-war':       { id: 'events-material',    name: 'Битва за материалы',        short: 'Битва',    color: '#A855F7' },
  // organizations.json
  'family-general':     { id: 'org-family',         name: 'Правила семей',             short: 'Семьи',    color: '#EF4444' },
  'crime-general':      { id: 'org-crime',          name: 'Криминальные правила',      short: 'Крим.',    color: '#DF005B' },
  'territory-war':      { id: 'org-territory',      name: 'Войны территорий',          short: 'Терр.',    color: '#F59E0B' },
  'raids':              { id: 'org-raids',          name: 'Рейды',                     short: 'Рейды',    color: '#EAB308' },
  'business-robbery':   { id: 'org-biz-rob',        name: 'Ограбление бизнеса',        short: 'Бизнес',   color: '#22C55E' },
  'bank-robbery':       { id: 'org-bank-rob',       name: 'Ограбление банка',          short: 'Банк',     color: '#10B981' },
  'martial-law':        { id: 'org-martial',        name: 'Военное положение',         short: 'Воен.',    color: '#06B6D4' },
  'state-general':      { id: 'org-state',          name: 'Правила государства',       short: 'Гос.',     color: '#0EA5E9' },
  'game-terror':        { id: 'org-terror',         name: 'Игровой террор',            short: 'Террор',   color: '#3B82F6' },
  'robbery-kidnap':     { id: 'org-kidnap',         name: 'Похищение и грабёж',        short: 'Грабёж',   color: '#6366F1' },
};

// Palette to assign colors to unknown sections (deterministic by hash)
const FALLBACK_COLORS = ['#8B5CF6', '#EC4899', '#06B6D4', '#10B981', '#F59E0B', '#DF005B', '#0070F3', '#F97316', '#84CC16', '#14B8A6'];

function slugToTitle(slug) {
  return String(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Get mapping for a section; if unknown — generate one
function getRuleCategory(sectionKey) {
  if (RULE_CATEGORY_MAP[sectionKey]) return RULE_CATEGORY_MAP[sectionKey];
  // Auto-generate for unknown sections so future additions to source repo
  // don't require code changes
  const title = slugToTitle(sectionKey);
  return {
    id: 'rules-' + sectionKey.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    name: title,
    short: title.slice(0, 12),
    color: FALLBACK_COLORS[hashString(sectionKey) % FALLBACK_COLORS.length],
  };
}

async function fetchJson(path) {
  const url = `${BASE}/${path}`.replace(/ /g, '%20');
  const res = await fetch(url, { timeout: 30000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} при загрузке ${path}`);
  return res.json();
}

// Returns the index of available files
async function loadStructure() {
  return fetchJson('repo_structure.json');
}

// Normalize server file name into a clean ID and display name
//   "los angeles-7.json" -> { id: "los-angeles-7", name: "Los Angeles", number: 7, file: "los angeles-7.json" }
function parseServerFile(filename) {
  const baseName = filename.replace(/\.json$/, '');
  const match = baseName.match(/^(.+?)-(\d+)$/);
  if (!match) {
    return { id: baseName.replace(/\s+/g, '-').toLowerCase(), name: baseName, number: null, file: filename };
  }
  const rawName = match[1].trim();
  const number = parseInt(match[2], 10);
  const id = `${rawName.replace(/\s+/g, '-').toLowerCase()}-${number}`;
  const name = rawName.replace(/\b\w/g, (c) => c.toUpperCase());
  return { id, name, number, file: filename };
}

async function listServers() {
  const struct = await loadStructure();
  const files = (struct.laws && struct.laws.files) || [];
  return files.map(parseServerFile).sort((a, b) => (a.number || 0) - (b.number || 0));
}

async function listRules() {
  const struct = await loadStructure();
  return (struct.rules && struct.rules.files) || [];
}

// Convert raw law JSON to flat list of articles
function flattenLaws(rawData) {
  const out = [];
  const data = rawData.data || {};
  for (const sectionKey of Object.keys(data)) {
    const section = data[sectionKey];
    const articles = section.articles || [];
    const ourCategoryId = LAW_CATEGORY_MAP[sectionKey.toUpperCase()] || sectionKey.toLowerCase();
    for (const a of articles) {
      out.push({
        sourceSection: sectionKey,
        suggestedCategoryId: ourCategoryId,
        code: String(a.code || ''),
        title: a.title || '',
        text: a.text || a.title || '',
        penalty: a.penalty || null,
        wantedStars: a.wanted_stars || a.wantedStars || 0,
        jurisdiction: a.jurisdiction || null,
      });
    }
  }
  return out;
}

function flattenRules(rawData) {
  const out = [];
  const data = rawData.data || {};
  for (const sectionKey of Object.keys(data)) {
    const section = data[sectionKey];
    const items = Array.isArray(section) ? section : (section.articles || []);
    if (!Array.isArray(items) || items.length === 0) continue;
    const mapping = getRuleCategory(sectionKey);
    for (const a of items) {
      const pieces = [a.text, a.explanation, a.note, a.exception].filter(Boolean).join('\n\n');
      out.push({
        sourceSection: sectionKey,
        suggestedCategoryId: mapping.id,
        suggestedCategoryName: mapping.name,
        suggestedCategoryShort: mapping.short,
        suggestedCategoryColor: mapping.color,
        code: String(a.code || ''),
        title: a.title || '',
        text: pieces || a.title || '',
        penalty: a.penalty || null,
        wantedStars: 0,
      });
    }
  }
  return out;
}

async function loadServerLaws(serverFile) {
  const raw = await fetchJson(`laws/${serverFile}`);
  let articles = flattenLaws(raw);
  articles = removeEmptyParents(splitInlineParts(articles));
  return { articles, updatedAt: raw.updatedAt || null };
}

async function loadRulesFile(rulesFile) {
  const raw = await fetchJson(`rules/${rulesFile}`);
  let articles = flattenRules(raw);
  articles = removeEmptyParents(splitInlineParts(articles));
  return { articles, updatedAt: raw.updatedAt || null };
}

// Get all updatedAt timestamps in one pass — for sync diff
async function getAllVersions() {
  const struct = await loadStructure();
  const lawFiles = (struct.laws && struct.laws.files) || [];
  const ruleFiles = (struct.rules && struct.rules.files) || [];

  const versions = { laws: {}, rules: {} };

  // Fetch in parallel batches
  await Promise.all(lawFiles.map(async (file) => {
    try {
      const data = await fetchJson(`laws/${file}`);
      const serverInfo = parseServerFile(file);
      versions.laws[serverInfo.id] = {
        file,
        serverId: serverInfo.id,
        serverName: serverInfo.name,
        serverNumber: serverInfo.number,
        updatedAt: data.updatedAt || null,
      };
    } catch (err) {
      console.warn('Failed to fetch', file, err.message);
    }
  }));

  await Promise.all(ruleFiles.map(async (file) => {
    try {
      const data = await fetchJson(`rules/${file}`);
      versions.rules[file] = { file, updatedAt: data.updatedAt || null };
    } catch (err) {
      console.warn('Failed to fetch', file, err.message);
    }
  }));

  return versions;
}

module.exports = {
  BASE,
  LAW_CATEGORY_MAP,
  RULE_CATEGORY_MAP,
  loadStructure,
  listServers,
  listRules,
  parseServerFile,
  loadServerLaws,
  loadRulesFile,
  getAllVersions,
};
