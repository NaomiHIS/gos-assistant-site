// ============================================================
// Реестр платёжных провайдеров.
// Чтобы добавить нового — положи модуль рядом и зарегистрируй здесь.
// ============================================================
const yookassa = require('./yookassa');
const manual = require('./manual');

const adapters = new Map();
function register(adapter) {
  adapters.set(adapter.slug, adapter);
}
register(yookassa);
register(manual);

function get(slug) {
  return adapters.get(slug) || null;
}

function list() {
  return Array.from(adapters.values()).map((a) => ({
    slug: a.slug,
    isOnline: !!a.isOnline,
  }));
}

module.exports = { get, list, register };
