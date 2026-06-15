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
