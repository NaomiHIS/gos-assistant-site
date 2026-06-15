// ============================================================
// Generic parser — extracts numbered articles from any HTML
// Looks for patterns like "Статья 1.1 ... Наказание: ..."
// ============================================================
const cheerio = require('cheerio');

// Article code pattern: digits + optional . + digits, like 1, 1.1, 1.1.2
const CODE_RE = /^(?:статья\s+|article\s+|пункт\s+|§\s*|п\.\s*)?(\d+(?:\.\d+){0,3})\s*[.)\-—:]?\s*(.*)/i;
// Heuristic: lines starting with article codes
const LINE_CODE_RE = /^(?:статья\s+|article\s+|§\s*)?(\d+(?:\.\d+){1,3})\s*[.)\-—:]\s*(.+)/i;

// Penalty markers
const PENALTY_RE = /(?:наказание|штраф|лишение\s+свободы|санкция|punishment|penalty|fine)[:\s—-]+(.{3,200})/i;
// Wanted stars (supports ё and various forms)
const STARS_RE = /(?:зв[еёЁЕ]зд[аыоу]?[а-я]*\s*розыска|wanted\s+stars?|уровень\s+розыска|stars?)[:\s—-]*([0-5])/i;

function cleanText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/[ ]/g, ' ')
    .trim();
}

function extractTextFromHtml(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside, .navigation, .sidebar').remove();
  // Try common forum content selectors first
  const candidates = [
    '.bbWrapper',
    '.message-body',
    '.message-content',
    '.post-content',
    'article',
    'main',
    '.content',
    '#content',
    'body',
  ];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      return cleanLines(el);
    }
  }
  return cleanLines($('body'));
}

function cleanLines($el) {
  // Replace <br> with newlines, preserve paragraph structure
  $el.find('br').replaceWith('\n');
  $el.find('p, div, li, tr').append('\n');
  const text = $el.text();
  return text
    .split(/\r?\n/)
    .map((l) => cleanText(l))
    .filter((l) => l.length > 0);
}

// Split lines into article chunks
function chunkByArticles(lines) {
  const chunks = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(LINE_CODE_RE);
    if (m) {
      // New article starts
      if (current) chunks.push(current);
      current = {
        code: m[1],
        title: cleanText(m[2]),
        body: [],
      };
    } else if (current) {
      // Append to current article
      current.body.push(line);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function extractPenalty(body) {
  for (const line of body) {
    const m = line.match(PENALTY_RE);
    if (m) return cleanText(m[1]);
  }
  return null;
}

function extractStars(body) {
  for (const line of body) {
    const m = line.match(STARS_RE);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

function parseHtml(html) {
  const lines = extractTextFromHtml(html);
  const chunks = chunkByArticles(lines);

  return chunks
    .filter((c) => c.title.length >= 2)
    .map((c) => {
      const penalty = extractPenalty(c.body);
      const stars = extractStars(c.body);
      // Body text = everything except penalty/stars lines
      const text = c.body
        .filter((l) => !PENALTY_RE.test(l) && !STARS_RE.test(l))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        code: c.code,
        title: c.title.slice(0, 500),
        text: text.slice(0, 2000),
        penalty: penalty ? penalty.slice(0, 500) : null,
        wantedStars: Math.max(0, Math.min(5, stars)),
      };
    });
}

module.exports = { parseHtml, name: 'generic' };
