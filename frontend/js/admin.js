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
    if (name === 'releases') initReleasesView();
    if (name === 'donate') initDonateView();
    if (name === 'devlog') initDevlogView();
    if (name === 'maintenance') initMaintenanceView();
    if (name === 'support') initSupportView();
    if (name === 'subscriptions') initSubscriptionsView();
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
    if (name === 'donate') {
      openDonateModal(data);
      return;
    }
    if (name === 'devlog') {
      openDevlogModal(data);
      return;
    }
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

    // Majestic-Laws-DB buttons
    $('btn-lawsdb-status').addEventListener('click', doLawsDbStatus);
    $('btn-lawsdb-import-all').addEventListener('click', doLawsDbImportAll);
    $('btn-lawsdb-import-one').addEventListener('click', doLawsDbImportOne);

    $('btn-parser-import').addEventListener('click', doImport);
    $('btn-parser-select-all').addEventListener('click', () => toggleAllParser(true));
    $('btn-parser-deselect-all').addEventListener('click', () => toggleAllParser(false));
    $('parser-check-all').addEventListener('change', (e) => toggleAllParser(e.target.checked));

    // JSON-per-server import
    $('btn-json-preview').addEventListener('click', () => doJsonServerImport({ preview: true }));
    $('btn-json-import').addEventListener('click', () => doJsonServerImport({ preview: false }));
    $('btn-json-clear').addEventListener('click', () => {
      $('json-import-raw').value = '';
      $('json-import-file').value = '';
      $('json-import-status').textContent = '';
    });
    $('json-import-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        $('json-import-raw').value = text;
        $('json-import-status').textContent = `Файл загружен: ${file.name} (${(file.size / 1024).toFixed(1)} КБ)`;
      } catch (err) {
        $('json-import-status').textContent = 'Ошибка чтения файла: ' + err.message;
      }
    });
  }

  async function doJsonServerImport({ preview }) {
    const status = $('json-import-status');
    const serverId = $('json-import-server').value;
    if (!serverId) {
      status.textContent = 'Выберите сервер';
      return;
    }
    const raw = $('json-import-raw').value.trim();
    if (!raw) {
      status.textContent = 'Вставьте JSON или загрузите файл';
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      status.textContent = 'Невалидный JSON: ' + err.message;
      return;
    }
    const mode = $('json-import-mode').value;
    const btn = preview ? $('btn-json-preview') : $('btn-json-import');
    btn.disabled = true;
    status.textContent = preview ? 'Парсинг...' : 'Импорт...';

    try {
      const endpoint = preview ? '/parser/json/preview-server' : '/parser/json/import-server';
      const res = await fetch(window.GosClient.API_BASE + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + window.GosClient.getToken(),
        },
        body: JSON.stringify({ serverId, json: parsed, mode }),
      });
      const data = await res.json();
      if (!data.success) {
        status.textContent = '✗ ' + (data.error || 'Неизвестная ошибка');
        return;
      }
      if (preview) {
        const groupLines = Object.entries(data.groups || {})
          .map(([cat, count]) => `  ${cat}: ${count}`)
          .join('\n');
        status.textContent = `✓ Найдено статей: ${data.articlesCount}\nПо категориям:\n${groupLines || '  (нет)'}`;
      } else {
        status.textContent = `✓ Импорт завершён\nДобавлено: ${data.inserted}\nУдалено старых: ${data.removed}\nПропущено: ${data.skipped}`;
        toast('Импорт завершён: +' + data.inserted);
      }
    } catch (err) {
      status.textContent = '✗ ' + err.message;
    } finally {
      btn.disabled = false;
    }
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
    const serverOptions = State.servers.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    srvSel.innerHTML = serverOptions;
    catSel.innerHTML =
      '<option value="__auto__">По типу из источника (для Codex-DB)</option>' +
      State.categories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    const jsonSrvSel = $('json-import-server');
    if (jsonSrvSel) {
      jsonSrvSel.innerHTML = '<option value="">— Выберите сервер —</option>' + serverOptions;
    }
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

  // ============================================================
  // Majestic-Laws-DB integration (alamantik/majestic-laws-db)
  // ============================================================
  function setLawsDbProgress(msg, append) {
    const el = $('lawsdb-progress');
    if (!el) return;
    if (append) el.textContent += '\n' + msg;
    else el.textContent = msg;
  }

  async function lawsdbFetch(path, opts) {
    const init = {
      headers: { 'Authorization': 'Bearer ' + window.GosClient.getToken() },
      ...opts,
    };
    if (opts && opts.body && typeof opts.body !== 'string') {
      init.body = JSON.stringify(opts.body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(window.GosClient.API_BASE + path, init);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || res.statusText);
    return data;
  }

  async function doLawsDbStatus() {
    setLawsDbProgress('Проверка обновлений в alamantik/majestic-laws-db...');
    try {
      const data = await lawsdbFetch('/parser/lawsdb/sync-status');
      const updatedServers = data.servers.filter((s) => s.hasUpdate);
      const updatedRules = data.rules.filter((r) => r.hasUpdate);
      const lines = [];
      lines.push(`Источник: ${data.servers.length} серверов, ${data.rules.length} файлов правил`);
      lines.push(`Требуют обновления: ${updatedServers.length} серверов, ${updatedRules.length} файлов правил`);
      if (updatedServers.length > 0) {
        lines.push('');
        lines.push('Серверы с обновлениями:');
        updatedServers.slice(0, 10).forEach((s) => {
          const last = s.localUpdatedAt ? new Date(s.localUpdatedAt).toLocaleString('ru-RU') : 'никогда';
          const next = s.sourceUpdatedAt ? new Date(s.sourceUpdatedAt).toLocaleString('ru-RU') : '?';
          lines.push(`  • ${s.serverName}: было ${last} → стало ${next}`);
        });
      }
      setLawsDbProgress(lines.join('\n'));
    } catch (err) {
      setLawsDbProgress('Ошибка: ' + err.message);
    }
  }

  async function doLawsDbImportAll() {
    const mode = $('lawsdb-mode').value;
    const includeRules = $('lawsdb-include-rules').checked;
    const confirmText = mode === 'replace'
      ? `Это удалит ВСЕ существующие статьи и заменит ${'данными из Majestic-Laws-DB'} (19 серверов${includeRules ? ' + правила' : ''}). Продолжить?`
      : `Импортировать 19 серверов${includeRules ? ' + правила' : ''} в дополнение к существующим данным?`;
    if (!confirm(confirmText)) return;

    setLawsDbProgress('Загрузка структуры и импорт... это займёт 30–60 секунд.');
    const btn = $('btn-lawsdb-import-all');
    btn.disabled = true;

    try {
      const data = await lawsdbFetch('/parser/lawsdb/import-all', {
        method: 'POST',
        body: { mode, includeRules },
      });

      const lines = [];
      const ok = data.servers.filter((s) => !s.error);
      const failed = data.servers.filter((s) => s.error);
      const totalArticles = ok.reduce((sum, s) => sum + (s.inserted || 0), 0);
      lines.push(`✓ Импорт завершён`);
      lines.push(`Серверов: ${ok.length} из ${data.servers.length}`);
      lines.push(`Статей всего: ${totalArticles}`);
      if (data.rules) {
        const rulesInserted = data.rules.reduce((sum, r) => sum + (r.inserted || 0), 0);
        lines.push(`Правил: ${rulesInserted}`);
      }
      if (failed.length) {
        lines.push('');
        lines.push('Ошибки:');
        failed.forEach((f) => lines.push(`  • ${f.name}: ${f.error}`));
      }
      setLawsDbProgress(lines.join('\n'));

      // Reload local data
      await loadAll();
      populateParserSelects();
      toast('База загружена: ' + totalArticles + ' статей');
    } catch (err) {
      setLawsDbProgress('Ошибка: ' + err.message);
      toast('Ошибка импорта: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function doLawsDbImportOne() {
    const mode = $('lawsdb-mode').value;
    try {
      // Get list of servers from the source
      const struct = await lawsdbFetch('/parser/lawsdb/structure');
      const options = struct.servers.map((s) => `${s.number}. ${s.name} (${s.file})`).join('\n');
      const choice = prompt(
        'Какой сервер импортировать? Введите номер из списка:\n\n' + options,
        struct.servers[0]?.number || '1'
      );
      if (!choice) return;

      const serverInfo = struct.servers.find((s) => String(s.number) === String(choice).trim());
      if (!serverInfo) {
        setLawsDbProgress('Сервер с номером ' + choice + ' не найден');
        return;
      }

      setLawsDbProgress(`Загрузка сервера ${serverInfo.name}...`);
      const data = await lawsdbFetch('/parser/lawsdb/import-server', {
        method: 'POST',
        body: { file: serverInfo.file, mode },
      });
      setLawsDbProgress(
        `✓ ${serverInfo.name}: добавлено ${data.inserted}, удалено ${data.removed}, пропущено ${data.skipped}`
      );
      await loadAll();
      populateParserSelects();
      toast(`Импортирован ${serverInfo.name}: ${data.inserted} статей`);
    } catch (err) {
      setLawsDbProgress('Ошибка: ' + err.message);
    }
  }

  // ============================================================
  // Releases admin
  // ============================================================
  const ReleasesState = { initialized: false, list: [] };

  function initReleasesView() {
    loadReleasesList();
    if (ReleasesState.initialized) return;
    ReleasesState.initialized = true;
    $('btn-upload-release').addEventListener('click', uploadRelease);
  }

  async function loadReleasesList() {
    const tbody = $('releases-table');
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px">Загрузка...</td></tr>';
    try {
      const res = await fetch(window.GosClient.API_BASE + '/releases', {
        headers: { 'Authorization': 'Bearer ' + window.GosClient.getToken() },
      });
      const data = await res.json();
      if (!data.success) { tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger)">${escapeHtml(data.error)}</td></tr>`; return; }
      ReleasesState.list = data.releases || [];
      renderReleasesTable();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger)">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderReleasesTable() {
    const tbody = $('releases-table');
    if (!ReleasesState.list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:30px">Релизов ещё нет. Загрузите первый.</td></tr>';
      return;
    }
    tbody.innerHTML = ReleasesState.list.map((r) => `
      <tr>
        <td><span class="badge ${r.type === 'installer' ? 'badge-primary' : 'badge-muted'}">${r.type === 'installer' ? 'Installer' : 'Portable'}</span></td>
        <td><code>${escapeHtml(r.version)}</code></td>
        <td><span class="text-xs text-muted">${escapeHtml(r.originalName)}</span></td>
        <td class="text-xs text-muted">${escapeHtml(r.sizeFormatted)}</td>
        <td>${r.downloadCount}</td>
        <td>
          <label class="switch" style="width:36px;height:20px;">
            <input type="checkbox" data-toggle-id="${r.id}" ${r.isActive ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </td>
        <td class="text-xs text-muted">${formatDate(r.createdAt)}</td>
        <td>
          <div class="actions-row">
            <button class="icon-btn danger" data-del-release="${r.id}" title="Удалить">✕</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-toggle-id]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        try {
          await fetch(window.GosClient.API_BASE + '/releases/' + cb.dataset.toggleId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.GosClient.getToken() },
            body: JSON.stringify({ isActive: cb.checked }),
          });
          toast(cb.checked ? 'Релиз активирован' : 'Релиз деактивирован');
        } catch (err) { toast('Ошибка: ' + err.message); }
      });
    });
    tbody.querySelectorAll('[data-del-release]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить релиз и файл с сервера?')) return;
        try {
          await fetch(window.GosClient.API_BASE + '/releases/' + btn.dataset.delRelease, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + window.GosClient.getToken() },
          });
          await loadReleasesList();
          toast('Удалено');
        } catch (err) { toast('Ошибка: ' + err.message); }
      });
    });
  }

  async function uploadRelease() {
    const fileInput = $('rel-file');
    const file = fileInput.files[0];
    const type = $('rel-type').value;
    const version = $('rel-version').value.trim();
    const notes = $('rel-notes').value;
    const status = $('rel-upload-status');
    const progress = $('rel-upload-progress');

    if (!file) { showRelStatus('Выберите файл', 'error'); return; }
    if (!version) { showRelStatus('Укажите версию', 'error'); return; }
    if (file.size > 200 * 1024 * 1024) {
      showRelStatus('Файл больше 200 МБ', 'error');
      return;
    }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);
    fd.append('version', version);
    fd.append('notes', notes);

    const btn = $('btn-upload-release');
    btn.disabled = true;
    showRelStatus('Загрузка...', 'info');
    progress.style.display = 'block';
    progress.textContent = '0%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', window.GosClient.API_BASE + '/releases/upload');
    xhr.setRequestHeader('Authorization', 'Bearer ' + window.GosClient.getToken());

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      progress.textContent = `${pct}% (${formatBytes(e.loaded)} / ${formatBytes(e.total)})`;
    };

    xhr.onload = () => {
      btn.disabled = false;
      progress.style.display = 'none';
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) {
          showRelStatus('✓ Загружено: ' + data.release.originalName, 'success');
          fileInput.value = '';
          $('rel-version').value = '';
          $('rel-notes').value = '';
          loadReleasesList();
          toast('Релиз загружен');
        } else {
          showRelStatus('Ошибка: ' + (data.error || xhr.statusText), 'error');
        }
      } catch (err) {
        showRelStatus('Ошибка ответа: ' + xhr.statusText, 'error');
      }
    };

    xhr.onerror = () => {
      btn.disabled = false;
      progress.style.display = 'none';
      showRelStatus('Ошибка сети — проверьте подключение и размер файла', 'error');
    };

    xhr.send(fd);
  }

  function showRelStatus(msg, type) {
    const el = $('rel-upload-status');
    el.style.display = 'block';
    const colors = {
      info: 'var(--accent-primary)',
      success: 'var(--success)',
      error: 'var(--danger)',
    };
    el.style.color = colors[type] || 'var(--text-muted)';
    el.textContent = msg;
  }

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  // ============================================================
  // Donate links admin
  // ============================================================
  const DonateState = { initialized: false, list: [], editingId: null };

  function initDonateView() {
    loadDonateList();
    if (DonateState.initialized) return;
    DonateState.initialized = true;

    // Hook into existing modal system: data-modal="donate" already wired in setupModals
    // Just need the save button
    $('dn-save').addEventListener('click', saveDonateLink);
  }

  async function loadDonateList() {
    const tbody = $('donate-table');
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px">Загрузка...</td></tr>';
    try {
      const data = await window.GosClient.donate.listAll();
      DonateState.list = data.links || [];
      renderDonateTable();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger)">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderDonateTable() {
    const tbody = $('donate-table');
    if (!DonateState.list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:30px">Ссылок пока нет — добавьте первую</td></tr>';
      return;
    }
    tbody.innerHTML = DonateState.list.map((link) => `
      <tr>
        <td><div style="width:24px;height:24px;border-radius:6px;background:${escapeHtml(link.color)}"></div></td>
        <td>
          <div class="font-medium text-sm">${escapeHtml(link.title)}</div>
          ${link.description ? `<div class="text-xs text-muted">${escapeHtml(link.description)}</div>` : ''}
        </td>
        <td><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="text-xs" style="color: var(--accent-primary); word-break: break-all;">${escapeHtml(link.url.length > 40 ? link.url.slice(0, 40) + '…' : link.url)}</a></td>
        <td style="font-size: 16px;">${escapeHtml(link.icon || '—')}</td>
        <td>${link.clickCount || 0}</td>
        <td>
          <label class="switch" style="width:36px;height:20px;">
            <input type="checkbox" data-donate-toggle="${link.id}" ${link.isActive ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </td>
        <td>
          <div class="actions-row">
            <button class="icon-btn" data-donate-edit="${link.id}" title="Редактировать">✎</button>
            <button class="icon-btn danger" data-donate-del="${link.id}" title="Удалить">✕</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-donate-toggle]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const link = DonateState.list.find((l) => String(l.id) === cb.dataset.donateToggle);
        if (!link) return;
        try {
          await window.GosClient.donate.update(link.id, { ...link, isActive: cb.checked });
          toast(cb.checked ? 'Ссылка активирована' : 'Ссылка скрыта');
          link.isActive = cb.checked;
        } catch (err) {
          toast('Ошибка: ' + err.message);
          cb.checked = !cb.checked;
        }
      });
    });
    tbody.querySelectorAll('[data-donate-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const link = DonateState.list.find((l) => String(l.id) === btn.dataset.donateEdit);
        if (link) openDonateModal(link);
      });
    });
    tbody.querySelectorAll('[data-donate-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить эту ссылку?')) return;
        try {
          await window.GosClient.donate.remove(btn.dataset.donateDel);
          await loadDonateList();
          toast('Удалено');
        } catch (err) { toast('Ошибка: ' + err.message); }
      });
    });
  }

  function openDonateModal(link) {
    DonateState.editingId = link ? link.id : null;
    $('modal-donate-title').textContent = link ? 'Редактирование ссылки' : 'Новая ссылка';
    $('dn-title').value = link?.title || '';
    $('dn-url').value = link?.url || '';
    $('dn-desc').value = link?.description || '';
    $('dn-icon').value = link?.icon || '';
    $('dn-color').value = link?.color || '#DF005B';
    $('dn-order').value = link?.sortOrder || 0;
    document.getElementById('modal-donate').classList.add('open');
  }

  async function saveDonateLink() {
    const payload = {
      title: $('dn-title').value.trim(),
      url: $('dn-url').value.trim(),
      description: $('dn-desc').value.trim(),
      icon: $('dn-icon').value.trim(),
      color: $('dn-color').value.trim() || '#DF005B',
      sortOrder: parseInt($('dn-order').value, 10) || 0,
      isActive: true,
    };
    if (!payload.title || !payload.url) {
      toast('Введите название и URL');
      return;
    }
    if (!/^https?:\/\//i.test(payload.url)) {
      toast('URL должен начинаться с http:// или https://');
      return;
    }
    const btn = $('dn-save');
    btn.disabled = true;
    try {
      if (DonateState.editingId) {
        await window.GosClient.donate.update(DonateState.editingId, payload);
      } else {
        await window.GosClient.donate.create(payload);
      }
      document.getElementById('modal-donate').classList.remove('open');
      await loadDonateList();
      toast('Сохранено');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ============================================================
  // DevLog admin
  // ============================================================
  const DevlogState = { initialized: false, list: [], editingId: null };

  function initDevlogView() {
    loadDevlogList();
    if (DevlogState.initialized) return;
    DevlogState.initialized = true;
    $('dl-save').addEventListener('click', saveDevlogEntry);
  }

  async function loadDevlogList() {
    const tbody = $('devlog-table');
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px">Загрузка...</td></tr>';
    try {
      const data = await window.GosClient.devlog.listAll();
      DevlogState.list = data.entries || [];
      renderDevlogTable();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger)">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function tagBadge(tag) {
    if (!tag) return '<span class="badge badge-muted">—</span>';
    const labels = { feature: ['Новое', 'badge-success'], fix: ['Фикс', 'badge-warning'], news: ['Новость', 'badge-primary'], major: ['Важно', 'badge-danger'] };
    const [label, cls] = labels[tag] || [tag, 'badge-muted'];
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function renderDevlogTable() {
    const tbody = $('devlog-table');
    if (!DevlogState.list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:30px">Записей нет — добавьте первую</td></tr>';
      return;
    }
    tbody.innerHTML = DevlogState.list.map((e) => `
      <tr>
        <td>${e.version ? `<code>v${escapeHtml(e.version)}</code>` : '<span class="text-muted">—</span>'}</td>
        <td>
          <div class="font-medium text-sm">${escapeHtml(e.title)}</div>
          <div class="text-xs text-muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:380px">${escapeHtml((e.content || '').slice(0, 120))}</div>
        </td>
        <td>${tagBadge(e.tag)}</td>
        <td class="text-xs text-muted">${formatDate(e.publishedAt || e.createdAt)}</td>
        <td>
          <label class="switch" style="width:36px;height:20px;">
            <input type="checkbox" data-devlog-toggle="${e.id}" ${e.isPublished ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </td>
        <td>
          <div class="actions-row">
            <button class="icon-btn" data-devlog-edit="${e.id}">✎</button>
            <button class="icon-btn danger" data-devlog-del="${e.id}">✕</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-devlog-toggle]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const entry = DevlogState.list.find((x) => String(x.id) === cb.dataset.devlogToggle);
        if (!entry) return;
        try {
          await window.GosClient.devlog.update(entry.id, { ...entry, isPublished: cb.checked });
          toast(cb.checked ? 'Опубликовано' : 'Снято с публикации');
          entry.isPublished = cb.checked;
        } catch (err) {
          toast('Ошибка: ' + err.message);
          cb.checked = !cb.checked;
        }
      });
    });
    tbody.querySelectorAll('[data-devlog-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entry = DevlogState.list.find((x) => String(x.id) === btn.dataset.devlogEdit);
        if (entry) openDevlogModal(entry);
      });
    });
    tbody.querySelectorAll('[data-devlog-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить запись?')) return;
        try {
          await window.GosClient.devlog.remove(btn.dataset.devlogDel);
          await loadDevlogList();
          toast('Удалено');
        } catch (err) { toast('Ошибка: ' + err.message); }
      });
    });
  }

  function openDevlogModal(entry) {
    DevlogState.editingId = entry ? entry.id : null;
    $('modal-devlog-title').textContent = entry ? 'Редактирование записи' : 'Новая запись DevLog';
    $('dl-version').value = entry?.version || '';
    $('dl-tag').value = entry?.tag || '';
    $('dl-title').value = entry?.title || '';
    $('dl-content').value = entry?.content || '';
    $('dl-published').checked = entry ? !!entry.isPublished : true;
    document.getElementById('modal-devlog').classList.add('open');
  }

  async function saveDevlogEntry() {
    const payload = {
      version: $('dl-version').value.trim(),
      tag: $('dl-tag').value,
      title: $('dl-title').value.trim(),
      content: $('dl-content').value.trim(),
      isPublished: $('dl-published').checked,
    };
    if (!payload.title || !payload.content) {
      toast('Заголовок и содержимое обязательны');
      return;
    }
    const btn = $('dl-save');
    btn.disabled = true;
    try {
      if (DevlogState.editingId) {
        await window.GosClient.devlog.update(DevlogState.editingId, payload);
      } else {
        await window.GosClient.devlog.create(payload);
      }
      document.getElementById('modal-devlog').classList.remove('open');
      await loadDevlogList();
      toast('Сохранено');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ============================================================
  // Maintenance view
  // ============================================================
  const MaintenanceState = { initialized: false, current: null };

  function initMaintenanceView() {
    loadMaintenance();
    if (MaintenanceState.initialized) return;
    MaintenanceState.initialized = true;

    $('btn-maint-save').addEventListener('click', () => saveMaintenance(true));
    $('btn-maint-disable').addEventListener('click', () => saveMaintenance(false));
    $('maint-quick-duration').addEventListener('change', (e) => {
      const minutes = parseInt(e.target.value, 10);
      if (!minutes) return;
      const d = new Date(Date.now() + minutes * 60 * 1000);
      $('maint-ends-at').value = toLocalInput(d);
      e.target.value = '';
    });
  }

  function toLocalInput(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function loadMaintenance() {
    const status = $('maint-status');
    status.textContent = 'Загрузка...';
    try {
      const data = await window.GosClient.maintenance.get();
      MaintenanceState.current = data;
      $('maint-enabled').checked = !!data.enabled;
      $('maint-message').value = data.message || '';
      $('maint-ends-at').value = data.endsAt ? toLocalInput(new Date(data.endsAt)) : '';
      updateMaintenancePill(data);
      status.textContent = data.updatedAt
        ? 'Последнее изменение: ' + new Date(data.updatedAt).toLocaleString('ru-RU')
        : '';
    } catch (err) {
      status.textContent = 'Не удалось загрузить: ' + err.message;
    }
  }

  function updateMaintenancePill(data) {
    const pill = $('maintenance-state-pill');
    const dot = $('nav-maintenance-dot');
    if (!pill) return;
    if (data.active) {
      pill.textContent = '● Активен';
      pill.style.background = 'rgba(245,158,11,0.15)';
      pill.style.color = 'var(--warning, #F59E0B)';
      if (dot) dot.style.display = '';
    } else if (data.enabled && data.expired) {
      pill.textContent = 'Срок истёк';
      pill.style.background = 'var(--bg-tertiary)';
      pill.style.color = 'var(--text-muted)';
      if (dot) dot.style.display = 'none';
    } else {
      pill.textContent = 'Выключен';
      pill.style.background = 'rgba(16,185,129,0.12)';
      pill.style.color = 'var(--success, #10B981)';
      if (dot) dot.style.display = 'none';
    }
  }

  async function saveMaintenance(turnOn) {
    const status = $('maint-status');
    const enabled = turnOn ? $('maint-enabled').checked : false;
    const message = $('maint-message').value.trim();
    const endsLocal = $('maint-ends-at').value;
    let endsAt = null;
    if (endsLocal) {
      const d = new Date(endsLocal);
      if (isNaN(d.getTime())) {
        status.textContent = 'Некорректная дата окончания';
        return;
      }
      endsAt = d.toISOString();
    }
    const btn = turnOn ? $('btn-maint-save') : $('btn-maint-disable');
    btn.disabled = true;
    status.textContent = 'Сохранение...';
    try {
      const data = await window.GosClient.maintenance.update({ enabled, message, endsAt });
      MaintenanceState.current = data;
      $('maint-enabled').checked = !!data.enabled;
      updateMaintenancePill(data);
      status.textContent = '✓ Сохранено';
      toast(data.active ? 'Тех. работы включены' : 'Тех. работы выключены');
    } catch (err) {
      status.textContent = '✗ ' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ============================================================
  // Support view (admin)
  // ============================================================
  const SupportState = {
    initialized: false,
    tickets: [],
    current: null,
    view: 'list',
    pollTimer: null,
    pollInflight: false,
  };

  function initSupportView() {
    loadSupportTickets();
    if (SupportState.initialized) return;
    SupportState.initialized = true;

    $('btn-refresh-support').addEventListener('click', loadSupportTickets);
    $('sup-filter-status').addEventListener('change', loadSupportTickets);
    $('sup-filter-type').addEventListener('change', loadSupportTickets);
    $('sup-filter-unread').addEventListener('change', loadSupportTickets);
    let searchDebounce = null;
    $('sup-filter-search').addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(loadSupportTickets, 300);
    });

    $('btn-sup-back').addEventListener('click', () => {
      showSupportSubview('list');
      loadSupportTickets();
    });
    $('btn-sup-reply').addEventListener('click', sendSupportReply);
    $('sup-detail-status').addEventListener('change', changeSupportStatus);
    $('sup-reply-body').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendSupportReply(); }
    });
  }

  function showSupportSubview(name) {
    SupportState.view = name;
    $('sup-list-view').classList.toggle('hidden', name !== 'list');
    $('sup-detail-view').classList.toggle('hidden', name !== 'detail');
    if (name !== 'detail') stopSupportPolling();
  }

  function startSupportPolling(ticketId) {
    stopSupportPolling();
    SupportState.pollTimer = setInterval(() => pollSupportTicket(ticketId), 5000);
  }

  function stopSupportPolling() {
    if (SupportState.pollTimer) {
      clearInterval(SupportState.pollTimer);
      SupportState.pollTimer = null;
    }
  }

  async function pollSupportTicket(ticketId) {
    if (SupportState.pollInflight) return;
    if (document.hidden) return;
    if (SupportState.view !== 'detail') { stopSupportPolling(); return; }
    if (!SupportState.current || SupportState.current.id !== ticketId) return;
    SupportState.pollInflight = true;
    try {
      const data = await window.GosClient.support.get(ticketId);
      if (!data.success || !data.ticket) return;
      if (SupportState.view !== 'detail') return;
      if (!SupportState.current || SupportState.current.id !== ticketId) return;

      const prev = SupportState.current;
      const next = data.ticket;
      const prevLastId = prev.messages.length ? prev.messages[prev.messages.length - 1].id : 0;
      const nextLastId = next.messages.length ? next.messages[next.messages.length - 1].id : 0;

      if (nextLastId !== prevLastId || next.status !== prev.status) {
        SupportState.current = next;
        const el = $('sup-messages');
        const wasAtBottom = el ? Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 20 : true;
        const replyText = $('sup-reply-body').value;
        renderSupportDetail(next);
        $('sup-reply-body').value = replyText;
        if (wasAtBottom || nextLastId !== prevLastId) {
          const m = $('sup-messages');
          m.scrollTop = m.scrollHeight;
        }
        const newUserMsg = next.messages.find((m) => m.id > prevLastId && !m.isAdmin);
        if (newUserMsg) toast('Новое сообщение от пользователя');
      }
      refreshAdminSupportBadge();
    } catch {
      // ignore
    } finally {
      SupportState.pollInflight = false;
    }
  }

  async function loadSupportTickets() {
    const tbody = $('sup-tickets-table');
    tbody.innerHTML = '<tr><td colspan="7" class="text-sm text-muted" style="padding:24px;text-align:center">Загрузка...</td></tr>';
    const params = {};
    const status = $('sup-filter-status').value;
    const type = $('sup-filter-type').value;
    const search = $('sup-filter-search').value.trim();
    const unread = $('sup-filter-unread').checked;
    if (status) params.status = status;
    if (type) params.type = type;
    if (search) params.search = search;
    if (unread) params.unread = '1';
    try {
      const data = await window.GosClient.support.listAll(params);
      SupportState.tickets = data.tickets || [];
      renderSupportList();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-sm text-muted" style="padding:24px;text-align:center">Ошибка: ${escapeHtml(err.message)}</td></tr>`;
    }
    refreshAdminSupportBadge();
  }

  function renderSupportList() {
    const tbody = $('sup-tickets-table');
    if (SupportState.tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-sm text-muted" style="padding:24px;text-align:center">Тикетов не найдено</td></tr>';
      return;
    }
    const typeMeta = {
      question: { icon: '❓', label: 'Вопрос' },
      suggestion: { icon: '💡', label: 'Идея' },
      bug: { icon: '🐞', label: 'Баг' },
    };
    const statusLabels = { open: 'Открыт', in_progress: 'В работе', answered: 'Отвечен', closed: 'Закрыт' };
    tbody.innerHTML = SupportState.tickets.map((t) => {
      const tm = typeMeta[t.type] || { icon: '📝', label: t.type };
      const date = t.updatedAt ? new Date(t.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const sourceLabel = t.source === 'app' ? `App${t.appVersion ? ' v' + t.appVersion : ''}` : 'Сайт';
      return `
        <tr style="cursor:pointer" data-id="${t.id}">
          <td><span style="font-family:monospace">#${t.id}</span></td>
          <td><span title="${escapeHtml(tm.label)}" style="font-size:18px">${tm.icon}</span></td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              ${t.unreadForAdmin ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--accent-primary);flex-shrink:0" title="Непрочитано"></span>' : ''}
              <span style="font-weight:${t.unreadForAdmin ? '600' : '400'}">${escapeHtml(t.subject)}</span>
            </div>
          </td>
          <td>
            <div style="font-size:12px">${escapeHtml(t.userName || '—')}</div>
            <div class="text-xs text-muted">${escapeHtml(t.userEmail || '')}</div>
          </td>
          <td><span class="ticket-row-status ticket-status-${t.status}">${statusLabels[t.status]}</span></td>
          <td><span class="text-xs text-muted">${escapeHtml(sourceLabel)}</span></td>
          <td><span class="text-xs text-muted">${escapeHtml(date)}</span></td>
        </tr>
      `;
    }).join('');
    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => openSupportTicket(parseInt(row.dataset.id, 10)));
    });
  }

  async function openSupportTicket(id) {
    showSupportSubview('detail');
    $('sup-detail-header').innerHTML = '<span class="text-muted">Загрузка...</span>';
    $('sup-messages').innerHTML = '';
    try {
      const data = await window.GosClient.support.get(id);
      SupportState.current = data.ticket;
      renderSupportDetail(data.ticket);
      startSupportPolling(id);
    } catch (err) {
      $('sup-detail-header').innerHTML = `<span class="text-muted">Ошибка: ${escapeHtml(err.message)}</span>`;
    }
    refreshAdminSupportBadge();
  }

  function renderSupportDetail(ticket) {
    const typeLabels = { question: 'Вопрос', suggestion: 'Предложение', bug: 'Баг-репорт' };
    const sourceLabel = ticket.source === 'app' ? `Приложение${ticket.appVersion ? ' v' + ticket.appVersion : ''}` : 'Сайт';
    $('sup-detail-header').innerHTML = `
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">#${ticket.id} · ${escapeHtml(ticket.subject)}</div>
      <div class="text-xs text-muted" style="display:flex;gap:14px;flex-wrap:wrap">
        <span>${escapeHtml(typeLabels[ticket.type] || ticket.type)}</span>
        <span>${escapeHtml(ticket.userName || '—')} (${escapeHtml(ticket.userEmail || '')})</span>
        <span>Источник: ${escapeHtml(sourceLabel)}</span>
        <span>Создан: ${escapeHtml(new Date(ticket.createdAt).toLocaleString('ru-RU'))}</span>
      </div>
    `;
    $('sup-detail-status').value = ticket.status;
    const msgsEl = $('sup-messages');
    msgsEl.innerHTML = ticket.messages.map(renderSupportMessage).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
    const closed = ticket.status === 'closed';
    $('sup-reply-block').style.display = closed ? 'none' : '';
    $('sup-reply-body').value = '';
  }

  function renderSupportMessage(m) {
    const cls = m.isAdmin ? 'admin' : 'user';
    const name = m.isAdmin ? (m.authorName || 'Поддержка') : (m.authorName || 'Пользователь');
    const initial = (name.charAt(0) || '?').toUpperCase();
    const date = m.createdAt ? new Date(m.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="ticket-message ${cls}">
        <div class="ticket-message-avatar">${escapeHtml(initial)}</div>
        <div>
          <div class="ticket-message-body">${escapeHtml(m.body)}</div>
          <div class="ticket-message-meta">${escapeHtml(name)} · ${escapeHtml(date)}</div>
        </div>
      </div>
    `;
  }

  async function sendSupportReply() {
    const ticket = SupportState.current;
    if (!ticket) return;
    const text = $('sup-reply-body').value.trim();
    if (!text) return;
    const btn = $('btn-sup-reply');
    btn.disabled = true;
    try {
      const data = await window.GosClient.support.reply(ticket.id, text);
      SupportState.current = data.ticket;
      renderSupportDetail(data.ticket);
      const m = $('sup-messages');
      m.scrollTop = m.scrollHeight;
    } catch (err) {
      toast('Ошибка: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function changeSupportStatus() {
    const ticket = SupportState.current;
    if (!ticket) return;
    const status = $('sup-detail-status').value;
    if (status === ticket.status) return;
    try {
      const data = await window.GosClient.support.setStatus(ticket.id, status);
      SupportState.current = data.ticket;
      renderSupportDetail(data.ticket);
      toast('Статус изменён');
    } catch (err) {
      toast('Ошибка: ' + err.message);
      $('sup-detail-status').value = ticket.status;
    }
  }

  async function refreshAdminSupportBadge() {
    try {
      const data = await window.GosClient.support.unreadCount();
      const badge = $('nav-support-badge');
      if (!badge) return;
      if (data.count > 0) {
        badge.textContent = String(data.count);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    } catch {}
  }
  setInterval(refreshAdminSupportBadge, 60000);
  setTimeout(refreshAdminSupportBadge, 2000);

  // ============================================================
  // Subscriptions view
  // ============================================================
  const SubsState = {
    initialized: false,
    plans: [],
    grants: [],
    features: [],
    editingPlan: null,
    selectedUser: null,
    selectedDays: 14,
  };

  function initSubscriptionsView() {
    loadSubsAll();
    if (SubsState.initialized) return;
    SubsState.initialized = true;

    $('btn-new-plan').addEventListener('click', () => openPlanModal(null));
    $('btn-save-plan').addEventListener('click', savePlan);
    $('btn-delete-plan').addEventListener('click', deletePlan);
    $('btn-add-custom-feature').addEventListener('click', addCustomFeature);

    $('btn-grant-subscription').addEventListener('click', doGrantSubscription);
    document.querySelectorAll('.duration-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.duration-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        SubsState.selectedDays = parseInt(btn.dataset.days, 10);
      });
    });

    let userSearchTimer = null;
    $('grant-user-search').addEventListener('input', (e) => {
      clearTimeout(userSearchTimer);
      const q = e.target.value.trim();
      if (!q) { hideUserResults(); return; }
      userSearchTimer = setTimeout(() => searchUsersForGrant(q), 250);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#grant-user-search') && !e.target.closest('#grant-user-results')) {
        hideUserResults();
      }
    });

    $('btn-refresh-grants').addEventListener('click', loadGrants);
    $('grants-filter').addEventListener('change', loadGrants);
    let grantsSearchTimer = null;
    $('grants-search').addEventListener('input', () => {
      clearTimeout(grantsSearchTimer);
      grantsSearchTimer = setTimeout(loadGrants, 300);
    });
  }

  async function loadSubsAll() {
    try {
      const [features, plans] = await Promise.all([
        window.GosClient.subscriptions.features(),
        window.GosClient.subscriptions.listPlans(),
      ]);
      SubsState.features = features.features || [];
      SubsState.plans = plans.plans || [];
      renderPlans();
      populateGrantPlanSelect();
      await loadGrants();
    } catch (err) {
      toast('Не удалось загрузить: ' + err.message);
    }
  }

  function renderPlans() {
    const el = $('plans-list');
    if (SubsState.plans.length === 0) {
      el.innerHTML = '<div class="text-sm text-muted">Планов пока нет. Создайте первый.</div>';
      return;
    }
    el.innerHTML = SubsState.plans.map((p) => {
      const feats = (p.features || []).slice(0, 6).map((f) => {
        const meta = SubsState.features.find((x) => x.key === f);
        return `<span class="plan-feature-chip">${escapeHtml(meta ? meta.label : f)}</span>`;
      }).join('');
      const more = (p.features || []).length > 6 ? `<span class="plan-feature-chip">+${(p.features || []).length - 6}</span>` : '';
      return `
        <div class="plan-card ${p.isActive ? '' : 'inactive'}" data-id="${p.id}" style="border-left-color:${escapeHtml(p.color || '#DF005B')}">
          <div class="plan-card-name">${escapeHtml(p.name)}</div>
          <div class="plan-card-slug">${escapeHtml(p.slug)}</div>
          ${p.description ? `<div class="plan-card-desc">${escapeHtml(p.description)}</div>` : ''}
          <div class="plan-card-features">${feats}${more}</div>
          <div class="plan-card-meta">
            <span class="${p.isActive ? 'plan-card-status-active' : 'plan-card-status-inactive'}">
              ${p.isActive ? '● Активен' : '○ Выключен'}
            </span>
            <span>Функций: ${(p.features || []).length}</span>
          </div>
        </div>
      `;
    }).join('');
    el.querySelectorAll('.plan-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id, 10);
        const plan = SubsState.plans.find((p) => p.id === id);
        if (plan) openPlanModal(plan);
      });
    });
  }

  function populateGrantPlanSelect() {
    const sel = $('grant-plan');
    sel.innerHTML = SubsState.plans
      .filter((p) => p.isActive)
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join('');
  }

  function openPlanModal(plan) {
    SubsState.editingPlan = plan;
    $('modal-plan-title').textContent = plan ? 'Редактировать план' : 'Новый план';
    $('plan-slug').value = plan ? plan.slug : '';
    $('plan-slug').disabled = !!plan;
    $('plan-name').value = plan ? plan.name : '';
    $('plan-description').value = plan ? (plan.description || '') : '';
    $('plan-color').value = plan ? (plan.color || '#DF005B') : '#DF005B';
    $('plan-sort').value = plan ? (plan.sortOrder || 0) : 0;
    $('plan-active').checked = plan ? !!plan.isActive : true;
    $('btn-delete-plan').style.display = plan ? '' : 'none';
    renderFeaturesList(plan ? (plan.features || []) : []);
    document.getElementById('modal-plan').classList.add('open');
  }

  function renderFeaturesList(selectedFeatures) {
    const list = $('plan-features-list');
    const known = SubsState.features.map((f) => f.key);
    const allKeys = Array.from(new Set([...known, ...selectedFeatures]));
    list.innerHTML = allKeys.map((key) => {
      const meta = SubsState.features.find((f) => f.key === key);
      const label = meta ? meta.label : key;
      const isCustom = !meta;
      const checked = selectedFeatures.includes(key);
      return `
        <label class="feature-item">
          <input type="checkbox" data-key="${escapeHtml(key)}" ${checked ? 'checked' : ''} />
          <span class="feature-item-label">${escapeHtml(label)}</span>
          <span class="feature-item-key">${escapeHtml(key)}</span>
          ${isCustom ? `<span class="feature-item-remove" data-remove="${escapeHtml(key)}" title="Удалить">×</span>` : ''}
        </label>
      `;
    }).join('');
    list.querySelectorAll('[data-remove]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = el.dataset.remove;
        const checks = collectSelectedFeatures().filter((f) => f !== key);
        renderFeaturesList(checks);
      });
    });
  }

  function collectSelectedFeatures() {
    return Array.from($('plan-features-list').querySelectorAll('input[type="checkbox"]'))
      .filter((c) => c.checked)
      .map((c) => c.dataset.key);
  }

  function addCustomFeature() {
    const input = $('plan-feature-custom');
    const key = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!key) return;
    const current = collectSelectedFeatures();
    if (!current.includes(key)) current.push(key);
    renderFeaturesList(current);
    input.value = '';
  }

  async function savePlan() {
    const slug = $('plan-slug').value.trim();
    const name = $('plan-name').value.trim();
    if (!slug || !name) { toast('Укажите slug и название'); return; }
    const payload = {
      slug,
      name,
      description: $('plan-description').value.trim() || null,
      color: $('plan-color').value,
      sortOrder: parseInt($('plan-sort').value, 10) || 0,
      isActive: $('plan-active').checked,
      features: collectSelectedFeatures(),
    };
    const btn = $('btn-save-plan');
    btn.disabled = true;
    try {
      if (SubsState.editingPlan) {
        await window.GosClient.subscriptions.updatePlan(SubsState.editingPlan.id, payload);
      } else {
        await window.GosClient.subscriptions.createPlan(payload);
      }
      document.getElementById('modal-plan').classList.remove('open');
      await loadSubsAll();
      toast('Сохранено');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function deletePlan() {
    if (!SubsState.editingPlan) return;
    if (!confirm('Удалить план «' + SubsState.editingPlan.name + '»?')) return;
    try {
      await window.GosClient.subscriptions.deletePlan(SubsState.editingPlan.id);
      document.getElementById('modal-plan').classList.remove('open');
      await loadSubsAll();
      toast('План удалён');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    }
  }

  async function searchUsersForGrant(q) {
    try {
      const data = await window.GosClient.users.list();
      const users = (data.users || []).filter((u) => {
        const hay = ((u.email || '') + ' ' + (u.username || '')).toLowerCase();
        return hay.includes(q.toLowerCase());
      }).slice(0, 8);
      const el = $('grant-user-results');
      if (users.length === 0) {
        el.innerHTML = '<div class="user-search-item text-muted">Не найдено</div>';
        el.style.display = 'block';
        return;
      }
      el.innerHTML = users.map((u) => `
        <div class="user-search-item" data-id="${u.id}" data-name="${escapeHtml(u.username || u.email)}" data-email="${escapeHtml(u.email)}">
          <div>${escapeHtml(u.username || '—')}</div>
          <div class="user-search-item-email">${escapeHtml(u.email)}</div>
        </div>
      `).join('');
      el.style.display = 'block';
      el.querySelectorAll('.user-search-item[data-id]').forEach((item) => {
        item.addEventListener('click', () => {
          SubsState.selectedUser = {
            id: parseInt(item.dataset.id, 10),
            name: item.dataset.name,
            email: item.dataset.email,
          };
          $('grant-user-search').value = item.dataset.email;
          $('grant-user-selected').textContent = `Выбрано: ${item.dataset.name} (${item.dataset.email})`;
          $('grant-user-selected').style.display = '';
          hideUserResults();
        });
      });
    } catch (err) {
      console.warn('user search failed', err);
    }
  }

  function hideUserResults() {
    $('grant-user-results').style.display = 'none';
  }

  async function doGrantSubscription() {
    if (!SubsState.selectedUser) { toast('Выберите пользователя'); return; }
    const planId = parseInt($('grant-plan').value, 10);
    if (!planId) { toast('Выберите план'); return; }
    const days = SubsState.selectedDays;
    const notes = $('grant-notes').value.trim() || null;
    const btn = $('btn-grant-subscription');
    btn.disabled = true;
    $('grant-status').textContent = 'Выдаём...';
    try {
      const data = await window.GosClient.subscriptions.grant({
        userId: SubsState.selectedUser.id,
        planId,
        durationDays: days,
        notes,
      });
      $('grant-status').textContent = `✓ Подписка выдана до ${new Date(data.subscription.expiresAt).toLocaleString('ru-RU')}`;
      toast(`Подписка выдана: ${SubsState.selectedUser.email}`);
      $('grant-notes').value = '';
      await loadGrants();
    } catch (err) {
      $('grant-status').textContent = '✗ ' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function loadGrants() {
    const tbody = $('grants-table');
    tbody.innerHTML = '<tr><td colspan="6" class="text-sm text-muted" style="padding:24px;text-align:center">Загрузка...</td></tr>';
    const params = {};
    const active = $('grants-filter').value;
    const search = $('grants-search').value.trim();
    if (active !== '') params.active = active;
    if (search) params.search = search;
    try {
      const data = await window.GosClient.subscriptions.listGrants(params);
      SubsState.grants = data.grants || [];
      renderGrants();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-sm text-muted" style="padding:24px;text-align:center">Ошибка: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderGrants() {
    const tbody = $('grants-table');
    if (SubsState.grants.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-sm text-muted" style="padding:24px;text-align:center">Нет выданных подписок</td></tr>';
      return;
    }
    const now = Date.now();
    tbody.innerHTML = SubsState.grants.map((g) => {
      const expMs = new Date(g.expiresAt).getTime();
      const expired = expMs <= now;
      let status, statusClass;
      if (g.revokedAt && !g.isActive) { status = 'Отозвана'; statusClass = 'sub-status-revoked'; }
      else if (!g.isActive || expired) { status = 'Истекла'; statusClass = 'sub-status-expired'; }
      else { status = 'Активна'; statusClass = 'sub-status-active'; }
      const expStr = new Date(g.expiresAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const remainingDays = Math.max(0, Math.ceil((expMs - now) / (24 * 60 * 60 * 1000)));
      return `
        <tr>
          <td><span style="font-family:monospace">#${g.id}</span></td>
          <td>
            <div style="font-size:13px">${escapeHtml(g.userName || '—')}</div>
            <div class="text-xs text-muted">${escapeHtml(g.userEmail)}</div>
          </td>
          <td><span style="font-weight:600;color:${escapeHtml(g.planColor || 'var(--accent-primary)')}">${escapeHtml(g.planName)}</span></td>
          <td>
            <div style="font-size:12px">${escapeHtml(expStr)}</div>
            ${!expired && g.isActive ? `<div class="text-xs text-muted">осталось ${remainingDays} дн.</div>` : ''}
          </td>
          <td><span class="ticket-row-status ${statusClass}">${status}</span></td>
          <td>
            <div class="flex gap-1" style="flex-wrap:wrap">
              <button class="btn btn-secondary btn-sm" data-extend="${g.id}" data-days="7">+7д</button>
              <button class="btn btn-secondary btn-sm" data-extend="${g.id}" data-days="14">+14д</button>
              <button class="btn btn-secondary btn-sm" data-extend="${g.id}" data-days="30">+30д</button>
              ${g.isActive ? `<button class="btn btn-danger btn-sm" data-revoke="${g.id}">Отозвать</button>` : `<button class="btn btn-secondary btn-sm" data-reactivate="${g.id}">Включить</button>`}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    tbody.querySelectorAll('[data-extend]').forEach((btn) => {
      btn.addEventListener('click', () => extendGrant(parseInt(btn.dataset.extend, 10), parseInt(btn.dataset.days, 10)));
    });
    tbody.querySelectorAll('[data-revoke]').forEach((btn) => {
      btn.addEventListener('click', () => revokeGrant(parseInt(btn.dataset.revoke, 10)));
    });
    tbody.querySelectorAll('[data-reactivate]').forEach((btn) => {
      btn.addEventListener('click', () => reactivateGrant(parseInt(btn.dataset.reactivate, 10)));
    });
  }

  async function extendGrant(id, days) {
    try {
      await window.GosClient.subscriptions.extend(id, days);
      toast(`+${days} дн. добавлено`);
      await loadGrants();
    } catch (err) { toast('Ошибка: ' + err.message); }
  }

  async function revokeGrant(id) {
    if (!confirm('Отозвать подписку?')) return;
    try {
      await window.GosClient.subscriptions.revoke(id);
      toast('Подписка отозвана');
      await loadGrants();
    } catch (err) { toast('Ошибка: ' + err.message); }
  }

  async function reactivateGrant(id) {
    try {
      // Re-activate with +7 days from now as a safe default
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await window.GosClient.subscriptions.updateGrant(id, { isActive: true, expiresAt: future });
      toast('Подписка активирована на 7 дн.');
      await loadGrants();
    } catch (err) { toast('Ошибка: ' + err.message); }
  }

  // Periodic refresh of the nav dot — keeps admins aware
  async function pollMaintenanceStatus() {
    try {
      const data = await window.GosClient.maintenance.get();
      updateMaintenancePill(data);
    } catch {}
  }
  setInterval(pollMaintenanceStatus, 60000);

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
