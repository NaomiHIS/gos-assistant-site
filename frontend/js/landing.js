(function () {
  'use strict';

  // ============================================================
  // Auth-aware visibility: elements with data-auth="guest" show only
  // when logged out; data-auth="user" show when logged in;
  // data-auth="admin" show only for admins.
  // ============================================================
  const user = window.GosClient.getUser();
  applyAuthVisibility(user);

  // Verify token freshness — refresh user from server if logged in
  if (user) {
    window.GosClient.auth.me().then((data) => {
      if (data && data.success) {
        window.GosClient.setUser(data.user);
        applyAuthVisibility(data.user);
      } else {
        window.GosClient.logout();
        applyAuthVisibility(null);
      }
    }).catch(() => {
      // Keep cached state on network error
    });
  }

  function applyAuthVisibility(u) {
    const isAdmin = !!u && u.role === 'admin';
    const isUser = !!u;
    document.querySelectorAll('[data-auth]').forEach((el) => {
      const need = el.dataset.auth;
      let show = false;
      if (need === 'guest') show = !isUser;
      else if (need === 'user') show = isUser;
      else if (need === 'admin') show = isAdmin;
      el.classList.toggle('hidden', !show);
    });
  }

  // Load latest release info to show real download buttons
  fetch(window.GosClient.API_BASE + '/releases/latest')
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.success) return;
      const info = document.getElementById('download-info');
      const parts = [];
      if (data.installer) {
        parts.push(`v${data.installer.version} · Installer ${data.installer.sizeFormatted}`);
      }
      if (data.portable) {
        parts.push(`Portable ${data.portable.sizeFormatted}`);
      }
      if (parts.length === 0) {
        // No releases uploaded yet
        const sub = document.getElementById('download-subtitle');
        if (sub) sub.textContent = 'Скоро здесь появятся файлы для скачивания';
        if (info) info.textContent = 'Релизы ещё не загружены администратором';
        document.querySelectorAll('#dl-installer, #dl-portable').forEach((b) => b.classList.add('hidden'));
      } else if (info) {
        info.textContent = parts.join(' · ');
      }
    })
    .catch(() => {});

  // Load donate links
  fetch(window.GosClient.API_BASE + '/donate')
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.success || !Array.isArray(data.links) || data.links.length === 0) return;
      const section = document.getElementById('donate-section');
      const list = document.getElementById('donate-list');
      const navDonate = document.getElementById('nav-donate');
      if (!section || !list) return;
      section.style.display = 'block';
      if (navDonate) navDonate.style.display = '';
      list.innerHTML = data.links.map((link) => `
        <a href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer" class="feature-card donate-card" data-id="${link.id}" style="--accent: ${escapeAttr(link.color || '#DF005B')}">
          <div class="feature-icon" style="background: ${rgbaFromHex(link.color || '#DF005B', 0.12)}; color: ${escapeAttr(link.color || '#DF005B')}">
            ${link.icon ? `<span style="font-size: 22px;">${escapeHtml(link.icon)}</span>` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`}
          </div>
          <div class="feature-title">${escapeHtml(link.title)}</div>
          ${link.description ? `<div class="feature-desc">${escapeHtml(link.description)}</div>` : ''}
        </a>
      `).join('');

      list.querySelectorAll('.donate-card').forEach((card) => {
        card.addEventListener('click', () => {
          const id = card.dataset.id;
          // Fire and forget — don't block navigation
          fetch(window.GosClient.API_BASE + '/donate/' + id + '/click', { method: 'POST' }).catch(() => {});
        });
      });
    })
    .catch(() => {});

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  function rgbaFromHex(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return `rgba(223,0,91,${alpha})`;
    const r = parseInt(h.substr(0, 2), 16);
    const g = parseInt(h.substr(2, 2), 16);
    const b = parseInt(h.substr(4, 2), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
