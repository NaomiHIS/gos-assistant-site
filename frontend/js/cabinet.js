(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const State = {
    user: null,
    servers: [],
    categories: [],
  };

  // ============================================================
  // Init / Auth gate
  // ============================================================
  async function init() {
    const token = window.GosClient.getToken();
    if (!token) {
      location.href = '/login.html';
      return;
    }
    try {
      const me = await window.GosClient.auth.me();
      if (!me.success) {
        location.href = '/login.html';
        return;
      }
      State.user = me.user;
      window.GosClient.setUser(me.user);
      renderHeader();
    } catch (err) {
      window.GosClient.logout();
      location.href = '/login.html';
      return;
    }

    setupTabs();
    setupActions();
    setupProfile();
    setupPassword();
    setupDiscord();
    setupDownloads();
    await loadData();
    handleDiscordReturnParams();
  }

  function renderHeader() {
    const u = State.user;
    if (!u) return;
    const initial = (u.username || u.email || '?').charAt(0).toUpperCase();
    $('big-avatar').textContent = initial;
    $('big-name').textContent = u.username || 'User';
    $('big-email').textContent = u.email || '';
    $('badge-role').textContent = u.role || 'user';
    if (u.role === 'admin') {
      $('badge-role').classList.remove('badge-muted');
      $('badge-role').classList.add('badge-primary');
      $('btn-admin').classList.remove('hidden');
    }
    if (u.created_at) {
      $('reg-date').textContent = 'С нами с ' + new Date(u.created_at).toLocaleDateString('ru-RU');
    }
  }

  // ============================================================
  // Tabs
  // ============================================================
  function setupTabs() {
    document.querySelectorAll('.cabinet-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.cabinet-tab').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.cabinet-panel').forEach((p) => {
          p.classList.toggle('active', p.dataset.panel === tab);
          p.classList.toggle('hidden', p.dataset.panel !== tab);
        });
      });
    });
  }

  // ============================================================
  // Actions
  // ============================================================
  function setupActions() {
    $('btn-logout').addEventListener('click', async () => {
      try { await window.GosClient.auth.logout(); } catch {}
      window.GosClient.logout();
      location.href = '/';
    });

    $('btn-logout-all').addEventListener('click', async () => {
      if (!confirm('Завершить сеанс на всех устройствах? Придётся войти заново везде.')) return;
      try {
        await window.GosClient.auth.logoutAll();
        window.GosClient.logout();
        location.href = '/login.html';
      } catch (err) {
        toast('Не удалось: ' + err.message);
      }
    });
  }

  // ============================================================
  // Profile
  // ============================================================
  function setupProfile() {
    $('profile-email').value = State.user.email || '';
    $('profile-username').value = State.user.username || '';

    $('btn-save-profile').addEventListener('click', async () => {
      const username = $('profile-username').value.trim();
      if (!username || username.length < 2) {
        showProfileError('Имя пользователя слишком короткое');
        return;
      }

      const btn = $('btn-save-profile');
      btn.disabled = true;
      btn.textContent = 'Сохранение...';
      try {
        const data = await window.GosClient.auth.updateProfile({ username });
        if (data.success) {
          State.user = data.user;
          window.GosClient.setUser(data.user);
          renderHeader();
          showProfileSuccess('Профиль обновлён');
        } else {
          showProfileError(data.error || 'Ошибка сохранения');
        }
      } catch (err) {
        showProfileError(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить изменения';
      }
    });
  }

  function showProfileError(msg) {
    $('profile-error').textContent = msg;
    $('profile-error').classList.add('visible');
    $('profile-success').classList.remove('visible');
  }
  function showProfileSuccess(msg) {
    $('profile-success').textContent = msg;
    $('profile-success').classList.add('visible');
    $('profile-error').classList.remove('visible');
    setTimeout(() => $('profile-success').classList.remove('visible'), 3000);
  }

  // ============================================================
  // Password
  // ============================================================
  function setupPassword() {
    $('btn-change-password').addEventListener('click', async () => {
      const current = $('pass-current').value;
      const next = $('pass-new').value;
      const next2 = $('pass-new2').value;

      $('pass-error').classList.remove('visible');
      $('pass-success').classList.remove('visible');

      if (!current || !next) {
        showPassError('Заполните все поля');
        return;
      }
      if (next.length < 6) {
        showPassError('Новый пароль должен быть не менее 6 символов');
        return;
      }
      if (next !== next2) {
        showPassError('Пароли не совпадают');
        return;
      }

      const btn = $('btn-change-password');
      btn.disabled = true;
      btn.textContent = 'Сохранение...';
      try {
        const data = await window.GosClient.auth.changePassword(current, next);
        if (data.success) {
          showPassSuccess('Пароль изменён. Через 2 секунды нужно войти заново.');
          setTimeout(async () => {
            try { await window.GosClient.auth.logout(); } catch {}
            window.GosClient.logout();
            location.href = '/login.html';
          }, 2000);
        } else {
          showPassError(data.error || 'Ошибка');
        }
      } catch (err) {
        showPassError(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Изменить пароль';
      }
    });
  }

  function showPassError(msg) {
    $('pass-error').textContent = msg;
    $('pass-error').classList.add('visible');
  }
  function showPassSuccess(msg) {
    $('pass-success').textContent = msg;
    $('pass-success').classList.add('visible');
  }

  // ============================================================
  // Discord linking
  // ============================================================
  function setupDiscord() {
    renderDiscordStatus();

    $('btn-link-discord').addEventListener('click', async () => {
      const btn = $('btn-link-discord');
      btn.disabled = true;
      btn.textContent = 'Открываем Discord...';
      try {
        const data = await window.GosClient.auth.discordLinkUrl();
        if (data && data.success && data.url) {
          location.href = data.url;
        } else {
          toast('Ошибка: ' + (data?.error || 'нет URL'));
          btn.disabled = false;
          btn.textContent = 'Привязать';
        }
      } catch (err) {
        toast('Ошибка: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Привязать';
      }
    });

    $('btn-unlink-discord').addEventListener('click', async () => {
      if (!confirm('Отвязать Discord от вашего аккаунта?')) return;
      const btn = $('btn-unlink-discord');
      btn.disabled = true;
      try {
        const data = await window.GosClient.auth.discordUnlink();
        if (data && data.success) {
          State.user = data.user;
          window.GosClient.setUser(data.user);
          renderHeader();
          renderDiscordStatus();
          toast('Discord отвязан');
        } else {
          toast('Ошибка: ' + (data?.error || 'не удалось'));
        }
      } catch (err) {
        toast('Ошибка: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function renderDiscordStatus() {
    const status = $('discord-status');
    const linkBtn = $('btn-link-discord');
    const unlinkBtn = $('btn-unlink-discord');
    const linked = !!(State.user && State.user.discordId);
    if (linked) {
      status.textContent = `Привязан · ID: ${State.user.discordId}`;
      status.style.color = 'var(--success)';
      linkBtn.classList.add('hidden');
      unlinkBtn.classList.remove('hidden');
    } else {
      status.textContent = 'Не привязан';
      status.style.color = 'var(--text-muted)';
      linkBtn.classList.remove('hidden');
      unlinkBtn.classList.add('hidden');
    }
  }

  async function handleDiscordReturnParams() {
    const params = new URLSearchParams(location.search);
    const discordParam = params.get('discord');
    if (!discordParam) return;
    history.replaceState({}, '', location.pathname + '#security');

    // Switch to security tab so user sees the result
    document.querySelectorAll('.cabinet-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === 'security');
    });
    document.querySelectorAll('.cabinet-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.panel === 'security');
      p.classList.toggle('hidden', p.dataset.panel !== 'security');
    });

    if (discordParam === 'linked') {
      // Re-fetch user to get updated discord_id
      try {
        const me = await window.GosClient.auth.me();
        if (me && me.success) {
          State.user = me.user;
          window.GosClient.setUser(me.user);
          renderHeader();
          renderDiscordStatus();
        }
      } catch {}
      toast('Discord успешно привязан');
    } else if (discordParam === 'error') {
      toast('Ошибка: ' + (params.get('reason') || 'не удалось привязать Discord'));
    }
  }

  // ============================================================
  // Downloads — real releases from API
  // ============================================================
  async function setupDownloads() {
    const grid = $('download-grid');
    try {
      const res = await fetch(window.GosClient.API_BASE + '/releases/latest');
      const data = await res.json();
      if (!data.success || (!data.installer && !data.portable)) {
        grid.innerHTML = `
          <div class="text-muted text-sm" style="padding: 30px; text-align: center;">
            Релизы пока не загружены. Загляните позже.
          </div>`;
        return;
      }
      const items = [];
      if (data.installer) {
        items.push(renderDownloadItem(data.installer, 'Windows Installer', 'x64 · с автообновлением',
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
          'btn-primary'));
      }
      if (data.portable) {
        items.push(renderDownloadItem(data.portable, 'Portable версия', 'x64 · без установки',
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></svg>`,
          'btn-secondary'));
      }
      grid.innerHTML = items.join('');
      grid.querySelectorAll('[data-release-id]').forEach((btn) => {
        btn.addEventListener('click', (e) => downloadRelease(e, btn.dataset.releaseId, btn.dataset.releaseName));
      });
    } catch (err) {
      grid.innerHTML = `<div class="text-muted text-sm" style="padding: 20px; color: var(--danger);">Ошибка: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderDownloadItem(release, label, descSuffix, iconSvg, btnClass) {
    return `
      <div class="download-item">
        <div class="download-icon">${iconSvg}</div>
        <div class="download-info">
          <div class="download-title">${escapeHtml(label)} <span class="text-xs text-muted">v${escapeHtml(release.version)}</span></div>
          <div class="download-desc">${escapeHtml(release.sizeFormatted)} · ${descSuffix}${release.downloadCount ? ' · ' + release.downloadCount + ' скачиваний' : ''}</div>
          ${release.notes ? `<div class="text-xs text-muted mt-2">${escapeHtml(release.notes)}</div>` : ''}
        </div>
        <button class="btn ${btnClass}" data-release-id="${release.id}" data-release-name="${escapeHtml(release.originalName)}">Скачать</button>
      </div>
    `;
  }

  async function downloadRelease(e, id, originalName) {
    e.preventDefault();
    const token = window.GosClient.getToken();
    if (!token) {
      toast('Войдите в аккаунт');
      return;
    }
    try {
      const res = await fetch(window.GosClient.API_BASE + '/releases/download/' + id, {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast('Ошибка: ' + (err.error || res.statusText));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalName || ('GOS-Assistant-' + id);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Загрузка началась');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ============================================================
  // Data
  // ============================================================
  async function loadData() {
    try {
      const [servers, categories] = await Promise.all([
        window.GosClient.servers.list(),
        window.GosClient.categories.list(),
      ]);
      State.servers = servers;
      State.categories = categories;
      renderServers();
      populateSearchControls();
      setupSearch();
    } catch (err) {
      console.warn('Не удалось загрузить данные:', err);
    }
  }

  function renderServers() {
    const grid = $('servers-list');
    if (!State.servers.length) {
      grid.innerHTML = '<div class="text-muted text-sm" style="grid-column: 1/-1; padding: 20px; text-align: center;">Серверы пока не настроены</div>';
      return;
    }
    grid.innerHTML = State.servers.map((s) => `
      <div class="server-tile">
        <div class="server-tile-icon" style="background:${escapeHtml(s.color || '#DF005B')}">${escapeHtml(s.icon || '?')}</div>
        <div class="server-tile-name">${escapeHtml(s.name)}</div>
      </div>
    `).join('');
  }

  function populateSearchControls() {
    const sel = $('search-server');
    sel.innerHTML = '<option value="">Все серверы</option>' +
      State.servers.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  }

  function setupSearch() {
    let debounce = null;
    const doSearch = async () => {
      const q = $('search-input').value.trim();
      const serverId = $('search-server').value;
      const results = $('search-results');

      if (!q) {
        results.innerHTML = '<div class="text-muted text-sm" style="padding: 20px; text-align: center;">Введите запрос для поиска</div>';
        return;
      }

      try {
        const data = await window.GosClient.articles.search({ q, serverId });
        if (!data.length) {
          results.innerHTML = '<div class="text-muted text-sm" style="padding: 20px; text-align: center;">Ничего не найдено</div>';
          return;
        }
        results.innerHTML = data.map((a) => {
          const cat = State.categories.find((c) => c.id === a.categoryId);
          return `
            <div class="result-card">
              <div class="result-card-header">
                <span class="result-card-code" ${cat ? `style="background:${cat.color}22;color:${cat.color}"` : ''}>${escapeHtml(a.code)}</span>
                <span class="result-card-title">${highlight(a.title, q)}</span>
              </div>
              <div class="result-card-text">${highlight(a.text, q)}</div>
              ${a.penalty ? `<div class="result-card-penalty">${escapeHtml(a.penalty)}</div>` : ''}
            </div>
          `;
        }).join('');
      } catch (err) {
        results.innerHTML = `<div class="text-muted text-sm" style="padding: 20px; text-align: center; color: var(--danger);">Ошибка: ${escapeHtml(err.message)}</div>`;
      }
    };

    $('search-input').addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(doSearch, 200);
    });
    $('search-server').addEventListener('change', doSearch);
  }

  function highlight(text, q) {
    const safe = escapeHtml(text || '');
    if (!q) return safe;
    const escaped = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(' + escaped + ')', 'gi');
    return safe.replace(re, '<mark style="background:var(--accent-soft);color:var(--accent-primary);padding:1px 3px;border-radius:3px">$1</mark>');
  }

  // ============================================================
  // Start
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
