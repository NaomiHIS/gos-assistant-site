const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loadCurrentSubscription } = require('./subscriptions');

const FEATURE_KEY = 'ai_assistant';

// ============================================================
// Config (env)
// ============================================================
// AI_API_BASE_URL — например https://api.proxyapi.ru/openai/v1 или https://api.openai.com/v1
// AI_API_KEY     — секрет провайдера (rk_live_..., sk-...)
// AI_MODEL       — по умолчанию gpt-5-nano
// AI_MAX_TOKENS  — лимит ответа
const AI_BASE_URL = (process.env.AI_API_BASE_URL || 'https://api.vsegpt.ru/v1').replace(/\/+$/, '');
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-3.1-pro-preview-1m';
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '2000', 10);
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.2');

// ============================================================
// Available role personas — passed by client to bias the system prompt.
// "civilian" — default if nothing matches.
// ============================================================
const ROLE_PROMPTS = {
  lawyer:    'Ты выступаешь от лица адвоката защиты. Опирайся на статьи УК/АК/ДК/ПК, ищи смягчающие обстоятельства, спорные моменты, нарушения процедуры со стороны ПД. Предложи линию защиты и какие доводы озвучить в суде.',
  prosecutor:'Ты выступаешь от лица прокурора. Указывай отягчающие обстоятельства, корректно квалифицируй деяние по статьям УК/АК/ДК/ПК, обосновывай меру наказания и срок розыска.',
  cop:       'Ты выступаешь от лица сотрудника полицейского департамента (ПД). Квалифицируй действия по статьям УК/АК/ДК/ПК, укажи звёзды розыска (wanted_stars), полагающееся наказание (штраф/срок/конфискация), укажи правильный порядок задержания.',
  judge:     'Ты выступаешь от лица судьи. Беспристрастно квалифицируй деяние по статьям УК/АК/ДК/ПК, перечисли все применимые статьи, укажи итоговое наказание с учётом смягчающих и отягчающих, объясни почему.',
  civilian:  'Ты помогаешь обычному игроку разобраться в ситуации с точки зрения правил Majestic RP. Простым языком объясни какие законы нарушены, какое грозит наказание, и что можно сделать.',
};

const ROLE_LABEL = {
  lawyer: 'Адвокат',
  prosecutor: 'Прокурор',
  cop: 'Сотрудник ПД',
  judge: 'Судья',
  civilian: 'Гражданский',
};

// ============================================================
// RAG: ищем релевантные статьи в БД по тексту последнего сообщения
// ============================================================
const ARTICLE_CATS = ['УК', 'АК', 'ДК', 'ПК', 'УАК'];
const MAX_ARTICLE_TEXT = 500;       // символов на статью в детальном блоке
const MAX_ARTICLES_INJECT = 30;     // топ-N с полным текстом
const MAX_CODE_LOOKUP = 8;          // прямой lookup статей по упомянутому номеру
const MAX_INDEX_ITEMS = 1500;       // верхняя граница полного индекса (защита от перегруза токенов)

