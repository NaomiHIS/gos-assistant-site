// ============================================================
// Parser for GTA 5 RP project — STUB.
//
// Реализация ждёт исходного репозитория с данными законов (по аналогии
// с alamantik/majestic-laws-db для Majestic). Как только источник появится
// — заменить NOT_CONFIGURED_ERROR на реальные fetch/import.
//
// Ожидаемый интерфейс (см. lawsdb.js):
//   getStructure()           → { servers: [...], files: [...] }
//   getSyncStatus()          → { updates: [], upToDate: N }
//   importServer(file, mode) → { imported, updated, skipped }
//   importRules(target, mode)→ { imported, updated }
//   importAll(mode)          → { totalServers, totalArticles }
//
// В админке при выборе проекта GTA 5 RP кнопки импорта покажут этот текст.
// ============================================================

const NOT_CONFIGURED = new Error(
  'Источник данных для GTA 5 RP не настроен. Обратитесь к администратору.'
);
NOT_CONFIGURED.code = 'PARSER_NOT_CONFIGURED';

async function getStructure() { throw NOT_CONFIGURED; }
async function getSyncStatus() { throw NOT_CONFIGURED; }
async function importServer() { throw NOT_CONFIGURED; }
async function importRules() { throw NOT_CONFIGURED; }
async function importAll() { throw NOT_CONFIGURED; }

module.exports = {
  name: 'gta5rp',
  configured: false,
  getStructure,
  getSyncStatus,
  importServer,
  importRules,
  importAll,
};
