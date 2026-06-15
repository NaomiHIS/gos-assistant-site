// ============================================================
// Parser orchestrator: picks the right parser by URL
// ============================================================
const fetch = require('node-fetch');
const generic = require('./generic');
const majestic = require('./majestic');

function pickParser(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('majestic-rp.ru')) return majestic;
  } catch {}
  return generic;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GOS-Assistant-Parser/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru,en;q=0.8',
    },
    timeout: 20000,
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} от ${url}`);
  }
  const html = await res.text();
  if (html.length < 100) {
    throw new Error('Получен пустой ответ');
  }
  return html;
}

async function parseUrl(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Неверный URL — нужен http:// или https://');
  }
  const parser = pickParser(url);
  const html = await fetchHtml(url);
  const result = parser.parseHtml(html);

  // Normalize: parser may return array or { articles, detectedCategory }
  let articles, detectedCategory;
  if (Array.isArray(result)) {
    articles = result;
    detectedCategory = null;
  } else {
    articles = result.articles || [];
    detectedCategory = result.detectedCategory || null;
  }

  return {
    parser: parser.name,
    url,
    detectedCategory,
    articlesCount: articles.length,
    articles,
  };
}

function parseRawText(text) {
  // Pretend it's HTML so cheerio can wrap it
  const html = `<div>${text.replace(/\n/g, '<br>')}</div>`;
  return { articles: generic.parseHtml(html), detectedCategory: null };
}

module.exports = { parseUrl, parseRawText };