function sanitizeQuery(s) {
  return String(s || '')
    .slice(0, 500)
    .replace(/[+\-<>~()*"@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Извлекает явно упомянутые номера статей из текста: "ст. 1.5", "264 УК", "статья 12.7.2", "12.8 ч.1" и т.п.
function extractMentionedCodes(text) {
  if (!text) return [];
  // Поддерживаем многоуровневые номера и опциональный суффикс части ("12.8 ч.1")
  const re = /(?:ст(?:атья|\.|\b)\.?\s*)?(\d+(?:\.\d+){0,4}(?:\s+(?:ч\.?|часть)\s*\d{1,2})?)/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(text))) {
    let code = m[1].trim();
    // Нормализуем "ч 1" → "ч.1"
    code = code.replace(/\s+(?:ч\.?|часть)\s*(\d{1,2})$/i, ' ч.$1');
    // Игнорируем "плоские" числа без точки если они слишком короткие
    const base = code.replace(/\s+ч\.?\d+$/i, '');
    if (!base.includes('.') && base.length < 2) continue;
    out.add(code);
    if (out.size >= 12) break;
  }
  return Array.from(out);
}

// Прямой lookup статей по упомянутым в вопросе номерам — гарантирует, что
// если юзер пишет "по ст. 264" — AI получит именно её, а не догадки.
async function findByCode(serverId, codes) {
  if (!serverId || !codes.length) return [];
  // Берём точные совпадения + детальные подстатьи + родителей.
  // Например, по «1.5» подгребём 1.5.1, 1.5.2 и сами 1.5 — чтобы AI имел
  // полный контекст, даже если он указал «общую» статью или «детальную».
  const conds = [];
  const params = [serverId];
  for (const c of codes) {
    // Если AI прислал код с частью ("12.8 ч.1") — отдельно ищем базу
    const baseCode = String(c).replace(/\s+ч\.?\d+$/i, '').trim();
    conds.push('a.code = ?');
    params.push(c);
    if (baseCode !== c) {
      conds.push('a.code = ?');
      params.push(baseCode);
    }
    // Дети по точке: '12.8.%'
    conds.push('a.code LIKE ?');
    params.push(baseCode + '.%');
    // Части: '12.8 ч.%' — формат хранения в Majestic-парсере (см. parsers/generic.js)
    conds.push('a.code LIKE ?');
    params.push(baseCode + ' ч.%');
    conds.push('a.code LIKE ?');
    params.push(baseCode + ' ч%');
    // Родители по точкам: 12.8.1 → ещё проверим 12.8 и 12
    const parts = baseCode.split('.');
    for (let i = 1; i < parts.length; i++) {
      conds.push('a.code = ?');
      params.push(parts.slice(0, i).join('.'));
    }
  }
  try {
    // is_active НЕ фильтруем — если юзер явно ссылается на номер статьи,
    // показываем её AI даже если временно деактивирована.
    return await db.query(
      `SELECT a.code, a.title, a.text, a.penalty, a.wanted_stars AS wantedStars,
              c.short_name AS catShort, c.name AS catName
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ? AND (${conds.join(' OR ')})
        LIMIT ${MAX_CODE_LOOKUP}`,
      params
    );
  } catch (err) {
    console.warn('[AI] findByCode failed:', err.message);
    return [];
  }
}

// Русские/общие стоп-слова, которые не несут смысла для поиска по законам
const STOPWORDS = new Set([
  'это','этот','эта','эти','тот','та','те','был','была','было','были','есть','быть',
  'для','как','что','чтобы','или','но','при','над','под','без','через','если','когда',
  'все','весь','вся','они','оно','она','мне','мой','моя','моё','твой','наш','ваш',
  'про','уже','еще','ещё','же','ли','бы','не','нет','ни','да','же',
  'после','перед','между','около','около','около','очень','можно','нужно','надо',
  'the','and','for','was','are','this','that','with','from','have','has',
]);

// Из текста запроса берём «стемы» — первые N букв слова, чтобы LIKE ловил
// все формы: «сбил» → стем «сби» → найдёт «сбил/сбила/сбили/сбит». Это
// дешёвый и устойчивый суррогат морфологии для MySQL без ngram-парсера.
function extractStems(text, { stemLen = 5, minWord = 3, maxKeywords = 10 } = {}) {
  if (!text) return [];
  const words = String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= minWord && !STOPWORDS.has(w));
  const stems = [];
  const seen = new Set();
  for (const w of words) {
    const stem = w.length > stemLen ? w.slice(0, stemLen) : w;
    if (seen.has(stem)) continue;
    seen.add(stem);
    stems.push(stem);
    if (stems.length >= maxKeywords) break;
  }
  return stems;
}

// Ранжированный LIKE: вес 3 за совпадение в title, 1 за совпадение в text.
// Возвращает топ-N статей с подсчётом скора.
async function findByStems(serverId, stems, limit) {
  if (!serverId || !stems.length) return [];
  const titleWeights = stems.map(() => 'CASE WHEN a.title LIKE ? THEN 3 ELSE 0 END').join(' + ');
  const textWeights = stems.map(() => 'CASE WHEN a.text  LIKE ? THEN 1 ELSE 0 END').join(' + ');
  const orConds = stems.map(() => '(a.title LIKE ? OR a.text LIKE ?)').join(' OR ');
  const params = [];
  stems.forEach((s) => params.push('%' + s + '%')); // titleWeights
  stems.forEach((s) => params.push('%' + s + '%')); // textWeights
  params.push(serverId);
  stems.forEach((s) => params.push('%' + s + '%', '%' + s + '%')); // orConds
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  try {
    return await db.query(
      `SELECT a.code, a.title, a.text, a.penalty, a.wanted_stars AS wantedStars,
              c.short_name AS catShort, c.name AS catName,
              (${titleWeights} + ${textWeights}) AS score
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ? AND a.is_active = 1 AND (${orConds})
        ORDER BY score DESC, a.code ASC
        LIMIT ${safeLimit}`,
      params
    );
  } catch (err) {
    console.warn('[AI] findByStems failed:', err.message);
    return [];
  }
}

