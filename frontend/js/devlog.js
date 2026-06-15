(function () {
  'use strict';

  const user = window.GosClient.getUser();
  document.querySelectorAll('[data-auth]').forEach((el) => {
    const need = el.dataset.auth;
    const show = need === 'guest' ? !user : !!user;
    el.classList.toggle('hidden', !show);
  });

  const list = document.getElementById('devlog-list');

  fetch(window.GosClient.API_BASE + '/devlog')
    .then((r) => r.json())
    .then((data) => {
      if (!data.success) {
        list.innerHTML = `<div class="devlog-empty" style="color:var(--danger)">Ошибка: ${escapeHtml(data.error)}</div>`;
        return;
      }
      if (!data.entries.length) {
        list.innerHTML = '<div class="devlog-empty">Пока записей нет. Заглядывайте позже.</div>';
        return;
      }
      list.innerHTML = data.entries.map(renderEntry).join('');
    })
    .catch((err) => {
      list.innerHTML = `<div class="devlog-empty" style="color:var(--danger)">Ошибка сети: ${escapeHtml(err.message)}</div>`;
    });

  function renderEntry(e) {
    const date = formatDate(e.publishedAt || e.createdAt);
    const tag = e.tag ? `<span class="devlog-tag tag-${escapeHtml(e.tag)}">${tagLabel(e.tag)}</span>` : '';
    const version = e.version ? `<span class="devlog-version">v${escapeHtml(e.version)}</span>` : '';
    return `
      <article class="devlog-entry">
        <div class="devlog-head">
          ${version}
          ${tag}
          <span class="devlog-date">${date}</span>
        </div>
        <div class="devlog-title">${escapeHtml(e.title)}</div>
        <div class="devlog-content">${escapeHtml(e.content)}</div>
      </article>
    `;
  }

  function tagLabel(tag) {
    const map = { feature: 'Новое', fix: 'Исправление', news: 'Новость', major: 'Важно' };
    return map[tag] || tag.toUpperCase();
  }

  function formatDate(s) {
    if (!s) return '';
    try {
      return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return ''; }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
