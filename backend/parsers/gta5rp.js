// ============================================================
// Parser for GTA 5 RP project.
//
// Автосинхронизация из внешнего репозитория для GTA 5 RP пока не реализована
// (нет открытого источника типа alamantik/majestic-laws-db). Импорт законов
// делается вручную через универсальный JSON-импортёр:
//   POST /api/parser/json/preview-server { serverId, json }
//   POST /api/parser/json/import-server  { serverId, json, mode }
// который работает с любым сервером (см. routes/parser.js).
//
// Формат JSON описан в database/gta5rp-sample.json.
// ============================================================

const AUTOSYNC_UNAVAILABLE = new Error(
  'Автосинхронизация GTA 5 RP пока не настроена. Используйте JSON-импорт для конкретного сервера.'
);
AUTOSYNC_UNAVAILABLE.code = 'AUTOSYNC_UNAVAILABLE';

async function getStructure() { throw AUTOSYNC_UNAVAILABLE; }
async function getSyncStatus() { throw AUTOSYNC_UNAVAILABLE; }
async function importServer() { throw AUTOSYNC_UNAVAILABLE; }
async function importRules() { throw AUTOSYNC_UNAVAILABLE; }
async function importAll() { throw AUTOSYNC_UNAVAILABLE; }

module.exports = {
  name: 'gta5rp',
  configured: false,       // авто-парсер не настроен
  supportsJsonImport: true, // JSON-импорт работает через /api/parser/json/*
  getStructure,
  getSyncStatus,
  importServer,
  importRules,
  importAll,
};