// Страховочный fallback: если ничего не нашли — берём срез самых первых
// статей по основным «законным» категориям этого сервера. Так AI ВСЕГДА
// получает контекст и не уходит фантазировать.
async function findFallback(serverId, limit) {
  if (!serverId) return [];
  // Слабый фильтр: только server_id. Без is_active, без типа категории.
  // Это финальная страховка — лучше дать AI странные/неактивные статьи,
  // чем пустой контекст (тогда он выдумывает номера).
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  try {
    return await db.query(
      `SELECT a.code, a.title, a.text, a.penalty, a.wanted_stars AS wantedStars,
              c.short_name AS catShort, c.name AS catName
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ?
        ORDER BY (a.is_active = 1) DESC, c.sort_order ASC, a.sort_order ASC, a.id ASC
        LIMIT ${safeLimit}`,
      [serverId]
    );
  } catch (err) {
    console.warn('[AI] findFallback failed:', err.message);
    return [];
  }
}

// Полный индекс всех статей сервера: только идентификатор + название,
// без текста. Для 1500 статей ≈ 30k токенов — спокойно влезает в современные модели.
// AI использует его как «оглавление БД», чтобы знать о статьях, которые не попали
// в детальную выборку RAG.
async function fetchServerArticleIndex(serverId) {
  if (!serverId) return [];
  try {
    return await db.query(
      `SELECT a.code, a.title, c.short_name AS catShort, c.sort_order AS catSort,
              c.type AS catType, a.sort_order AS articleSort
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ? AND a.is_active = 1
        ORDER BY (c.type = 'laws') DESC, c.sort_order ASC, a.sort_order ASC, a.id ASC
        LIMIT ${MAX_INDEX_ITEMS}`,
      [serverId]
    );
  } catch (err) {
    console.warn('[AI] fetchServerArticleIndex failed:', err.message);
    return [];
  }
}

// Форматируем индекс компактно, группируя по категории.
function formatArticleIndex(rows, totalInDb) {
  if (!rows || !rows.length) return '';
  const groups = new Map();
  for (const r of rows) {
    const key = r.catShort || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const truncated = rows.length >= MAX_INDEX_ITEMS && totalInDb > MAX_INDEX_ITEMS;
  const lines = [
    '',
    `=== ПОЛНЫЙ ИНДЕКС СТАТЕЙ СЕРВЕРА (${rows.length}${truncated ? ' из ' + totalInDb : ''} шт.) ===`,
    'Это ИСЧЕРПЫВАЮЩИЙ список всех статей сервера. Каждая строка — реальная статья в БД.',
    'Используй индекс как ОГЛАВЛЕНИЕ: найди подходящие по названию, потом смотри детальный блок ниже.',
    'Если в детальном блоке нет нужной, но в этом индексе она есть — упомяни её идентификатор и название, и предложи юзеру открыть её в окне поиска приложения.',
    '',
  ];
  for (const [cat, arr] of groups) {
    lines.push(`— ${cat} (${arr.length} шт.):`);
    for (const a of arr) {
      const title = String(a.title || '').replace(/\s+/g, ' ').slice(0, 100);
      lines.push(`  [${cat} ст. ${a.code}] ${title}`);
    }
  }
  return lines.join('\n');
}

// Диагностика: сколько вообще активных/неактивных статей на этом server_id.
// Вызывается в начале каждого chat-запроса, лог идёт в Railway → видно,
// если фронт шлёт неправильный serverId, или is_active=0 у всех статей.
async function diagServerArticles(serverId) {
  if (!serverId) return null;
  try {
    const row = await db.queryOne(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_active = 0 OR is_active IS NULL THEN 1 ELSE 0 END) AS inactive,
         COUNT(DISTINCT category_id) AS categories
       FROM articles WHERE server_id = ?`,
      [serverId]
    );
    return row || null;
  } catch (err) {
    console.warn('[AI] diagServerArticles failed:', err.message);
    return null;
  }
}

async function findRelevantArticles(serverId, query) {
  if (!serverId) {
    console.warn('[AI] RAG: no serverId, skip retrieval');
    return [];
  }
  const q = sanitizeQuery(query);

  // 1. FULLTEXT (idx_fulltext on articles(title, text)) — лучший случай, но
  // на короткой/чисто-русской фразе может вернуть 0. Используем как «бонусные».
  let ft = [];
  if (q.length >= 3) {
    try {
      ft = await db.query(
        `SELECT a.code, a.title, a.text, a.penalty, a.wanted_stars AS wantedStars,
                c.short_name AS catShort, c.name AS catName,
                MATCH(a.title, a.text) AGAINST(? IN NATURAL LANGUAGE MODE) AS score
           FROM articles a
           LEFT JOIN categories c ON c.id = a.category_id
          WHERE a.server_id = ?
            AND a.is_active = 1
            AND MATCH(a.title, a.text) AGAINST(? IN NATURAL LANGUAGE MODE)
          ORDER BY score DESC
          LIMIT ${MAX_ARTICLES_INJECT}`,
        [q, serverId, q]
      );
    } catch (err) {
      console.warn('[AI] FULLTEXT failed:', err.message);
    }
  }

  // 2. Стем-LIKE: гораздо лучше работает на склонениях русского
  const stems = extractStems(query);
  const stemHits = stems.length ? await findByStems(serverId, stems, MAX_ARTICLES_INJECT) : [];

  // 3. Прямой lookup по упомянутым номерам статей («ст. 1.5», «264»)
  const mentionedCodes = extractMentionedCodes(query);
  const byCode = mentionedCodes.length ? await findByCode(serverId, mentionedCodes) : [];

  // Сливаем без дубликатов в порядке приоритета: прямые номера → стемы → FULLTEXT
  const merged = [];
  const seen = new Set();
  const pushUnique = (rows) => {
    for (const a of rows) {
      const k = `${a.catShort || ''}:${a.code}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(a);
      if (merged.length >= MAX_ARTICLES_INJECT) return true;
    }
    return false;
  };
  if (pushUnique(byCode)) return logRag(serverId, query, merged, 'code+');
  if (pushUnique(stemHits)) return logRag(serverId, query, merged, 'stems+');
  if (pushUnique(ft)) return logRag(serverId, query, merged, 'fulltext+');

  // 4. Страховка: пусто — даём общий срез статей сервера, чтобы AI имел контекст
  if (merged.length === 0) {
    const fb = await findFallback(serverId, MAX_ARTICLES_INJECT);
    pushUnique(fb);
    return logRag(serverId, query, merged, 'fallback');
  }
  return logRag(serverId, query, merged, 'merged');
}

