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
const AI_MODEL = process.env.AI_MODEL || 'anthropic/claude-sonnet-4.5-thinking';
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '800', 10);
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.4');

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
const MAX_ARTICLE_TEXT = 240; // символов на статью в prompt
const MAX_ARTICLES_INJECT = 10;

function sanitizeQuery(s) {
  return String(s || '')
    .slice(0, 500)
    .replace(/[+\-<>~()*"@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findRelevantArticles(serverId, query) {
  if (!serverId) return [];
  const q = sanitizeQuery(query);
  if (q.length < 3) return [];

  // 1. FULLTEXT (idx_fulltext on articles(title, text))
  try {
    const rows = await db.query(
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
    if (rows && rows.length) return rows;
  } catch (err) {
    console.warn('[AI] FULLTEXT search failed, falling back to LIKE:', err.message);
  }

  // 2. Fallback: LIKE по топ-5 ключевым словам
  const keywords = q.split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
  if (!keywords.length) return [];
  const conds = keywords.map(() => '(a.title LIKE ? OR a.text LIKE ?)').join(' OR ');
  const params = [serverId];
  keywords.forEach((k) => params.push('%' + k + '%', '%' + k + '%'));
  params.push(MAX_ARTICLES_INJECT);
  try {
    return await db.query(
      `SELECT a.code, a.title, a.text, a.penalty, a.wanted_stars AS wantedStars,
              c.short_name AS catShort, c.name AS catName
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.server_id = ? AND a.is_active = 1 AND (${conds})
        LIMIT ?`,
      params
    );
  } catch (err) {
    console.warn('[AI] LIKE search failed:', err.message);
    return [];
  }
}

function formatArticlesBlock(articles) {
  if (!articles || !articles.length) return '';
  const lines = ['', '=== Релевантные статьи сервера ===',
    'Используй ИМЕННО эти статьи для квалификации. Не выдумывай номера. Если ни одна не подходит — скажи что точной статьи в БД не нашлось.'];
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
    'Ты — AI-ассистент по законам и правилам ролевых серверов Majestic RP (GTA 5).',
    'У серверов есть кодексы: УК (Уголовный), АК (Административный), ДК (Должностной), ПК (Полицейский), УАК (Уголовно-административный, маппится в УК) — а также общие правила сервера, правила фракций, эвенты.',
    'Когда квалифицируешь деяние — обязательно называй конкретный кодекс и номер статьи в формате "УК ст. 1.1", "АК ст. 2.3" и т.п. Если у статьи есть штраф и розыск — приводи цифры.',
    'Если в вопросе нет важной детали (роль игрока, версия сервера, контекст) — кратко уточни её одним вопросом перед ответом. Не выдумывай статьи, которых нет.',
    'Отвечай на русском, кратко и по делу. Используй маркированные списки когда уместно. Не давай юридических советов вне игрового контекста.',
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
  const payload = {
    model: AI_MODEL,
    messages: [systemMsg, ...cleaned],
    temperature: AI_TEMPERATURE,
    max_tokens: AI_MAX_TOKENS,
    user: 'u' + req.user.id,
  };

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + AI_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!upstream.ok) {
      console.error('[AI] upstream error', upstream.status, text.slice(0, 500));
      const message = (data && (data.error?.message || data.message)) || `Upstream HTTP ${upstream.status}`;
      return res.status(502).json({ error: 'AI-провайдер вернул ошибку: ' + message });
    }

    const reply = data?.choices?.[0]?.message?.content || '';
    if (!reply) {
      return res.status(502).json({ error: 'AI вернул пустой ответ', raw: data });
    }

    // Пост-валидация: ищем в ответе ссылки на статьи и сверяем с БД
    let invalidRefs = [];
    if (serverId) {
      const validKeys = await getValidArticleKeys(serverId);
      if (validKeys && validKeys.size) {
        const refs = extractArticleRefs(reply);
        const seen = new Set();
        for (const r of refs) {
          if (!validKeys.has(r.key) && !seen.has(r.key)) {
            seen.add(r.key);
            invalidRefs.push(r.raw);
          }
        }
      }
    }

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
    });
  } catch (err) {
    console.error('[AI] fetch error:', err);
    res.status(502).json({ error: 'Не удалось связаться с AI-провайдером: ' + err.message });
  }
});

module.exports = router;
module.exports.FEATURE_KEY = FEATURE_KEY;
