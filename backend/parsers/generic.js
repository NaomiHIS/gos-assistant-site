// ============================================================
// Generic parser — extracts numbered articles from any HTML/text
// Supports:
//   - Numbered codes:   1, 1.1, 1.1.2
//   - Prefixes:         Статья 1.1 / Ст. 1.1 / Article 1.1 / § 1.1 / п. 1.1
//   - Parts:            1.1 ч.1 / 1.1 часть 2 / 1.1 ч 3 — produce separate articles
//   - Penalty markers:  Наказание / Штраф / Лишение свободы / Санкция / Penalty
//   - Stars:            Звёзды/Звезды розыска / Wanted stars
//   - Title on same line OR on next line after code
// ============================================================
const cheerio = require('cheerio');

// Article code: digits with optional dot-segments (1, 1.1, 1.1.2)
// Optional prefix like "Статья ", "Ст.", "§", "п.", "Article"
const ARTICLE_RE = /^\s*(?:статья|ст\.?|article|art\.?|§|пункт|п\.?)?\s*[#«"]?\s*(\d{1,4}(?:\.\d{1,3}){0,3})\b\s*[»"]?(?:\s*[.)\-—:]?\s*(.*))?$/i;
// Inline detection (looking for code anywhere on the line)
const ARTICLE_INLINE_RE = /(?:статья|ст\.|article|§)\s*(\d{1,4}(?:\.\d{1,3}){0,3})\b\s*[.)\-—:]?\s*(.*)/i;
// Part marker inside title: "ч.1", "часть 2", "ч 3", "часть 1"
const PART_RE = /^\s*(?:ч\.?|часть)\s*(\d{1,2})\s*[.)\-—:]?\s*(.*)$/i;
// Strip part suffix from title if present
const TITLE_PART_RE = /\s+(?:ч\.?|часть)\s*(\d{1,2})\b/i;

// Penalty markers (anywhere in line)
const PENALTY_RE = /(?:наказание|штраф|лишение\s+свобод[ыа]|санкция|punishment|penalty|fine)[:\s—\-]+(.{2,500})/i;
// Wanted stars (supports ё/е variations)
const STARS_RE = /(?:зв[еёЁЕ]зд[а-я]*\s*розыска|уровень\s+розыска|розыск[\s—\-:]+|wanted\s+stars?|stars?)[:\s—\-]*([0-5])/i;

function cleanText(s) {
  return String(s || '')
    .replace(/[  -​]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTextFromHtml(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside').remove();

  // XenForo (Majestic uses this) — try first-post bbWrapper
  const xenforo = $('article.message').first().find('.bbWrapper').first();
  if (xenforo.length && xenforo.text().trim().length > 100) {
    return cleanLines(xenforo, $);
  }

  // Generic content selectors
  const candidates = [
    '.bbWrapper',
    '.message-body',
    '.message-content',
    '.post-content',
    '.entry-content',
    'article',
    'main',
    '.content',
    '#content',
  ];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      return cleanLines(el, $);
    }
  }
  return cleanLines($('body'), $);
}

function cleanLines($el, $) {
  // Replace <br>, <p>, <div>, <li>, <tr>, <details>, <summary> with newlines
  $el.find('br').replaceWith('\n');
  $el.find('p, div, li, tr, summary, h1, h2, h3, h4, h5, h6').each((_, node) => {
    $(node).prepend('\n');
  });
  const text = $el.text();
  return text
    .split(/\r?\n/)
    .map(cleanText)
    .filter((l) => l.length > 0);
}

// Determine if a line introduces a new article. Returns { code, partNum, restAfterCode } or null.
function detectArticleStart(line) {
  let m = line.match(ARTICLE_RE);
  if (m) {
    const code = m[1];
    let rest = (m[2] || '').trim();
    // Check for part marker right after the code
    const pm = rest.match(PART_RE);
    if (pm) {
      return { code, part: pm[1], rest: pm[2] || '' };
    }
    // Sometimes "ч.1" appears later inside the rest
    const tpm = rest.match(TITLE_PART_RE);
    if (tpm) {
      const part = tpm[1];
      rest = rest.replace(TITLE_PART_RE, '').trim();
      return { code, part, rest };
    }
    return { code, part: null, rest };
  }
  return null;
}

function chunkByArticles(lines) {
  const chunks = [];
  let current = null;
  let lookingForTitle = false;

  for (const line of lines) {
    const det = detectArticleStart(line);
    if (det) {
      if (current) chunks.push(current);
      const fullCode = det.part ? `${det.code} ч.${det.part}` : det.code;
      current = {
        code: fullCode,
        title: det.rest,
        body: [],
      };
      lookingForTitle = !det.rest || det.rest.length < 3;
    } else if (current) {
      if (lookingForTitle && line.length > 3 && !/^[\d.,\s]+$/.test(line)) {
        current.title = line;
        lookingForTitle = false;
      } else {
        current.body.push(line);
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function extractPenalty(body) {
  for (const line of body) {
    const m = line.match(PENALTY_RE);
    if (m) return cleanText(m[1]).replace(/^[—\-:\s]+/, '').slice(0, 500);
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

function chunkToArticle(c) {
  const penalty = extractPenalty(c.body);
  const stars = extractStars(c.body);
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
}

function parseHtml(html) {
  // First sanity check — DDoS-Guard / JS-required pages
  const lower = html.slice(0, 2000).toLowerCase();
  if (lower.includes('vddosw3data') || lower.includes('please turn javascript') ||
      (lower.includes('ddos-guard') && html.length < 5000)) {
    const err = new Error('Сайт защищён DDoS-Guard и требует выполнения JavaScript для отображения. Прямой парсинг невозможен. Скопируйте текст со страницы вручную и вставьте в поле «Парсить текст».');
    err.code = 'JS_REQUIRED';
    throw err;
  }

  const lines = extractTextFromHtml(html);
  const chunks = chunkByArticles(lines);
  return chunks.filter((c) => c.title && c.title.length >= 2).map(chunkToArticle);
}

function parseText(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map(cleanText)
    .filter((l) => l.length > 0);
  const chunks = chunkByArticles(lines);
  return chunks.filter((c) => c.title && c.title.length >= 2).map(chunkToArticle);
}

module.exports = { parseHtml, parseText, name: 'generic' };