function logRag(serverId, query, articles, source) {
  console.log(
    `[AI] RAG server=${serverId} source=${source} returned=${articles.length} ` +
    `query="${String(query || '').slice(0, 80).replace(/\s+/g, ' ')}"`
  );
  return articles;
}

function formatArticlesBlock(articles) {
  if (!articles || !articles.length) return '';
  const lines = [
    '',
    `=== БАЗА СТАТЕЙ ЭТОГО СЕРВЕРА (${articles.length} шт., релевантная выборка) ===`,
    'Это ЕДИНСТВЕННЫЙ источник правды о статьях. Любой номер, которого здесь нет, — НЕ СУЩЕСТВУЕТ на этом сервере.',
    'Каждая статья ниже помечена строгим идентификатором в квадратных скобках: [КОДЕКС ст. НОМЕР]. Цитируй ТОЛЬКО эти идентификаторы дословно, копируй посимвольно.',
    'ВНИМАНИЕ: список ниже НЕ ПУСТОЙ. Перед тем как сказать «статьи нет» — прочитай каждую и попробуй применить, даже частично. Категорически запрещено отвечать «не нашёл», игнорируя предоставленные статьи.',
    '',
  ];
  for (const a of articles) {
    const code = (a.catShort ? a.catShort + ' ст. ' : '') + a.code;
    const stars = a.wantedStars > 0 ? `${a.wantedStars}★` : '';
    const meta = [a.penalty, stars].filter(Boolean).join(', ');
    const text = String(a.text || '').replace(/\s+/g, ' ').slice(0, MAX_ARTICLE_TEXT);
    lines.push(`[${code}] ${a.title || ''}${meta ? '  (' + meta + ')' : ''}`);
    if (text) lines.push('  ' + text + (a.text && a.text.length > MAX_ARTICLE_TEXT ? '…' : ''));
  }
  return lines.join('\n');
}

// ============================================================
// Пост-валидация: парсим ссылки на статьи в ответе AI и сверяем с БД
// ============================================================
function normalizeRef(cat, num) {
  // УАК → УК для сравнения (по существующей конвенции)
  let c = String(cat).toUpperCase();
  if (c === 'УАК') c = 'УК';
  return c + ':' + String(num).trim();
}

