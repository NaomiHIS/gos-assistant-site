(function () {
  'use strict';

  // If already logged in, replace login button with link to cabinet/admin
  const user = window.GosClient.getUser();
  if (user) {
    const targetHref = user.role === 'admin' ? '/admin.html' : '/cabinet.html';
    const targetText = user.role === 'admin' ? 'Админ-панель' : 'Личный кабинет';
    document.querySelectorAll('a[href="/login.html"]').forEach((a) => {
      a.textContent = targetText;
      a.href = targetHref;
    });
    document.querySelectorAll('a[href="/login.html?mode=register"]').forEach((a) => {
      a.textContent = targetText;
      a.href = targetHref;
    });
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
