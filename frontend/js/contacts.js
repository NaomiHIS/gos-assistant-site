(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const API = window.GosClient;

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function applyAuthVisibility() {
    const user = API && API.getUser ? API.getUser() : null;
    document.querySelectorAll('[data-auth="guest"]').forEach((el) =>
      el.classList.toggle('hidden', !!user)
    );
    document.querySelectorAll('[data-auth="user"]').forEach((el) =>
      el.classList.toggle('hidden', !user)
    );
  }

  function ensureHref(value, type) {
    if (!value) return null;
    const v = String(value).trim();
    if (type === 'email') return v.startsWith('mailto:') ? v : 'mailto:' + v;
    if (type === 'telegram') {
      if (v.startsWith('http')) return v;
      if (v.startsWith('@')) return 'https://t.me/' + v.slice(1);
      return 'https://t.me/' + v;
    }
    if (type === 'vk') {
      if (v.startsWith('http')) return v;
      return 'https://vk.com/' + v.replace(/^@/, '');
    }
    if (type === 'github') {
      if (v.startsWith('http')) return v;
      return 'https://github.com/' + v.replace(/^@/, '');
    }
    if (type === 'website') {
      if (/^https?:\/\//i.test(v)) return v;
      return 'https://' + v;
    }
    return v;
  }

  const SVG = {
    email:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>',
    discord:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33-.01 0-.02.01-.03.02-2.72 4.07-3.47 8.03-3.1 11.95 0 .02.01.04.03.05 1.8 1.32 3.53 2.12 5.24 2.65.03.01.06 0 .07-.02.4-.55.76-1.13 1.07-1.74.02-.04 0-.08-.04-.09-.57-.22-1.11-.48-1.64-.78-.04-.02-.04-.08-.01-.11.11-.08.22-.17.33-.25.02-.02.05-.02.07-.01 3.44 1.57 7.15 1.57 10.55 0 .02-.01.05-.01.07.01.11.09.22.17.33.26.04.03.04.09-.01.11-.52.31-1.07.56-1.64.78-.04.01-.05.06-.04.09.32.61.68 1.19 1.07 1.74.03.01.06.02.09.01 1.72-.53 3.45-1.33 5.25-2.65.02-.01.03-.03.03-.05.44-4.53-.73-8.46-3.1-11.95-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.83 2.12-1.89 2.12z"/></svg>',
    vk:       '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 5h3.5c1 0 1.2.3 1.6 1.3.7 1.7 2 4.5 3.4 4.5.5 0 .8-.3.8-1.7v-2.6c-.1-1.2-.3-1.5-1.1-1.7C9.9 4.6 11 4 13.3 4c2.7 0 3.6.7 3.6 2.6v3.3c0 1 .2 1.2.5 1.2.7 0 1.9-1.7 3-4.7.4-1 .7-1.4 1.5-1.4H25c1.1 0 1.2.4.9 1.2-.7 1.8-2.7 4.9-3.6 6.4-.4.8-.5 1 0 1.7l3.7 4.4c1 1.2.7 1.8-.7 1.8h-3.6c-1 0-1.2-.4-2-1.4-1.1-1.3-1.8-2.3-2.8-2.3-.5 0-.6.2-.6.8v2c0 .9-.3 1-1.3 1-1.8 0-3.9-.5-6.8-3.4C4.4 12.5 2 7.5 2 7.5V5z"/></svg>',
    github:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.5 2 12.06c0 4.45 2.87 8.22 6.84 9.56.5.09.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.04 1.53 1.04.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.26-4.55-1.11-4.55-4.94 0-1.09.39-1.99 1.03-2.69-.1-.26-.45-1.27.1-2.66 0 0 .84-.27 2.75 1.03A9.43 9.43 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.3 2.75-1.03 2.75-1.03.55 1.39.2 2.4.1 2.66.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86 0 1.34-.01 2.42-.01 2.75 0 .27.18.58.69.48A10.02 10.02 0 0 0 22 12.06C22 6.5 17.52 2 12 2z"/></svg>',
    website:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>',
    link:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  };

  function renderContact({ icon, label, value, href }) {
    if (!value) return '';
    const link = href || value;
    return `
      <a class="contact-row" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
        <span class="contact-row-icon">${SVG[icon] || SVG.link}</span>
        <span class="contact-row-info">
          <span class="contact-row-label">${escapeHtml(label)}</span>
          <span class="contact-row-value">${escapeHtml(value)}</span>
        </span>
      </a>
    `;
  }

  async function load() {
    const cont = $('contacts-content');
    try {
      const res = await fetch(API.API_BASE + '/contacts').then((r) => r.json());
      if (!res.success) throw new Error(res.error || 'Не удалось загрузить контакты');
      const c = res.contacts || {};
      const hasAny = c.ownerName || c.email || c.telegram || c.discord || c.vk || c.github || c.website || (c.customLinks && c.customLinks.length);
      if (!hasAny) {
        cont.innerHTML = `<div class="text-sm text-muted" style="text-align:center;padding:40px 0">Контакты пока не заполнены.</div>`;
        return;
      }

      const initials = (c.ownerName || 'GA').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const avatar = c.avatarUrl
        ? `<img src="${escapeHtml(c.avatarUrl)}" alt="" />`
        : `<span>${escapeHtml(initials || 'GA')}</span>`;

      const rows = [
        renderContact({ icon: 'email',    label: 'Email',    value: c.email,    href: ensureHref(c.email, 'email') }),
        renderContact({ icon: 'telegram', label: 'Telegram', value: c.telegram, href: ensureHref(c.telegram, 'telegram') }),
        renderContact({ icon: 'discord',  label: 'Discord',  value: c.discord,  href: c.discord && c.discord.startsWith('http') ? c.discord : null }),
        renderContact({ icon: 'vk',       label: 'VK',       value: c.vk,       href: ensureHref(c.vk, 'vk') }),
        renderContact({ icon: 'github',   label: 'GitHub',   value: c.github,   href: ensureHref(c.github, 'github') }),
        renderContact({ icon: 'website',  label: 'Сайт',     value: c.website,  href: ensureHref(c.website, 'website') }),
      ].filter(Boolean).join('');

      const customRows = (c.customLinks || []).map((l) => `
        <a class="contact-row" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
          <span class="contact-row-icon">${l.icon ? escapeHtml(l.icon) : SVG.link}</span>
          <span class="contact-row-info">
            <span class="contact-row-label">${escapeHtml(l.label || 'Ссылка')}</span>
            <span class="contact-row-value">${escapeHtml(l.url)}</span>
          </span>
        </a>
      `).join('');

      cont.innerHTML = `
        <div class="contact-card">
          <div class="contact-card-head">
            <div class="contact-avatar">${avatar}</div>
            <div>
              ${c.ownerName ? `<div class="contact-name">${escapeHtml(c.ownerName)}</div>` : ''}
              ${c.ownerRole ? `<div class="contact-role">${escapeHtml(c.ownerRole)}</div>` : ''}
            </div>
          </div>
          ${c.about ? `<div class="contact-about">${escapeHtml(c.about)}</div>` : ''}
          ${rows ? `<div class="contact-rows">${rows}</div>` : ''}
          ${customRows ? `<div class="contact-rows">${customRows}</div>` : ''}
        </div>
      `;
    } catch (err) {
      cont.innerHTML = `<div class="text-sm" style="color:var(--danger);text-align:center;padding:40px 0">${escapeHtml(err.message)}</div>`;
    }
  }

  function setup() {
    applyAuthVisibility();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else setup();
})();
