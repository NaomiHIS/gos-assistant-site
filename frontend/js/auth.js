(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const loginForm = $('login-form');
  const registerForm = $('register-form');
  const errorBox = $('error-box');
  const successBox = $('success-box');
  const formTitle = $('form-title');
  const formSubtitle = $('form-subtitle');
  const switchText = $('switch-text');
  const switchLink = $('switch-link');

  // Capture referral code from URL ?ref= and remember across switches/redirects.
  // Sticky: даже если юзер сначала ушёл на login и вернулся — код остаётся.
  const refFromUrl = new URLSearchParams(location.search).get('ref');
  if (refFromUrl) {
    const clean = refFromUrl.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    if (clean) sessionStorage.setItem('gos_ref_code', clean);
  }
  function getStickyRef() {
    return sessionStorage.getItem('gos_ref_code') || '';
  }
  function renderRefBanner() {
    const code = getStickyRef();
    const banner = $('ref-banner');
    if (!banner) return;
    if (!code) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    const codeEl = $('ref-banner-code');
    if (codeEl) codeEl.textContent = code;
  }
  renderRefBanner();

  // Check ?mode=register or ?token (Discord callback) or ?error=...
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  const errParam = params.get('error');
  if (token) {
    handleDiscordReturn(token);
    return;
  }
  if (errParam) {
    setTimeout(() => showError(errParam), 50);
    // Clean URL so error doesn't persist on refresh
    history.replaceState({}, '', location.pathname);
  }

  let mode = params.get('mode') === 'register' ? 'register' : 'login';

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('visible');
    successBox.classList.remove('visible');
  }

  function showSuccess(msg) {
    successBox.textContent = msg;
    successBox.classList.add('visible');
    errorBox.classList.remove('visible');
  }

  function clearMessages() {
    errorBox.classList.remove('visible');
    successBox.classList.remove('visible');
  }

  function setMode(newMode) {
    mode = newMode;
    clearMessages();
    const refBanner = $('ref-banner');
    if (mode === 'login') {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
      formTitle.textContent = 'Вход в аккаунт';
      formSubtitle.textContent = 'Войдите, чтобы продолжить';
      switchText.textContent = 'Нет аккаунта?';
      switchLink.textContent = 'Зарегистрироваться';
      if (refBanner) refBanner.classList.add('hidden'); // баннер только на регистрации
    } else {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      formTitle.textContent = 'Создание аккаунта';
      formSubtitle.textContent = 'Зарегистрируйтесь, чтобы получить доступ';
      switchText.textContent = 'Уже есть аккаунт?';
      switchLink.textContent = 'Войти';
      if (refBanner && getStickyRef()) refBanner.classList.remove('hidden');
    }
  }

  setMode(mode);
  loadServers();

  async function loadServers() {
    const select = $('reg-server');
    if (!select) return;
    try {
      const res = await fetch(window.GosClient.API_BASE + '/servers').then((r) => r.json());
      const list = Array.isArray(res) ? res : (res.servers || []);
      if (!list.length) {
        select.innerHTML = '<option value="">Серверы пока недоступны</option>';
        return;
      }
      select.innerHTML = '<option value="">— Выберите сервер —</option>' +
        list.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    } catch {
      select.innerHTML = '<option value="">Не удалось загрузить серверы</option>';
    }
  }

  switchLink.addEventListener('click', () => {
    setMode(mode === 'login' ? 'register' : 'login');
  });

  function redirectAfterAuth(user) {
    // Если был передан ?redirect= — возвращаем юзера именно туда (только
    // внутренние пути, чтобы не превратить логин в open-redirect для фишинга).
    const ret = new URLSearchParams(location.search).get('redirect');
    if (ret && ret.startsWith('/') && !ret.startsWith('//')) {
      location.href = ret;
      return;
    }
    if (user && user.role === 'admin') {
      location.href = '/admin.html';
    } else {
      location.href = '/cabinet.html';
    }
  }

  async function handleDiscordReturn(token) {
    window.GosClient.setToken(token);
    try {
      const data = await window.GosClient.auth.me();
      if (data.success) {
        window.GosClient.setUser(data.user);
        redirectAfterAuth(data.user);
      } else {
        showError('Не удалось получить профиль');
      }
    } catch (err) {
      showError('Ошибка: ' + err.message);
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    const btn = $('login-submit');
    btn.disabled = true;
    btn.textContent = 'Вход...';

    try {
      const data = await window.GosClient.auth.login(email, password);
      if (data.success) {
        window.GosClient.setToken(data.token);
        window.GosClient.setUser(data.user);
        showSuccess('Успешный вход! Перенаправление...');
        setTimeout(() => redirectAfterAuth(data.user), 600);
      } else {
        showError(data.error || 'Ошибка входа');
      }
    } catch (err) {
      showError(err.message || 'Не удалось войти');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    const email = $('reg-email').value.trim();
    const username = $('reg-username').value.trim();
    const password = $('reg-password').value;
    const password2 = $('reg-password2').value;
    const acceptTerms = $('reg-accept-terms').checked;
    const serverId = $('reg-server').value;

    if (password !== password2) {
      showError('Пароли не совпадают');
      return;
    }
    if (!acceptTerms) {
      showError('Необходимо принять Условия использования и Политику конфиденциальности');
      return;
    }
    if (!serverId) {
      showError('Выберите свой сервер');
      return;
    }

    const btn = $('register-submit');
    btn.disabled = true;
    btn.textContent = 'Создание...';

    try {
      const referralCode = getStickyRef();
      const data = await window.GosClient.auth.register(email, username, password, acceptTerms, serverId, referralCode);
      if (data.success) {
        window.GosClient.setToken(data.token);
        window.GosClient.setUser(data.user);
        // Не очищаем код — он понадобится юзеру для ввода в приложении.
        // Запомним отдельно, чтобы показать на странице «после регистрации» / кабинета.
        if (referralCode) {
          localStorage.setItem('gos_pending_referral', referralCode);
        }
        const msg = referralCode
          ? '✅ Аккаунт создан. Активируйте реферальный код в приложении (Настройки → Реферальная программа). Перенаправление...'
          : 'Аккаунт создан! Перенаправление...';
        showSuccess(msg);
        setTimeout(() => redirectAfterAuth(data.user), 900);
      } else {
        showError(data.error || 'Ошибка регистрации');
      }
    } catch (err) {
      showError(err.message || 'Не удалось создать аккаунт');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Создать аккаунт';
    }
  });
})();
