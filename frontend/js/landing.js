(function () {
  'use strict';

  // If already logged in, replace login button with link to dashboard / app
  const user = window.GosClient.getUser();
  if (user) {
    document.querySelectorAll('a[href="/login.html"]').forEach((a) => {
      a.textContent = user.role === 'admin' ? 'Админ-панель' : 'Личный кабинет';
      a.href = user.role === 'admin' ? '/admin.html' : '/login.html';
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
