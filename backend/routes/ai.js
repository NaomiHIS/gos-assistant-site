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
const MAX_ARTICLE_TEXT = 500; // символов на статью в prompt
const MAX_ARTICLES_INJECT = 20;
const MAX_CODE_LOOKUP = 8; // прямой lookup статей по упомянутому номеру

function sanitizeQuery(s) {
  return String(s || '')
    .slice(0, 500)
    .replace(/[+\-<>~()*"@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Извлекает явно упомянутые номера статей из текста: "ст. 1.5", "264 УК", "статья 12.7" и т.п.
function extractMentionedCodes(text) {
  if (!text) return [];
  const re = /(?:ст(?:атья|\.|\b)\.?\s*)?(\d+(?:\.\d+)?)/g;
  const out = new Set();
  let m;
  while ((m = re.exec(text))) {
    const code = m[1];
    // Игнорируем "плоские" числа без точки если они слишком короткие (вероятно не статья)
    if (!code.includes('.') && code.length < 2) continue;
    out.add(code);
    if (out.size >= 12) break;
  }
  return Array.from(out);
}

// Прямой lookup статей по упомянутым в вопросе номерам — гарантирует, что
// если юзер пишет "по ст. 264" — AI получит именно её, а не догадки.
async function findByCode(serverId, codes) {
  if (!serverId || !codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  try {
    return await db.query(
      `SELECT a.code, a.title, a.text, a.penalty, a.wanted_stars AS wantedStars,
              c.short_name AS catShort, c.name AS catName
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ? AND a.is_active = 1 AND a.code IN (${placeholders})
        LIMIT ?`,
      [serverId, ...codes, MAX_CODE_LOOKUP]
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
  params.push(limit);
  try {
    return await db.query(
      `SELECT a.code, a.title, a.text, a.penalty, a.wanted_stars AS wantedStars,
              c.short_name AS catShort, c.name AS catName,
              (${titleWeights} + ${textWeights}) AS score
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ? AND a.is_active = 1 AND (${orConds})
        ORDER BY score DESC, a.code ASC
        LIMIT ?`,
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
  try {
    return await db.query(
      `SELECT a.code, a.title, a.text, a.penalty, a.wanted_stars AS wantedStars,
              c.short_name AS catShort, c.name AS catName
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ? AND a.is_active = 1
          AND c.type IN ('laws','rules','other')
        ORDER BY c.sort_order ASC, a.sort_order ASC, a.id ASC
        LIMIT ?`,
      [serverId, limit]
    );
  } catch (err) {
    console.warn('[AI] findFallback failed:', err.message);
    return [];
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
          LIMIT ?`,
        [q, serverId, q, MAX_ARTICLES_INJECT]
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
    '=== БАЗА СТАТЕЙ ЭТОГО СЕРВЕРА ===',
    'Это ЕДИНСТВЕННЫЙ источник правды о статьях. Любой номер, которого здесь нет, — НЕ СУЩЕСТВУЕТ на этом сервере.',
    'Каждая статья ниже помечена строгим идентификатором в квадратных скобках: [КОДЕКС ст. НОМЕР]. Цитируй ТОЛЬКО эти идентификаторы дословно, копируй посимвольно.',
    'Если ни одна статья из списка не подходит — честно скажи: «Подходящей статьи в базе сервера не нашёл, уточни вопрос» и НЕ называй никаких номеров.',
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
  // Варианты: "УК ст. 1.1", "УК 1.1", "ст. 1.1 УК", "статья 1.1 УК"
  const re = new RegExp(
    `(?:(${cats})\\s*(?:ст(?:атья|\\.|\\b)\\.?\\s*)?(\\d+(?:\\.\\d+)?))|(?:ст(?:атья|\\.|\\b)\\.?\\s*(\\d+(?:\\.\\d+)?)\\s*(${cats}))`,
    'gi'
  );
  const refs = [];
  let m;
  while ((m = re.exec(text))) {
    const cat = (m[1] || m[4] || '').toUpperCase();
    const num = m[2] || m[3];
    if (cat && num) refs.push({ cat, num, raw: m[0].trim(), key: normalizeRef(cat, num) });
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
    '⛔ ЖЁСТКИЕ ПРАВИЛА ПРОТИВ ВЫДУМЫВАНИЯ СТАТЕЙ — нарушение недопустимо:',
    '1. Используй ИСКЛЮЧИТЕЛЬНО статьи из раздела «БАЗА СТАТЕЙ ЭТОГО СЕРВЕРА» в этом промпте. Никакие другие.',
    '2. Полностью забудь номера статей реального УК/АК РФ — на сервере СВОЯ нумерация, не совпадающая с реальной.',
    '3. Идентификатор статьи в формате [КОДЕКС ст. НОМЕР] копируй ПОСИМВОЛЬНО из квадратных скобок предоставленного списка. Не сокращай, не округляй, не "близко-похожий" номер.',
    '4. Если ни одна статья из списка не подходит — НЕ ПРИДУМЫВАЙ номер. Скажи: «Подходящей статьи в базе сервера не нашёл, уточни ситуацию или открой поиск в приложении».',
    '5. У серверов есть кодексы: УК (Уголовный), АК (Административный), ДК (Должностной), ПК (Полицейский), УАК (синоним УК). При цитировании используй именно тот префикс, который указан в идентификаторе статьи.',
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

  // RAG: тянем статьи под последний пользовательский вопрос
  const lastUser = [...cleaned].reverse().find((m) => m.role === 'user');
  const relevant = lastUser ? await findRelevantArticles(serverId, lastUser.content) : [];
  const articlesBlock = formatArticlesBlock(relevant);

  const baseSystem = buildSystemPrompt(persona, context);
  const systemMsg = {
    role: 'system',
    content: articlesBlock ? baseSystem + '\n' + articlesBlock : baseSystem,
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

  function detectInvalidRefs(text, validKeys) {
    if (!validKeys || !validKeys.size) return [];
    const refs = extractArticleRefs(text);
    const out = [];
    const seen = new Set();
    for (const r of refs) {
      if (!validKeys.has(r.key) && !seen.has(r.key)) {
        seen.add(r.key);
        out.push(r.raw);
      }
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