function extractArticleRefs(text) {
  if (!text) return [];
  const cats = ARTICLE_CATS.join('|');
  // Базовый номер: 1, 1.5, 1.5.2, 1.5.2.3
  const NUM = '\\d+(?:\\.\\d+){0,4}';
  // Опциональный суффикс части — "ч.1", "ч. 2", "часть 3", "ч1"
  // Парсер Majestic хранит части как "12.8 ч.1" в a.code, поэтому нам нужно
  // включать суффикс в захват, иначе валидатор пометит существующую статью как несуществующую.
  const PART = '(?:\\s+(?:ч\\.?|часть)\\s*\\d{1,2})?';
  const re = new RegExp(
    `(?:(${cats})[\\s,.;:\\-—]*(?:ст(?:атья|\\.|\\b)\\.?\\s*)?(${NUM}${PART}))|(?:ст(?:атья|\\.|\\b)\\.?\\s*(${NUM}${PART})[\\s,.;:\\-—]*(${cats}))`,
    'gi'
  );
  const refs = [];
  let m;
  while ((m = re.exec(text))) {
    const cat = (m[1] || m[4] || '').toUpperCase();
    const num = m[2] || m[3];
    if (cat && num) {
      // Нормализуем номер части: "ч 1" → "ч.1", "часть 1" → "ч.1"
      const normNum = String(num).replace(/\s+(?:ч\.?|часть)\s*(\d{1,2})/i, ' ч.$1');
      refs.push({ cat, num: normNum, raw: m[0].trim(), key: normalizeRef(cat, normNum) });
    }
  }
  return refs;
}

async function getValidArticleKeys(serverId) {
  if (!serverId) return null;
  try {
    const rows = await db.query(
      `SELECT a.code, c.short_name AS catShort
         FROM articles a
         JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ? AND a.is_active = 1 AND c.short_name IS NOT NULL`,
      [serverId]
    );
    return new Set(rows.map((r) => normalizeRef(r.catShort, r.code)));
  } catch (err) {
    console.warn('[AI] getValidArticleKeys failed:', err.message);
    return null;
  }
}

async function buildServerContext(serverId) {
  if (!serverId) return null;
  try {
    const server = await db.queryOne(
      'SELECT id, name, color FROM servers WHERE id = ? AND is_active = 1',
      [serverId]
    );
    if (!server) return null;

    // Группируем категории и считаем статьи в каждой
    const rows = await db.query(
      `SELECT c.id, c.name, c.short_name AS shortName, c.type, COUNT(a.id) AS articleCount
         FROM categories c
         LEFT JOIN articles a ON a.category_id = c.id AND a.server_id = ?
        WHERE c.is_active = 1
        GROUP BY c.id, c.name, c.short_name, c.type, c.sort_order
        HAVING articleCount > 0
        ORDER BY c.sort_order ASC, c.id ASC`,
      [serverId]
    );
    return { server, categories: rows };
  } catch (err) {
    console.warn('[AI] buildServerContext error:', err.message);
    return null;
  }
}

