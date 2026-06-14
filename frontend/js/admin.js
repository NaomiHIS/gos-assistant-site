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

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
