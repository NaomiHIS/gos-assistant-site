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

  function currencySymbol(currency) {
    return currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₽';
  }

  function formatPrice(cents, currency) {
    const rub = Math.floor(cents / 100);
    const kop = cents % 100;
    const ccy = currencySymbol(currency);
    if (kop) return rub + ',' + String(kop).padStart(2, '0') + ' ' + ccy;
    return rub + ' ' + ccy;
  }

  // Стоимость за день, формат «8,4 ₽» / «10 ₽» — копейки округляем до 1 знака
  function formatPerDay(cents, days, currency) {
    if (!days || days < 1) return '';
    const perDay = cents / 100 / days;
    const rounded = perDay >= 10 ? Math.round(perDay) : Math.round(perDay * 10) / 10;
    const str = String(rounded).replace('.', ',');
    return str + ' ' + currencySymbol(currency);
  }

  function dayWord(n) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return 'дней';
    if (b > 1 && b < 5) return 'дня';
    if (b === 1) return 'день';
    return 'дней';
  }

  // Делит планы на группы: lite, premium, yearly (Premium-годовые).
  // Эвристика — по slug/name (без миграций БД). 180+ дней → отдельная плашка.
  const YEARLY_DAYS_THRESHOLD = 180;
  function groupOf(plan) {
    const days = Number(plan.durationDays) || 0;
    const haystack = ((plan.slug || '') + ' ' + (plan.name || '')).toLowerCase();
    const isPremium = haystack.includes('premium') || haystack.includes('премиум');
    const isLite = haystack.includes('lite') || haystack.includes('лайт');
    if (isPremium && days >= YEARLY_DAYS_THRESHOLD) return 'yearly';
    if (isPremium) return 'premium';
    if (isLite) return 'lite';
    return 'other';
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
    multi_server: 'Просмотр законов всех серверов',
    binder_unlimited: 'Безлимит макросов в биндере',
    binder_share: 'Поделиться биндером по коду',
  };

  // Распределяет планы по группам и для каждой считает min ₽/день и базовую ₽/день
  // (от которой считается скидка). Возвращает {lite, premium, yearly, other}.
  function buildGroups(plans) {
    const groups = { lite: [], premium: [], yearly: [], other: [] };
    plans.forEach((p) => groups[groupOf(p)].push(p));
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => (a.durationDays || 0) - (b.durationDays || 0));
    });
    return groups;
  }

  function renderPlanCard(plan, ctx) {
    const features = (plan.features || []).map((key) =>
      `<li><span class="check">✓</span> ${escapeHtml(FEATURE_LABELS[key] || key)}</li>`
    ).join('');
    const accent = plan.color || '#DF005B';
    const perDay = formatPerDay(plan.priceCents, plan.durationDays, plan.currency);
    const perDayValue = (plan.priceCents / 100) / (plan.durationDays || 1);
    const isBest = ctx.bestPlanId === plan.id;
    const discount = ctx.baselinePerDay > 0
      ? Math.round((1 - perDayValue / ctx.baselinePerDay) * 100)
      : 0;
    const trialNote = plan.durationDays && plan.durationDays <= 7 ? 'попробовать' : '';

    const perDayParts = [];
    if (perDay) perDayParts.push(perDay + ' / день');
    if (discount > 0) perDayParts.push(`<span class="pricing-card-discount">−${discount}%</span>`);
    else if (trialNote) perDayParts.push(trialNote);
    const perDayLine = perDayParts.length
      ? `<div class="pricing-card-perday">${perDayParts.join(' · ')}</div>`
      : '';

    return `
      <div class="pricing-card ${isBest ? 'pricing-card-best' : ''}" style="--card-accent:${escapeHtml(accent)}">
        ${isBest ? '<div class="pricing-card-badge pricing-card-badge-best">Лучшая цена</div>' : ''}
        <div class="pricing-card-name">${escapeHtml(plan.name)}</div>
        <div class="pricing-card-price">
          <span class="price-value">${formatPrice(plan.priceCents, plan.currency)}</span>
          <span class="price-period">/ ${plan.durationDays} ${dayWord(plan.durationDays)}</span>
        </div>
        ${perDayLine}
        ${plan.description ? `<div class="pricing-card-desc">${escapeHtml(plan.description)}</div>` : ''}
        <ul class="pricing-card-features">${features}</ul>
        <button class="btn btn-primary btn-block pricing-card-buy" data-plan-id="${plan.id}">Купить</button>
      </div>
    `;
  }

  function renderGroupSection(title, plans, options) {
    if (!plans.length) return '';
    // Базовая ₽/день — самая дорогая в группе (от неё считаем скидку). Min — «Лучшая цена».
    const perDays = plans.map((p) => (p.priceCents / 100) / (p.durationDays || 1));
    const baselinePerDay = Math.max(...perDays);
    const minPerDay = Math.min(...perDays);
    const bestPlan = plans.length > 1 ? plans.find((p, i) => perDays[i] === minPerDay) : null;
    const ctx = { baselinePerDay, bestPlanId: bestPlan ? bestPlan.id : null };
    const chips = (options && options.chip)
      ? `<span class="pricing-group-chip">${escapeHtml(options.chip)}</span>`
      : '';
    return `
      <div class="pricing-group">
        <div class="pricing-group-header">
          <span class="pricing-group-title">${escapeHtml(title)}</span>
          ${chips}
        </div>
        <div class="pricing-cards-grid">
          ${plans.map((p) => renderPlanCard(p, ctx)).join('')}
        </div>
      </div>
    `;
  }

  function renderYearlySection(plans) {
    if (!plans.length) return '';
    // Базовая для расчёта экономии — самая дорогая ₽/день среди ВСЕХ Premium-планов (включая обычные).
    // Если обычных Premium нет — просто скрываем скидку.
    const premiumPlans = State.plans.filter((p) => groupOf(p) === 'premium');
    let baselinePerDay = 0;
    if (premiumPlans.length) {
      baselinePerDay = Math.max(...premiumPlans.map((p) => (p.priceCents / 100) / (p.durationDays || 1)));
    }
    return plans.map((plan) => {
      const perDay = formatPerDay(plan.priceCents, plan.durationDays, plan.currency);
      const perDayValue = (plan.priceCents / 100) / (plan.durationDays || 1);
      const discount = baselinePerDay > 0
        ? Math.round((1 - perDayValue / baselinePerDay) * 100)
        : 0;
      const metaParts = [formatPrice(plan.priceCents, plan.currency)];
      if (perDay) metaParts.push(perDay + ' / день');
      if (discount > 0) metaParts.push(`экономия ${discount}%`);
      const accent = plan.color || '#7C3AED';
      return `
        <div class="pricing-yearly" style="--card-accent:${escapeHtml(accent)}">
          <div class="pricing-yearly-info">
            <div class="pricing-yearly-name">👑 ${escapeHtml(plan.name)} · ${plan.durationDays} ${dayWord(plan.durationDays)}</div>
            <div class="pricing-yearly-meta">${metaParts.join(' · ')}</div>
          </div>
          <button class="btn btn-secondary pricing-card-buy" data-plan-id="${plan.id}">Подробнее →</button>
        </div>
      `;
    }).join('');
  }

  function renderPlans() {
    const cont = $('pricing-cards');
    if (!State.plans.length) {
      cont.innerHTML = `<div class="text-sm text-muted" style="grid-column:1/-1;text-align:center;padding:40px 0">Тарифы пока недоступны.</div>`;
      return;
    }
    const groups = buildGroups(State.plans);
    const sections = [];
    sections.push(renderGroupSection('LITE', groups.lite));
    sections.push(renderGroupSection('PREMIUM', groups.premium, { chip: 'AI-ассистент' }));
    if (groups.other.length) sections.push(renderGroupSection('ДРУГИЕ ТАРИФЫ', groups.other));
    sections.push(renderYearlySection(groups.yearly));
    cont.innerHTML = sections.filter(Boolean).join('');
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
    $('buy-modal').classList.add('open');
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
    $('buy-modal').classList.remove('open');
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