function buildSystemPrompt(role, context) {
  const persona = ROLE_PROMPTS[role] || ROLE_PROMPTS.civilian;
  const lines = [
    'Ты — AI-ассистент по законам и правилам ролевых серверов Majestic RP (GTA 5). Это ИГРОВОЙ ВЫМЫШЛЕННЫЙ свод правил, не путать с законодательством РФ.',
    '',
    '⛔ ЖЁСТКИЕ ПРАВИЛА РАБОТЫ СО СТАТЬЯМИ — нарушение недопустимо:',
    '',
    'В промпте ниже два блока с данными:',
    '— «ПОЛНЫЙ ИНДЕКС СТАТЕЙ СЕРВЕРА» — ВСЕ статьи сервера (только идентификатор + название). Это исчерпывающий каталог.',
    '— «БАЗА СТАТЕЙ ЭТОГО СЕРВЕРА (релевантная выборка)» — топ статей по запросу, с полным текстом и штрафами.',
    '',
    'Алгоритм поиска нужной статьи:',
    '1. Сначала прочти ИНДЕКС и найди статьи, чьи названия подходят к ситуации юзера. Их может быть 1–5 штук.',
    '2. Если эти статьи есть в ДЕТАЛЬНОЙ ВЫБОРКЕ — бери полный текст оттуда, цитируй с штрафом/звёздами.',
    '3. Если в ДЕТАЛЬНОЙ ВЫБОРКЕ их нет, но в ИНДЕКСЕ есть — назови идентификатор и название из индекса, и предложи юзеру открыть статью в окне поиска приложения для полного текста.',
    '',
    'Жёсткие ограничения:',
    '— Используй ТОЛЬКО статьи, идентификатор которых явно присутствует в одном из этих двух блоков. НИКАКИЕ номера из головы или из реального УК/АК РФ.',
    '— Идентификатор копируй посимвольно: формат [КОДЕКС ст. НОМЕР].',
    '— У серверов есть кодексы: УК (Уголовный), АК (Административный), ДК (Должностной), ПК (Полицейский), УАК (синоним УК). Префикс бери из идентификатора, не подменяй.',
    '— Если в ИНДЕКСЕ нет НИ ОДНОЙ статьи, подходящей даже отдалённо — скажи «Подходящей статьи в базе сервера не нашёл, уточни ситуацию или открой поиск в приложении». Только в этом случае.',
    '',
    'Формат ответа:',
    '— Если ссылаешься на статью, обязательно дай: точный идентификатор из списка, краткую формулировку нарушения, и (если есть в данных) штраф / звёзды розыска / срок.',
    '— Отвечай на русском, кратко и по делу. Используй маркированные списки для перечислений.',
    '— Если в вопросе не хватает важной детали (роль, обстоятельства, был ли вред) — уточни одним коротким вопросом перед ответом.',
    '— Не давай юридических советов вне игрового контекста Majestic RP.',
  ];

  if (context && context.server) {
    lines.push('');
    lines.push('=== Текущий сервер игрока ===');
    lines.push('Сервер: ' + context.server.name + ' (id: ' + context.server.id + ')');
    lines.push('Опирайся в первую очередь на кодексы и правила ИМЕННО этого сервера.');
    if (context.categories && context.categories.length) {
      const laws = context.categories.filter((c) => c.type === 'laws');
      const rules = context.categories.filter((c) => c.type === 'rules');
      const other = context.categories.filter((c) => c.type !== 'laws' && c.type !== 'rules');
      const fmt = (c) => '  • ' + (c.shortName ? c.shortName + ' — ' : '') + c.name + ' (' + c.articleCount + ' ст.)';
      if (laws.length) {
        lines.push('Кодексы:');
        laws.forEach((c) => lines.push(fmt(c)));
      }
      if (rules.length) {
        lines.push('Правила:');
        rules.forEach((c) => lines.push(fmt(c)));
      }
      if (other.length) {
        lines.push('Прочее:');
        other.forEach((c) => lines.push(fmt(c)));
      }
    }
  } else {
    lines.push('');
    lines.push('Сервер не выбран — попроси игрока выбрать сервер в окне приложения, чтобы ответ опирался на его законы.');
  }

  lines.push('');
  lines.push('Текущая роль ассистента: ' + (ROLE_LABEL[role] || ROLE_LABEL.civilian) + '.');
  lines.push(persona);
  return lines.join('\n');
}

// ============================================================
// Per-user rate limiter (auth-aware — ключ это user.id)
// ============================================================
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: parseInt(process.env.AI_RATE_LIMIT_PER_HOUR || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `u:${req.user.id}` : req.ip),
  message: { error: 'Слишком много запросов к AI. Подождите и попробуйте снова.' },
});

