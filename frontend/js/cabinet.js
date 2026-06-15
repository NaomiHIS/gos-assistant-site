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
    setupDownloads();
    await loadData();
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
  // Downloads (placeholders)
  // ============================================================
  function setupDownloads() {
    const showSoon = (e) => {
      e.preventDefault();
      toast('Ссылки появятся после публикации первого релиза');
    };
    $('btn-download-installer').addEventListener('click', showSoon);
    $('btn-download-portable').addEventListener('click', showSoon);
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
