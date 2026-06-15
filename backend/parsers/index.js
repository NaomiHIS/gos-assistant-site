// ============================================================
// Parser orchestrator
// ============================================================
const fetch = require('node-fetch');
const generic = require('./generic');
const majestic = require('./majestic');
const codexdb = require('./codexdb');

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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
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
  const articles = generic.parseText(text);
  return {
    parser: 'manual-text',
    url: null,
    detectedCategory: null,
    articlesCount: articles.length,
    articles,
  };
}

module.exports = { parseUrl, parseRawText, codexdb };