// ============================================================
// Проверка подписки на фичу ai_assistant
// ============================================================
async function requireAiFeature(req, res, next) {
  try {
    const sub = await loadCurrentSubscription(req.user.id);
    if (!sub || !Array.isArray(sub.plan.features) || !sub.plan.features.includes(FEATURE_KEY)) {
      return res.status(403).json({
        error: 'AI-ассистент доступен только с активной подпиской Premium.',
        code: 'AI_FEATURE_REQUIRED',
        feature: FEATURE_KEY,
      });
    }
    req.subscription = sub;
    next();
  } catch (err) {
    console.error('[AI] subscription check error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ============================================================
// GET /api/ai/status — клиент проверяет доступ перед открытием окна
// ============================================================
router.get('/status', requireAuth, async (req, res) => {
  try {
    const sub = await loadCurrentSubscription(req.user.id);
    const enabled = !!(sub && Array.isArray(sub.plan.features) && sub.plan.features.includes(FEATURE_KEY));
    res.json({
      success: true,
      enabled,
      configured: !!AI_API_KEY,
      model: AI_MODEL,
      roles: Object.keys(ROLE_LABEL).map((k) => ({ key: k, label: ROLE_LABEL[k] })),
      limitsPerHour: parseInt(process.env.AI_RATE_LIMIT_PER_HOUR || '60', 10),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/ai/chat
// body: { messages: [{role: 'user'|'assistant', content: string}], persona?: 'lawyer'|... }
// ============================================================
router.post('/chat', requireAuth, requireAiFeature, aiLimiter, async (req, res) => {
  if (!AI_API_KEY) {
    return res.status(503).json({ error: 'AI не настроен на сервере (AI_API_KEY)' });
  }

  const { messages, persona, serverId } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages обязателен и не должен быть пустым' });
  }
  if (messages.length > 30) {
    return res.status(400).json({ error: 'История диалога слишком длинная (>30 сообщений)' });
  }

  // Валидация и обрезка
  const cleaned = [];
  for (const m of messages) {
    if (!m || typeof m.content !== 'string') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = m.content.slice(0, 4000);
    if (!content.trim()) continue;
    cleaned.push({ role, content });
  }
  if (!cleaned.length) {
    return res.status(400).json({ error: 'Пустой запрос' });
  }

  const context = await buildServerContext(serverId);

  // Диагностика — всегда видна в Railway-логах: что реально лежит в БД
  // для этого serverId. Если total=0 — проблема в slug или импорте.
  // Если active=0 при ненулевом total — RAG их не увидит (выбирает is_active=1).
  let diag = null;
  if (serverId) {
    diag = await diagServerArticles(serverId);
    if (!diag || Number(diag.total) === 0) {
      console.warn(`[AI] DIAG server=${serverId}: 0 articles. Возможно неверный slug или статьи не импортированы.`);
    } else {
      console.log(`[AI] DIAG server=${serverId}: total=${diag.total} active=${diag.active} inactive=${diag.inactive} categories=${diag.categories}`);
    }
  }

  // RAG: тянем статьи под последний пользовательский вопрос
  const lastUser = [...cleaned].reverse().find((m) => m.role === 'user');
  const relevant = lastUser ? await findRelevantArticles(serverId, lastUser.content) : [];
  const articlesBlock = formatArticlesBlock(relevant);

  // Полный индекс всех статей сервера — AI видит всё «оглавление БД»,
  // а не только 30 отобранных RAG. Это критично против ответов «такой статьи нет».
  const indexRows = serverId ? await fetchServerArticleIndex(serverId) : [];
  const totalActiveInDb = (diag && Number(diag.active)) || indexRows.length;
  const indexBlock = formatArticleIndex(indexRows, totalActiveInDb);
  if (indexRows.length) {
    console.log(`[AI] INDEX server=${serverId} injected=${indexRows.length}/${totalActiveInDb}`);
  }

  const baseSystem = buildSystemPrompt(persona, context);
  const systemMsg = {
    role: 'system',
    content: [baseSystem, indexBlock, articlesBlock].filter(Boolean).join('\n'),
  };

  const url = AI_BASE_URL + '/chat/completions';

  async function callUpstream(messages, timeoutMs = 90000) {
    const upstreamController = new AbortController();
    const upstreamTimeout = setTimeout(() => upstreamController.abort(), timeoutMs);
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + AI_API_KEY,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages,
          temperature: AI_TEMPERATURE,
          max_tokens: AI_MAX_TOKENS,
          user: 'u' + req.user.id,
        }),
        signal: upstreamController.signal,
      });
      const t = await upstream.text();
      let d;
      try { d = JSON.parse(t); } catch { d = null; }
      if (!upstream.ok) {
        const msg = (d && (d.error?.message || d.message)) || `Upstream HTTP ${upstream.status}`;
        const err = new Error(msg);
        err.status = upstream.status;
        err.upstreamBody = t.slice(0, 500);
        throw err;
      }
      return d;
    } finally {
      clearTimeout(upstreamTimeout);
    }
  }

  // Кэш префикс-индексов на validKeys чтобы не пересоздавать на каждой ссылке.
  const prefixCache = new WeakMap();
  function getPrefixIndex(validKeys) {
    if (prefixCache.has(validKeys)) return prefixCache.get(validKeys);
    // Группируем по категории и сортируем по длине номера, чтобы быстро искать
    // префикс-совпадение в обе стороны.
    const byCat = new Map();
    for (const key of validKeys) {
      const sep = key.indexOf(':');
      if (sep < 0) continue;
      const cat = key.slice(0, sep);
      const num = key.slice(sep + 1);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(num);
    }
    prefixCache.set(validKeys, byCat);
    return byCat;
  }

  function isReferenceValid(ref, validKeys) {
    if (validKeys.has(ref.key)) return true;
    const byCat = getPrefixIndex(validKeys);
    const cat = ref.key.slice(0, ref.key.indexOf(':'));
    const num = ref.key.slice(ref.key.indexOf(':') + 1);
    const inCat = byCat.get(cat);
    if (!inCat) return false;
    // Базовый номер без суффикса части ("12.8 ч.1" → "12.8")
    const baseNum = num.replace(/\s+ч\.?\d+$/i, '').trim();

    // Случай 1: AI назвал общий «12.8», а в БД лежат подстатьи «12.8.1» или части «12.8 ч.1»
    const dotPref = num + '.';
    const partPref = num + ' ч.';
    const partPrefAlt = num + ' ч';
    if (inCat.some((dbNum) => dbNum.startsWith(dotPref) || dbNum.startsWith(partPref) || dbNum.startsWith(partPrefAlt))) {
      return true;
    }
    // То же, но если AI добавил часть, а в БД лежит другой набор частей под тем же базом
    if (baseNum !== num && inCat.some((dbNum) => dbNum === baseNum || dbNum.startsWith(baseNum + ' ч.') || dbNum.startsWith(baseNum + '.'))) {
      return true;
    }
    // Случай 2: AI назвал детальный «1.5.2», а в БД хранится только «1.5» (склеено).
    const parts = baseNum.split('.');
    if (parts.length > 1) {
      for (let i = parts.length - 1; i >= 1; i--) {
        const parent = parts.slice(0, i).join('.');
        if (inCat.includes(parent)) return true;
      }
    }
    return false;
  }

  function detectInvalidRefs(text, validKeys) {
    if (!validKeys || !validKeys.size) return [];
    const refs = extractArticleRefs(text);
    const out = [];
    const seen = new Set();
    for (const r of refs) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      if (!isReferenceValid(r, validKeys)) {
        out.push(r.raw);
      }
    }
    if (out.length) {
      console.warn(`[AI] detectInvalidRefs flagged ${out.length}/${refs.length} refs: ${out.join(' | ')}`);
    }
    return out;
  }

  try {
    let data = await callUpstream([systemMsg, ...cleaned]);
    let reply = data?.choices?.[0]?.message?.content || '';
    let finishReason = data?.choices?.[0]?.finish_reason || null;
    if (!reply) {
      return res.status(502).json({ error: 'AI вернул пустой ответ', raw: data });
    }

    // Пост-валидация + регенерация: если AI выдумал номера, дёрнем его ещё раз
    // с явной коррекцией. Максимум 1 дополнительная попытка.
    let invalidRefs = [];
    let regenerated = false;
    if (serverId) {
      const validKeys = await getValidArticleKeys(serverId);
      invalidRefs = detectInvalidRefs(reply, validKeys);
      if (invalidRefs.length) {
        console.warn('[AI] invalid refs, regenerating:', invalidRefs.join(','));
        const correction = {
          role: 'system',
          content:
            'В твоём предыдущем ответе ссылки на следующие статьи НЕ СУЩЕСТВУЮТ в базе сервера: ' +
            invalidRefs.map((r) => `«${r}»`).join(', ') +
            '. Перепиши ответ полностью, заменив их на корректные идентификаторы ИСКЛЮЧИТЕЛЬНО из раздела «БАЗА СТАТЕЙ ЭТОГО СЕРВЕРА». ' +
            'Если корректной замены нет — честно скажи «Подходящей статьи в базе нет» вместо номера. ' +
            'Не извиняйся, не упоминай эту коррекцию, не пиши «ошибся» — просто выдай новый чистый ответ.',
        };
        try {
          const retry = await callUpstream(
            [systemMsg, ...cleaned, { role: 'assistant', content: reply }, correction],
            60000
          );
          const retryReply = retry?.choices?.[0]?.message?.content || '';
          if (retryReply) {
            data = retry;
            reply = retryReply;
            finishReason = retry?.choices?.[0]?.finish_reason || null;
            regenerated = true;
            invalidRefs = detectInvalidRefs(reply, validKeys);
          }
        } catch (err) {
          console.warn('[AI] regeneration failed, returning original:', err.message);
        }
      }
    }
    const truncated = finishReason === 'length';

    res.json({
      success: true,
      reply,
      model: data?.model || AI_MODEL,
      usage: data?.usage || null,
      persona: persona || 'civilian',
      serverId: context ? context.server.id : null,
      serverName: context ? context.server.name : null,
      usedArticles: relevant.map((a) => ({
        code: (a.catShort ? a.catShort + ' ' : '') + a.code,
        title: a.title,
      })),
      invalidRefs,
      regenerated,
      truncated,
      finishReason,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[AI] upstream timeout');
      return res.status(504).json({ error: 'AI-провайдер не ответил за 90 секунд. Попробуйте упростить вопрос или повторите.' });
    }
    if (err.status) {
      console.error('[AI] upstream error', err.status, err.upstreamBody || '');
      return res.status(502).json({ error: 'AI-провайдер вернул ошибку: ' + err.message });
    }
    console.error('[AI] fetch error:', err);
    res.status(502).json({ error: 'Не удалось связаться с AI-провайдером: ' + err.message });
  }
});

module.exports = router;
module.exports.FEATURE_KEY = FEATURE_KEY;
