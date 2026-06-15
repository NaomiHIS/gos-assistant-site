(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const State = {
    user: null,
    servers: [],
    categories: [],
    articles: [],
    users: [],
    editing: { type: null, id: null },
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
      if (!me.success || me.user.role !== 'admin') {
        toast('Требуются права администратора');
        setTimeout(() => (location.href = '/'), 1500);
        return;
      }
      State.user = me.user;
      window.GosClient.setUser(me.user);
      renderUserCard();
    } catch (err) {
      toast('Ошибка авторизации: ' + err.message);
      setTimeout(() => (location.href = '/login.html'), 1500);
      return;
    }

    setupNav();
    setupModals();
    setupActions();
    await loadAll();
    showView('dashboard');
  }

  function renderUserCard() {
    if (!State.user) return;
    $('user-name').textContent = State.user.username || 'admin';
    $('user-role').textContent = State.user.role || 'user';
    $('user-avatar').textContent = (State.user.username || '?').charAt(0).toUpperCase();
  }

  // ============================================================
  // Navigation
  // ============================================================
  function setupNav() {
    document.querySelectorAll('.admin-nav-item[data-view]').forEach((item) => {
      item.addEventListener('click', () => showView(item.dataset.view));
    });
    $('nav-home').addEventListener('click', () => (location.href = '/'));
    $('nav-logout').addEventListener('click', async () => {
      try { await window.GosClient.auth.logout(); } catch {}
      window.GosClient.logout();
      location.href = '/';
    });
  }

  function showView(name) {
    document.querySelectorAll('.admin-nav-item[data-view]').forEach((i) => {
      i.classList.toggle('active', i.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('hidden', v.dataset.view !== name);
    });

    if (name === 'dashboard') renderDashboard();
    if (name === 'servers') renderServersTable();
    if (name === 'categories') renderCategoriesTable();
    if (name === 'articles') renderArticlesTable();
    if (name === 'users') loadAndRenderUsers();
    if (name === 'parser') initParserView();
  }

  // ============================================================
  // Modals
  // ============================================================
  function setupModals() {
    document.querySelectorAll('[data-modal]').forEach((btn) => {
      btn.addEventListener('click', () => openModal(btn.dataset.modal));
    });
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeAllModals());
    });
    document.querySelectorAll('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeAllModals();
      });
    });
  }

  function openModal(name, data) {
    State.editing = { type: name, id: data?.id || null };
    if (name === 'server') prepareServerModal(data);
    if (name === 'category') prepareCategoryModal(data);
    if (name === 'article') prepareArticleModal(data);
    document.getElementById('modal-' + name).classList.add('open');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.classList.remove('open'));
    State.editing = { type: null, id: null };
  }

  // ============================================================
  // Load all
  // ============================================================
  async function loadAll() {
    try {
      const [servers, categories, articles] = await Promise.all([
        window.GosClient.servers.listAll(),
        window.GosClient.categories.listAll(),
        window.GosClient.articles.list(),
      ]);
      State.servers = servers;
      State.categories = categories;
      State.articles = articles;
      populateArticleFilters();
    } catch (err) {
      toast('Ошибка загрузки данных: ' + err.message);
    }
  }

  // ============================================================
  // Dashboard
  // ============================================================
  async function renderDashboard() {
    $('stat-servers').textContent = State.servers.length;
    $('stat-categories').textContent = State.categories.length;
    $('stat-articles').textContent = State.articles.length;
    try {
      const users = await window.GosClient.users.list();
      State.users = users;
      $('stat-users').textContent = users.length;
      const tbody = $('recent-users');
      tbody.innerHTML = users.slice(0, 5).map((u) => `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td><span class="badge badge-${u.role === 'admin' ? 'primary' : 'muted'}">${u.role}</span></td>
          <td class="text-muted">${formatDate(u.created_at)}</td>
        </tr>
      `).join('');
    } catch {}
  }

  // ============================================================
  // Servers
  // ============================================================
  function renderServersTable() {
    const tbody = $('servers-table');
    tbody.innerHTML = State.servers.map((s) => `
      <tr>
        <td><div class="brand-icon" style="width:30px;height:30px;font-size:11px;background:${escapeHtml(s.color)}">${escapeHtml(s.icon)}</div></td>
        <td><code>${escapeHtml(s.id)}</code></td>
        <td>${escapeHtml(s.name)}</td>
        <td><span class="badge ${s.is_active ? 'badge-success' : 'badge-muted'}">${s.is_active ? 'Активен' : 'Выкл'}</span></td>
        <td>
          <div class="actions-row">
            <button class="icon-btn" data-edit-server="${escapeHtml(s.id)}" title="Редактировать">✎</button>
            <button class="icon-btn danger" data-del-server="${escapeHtml(s.id)}" title="Удалить">✕</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit-server]').forEach((b) => {
      b.addEventListener('click', () => {
        const srv = State.servers.find((s) => s.id === b.dataset.editServer);
        if (srv) openModal('server', srv);
      });
    });
    tbody.querySelectorAll('[data-del-server]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Удалить сервер? Все связанные статьи будут удалены.')) return;
        try {
          await window.GosClient.servers.remove(b.dataset.delServer);
          await loadAll();
          renderServersTable();
          toast('Сервер удалён');
        } catch (err) { toast('Ошибка: ' + err.message); }
      });
    });
  }

  function prepareServerModal(srv) {
    $('modal-server-title').textContent = srv ? 'Редактирование сервера' : 'Новый сервер';
    $('srv-id').value = srv?.id || '';
    $('srv-id').disabled = !!srv;
    $('srv-name').value = srv?.name || '';
    $('srv-icon').value = srv?.icon || 'GS';
    $('srv-color').value = srv?.color || '#DF005B';
    $('srv-desc').value = srv?.description || '';
    $('srv-order').value = srv?.sort_order || 0;
  }

  // ============================================================
  // Categories
  // ============================================================
  function renderCategoriesTable() {
    const tbody = $('categories-table');
    tbody.innerHTML = State.categories.map((c) => `
      <tr>
        <td><code>${escapeHtml(c.id)}</code></td>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.short_name)}</td>
        <td><span class="badge badge-muted">${c.type}</span></td>
        <td><div style="width:18px;height:18px;border-radius:4px;background:${escapeHtml(c.color)}"></div></td>
        <td>
          <div class="actions-row">
            <button class="icon-btn" data-edit-cat="${escapeHtml(c.id)}">✎</button>
            <button class="icon-btn danger" data-del-cat="${escapeHtml(c.id)}">✕</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit-cat]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = State.categories.find((x) => x.id === b.dataset.editCat);
        if (c) openModal('category', c);
      });
    });
    tbody.querySelectorAll('[data-del-cat]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Удалить категорию?')) return;
        try {
          await window.GosClient.categories.remove(b.dataset.delCat);
          await loadAll();
          renderCategoriesTable();
          toast('Категория удалена');
        } catch (err) { toast('Ошибка: ' + err.message); }
      });
    });
  }

  function prepareCategoryModal(c) {
    $('modal-category-title').textContent = c ? 'Редактирование категории' : 'Новая категория';
    $('cat-id').value = c?.id || '';
    $('cat-id').disabled = !!c;
    $('cat-name').value = c?.name || '';
    $('cat-short').value = c?.short_name || '';
    $('cat-type').value = c?.type || 'laws';
    $('cat-color').value = c?.color || '#DF005B';
    $('cat-order').value = c?.sort_order || 0;
  }

  // ============================================================
  // Articles
  // ============================================================
  function populateArticleFilters() {
    const srvSel = $('filter-server');
    srvSel.innerHTML = '<option value="">Все серверы</option>' +
      State.servers.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');

    const catSel = $('filter-category');
    catSel.innerHTML = '<option value="">Все категории</option>' +
      State.categories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');

    // Article modal selects
    $('art-server').innerHTML = State.servers.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    $('art-category').innerHTML = State.categories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');

    srvSel.addEventListener('change', renderArticlesTable);
    catSel.addEventListener('change', renderArticlesTable);
    $('filter-search').addEventListener('input', renderArticlesTable);
  }

  function renderArticlesTable() {
    const srvF = $('filter-server')?.value || '';
    const catF = $('filter-category')?.value || '';
    const q = ($('filter-search')?.value || '').toLowerCase().trim();
    const filtered = State.articles.filter((a) => {
      if (srvF && a.serverId !== srvF) return false;
      if (catF && a.categoryId !== catF) return false;
      if (q) {
        const hay = `${a.code} ${a.title} ${a.text} ${a.penalty || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const tbody = $('articles-table');
    tbody.innerHTML = filtered.map((a) => {
      const srv = State.servers.find((s) => s.id === a.serverId);
      const cat = State.categories.find((c) => c.id === a.categoryId);
      const stars = '★'.repeat(a.wantedStars || 0).padEnd(5, '☆');
      return `
        <tr>
          <td><code>${escapeHtml(a.code)}</code></td>
          <td>${escapeHtml(a.title)}</td>
          <td>${srv ? escapeHtml(srv.name) : '—'}</td>
          <td>${cat ? `<span class="badge" style="background:${cat.color}22;color:${cat.color}">${escapeHtml(cat.short_name || cat.name)}</span>` : '—'}</td>
          <td style="color:var(--warning);font-size:11px;letter-spacing:1px">${stars}</td>
          <td>
            <div class="actions-row">
              <button class="icon-btn" data-edit-art="${a.id}">✎</button>
              <button class="icon-btn danger" data-del-art="${a.id}">✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:30px">Нет данных</td></tr>';

    tbody.querySelectorAll('[data-edit-art]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = State.articles.find((x) => x.id === b.dataset.editArt);
        if (a) openModal('article', a);
      });
    });
    tbody.querySelectorAll('[data-del-art]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Удалить статью?')) return;
        try {
          await window.GosClient.articles.remove(b.dataset.delArt);
          await loadAll();
          renderArticlesTable();
          toast('Статья удалена');
        } catch (err) { toast('Ошибка: ' + err.message); }
      });
    });
  }

  function prepareArticleModal(a) {
    $('modal-article-title').textContent = a ? 'Редактирование статьи' : 'Новая статья';
    $('art-server').value = a?.serverId || (State.servers[0]?.id || '');
    $('art-category').value = a?.categoryId || (State.categories[0]?.id || '');
    $('art-code').value = a?.code || '';
    $('art-title').value = a?.title || '';
    $('art-text').value = a?.text || '';
    $('art-penalty').value = a?.penalty || '';
    $('art-stars').value = a?.wantedStars || 0;
    $('art-order').value = a?.sortOrder || 0;
  }

  // ============================================================
  // Users
  // ============================================================
  async function loadAndRenderUsers() {
    try {
      const users = await window.GosClient.users.list();
      State.users = users;
      const tbody = $('users-table');
      tbody.innerHTML = users.map((u) => `
        <tr>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.username)}</td>
          <td>
            <select class="input select" style="height:32px;max-width:140px" data-user-role="${u.id}" ${u.id === State.user.id ? 'disabled' : ''}>
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
              <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>Moderator</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </td>
          <td class="text-muted">${formatDate(u.created_at)}</td>
          <td class="text-muted">${u.last_login ? formatDate(u.last_login) : '—'}</td>
          <td>
            <button class="icon-btn danger" data-del-user="${u.id}" ${u.id === State.user.id ? 'disabled' : ''}>✕</button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-user-role]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          try {
            await window.GosClient.users.setRole(sel.dataset.userRole, sel.value);
            toast('Роль обновлена');
          } catch (err) { toast('Ошибка: ' + err.message); }
        });
      });
      tbody.querySelectorAll('[data-del-user]').forEach((b) => {
        b.addEventListener('click', async () => {
          if (!confirm('Удалить пользователя?')) return;
          try {
            await window.GosClient.users.remove(b.dataset.delUser);
            await loadAndRenderUsers();
            toast('Пользователь удалён');
          } catch (err) { toast('Ошибка: ' + err.message); }
        });
      });
    } catch (err) {
      toast('Ошибка загрузки пользователей: ' + err.message);
    }
  }

  // ============================================================
  // Save handlers
  // ============================================================
  function setupActions() {
    $('srv-save').addEventListener('click', async () => {
      const data = {
        id: $('srv-id').value.trim(),
        name: $('srv-name').value.trim(),
        icon: $('srv-icon').value.trim() || 'GS',
        color: $('srv-color').value.trim() || '#DF005B',
        description: $('srv-desc').value.trim(),
        sort_order: parseInt($('srv-order').value, 10) || 0,
        is_active: true,
      };
      if (!data.id || !data.name) return toast('Заполните ID и название');
      try {
        if (State.editing.type === 'server' && State.editing.id) {
          await window.GosClient.servers.update(State.editing.id, data);
        } else {
          await window.GosClient.servers.create(data);
        }
        await loadAll();
        renderServersTable();
        closeAllModals();
        toast('Сохранено');
      } catch (err) { toast('Ошибка: ' + err.message); }
    });

    $('cat-save').addEventListener('click', async () => {
      const data = {
        id: $('cat-id').value.trim(),
        name: $('cat-name').value.trim(),
        short_name: $('cat-short').value.trim(),
        type: $('cat-type').value,
        color: $('cat-color').value.trim() || '#DF005B',
        sort_order: parseInt($('cat-order').value, 10) || 0,
        is_active: true,
      };
      if (!data.id || !data.name) return toast('Заполните ID и название');
      try {
        if (State.editing.type === 'category' && State.editing.id) {
          await window.GosClient.categories.update(State.editing.id, data);
        } else {
          await window.GosClient.categories.create(data);
        }
        await loadAll();
        renderCategoriesTable();
        closeAllModals();
        toast('Сохранено');
      } catch (err) { toast('Ошибка: ' + err.message); }
    });

    $('art-save').addEventListener('click', async () => {
      const data = {
        serverId: $('art-server').value,
        categoryId: $('art-category').value,
        code: $('art-code').value.trim(),
        title: $('art-title').value.trim(),
        text: $('art-text').value.trim(),
        penalty: $('art-penalty').value.trim(),
        wantedStars: parseInt($('art-stars').value, 10) || 0,
        sortOrder: parseInt($('art-order').value, 10) || 0,
        isActive: true,
      };
      if (!data.code || !data.title || !data.text) return toast('Заполните код, название и текст');
      try {
        if (State.editing.type === 'article' && State.editing.id) {
          await window.GosClient.articles.update(State.editing.id, data);
        } else {
          await window.GosClient.articles.create(data);
        }
        await loadAll();
        renderArticlesTable();
        closeAllModals();
        toast('Сохранено');
      } catch (err) { toast('Ошибка: ' + err.message); }
    });
  }

  // ============================================================
  // Utilities
  // ============================================================
  function formatDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // ============================================================
  // Parser
  // ============================================================
  const ParserState = {
    initialized: false,
    articles: [], // [{ code, title, text, penalty, wantedStars, selected }]
    detectedCategory: null,
  };

  function initParserView() {
    populateParserSelects();
    if (ParserState.initialized) return;
    ParserState.initialized = true;

    $('btn-parse').addEventListener('click', () => doParse({ url: $('parser-url').value.trim() }));
    $('btn-parse-raw').addEventListener('click', () => doParse({ rawText: $('parser-raw').value }));
    $('parser-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doParse({ url: $('parser-url').value.trim() });
    });

    $('btn-codexdb-load').addEventListener('click', doCodexDbLoad);
    loadCodexDbServers();

    $('btn-parser-import').addEventListener('click', doImport);
    $('btn-parser-select-all').addEventListener('click', () => toggleAllParser(true));
    $('btn-parser-deselect-all').addEventListener('click', () => toggleAllParser(false));
    $('parser-check-all').addEventListener('change', (e) => toggleAllParser(e.target.checked));
  }

  async function loadCodexDbServers() {
    try {
      const res = await fetch(window.GosClient.API_BASE + '/parser/codexdb/servers', {
        headers: { 'Authorization': 'Bearer ' + window.GosClient.getToken() },
      });
      const data = await res.json();
      if (data.success) {
        const sel = $('codexdb-server');
        sel.innerHTML = data.servers.map((s) =>
          `<option value="${escapeHtml(s.file)}">${escapeHtml(s.name)}</option>`
        ).join('');
      }
    } catch (err) {
      console.warn('CodexDB servers load failed:', err);
    }
  }

  async function doCodexDbLoad() {
    const serverFile = $('codexdb-server').value;
    if (!serverFile) {
      setParserStatus('Выберите сервер', 'warn');
      return;
    }
    setParserStatus('Загрузка из Codex-DB...', 'info');
    $('parser-result').classList.add('hidden');
    const btn = $('btn-codexdb-load');
    btn.disabled = true;

    try {
      const res = await fetch(window.GosClient.API_BASE + '/parser/codexdb/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + window.GosClient.getToken(),
        },
        body: JSON.stringify({ serverFile }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setParserStatus('Ошибка: ' + (data.error || res.statusText), 'error');
        return;
      }

      ParserState.articles = (data.articles || []).map((a) => ({ ...a, selected: true }));
      ParserState.detectedCategory = null;
      const dateStr = data.updatedAt
        ? new Date(data.updatedAt).toLocaleDateString('ru-RU')
        : 'неизвестно';
      setParserStatus(
        `Загружено ${data.articlesCount} статей из Codex-DB (обновлено: ${dateStr})`,
        'success'
      );
      renderParserTable();
      $('parser-result').classList.remove('hidden');
    } catch (err) {
      setParserStatus('Ошибка сети: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function populateParserSelects() {
    const srvSel = $('parser-server');
    const catSel = $('parser-category');
    if (!srvSel || !catSel) return;
    srvSel.innerHTML = State.servers.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    catSel.innerHTML =
      '<option value="__auto__">По типу из источника (для Codex-DB)</option>' +
      State.categories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  }

  function setParserStatus(msg, type) {
    const el = $('parser-status');
    if (!el) return;
    el.classList.remove('hidden');
    const colors = {
      info: { bg: 'var(--accent-soft)', color: 'var(--accent-primary)' },
      success: { bg: 'rgba(16,185,129,0.12)', color: 'var(--success)' },
      error: { bg: 'rgba(239,68,68,0.12)', color: 'var(--danger)' },
      warn: { bg: 'rgba(245,158,11,0.12)', color: 'var(--warning)' },
    };
    const c = colors[type] || colors.info;
    el.style.background = c.bg;
    el.style.color = c.color;
    el.textContent = msg;
  }

  function clearParserStatus() {
    $('parser-status').classList.add('hidden');
  }

  async function doParse(payload) {
    if (!payload.url && !payload.rawText) {
      setParserStatus('Укажите URL или вставьте текст', 'warn');
      return;
    }
    setParserStatus('Загрузка и парсинг...', 'info');
    $('parser-result').classList.add('hidden');
    const btn = payload.url ? $('btn-parse') : $('btn-parse-raw');
    btn.disabled = true;

    try {
      const res = await fetch(window.GosClient.API_BASE + '/parser/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + window.GosClient.getToken(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setParserStatus('Ошибка: ' + (data.error || res.statusText), 'error');
        return;
      }

      ParserState.articles = (data.articles || []).map((a) => ({ ...a, selected: true }));
      ParserState.detectedCategory = data.detectedCategory;

      if (data.detectedCategory) {
        const opt = Array.from($('parser-category').options).find((o) => o.value === data.detectedCategory);
        if (opt) $('parser-category').value = data.detectedCategory;
      }

      const parserName = data.parser === 'majestic' ? 'Majestic RP' : data.parser;
      setParserStatus(`Найдено: ${data.articlesCount} статей (парсер: ${parserName})`, data.articlesCount > 0 ? 'success' : 'warn');

      if (data.articlesCount > 0) {
        renderParserTable();
        $('parser-result').classList.remove('hidden');
      }
    } catch (err) {
      setParserStatus('Ошибка сети: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function renderParserTable() {
    const tbody = $('parser-table');
    tbody.innerHTML = ParserState.articles.map((a, i) => `
      <tr>
        <td><input type="checkbox" data-parser-row="${i}" ${a.selected ? 'checked' : ''} /></td>
        <td><input type="text" class="input" style="height:30px;font-family:monospace;font-size:11px" data-field="code" data-idx="${i}" value="${escapeHtml(a.code || '')}" /></td>
        <td><input type="text" class="input" style="height:30px;font-size:12px" data-field="title" data-idx="${i}" value="${escapeHtml(a.title || '')}" /></td>
        <td><textarea class="input" style="height:60px;font-size:12px;padding:6px 10px;resize:vertical" data-field="text" data-idx="${i}">${escapeHtml(a.text || '')}</textarea></td>
        <td><input type="text" class="input" style="height:30px;font-size:11px" data-field="penalty" data-idx="${i}" value="${escapeHtml(a.penalty || '')}" /></td>
        <td><input type="number" class="input" style="height:30px;width:50px;text-align:center" min="0" max="5" data-field="wantedStars" data-idx="${i}" value="${a.wantedStars || 0}" /></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('input[data-parser-row]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.parserRow, 10);
        ParserState.articles[idx].selected = cb.checked;
        updateParserSummary();
      });
    });

    tbody.querySelectorAll('[data-field][data-idx]').forEach((el) => {
      el.addEventListener('input', () => {
        const idx = parseInt(el.dataset.idx, 10);
        const field = el.dataset.field;
        let value = el.value;
        if (field === 'wantedStars') value = parseInt(value, 10) || 0;
        ParserState.articles[idx][field] = value;
      });
    });

    updateParserSummary();
  }

  function updateParserSummary() {
    const selected = ParserState.articles.filter((a) => a.selected).length;
    $('parser-summary').textContent = `Найдено: ${ParserState.articles.length} · Выбрано: ${selected}`;
  }

  function toggleAllParser(checked) {
    ParserState.articles.forEach((a) => (a.selected = checked));
    document.querySelectorAll('#parser-table input[data-parser-row]').forEach((cb) => {
      cb.checked = checked;
    });
    $('parser-check-all').checked = checked;
    updateParserSummary();
  }

  async function doImport() {
    const serverId = $('parser-server').value;
    const categoryId = $('parser-category').value;
    const mode = $('parser-mode').value;
    const selected = ParserState.articles.filter((a) => a.selected);

    if (!selected.length) {
      setParserStatus('Выберите хотя бы одну статью', 'warn');
      return;
    }

    // Group by category (either chosen one, or suggested per-article for __auto__)
    const groups = {};
    for (const a of selected) {
      const cat = categoryId === '__auto__'
        ? (a.suggestedCategoryId || a.categoryId || 'uk')
        : categoryId;
      (groups[cat] = groups[cat] || []).push(a);
    }

    const groupCount = Object.keys(groups).length;
    if (mode === 'replace') {
      const groupList = Object.entries(groups)
        .map(([cat, arts]) => `  • ${cat}: ${arts.length} статей`)
        .join('\n');
      if (!confirm(
        `Удалить все существующие статьи в категориях и заменить новыми?\n\n${groupList}\n\nСервер: ${serverId}`
      )) return;
    }

    setParserStatus(`Импорт ${selected.length} статей в ${groupCount} категорий...`, 'info');
    const btn = $('btn-parser-import');
    btn.disabled = true;

    try {
      let totalInserted = 0;
      let totalRemoved = 0;
      let totalSkipped = 0;
      const allErrors = [];

      for (const [cat, arts] of Object.entries(groups)) {
        const res = await fetch(window.GosClient.API_BASE + '/parser/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + window.GosClient.getToken(),
          },
          body: JSON.stringify({ serverId, categoryId: cat, articles: arts, mode }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          allErrors.push(`Категория ${cat}: ${data.error || res.statusText}`);
          continue;
        }
        totalInserted += data.inserted || 0;
        totalRemoved += data.removed || 0;
        totalSkipped += data.skipped || 0;
        if (data.errors) allErrors.push(...data.errors);
      }

      const parts = [`✓ Импортировано: ${totalInserted} в ${groupCount} категорий`];
      if (totalRemoved) parts.push(`удалено: ${totalRemoved}`);
      if (totalSkipped) parts.push(`пропущено: ${totalSkipped}`);
      setParserStatus(parts.join(' · '), allErrors.length ? 'warn' : 'success');

      await loadAll();
      populateParserSelects();

      if (allErrors.length) {
        console.warn('Import errors:', allErrors);
        toast('Часть статей с ошибками — см. консоль');
      } else {
        toast('Импорт завершён');
      }
    } catch (err) {
      setParserStatus('Ошибка сети: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
