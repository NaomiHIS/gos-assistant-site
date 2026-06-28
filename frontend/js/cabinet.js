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
    setupSupport();
    await loadData();
    refreshSupportBadge();
    loadSubscription();
    loadReferral();
    handleDiscordReturnParams();
    handlePaymentReturn();
  }

  // ============================================================
  // Реферальная программа
  // ============================================================
  async function loadReferral() {
    const el = document.getElementById('referral-content');
    if (!el) return;
    try {
      const data = await window.GosClient.referrals.me();
      if (!data.success) throw new Error(data.error || 'Не удалось загрузить');
      const link = location.origin + '/login.html?mode=register&ref=' + encodeURIComponent(data.code);
      const s = data.stats || {};
      el.innerHTML = `
        <div class="text-sm" style="line-height:1.6;margin-bottom:14px">${escapeHtmlSafe(data.programDescription || '')}</div>

        <div class="input-group">
          <label class="input-label">Ваша реферальная ссылка</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" class="input" id="ref-link" value="${escapeHtmlAttr(link)}" readonly style="flex:1;font-family:monospace;font-size:13px" />
            <button class="btn btn-primary" id="btn-copy-ref" style="white-space:nowrap">Копировать</button>
          </div>
          <div class="text-xs text-muted mt-2">Код: <b style="font-family:monospace">${escapeHtmlSafe(data.code)}</b></div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:10px;margin-top:16px">
          <div style="background:var(--bg-secondary);padding:12px;border-radius:8px;text-align:center">
            <div style="font-size:22px;font-weight:700">${s.granted || 0}</div>
            <div class="text-xs text-muted">Приведено</div>
          </div>
          <div style="background:var(--bg-secondary);padding:12px;border-radius:8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:var(--accent-primary)">+${s.totalDays || 0} дн.</div>
            <div class="text-xs text-muted">Премиум-бонус</div>
          </div>
          ${(s.blocked || 0) > 0 ? `
          <div style="background:var(--bg-secondary);padding:12px;border-radius:8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:var(--danger)">${s.blocked}</div>
            <div class="text-xs text-muted">Заблокировано</div>
          </div>` : ''}
        </div>

        ${(data.referrals && data.referrals.length) ? `
          <div style="margin-top:18px">
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Последние приглашённые</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${data.referrals.slice(0, 10).map((r) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;font-size:13px">
                  <span>${escapeHtmlSafe(r.refereeName || r.refereeEmail || '—')}</span>
                  <span class="text-xs ${r.status === 'granted' ? 'text-muted' : ''}" style="${r.status === 'blocked' ? 'color:var(--danger)' : ''}">
                    ${r.status === 'granted' ? '+' + (r.rewardDays || 0) + ' дн.' : 'заблокирован'}
                    · ${new Date(r.createdAt).toLocaleDateString('ru-RU')}
                  </span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `;
      const copyBtn = document.getElementById('btn-copy-ref');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const inp = document.getElementById('ref-link');
          if (!inp) return;
          inp.select();
          try {
            navigator.clipboard.writeText(inp.value);
            copyBtn.textContent = 'Скопировано';
            setTimeout(() => { copyBtn.textContent = 'Копировать'; }, 1500);
          } catch (_) {
            document.execCommand('copy');
          }
        });
      }
    } catch (err) {
      el.innerHTML = `<div class="text-sm" style="color:var(--danger)">Не удалось загрузить реферальную программу: ${escapeHtmlSafe(err.message)}</div>`;
    }
  }
  function escapeHtmlSafe(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeHtmlAttr(s) { return escapeHtmlSafe(s); }

  // ============================================================
  // Возврат из платёжного провайдера: страховка от потерянного webhook'а.
  // Если в URL ?paid=... — берём свой последний pending платёж и опрашиваем
  // /payments/:id/check несколько раз. Backend сам спросит провайдера и при
  // succeeded выдаст подписку. После — перерисовываем карточку.
  // ============================================================
  async function handlePaymentReturn() {
    const params = new URLSearchParams(location.search);
    if (!params.has('paid')) return;
    // Чистим query, чтобы при перезагрузке поллинг не запускался повторно.
    history.replaceState({}, '', location.pathname + location.hash);

    try {
      const data = await window.GosClient.payments.mine();
      const list = (data && data.payments) || [];
      // Берём самый свежий pending — это то, за что юзер только что заплатил.
      const target = list.find((p) => p.status === 'pending');
      if (!target) {
        loadSubscription();
        return;
      }

      window.toast('Проверяем оплату…');
      // 6 попыток с возрастающей паузой: 1.5, 3, 5, 8, 12, 20 секунд.
      const delays = [1500, 3000, 5000, 8000, 12000, 20000];
      for (const d of delays) {
        await new Promise((r) => setTimeout(r, d));
        try {
          const r = await window.GosClient.payments.check(target.id);
          if (r && r.success && r.status === 'succeeded') {
            window.toast('Подписка активирована');
            await loadSubscription();
            return;
          }
          if (r && (r.status === 'canceled' || r.status === 'failed')) {
            window.toast('Оплата не прошла');
            return;
          }
        } catch (_) { /* ignore, попробуем ещё раз */ }
      }
      window.toast('Оплата ещё в обработке. Если подписка не появится через минуту — напишите в поддержку.');
    } catch (err) {
      console.warn('[Cabinet] handlePaymentReturn:', err);
    }
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
        if (tab === 'support') loadTickets();
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
  // Subscription
  // ============================================================
  async function loadSubscription() {
    const el = $('subscription-content');
    if (!el) return;
    try {
      const [meRes, featRes] = await Promise.all([
        window.GosClient.subscriptions.me(),
        window.GosClient.subscriptions.features(),
      ]);
      const sub = meRes.subscription;
      const featuresMeta = featRes.features || [];
      if (!sub) {
        el.innerHTML = `
          <div class="sub-empty">
            У вас пока нет активной подписки.<br>
            <span class="text-xs">Посмотрите <a href="/pricing.html">тарифы и оформите подписку</a>, или напишите в поддержку.</span>
          </div>
        `;
        return;
      }
      const expiresAt = new Date(sub.expiresAt);
      const expStr = expiresAt.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const remaining = sub.remainingDays;
      let remainingClass = '';
      if (remaining <= 0) remainingClass = 'sub-expired-warn';
      else if (remaining <= 3) remainingClass = 'sub-expiring-soon';
      const featsHtml = (sub.plan.features || []).map((key) => {
        const meta = featuresMeta.find((f) => f.key === key);
        return `<div class="sub-feature">✓ ${escapeHtml(meta ? meta.label : key)}</div>`;
      }).join('');
      el.innerHTML = `
        <div class="subscription-active">
          <div class="sub-badge" style="background:linear-gradient(135deg, ${escapeHtml(sub.plan.color || '#DF005B')}, rgba(0,0,0,0.4))">
            ${escapeHtml(sub.plan.name)}
          </div>
          <div class="sub-info">
            ${sub.plan.description ? `<div class="sub-desc">${escapeHtml(sub.plan.description)}</div>` : ''}
            <div class="sub-meta">
              <div>Истекает: <strong>${escapeHtml(expStr)}</strong></div>
              <div class="${remainingClass}">Осталось: <strong>${remaining} ${dayWord(remaining)}</strong></div>
            </div>
            ${featsHtml ? `<div class="sub-features-title">Доступные функции</div><div class="sub-features-list">${featsHtml}</div>` : ''}
          </div>
        </div>
      `;
    } catch (err) {
      el.innerHTML = `<div class="text-sm text-muted">Не удалось загрузить: ${escapeHtml(err.message)}</div>`;
    }
  }

  function dayWord(n) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return 'дней';
    if (b > 1 && b < 5) return 'дня';
    if (b === 1) return 'день';
    return 'дней';
  }

  // ============================================================
  // Support
  // ============================================================
  const SupportState = {
    tickets: [],
    currentTicket: null,
    view: 'list',
    pollTimer: null,
    pollInflight: false,
    lastRenderedMessageId: 0,
  };

  function setupSupport() {
    $('btn-new-ticket').addEventListener('click', () => showSupportView('form'));
    $('btn-cancel-ticket').addEventListener('click', () => showSupportView('list'));
    $('btn-back-to-tickets').addEventListener('click', () => {
      showSupportView('list');
      loadTickets();
    });
    $('btn-submit-ticket').addEventListener('click', submitTicket);
    $('btn-send-reply').addEventListener('click', sendReply);
    $('ticket-body').addEventListener('input', (e) => {
      $('ticket-body-counter').textContent = `${e.target.value.length} / 5000`;
    });
    $('ticket-reply').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendReply(); }
    });
  }

  function showSupportView(name) {
    SupportState.view = name;
    $('support-list-view').classList.toggle('hidden', name !== 'list');
    $('support-form-view').classList.toggle('hidden', name !== 'form');
    $('support-detail-view').classList.toggle('hidden', name !== 'detail');
    if (name !== 'detail') stopTicketPolling();
    if (name === 'form') {
      $('ticket-subject').value = '';
      $('ticket-body').value = '';
      $('ticket-body-counter').textContent = '0 / 5000';
      $('ticket-form-error').textContent = '';
      $('ticket-form-error').style.display = 'none';
      document.querySelector('input[name="ticket-type"][value="question"]').checked = true;
      setTimeout(() => $('ticket-subject').focus(), 50);
    }
  }

  function startTicketPolling(ticketId) {
    stopTicketPolling();
    SupportState.pollTimer = setInterval(() => pollCurrentTicket(ticketId), 5000);
  }

  function stopTicketPolling() {
    if (SupportState.pollTimer) {
      clearInterval(SupportState.pollTimer);
      SupportState.pollTimer = null;
    }
  }

  async function pollCurrentTicket(ticketId) {
    if (SupportState.pollInflight) return;
    if (document.hidden) return; // browser tab is in background
    if (SupportState.view !== 'detail') { stopTicketPolling(); return; }
    if (!SupportState.currentTicket || SupportState.currentTicket.id !== ticketId) return;
    SupportState.pollInflight = true;
    try {
      const data = await window.GosClient.support.get(ticketId);
      if (!data.success || !data.ticket) return;
      if (SupportState.view !== 'detail') return;
      if (!SupportState.currentTicket || SupportState.currentTicket.id !== ticketId) return;

      const prev = SupportState.currentTicket;
      const next = data.ticket;
      const prevLastId = prev.messages.length ? prev.messages[prev.messages.length - 1].id : 0;
      const nextLastId = next.messages.length ? next.messages[next.messages.length - 1].id : 0;

      // Re-render messages only when something changed (avoid disturbing the user)
      if (nextLastId !== prevLastId || next.status !== prev.status) {
        SupportState.currentTicket = next;
        const wasAtBottom = isMessagesScrolledToBottom();
        const replyText = $('ticket-reply').value; // preserve in-progress reply
        renderTicketDetail(next);
        $('ticket-reply').value = replyText;
        if (wasAtBottom || nextLastId !== prevLastId) {
          const el = $('ticket-messages');
          el.scrollTop = el.scrollHeight;
        }
        // Audio cue if a new admin message arrived (optional, gentle)
        const newAdminMsg = next.messages.find(
          (m) => m.id > prevLastId && m.isAdmin
        );
        if (newAdminMsg) toast('Новый ответ от поддержки');
      }
      // Always refresh badge counter (it might have changed via mark-read)
      refreshSupportBadge();
    } catch {
      // Silent — network blip
    } finally {
      SupportState.pollInflight = false;
    }
  }

  function isMessagesScrolledToBottom() {
    const el = $('ticket-messages');
    if (!el) return true;
    return Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 20;
  }

  async function loadTickets() {
    const listEl = $('tickets-list');
    listEl.innerHTML = '<div class="text-sm text-muted" style="padding:8px 0">Загрузка...</div>';
    try {
      const data = await window.GosClient.support.listMine();
      SupportState.tickets = data.tickets || [];
      renderTickets();
    } catch (err) {
      listEl.innerHTML = `<div class="text-sm text-muted" style="padding:8px 0">Ошибка: ${escapeHtml(err.message)}</div>`;
    }
    refreshSupportBadge();
  }

  function renderTickets() {
    const listEl = $('tickets-list');
    if (SupportState.tickets.length === 0) {
      listEl.innerHTML = `<div class="text-sm text-muted" style="padding:24px 8px;text-align:center">
        У вас пока нет обращений.<br>Нажмите «+ Новое обращение», чтобы создать первое.
      </div>`;
      return;
    }
    listEl.innerHTML = SupportState.tickets.map(renderTicketRow).join('');
    listEl.querySelectorAll('.ticket-row').forEach((row) => {
      row.addEventListener('click', () => openTicket(parseInt(row.dataset.id, 10)));
    });
  }

  function renderTicketRow(t) {
    const typeMeta = {
      question:   { icon: '❓', label: 'Вопрос' },
      suggestion: { icon: '💡', label: 'Предложение' },
      bug:        { icon: '🐞', label: 'Баг' },
    }[t.type] || { icon: '📝', label: t.type };
    const statusLabels = {
      open: 'Открыт', in_progress: 'В работе', answered: 'Ответ', closed: 'Закрыт',
    };
    const date = t.updatedAt ? new Date(t.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="ticket-row" data-id="${t.id}">
        <div class="ticket-row-type" title="${escapeHtml(typeMeta.label)}">${typeMeta.icon}</div>
        <div class="ticket-row-main">
          <div class="ticket-row-subject">${escapeHtml(t.subject)}</div>
          <div class="ticket-row-meta">#${t.id} · ${escapeHtml(typeMeta.label)} · ${escapeHtml(date)}</div>
        </div>
        ${t.unreadForUser ? '<div class="ticket-row-unread" title="Новый ответ"></div>' : ''}
        <div class="ticket-row-status ticket-status-${t.status}">${statusLabels[t.status] || t.status}</div>
      </div>
    `;
  }

  async function openTicket(id) {
    showSupportView('detail');
    $('ticket-detail-subject').textContent = 'Загрузка...';
    $('ticket-detail-meta').textContent = '';
    $('ticket-messages').innerHTML = '';
    try {
      const data = await window.GosClient.support.get(id);
      SupportState.currentTicket = data.ticket;
      renderTicketDetail(data.ticket);
      startTicketPolling(id);
    } catch (err) {
      $('ticket-detail-subject').textContent = 'Ошибка';
      $('ticket-detail-meta').textContent = err.message;
    }
    refreshSupportBadge();
  }

  function renderTicketDetail(ticket) {
    const typeLabels = { question: 'Вопрос', suggestion: 'Предложение', bug: 'Баг' };
    const statusLabels = { open: 'Открыт', in_progress: 'В работе', answered: 'Ответ', closed: 'Закрыт' };
    $('ticket-detail-subject').textContent = `#${ticket.id} · ${ticket.subject}`;
    $('ticket-detail-meta').innerHTML = `
      <span class="ticket-row-status ticket-status-${ticket.status}" style="font-size:10px">${statusLabels[ticket.status]}</span>
      <span style="margin-left:8px">${escapeHtml(typeLabels[ticket.type] || ticket.type)}</span>
      <span style="margin-left:8px">·</span>
      <span style="margin-left:8px">${new Date(ticket.createdAt).toLocaleString('ru-RU')}</span>
    `;
    const msgsEl = $('ticket-messages');
    msgsEl.innerHTML = ticket.messages.map((m) => renderMessage(m, ticket)).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
    const isClosed = ticket.status === 'closed';
    $('ticket-reply-block').style.display = isClosed ? 'none' : '';
    $('ticket-closed-note').classList.toggle('hidden', !isClosed);
    $('ticket-reply').value = '';
  }

  function renderMessage(m, ticket) {
    const cls = m.isAdmin ? 'admin' : 'user';
    const name = m.isAdmin ? 'Поддержка' : (m.authorName || 'Вы');
    const initial = name.charAt(0).toUpperCase();
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

  async function submitTicket() {
    const errEl = $('ticket-form-error');
    errEl.style.display = 'none';
    const type = document.querySelector('input[name="ticket-type"]:checked').value;
    const subject = $('ticket-subject').value.trim();
    const body = $('ticket-body').value.trim();
    if (!subject) { errEl.textContent = 'Укажите тему'; errEl.style.display = 'block'; return; }
    if (!body) { errEl.textContent = 'Опишите проблему или предложение'; errEl.style.display = 'block'; return; }
    const btn = $('btn-submit-ticket');
    btn.disabled = true;
    try {
      const data = await window.GosClient.support.create({ type, subject, body, source: 'site' });
      toast('Обращение отправлено');
      SupportState.currentTicket = data.ticket;
      await loadTickets();
      showSupportView('detail');
      renderTicketDetail(data.ticket);
      startTicketPolling(data.ticket.id);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  }

  async function sendReply() {
    const ticket = SupportState.currentTicket;
    if (!ticket) return;
    const text = $('ticket-reply').value.trim();
    if (!text) return;
    const btn = $('btn-send-reply');
    btn.disabled = true;
    try {
      const data = await window.GosClient.support.reply(ticket.id, text);
      SupportState.currentTicket = data.ticket;
      renderTicketDetail(data.ticket);
      const msgsEl = $('ticket-messages');
      msgsEl.scrollTop = msgsEl.scrollHeight;
    } catch (err) {
      toast('Ошибка: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function refreshSupportBadge() {
    try {
      const data = await window.GosClient.support.unreadCount();
      const badge = $('support-badge');
      if (data.count > 0) {
        badge.textContent = String(data.count);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    } catch {}
  }
  setInterval(refreshSupportBadge, 60000);

  // ============================================================
  // Start
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
