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

  // Check ?mode=register or ?token (Discord callback)
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (token) {
    handleDiscordReturn(token);
    return;
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
    if (mode === 'login') {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
      formTitle.textContent = 'Вход в аккаунт';
      formSubtitle.textContent = 'Войдите, чтобы продолжить';
      switchText.textContent = 'Нет аккаунта?';
      switchLink.textContent = 'Зарегистрироваться';
    } else {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      formTitle.textContent = 'Создание аккаунта';
      formSubtitle.textContent = 'Зарегистрируйтесь, чтобы получить доступ';
      switchText.textContent = 'Уже есть аккаунт?';
      switchLink.textContent = 'Войти';
    }
  }

  setMode(mode);

  switchLink.addEventListener('click', () => {
    setMode(mode === 'login' ? 'register' : 'login');
  });

  function redirectAfterAuth(user) {
    if (user && user.role === 'admin') {
      location.href = '/admin.html';
    } else {
      location.href = '/';
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

    if (password !== password2) {
      showError('Пароли не совпадают');
      return;
    }

    const btn = $('register-submit');
    btn.disabled = true;
    btn.textContent = 'Создание...';

    try {
      const data = await window.GosClient.auth.register(email, username, password);
      if (data.success) {
        window.GosClient.setToken(data.token);
        window.GosClient.setUser(data.user);
        showSuccess('Аккаунт создан! Перенаправление...');
        setTimeout(() => redirectAfterAuth(data.user), 600);
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
