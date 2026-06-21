(function () {
  'use strict';

  const TOKEN_KEY = 'gos_token';
  const USER_KEY = 'gos_user';

  const API_BASE = (() => {
    // Use same origin if served from backend, otherwise localhost:3000
    if (location.port === '3000' || location.protocol === 'file:') {
      return location.origin + '/api';
    }
    return location.origin + '/api';
  })();

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setUser(user) {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.GosClient = {
    API_BASE,
    getToken,
    setToken,
    getUser,
    setUser,
    logout,

    auth: {
      login: (email, password) => request('POST', '/auth/login', { email, password }),
      register: (email, username, password, acceptTerms) =>
        request('POST', '/auth/register', { email, username, password, acceptTerms }),
      me: () => request('GET', '/auth/me'),
      logout: () => request('POST', '/auth/logout'),
      logoutAll: () => request('POST', '/auth/logout-all'),
      updateProfile: (data) => request('PUT', '/auth/me', data),
      changePassword: (currentPassword, newPassword) =>
        request('POST', '/auth/change-password', { currentPassword, newPassword }),
      discordLinkUrl: () => request('POST', '/auth/discord/link-url'),
      discordUnlink: () => request('POST', '/auth/discord/unlink'),
    },

    servers: {
      list: () => request('GET', '/servers'),
      listAll: () => request('GET', '/servers/all'),
      create: (data) => request('POST', '/servers', data),
      update: (id, data) => request('PUT', '/servers/' + encodeURIComponent(id), data),
      remove: (id) => request('DELETE', '/servers/' + encodeURIComponent(id)),
    },

    categories: {
      list: () => request('GET', '/categories'),
      listAll: () => request('GET', '/categories/all'),
      create: (data) => request('POST', '/categories', data),
      update: (id, data) => request('PUT', '/categories/' + encodeURIComponent(id), data),
      remove: (id) => request('DELETE', '/categories/' + encodeURIComponent(id)),
    },

    articles: {
      list: (params) => {
        const qs = new URLSearchParams(params || {}).toString();
        return request('GET', '/articles' + (qs ? '?' + qs : ''));
      },
      search: (params) => {
        const qs = new URLSearchParams(params || {}).toString();
        return request('GET', '/articles/search' + (qs ? '?' + qs : ''));
      },
      create: (data) => request('POST', '/articles', data),
      update: (id, data) => request('PUT', '/articles/' + id, data),
      remove: (id) => request('DELETE', '/articles/' + id),
    },

    users: {
      list: () => request('GET', '/users'),
      setRole: (id, role) => request('PUT', '/users/' + id + '/role', { role }),
      remove: (id) => request('DELETE', '/users/' + id),
    },

    donate: {
      list: () => request('GET', '/donate'),
      listAll: () => request('GET', '/donate/all'),
      create: (data) => request('POST', '/donate', data),
      update: (id, data) => request('PUT', '/donate/' + id, data),
      remove: (id) => request('DELETE', '/donate/' + id),
    },

    devlog: {
      list: (limit) => request('GET', '/devlog' + (limit ? '?limit=' + limit : '')),
      listAll: () => request('GET', '/devlog/all'),
      create: (data) => request('POST', '/devlog', data),
      update: (id, data) => request('PUT', '/devlog/' + id, data),
      remove: (id) => request('DELETE', '/devlog/' + id),
    },

    maintenance: {
      get: () => request('GET', '/maintenance'),
      update: (data) => request('PUT', '/maintenance', data),
    },

    parser: {
      importServerJson: (data) => request('POST', '/parser/json/import-server', data),
      previewServerJson: (data) => request('POST', '/parser/json/preview-server', data),
    },

    support: {
      listMine: () => request('GET', '/support/tickets/mine'),
      listAll: (params) => {
        const qs = new URLSearchParams(params || {}).toString();
        return request('GET', '/support/tickets/all' + (qs ? '?' + qs : ''));
      },
      get: (id) => request('GET', '/support/tickets/' + id),
      create: (data) => request('POST', '/support/tickets', data),
      reply: (id, body) => request('POST', '/support/tickets/' + id + '/messages', { body }),
      setStatus: (id, status) => request('PUT', '/support/tickets/' + id + '/status', { status }),
      unreadCount: () => request('GET', '/support/unread-count'),
    },

    subscriptions: {
      features: () => request('GET', '/subscriptions/features'),
      me: () => request('GET', '/subscriptions/me'),
      listPlans: () => request('GET', '/subscriptions/plans'),
      createPlan: (data) => request('POST', '/subscriptions/plans', data),
      updatePlan: (id, data) => request('PUT', '/subscriptions/plans/' + id, data),
      deletePlan: (id) => request('DELETE', '/subscriptions/plans/' + id),
      listGrants: (params) => {
        const qs = new URLSearchParams(params || {}).toString();
        return request('GET', '/subscriptions/grants' + (qs ? '?' + qs : ''));
      },
      grant: (data) => request('POST', '/subscriptions/grants', data),
      extend: (id, days) => request('POST', '/subscriptions/grants/' + id + '/extend', { days }),
      updateGrant: (id, data) => request('PUT', '/subscriptions/grants/' + id, data),
      revoke: (id) => request('DELETE', '/subscriptions/grants/' + id),
    },
  };

  // Toast helper
  let toastTimer = null;
  window.toast = function (msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
  };

  window.escapeHtml = function (str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
})();
