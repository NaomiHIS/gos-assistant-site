(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const API = window.GosClient;

  const State = {
    plans: [],
    providers: [],
    selectedPlan: null,
    selectedProvider: null,
  };

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatPrice(cents, currency) {
    const rub = Math.floor(cents / 100);
    const kop = cents % 100;
    const ccy = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₽';
    if (kop) return rub + ',' + String(kop).padStart(2, '0') + ' ' + ccy;
    return rub + ' ' + ccy;
  }

  function dayWord(n) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return 'дней';
    if (b > 1 && b < 5) return 'дня';
    if (b === 1) return 'день';
    return 'дней';
  }

  function applyAuthVisibility() {
    const user = API.getUser();
    document.querySelectorAll('[data-auth="guest"]').forEach((el) => {
      el.classList.toggle('hidden', !!user);
    });
    document.querySelectorAll('[data-auth="user"]').forEach((el) => {
      el.classList.toggle('hidden', !user);
    });
    document.querySelectorAll('[data-auth="admin"]').forEach((el) => {
      el.classList.toggle('hidden', !user || user.role !== 'admin');
    });
  }

  async function loadPlans() {
    try {
      const data = await fetch(API.API_BASE + '/subscriptions/plans/public').then((r) => r.json());
      if (!data.success) throw new Error(data.error || 'Не удалось загрузить тарифы');
      State.plans = data.plans || [];
      renderPlans();
    } catch (err) {
      $('pricing-cards').innerHTML = `<div class="text-sm" style="grid-column:1/-1;text-align:center;color:var(--danger);padding:40px 0">${escapeHtml(err.message)}</div>`;
    }
  }

  const FEATURE_LABELS = {
    notes_unlimited: 'Безлимит заметок',
    notes_sync: 'Синхронизация заметок',
    themes_extra: 'Дополнительные темы',
    priority_support: 'Приоритетная поддержка',
    early_access: 'Ранний доступ к новому',
    no_ads: 'Без рекламы',
    export_data: 'Экспорт заметок и данных',
    custom_hotkeys: 'Расширенные горячие клавиши',
    ai_assistant: 'AI-ассистент по законам',
  };

  function renderPlans() {
    const cont = $('pricing-cards');
    if (!State.plans.length) {
      cont.innerHTML = `<div class="text-sm text-muted" style="grid-column:1/-1;text-align:center;padding:40px 0">Тарифы пока недоступны.</div>`;
      return;
    }
    cont.innerHTML = State.plans.map((plan) => {
      const features = (plan.features || []).map((key) =>
        `<li><span class="check">✓</span> ${escapeHtml(FEATURE_LABELS[key] || key)}</li>`
      ).join('');
      const accent = plan.color || '#DF005B';
      const isPopular = plan.slug === 'premium';
      return `
        <div class="pricing-card ${isPopular ? 'pricing-card-popular' : ''}" style="--card-accent:${escapeHtml(accent)}">
          ${isPopular ? '<div class="pricing-card-badge">Популярный</div>' : ''}
          <div class="pricing-card-name">${escapeHtml(plan.name)}</div>
          <div class="pricing-card-price">
            <span class="price-value">${formatPrice(plan.priceCents, plan.currency)}</span>
            <span class="price-period">/ ${plan.durationDays} ${dayWord(plan.durationDays)}</span>
          </div>
          ${plan.description ? `<div class="pricing-card-desc">${escapeHtml(plan.description)}</div>` : ''}
          <ul class="pricing-card-features">${features}</ul>
          <button class="btn btn-primary btn-block pricing-card-buy" data-plan-id="${plan.id}">Купить</button>
        </div>
      `;
    }).join('');
    cont.querySelectorAll('.pricing-card-buy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const planId = parseInt(btn.dataset.planId, 10);
        const plan = State.plans.find((p) => p.id === planId);
        if (plan) openBuyModal(plan);
      });
    });
  }

  async function openBuyModal(plan) {
    if (!API.getUser()) {
      // Не залогинен — отправляем на /login.html и помним намерение
      sessionStorage.setItem('gos_buy_intent', String(plan.id));
      location.href = '/login.html?redirect=/pricing.html';
      return;
    }
    State.selectedPlan = plan;
    State.selectedProvider = null;
    $('buy-modal-title').textContent = 'Оформление: ' + plan.name;
    $('buy-modal-plan').innerHTML = `
      <div class="buy-plan-row">
        <div class="buy-plan-badge" style="background:${escapeHtml(plan.color || '#DF005B')}">${escapeHtml(plan.name)}</div>
        <div class="buy-plan-meta">
          <div><b>${formatPrice(plan.priceCents, plan.currency)}</b> на ${plan.durationDays} ${dayWord(plan.durationDays)}</div>
        </div>
      </div>
    `;
    $('buy-modal-error').style.display = 'none';
    $('buy-modal').style.display = 'flex';
    await loadProvidersInModal();
  }

  async function loadProvidersInModal() {
    const cont = $('buy-modal-providers');
    cont.innerHTML = '<div class="text-sm text-muted">Загрузка…</div>';
    try {
      const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API.getToken() };
      const res = await fetch(API.API_BASE + '/payments/providers', { headers });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Не удалось загрузить способы оплаты');
      State.providers = data.providers || [];
      if (!State.providers.length) {
        cont.innerHTML = '<div class="text-sm" style="color:var(--danger)">Способы оплаты пока не настроены. Свяжитесь с поддержкой.</div>';
        return;
      }
      cont.innerHTML = State.providers.map((p, idx) => `
        <label class="buy-provider-option">
          <input type="radio" name="provider" value="${escapeHtml(p.slug)}" ${idx === 0 ? 'checked' : ''} />
          <span class="buy-provider-card">
            <span class="buy-provider-name">${escapeHtml(p.name)}</span>
            ${p.description ? `<span class="buy-provider-desc">${escapeHtml(p.description)}</span>` : ''}
          </span>
        </label>
      `).join('');
      State.selectedProvider = State.providers[0].slug;
      cont.querySelectorAll('input[name="provider"]').forEach((inp) => {
        inp.addEventListener('change', () => { State.selectedProvider = inp.value; });
      });
    } catch (err) {
      cont.innerHTML = `<div class="text-sm" style="color:var(--danger)">${escapeHtml(err.message)}</div>`;
    }
  }

  function closeBuyModal() {
    $('buy-modal').style.display = 'none';
    State.selectedPlan = null;
    State.selectedProvider = null;
  }

  async function confirmBuy() {
    const plan = State.selectedPlan;
    const provider = State.selectedProvider;
    if (!plan || !provider) return;
    const btn = $('buy-modal-confirm');
    const errEl = $('buy-modal-error');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Создаём платёж…';
    try {
      const res = await fetch(API.API_BASE + '/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API.getToken() },
        body: JSON.stringify({ planId: plan.id, providerSlug: provider, returnUrl: location.origin + '/cabinet.html' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Не удалось создать платёж');

      if (data.payment.confirmationUrl) {
        // Онлайн-оплата → редирект
        location.href = data.payment.confirmationUrl;
        return;
      }
      // Ручная выдача — сообщаем что заявка принята
      closeBuyModal();
      alert('Заявка принята! Админ свяжется с вами для оплаты. Статус — в личном кабинете.');
      location.href = '/cabinet.html';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Оплатить';
    }
  }

  function setup() {
    applyAuthVisibility();
    loadPlans();
    $('buy-modal-close').addEventListener('click', closeBuyModal);
    $('buy-modal-cancel').addEventListener('click', closeBuyModal);
    $('buy-modal-confirm').addEventListener('click', confirmBuy);
    $('buy-modal').addEventListener('click', (e) => {
      if (e.target.id === 'buy-modal') closeBuyModal();
    });

    // Если юзер вернулся со страницы логина с намерением купить — открыть модалку
    const intentId = sessionStorage.getItem('gos_buy_intent');
    if (intentId && API.getUser()) {
      sessionStorage.removeItem('gos_buy_intent');
      const tryOpen = () => {
        const plan = State.plans.find((p) => String(p.id) === intentId);
        if (plan) openBuyModal(plan);
        else setTimeout(tryOpen, 200);
      };
      setTimeout(tryOpen, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else setup();
})();
