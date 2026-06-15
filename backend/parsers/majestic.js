// ============================================================
// Parser for Majestic RP forum (forum.majestic-rp.ru)
// Uses XenForo-style structure
// ============================================================
const cheerio = require('cheerio');
const generic = require('./generic');

function detectCategory(text) {
  const t = text.toLowerCase();
  if (/уголовн[а-я]+\s*кодекс|\bук\b/.test(t)) return 'uk';
  if (/администр[а-я]+\s*кодекс|\bак\b/.test(t)) return 'ak';
  if (/дорож[а-я]+\s*кодекс|пдд|\bдк\b/.test(t)) return 'dk';
  if (/процессуальн[а-я]+\s*кодекс|\bпк\b/.test(t)) return 'pk';
  if (/правил[а-я]+/.test(t)) return 'rules-general';
  return null;
}

function parseHtml(html) {
  const $ = cheerio.load(html);
  // Take the first post content (thread starter)
  const firstPost = $('.bbWrapper').first();
  if (!firstPost.length) {
    return generic.parseHtml(html);
  }
  const detectedCategory = detectCategory($('title').text() + ' ' + $('h1').first().text());
  const articles = generic.parseHtml(firstPost.html() || html);
  return { articles, detectedCategory };
}

module.exports = { parseHtml, name: 'majestic' };
