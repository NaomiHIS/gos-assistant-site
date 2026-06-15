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

const BASE = 'https://raw.githubusercontent.com/alamantik/majestic-laws-db/main';

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
  'main-rules':      { id: 'rules-main',    name: 'Основные правила',         short: 'Общие',   color: '#8B5CF6' },
  'game-zones':      { id: 'rules-zones',   name: 'Игровые зоны',             short: 'Зоны',    color: '#EC4899' },
  'faction-leaders': { id: 'rules-leaders', name: 'Правила лидеров',          short: 'Лидеры',  color: '#06B6D4' },
  'forum-rules':     { id: 'rules-forum',   name: 'Правила форума',           short: 'Форум',   color: '#10B981' },
  'cheat-check':     { id: 'rules-cheat',   name: 'Проверки на ПО',           short: 'ПО',      color: '#F59E0B' },
  'admin-rules':     { id: 'rules-admin',   name: 'Внутренние правила',       short: 'Адм.',    color: '#DF005B' },
};

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
    const mapping = RULE_CATEGORY_MAP[sectionKey];
    if (!mapping) continue;
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
