# GOS Assistant — Проектная документация

> **Контекст для нового чата:** Этот документ описывает два связанных проекта — десктопное Electron-приложение и веб-сайт с REST API. Они работают вместе.

---

## 📁 Расположение проектов

| Проект | Путь | Что это |
|--------|------|---------|
| **Электронное приложение** | `D:\MVD Assistant\` | Десктопный оверлей-справочник для RP-серверов GTA 5 |
| **Сайт + API** | `D:\Site GOS\` | Лендинг, личный кабинет, админ-панель, REST API, MySQL |

Также есть исходный проект-референс: `C:\Users\pivno\OneDrive\Desktop\codex-app-main\` — оригинальный Codex Assistant, на основе которого строился GOS.

---

## 🎯 Что это за приложение

**GOS Assistant** — оверлейный справочник для игроков на RP-серверах **Majestic RP** (GTA 5). Помогает быстро искать законы, правила и кодексы прямо во время игры через горячую клавишу `Ctrl+Shift+K`.

**Возможности приложения:**
- Поиск по законам/правилам сервера Majestic RP (категории через выпадающий список с группами и фильтром)
- Просмотр **только закреплённого сервера** для бесплатных юзеров; с подпиской Lite/Premium (`multi_server`) — любые. В dropdown недоступные сервера помечены 🔒
- Окно поверх игры с регулируемой прозрачностью
- Личные заметки с горячей клавишей `Ctrl+Shift+N` (прозрачность, закрепление, размер)
- **Лимит 2 заметки без подписки.** С `notes_unlimited` (Lite/Premium) — без ограничений
- **Share by code** — заметки имеют уникальный код, можно поделиться, другой пользователь импортирует одной кнопкой. Снимок обновляется автоматически после каждого изменения. Импорт уважает локальный лимит у получателя
- Авто-обновление через сайт + **модалка** «Доступно обновление» при старте старой версии
- Авторизация через email/пароль или Discord
- Тёмная/светлая темы
- **Поддержка** — тикеты (Вопрос/Идея/Баг), переписка с админом, live-обновление
- **Поддержать проект** — карточки с донат-ссылками (синхронизированы с сайтом)
- **AI-ассистент** (Premium, `ai_assistant`) — чат с GPT-моделью для квалификации действий игроков с разных ролей (адвокат / прокурор / сотрудник ПД / судья / гражданский), с RAG-инъекцией реальных статей и пост-валидацией ссылок
- **Блокирующее окно «Тех. работы»** для обычных юзеров когда админ включил режим
- **Бейдж подписки** на главной с фичами и сроком; helper `window.GosSubscription.hasFeature(key)` для гейта функций
- Полное закрытие процесса по X (нет висящих в Task Manager)

**Возможности сайта:**
- Лендинг с описанием, скачиванием и секцией доната
- **Регистрация требует выбора сервера** (закрепляется за пользователем; смена — только с `multi_server`)
- Согласие с Условиями использования и Политикой конфиденциальности
- **Тарифы (`/pricing.html`)** — публичная страница с карточками Lite/Premium, ценами, фичами, модалкой покупки и выбором способа оплаты
- **Контакты (`/contacts.html`)** — карточка владельца с соцсетями и произвольными ссылками
- Личный кабинет (Профиль с карточкой подписки, Безопасность, Скачивание, Данные, Поддержка)
- Админ-панель: Дашборд, Серверы, Категории, Статьи, Пользователи, Парсер, Релизы, Донат, DevLog, **Тех. работы**, **Поддержка**, **Подписки**, **Платежи**, **Контакты**
- DevLog для пользователей
- Страницы Terms / Privacy

---

## 🛠 Технологический стек

### Сайт (`D:\Site GOS`)
- **Node.js 20+** (Express)
- **MySQL** (через `mysql2/promise`)
- **JWT** для авторизации (bcryptjs для паролей)
- **multer** для загрузки релизов
- **cheerio** + **node-fetch** для парсера законов
- **express-rate-limit** на auth-эндпойнтах
- **Frontend:** чистый HTML/CSS/JS без фреймворков (vanilla)

### Приложение (`D:\MVD Assistant`)
- **Electron 28.3.3**
- **electron-builder** для сборки (NSIS installer + portable)
- **electron-updater** для авто-обновления (provider: `generic`)
- **node-fetch 2.x** для HTTP к API
- **png-to-ico** для генерации иконки (predist hook)
- **Frontend:** vanilla JS + CSS variables для тем

---

## 🏗 Архитектура

### Сайт
```
D:\Site GOS\
├── backend/
│   ├── server.js          # Express, маршруты
│   ├── db.js              # MySQL pool, поддержка Railway MYSQL_URL
│   ├── init-db.js         # Авто-применение schema + seed при первом запуске
│   ├── middleware/
│   │   └── auth.js        # JWT verify, requireAuth, requireRole
│   ├── routes/
│   │   ├── auth.js          # Login, register, Discord OAuth, profile, password
│   │   ├── servers.js       # CRUD серверов
│   │   ├── categories.js    # CRUD категорий
│   │   ├── articles.js      # CRUD + поиск статей
│   │   ├── users.js         # Список пользователей, смена роли (отдаёт МАССИВ напрямую)
│   │   ├── parser.js        # Парсер URL + импорт alamantik + JSON-импорт для одного сервера
│   │   ├── releases.js      # Релизы приложения (с SHA-512 для авто-обновления)
│   │   ├── donate.js        # Ссылки на пожертвования
│   │   ├── devlog.js        # Журнал изменений
│   │   ├── maintenance.js   # Single-row флаг тех. работ (upsert через INSERT...ON DUPLICATE KEY)
│   │   ├── support.js       # Тикеты + сообщения + unread-counts
│   │   ├── subscriptions.js # Планы (с ценами и duration), выдача, фичи, grantSubscription helper
│   │   ├── ai.js            # AI-ассистент (proxy → GPT API, gating ai_assistant, RAG, post-validation)
│   │   ├── payments.js      # Платежи: create, webhook, providers CRUD, история
│   │   ├── contacts.js      # Контакты владельца (single-row): GET public, PUT admin
│   │   └── notes.js         # Share-by-code: snapshot/code/lookup
│   ├── providers/
│   │   └── payments/
│   │       ├── index.js     # Реестр адаптеров
│   │       ├── yookassa.js  # YooKassa adapter (онлайн-оплата)
│   │       └── manual.js    # Ручная выдача — админ помечает payment succeeded
│   └── parsers/
│       ├── index.js       # Оркестратор
│       ├── generic.js     # Универсальный HTML/text парсер
│       ├── majestic.js    # Парсер для forum.majestic-rp.ru (упирается в DDoS-Guard)
│       ├── codexdb.js     # Адаптер для старой кодекс-БД kirikch72
│       └── lawsdb.js      # Адаптер для alamantik/majestic-laws-db (основной)
├── frontend/
│   ├── index.html         # Лендинг
│   ├── login.html         # Вход/регистрация
│   ├── cabinet.html       # Личный кабинет (профиль, безопасность, скачивание, данные)
│   ├── admin.html         # Админ-панель
│   ├── devlog.html        # Публичный DevLog
│   ├── pricing.html       # Тарифы (Lite/Premium) с модалкой покупки
│   ├── contacts.html      # Контакты владельца
│   ├── terms.html         # Условия использования
│   ├── privacy.html       # Политика конфиденциальности
│   ├── css/styles.css     # Общие стили
│   └── js/
│       ├── api.js         # HTTP-клиент → window.GosClient
│       ├── landing.js
│       ├── auth.js        # Login/register c обязательным выбором сервера
│       ├── cabinet.js
│       ├── admin.js
│       ├── devlog.js
│       ├── pricing.js     # Загрузка тарифов, модалка покупки, выбор провайдера
│       └── contacts.js    # Публичная страница контактов
├── database/
│   ├── schema.sql         # Структура БД
│   └── seed.sql           # Начальные данные
├── package.json           # name: gos-assistant-site, start: node backend/server.js
├── package-lock.json
├── .nvmrc                 # node 20
├── .env                   # Локальные переменные (gitignored)
├── .gitignore
├── README.md
├── DEPLOY.md
└── PROJECT.md             # ← этот файл
```

### Приложение
```
D:\MVD Assistant\
├── main.js                # Electron main процесс — окна, IPC, hotkeys, auto-updater
├── preload.js             # window.GosAPI — безопасный мост к main
├── api-client.js          # HTTP-клиент с DEFAULT_API_URL (захардкожен production-URL)
├── package.json           # name: gos-assistant, version: 1.0.6
├── electron-builder.yml   # Сборка с publish: generic
├── .env                   # Локальный, в .gitignore
├── scripts/
│   └── make-icon.js       # PNG → ICO для NSIS (до 256x256)
├── assets/
│   ├── Icon/icon.png      # 1024x1024
│   ├── Icon/icon.ico      # Авто-генерируется prebuild/predist
│   └── sounds/            # Звуковые эффекты (.ogg)
└── src/
    ├── auth.html          # Окно входа (без регистрации — только вход)
    ├── index.html         # Главное окно (sidebar + tabs)
    ├── search.html        # Оверлей поиска (frameless, always-on-top)
    ├── notes.html         # Окно заметок (resizable, прозрачное по желанию)
    ├── css/styles.css
    ├── js/
    │   ├── auth-window.js
    │   ├── main-window.js
    │   ├── search-window.js
    │   └── notes-window.js
    └── mock/              # Fallback данные если API недоступен
        ├── servers.json
        ├── categories.json
        └── articles.json
```

---

## 🌐 Production URLs

- **Сайт:** `https://gosassistent.su`
- **API:** `https://gosassistent.su/api`
- **Хостинг:** Railway (MySQL подключён через MYSQL_URL Reference)
- **Источник законов:** `https://github.com/alamantik/majestic-laws-db`

---

## 🗃 База данных (MySQL)

Схема в `database/schema.sql`. Основные таблицы:

| Таблица | Что хранит |
|---------|-----------|
| `users` | id, email, username, password_hash, discord_id, avatar_url, role (user/admin/moderator), terms_accepted_at, terms_version, **locked_server_id (закреплённый сервер — без multi_server виден только он)**, created_at, last_login |
| `servers` | id (slug), name, color, icon, sort_order, is_active |
| `categories` | id (slug), name, short_name, color, type (laws/rules/other), sort_order, is_active |
| `articles` | id, server_id, category_id, code, title, text, penalty, wanted_stars, sort_order |
| `sessions` | Заготовка под JWT-сессии (пока не используется активно) |
| `releases` | type (installer/portable), version, filename, original_name, size, **sha512**, notes, is_active, download_count |
| `donate_links` | title, url, description, icon (эмодзи), color, sort_order, is_active, click_count |
| `devlog_entries` | version, title, content, tag (feature/fix/news/major), is_published, published_at |
| `sync_state` | source, resource, source_updated_at, articles_count — для отслеживания обновлений из alamantik |
| `maintenance` | Single-row (id=1): enabled, message, starts_at, ends_at, updated_by — режим тех. работ |
| `support_tickets` | id, user_id, type (question/suggestion/bug), subject, status (open/in_progress/answered/closed), source (site/app), app_version, unread_for_user, unread_for_admin |
| `support_messages` | id, ticket_id, author_id, is_admin, body, created_at |
| `subscription_plans` | id, slug, name, description, color, **features (JSON)**, **price_cents, currency, duration_days, is_purchasable**, sort_order, is_active |
| `user_subscriptions` | id, user_id, plan_id, starts_at, expires_at, is_active, granted_by, revoked_at, notes |
| `payment_providers` | id, slug (yookassa/manual/...), name, description, **config (JSON c shop_id/secret_key/...)**, is_enabled, sort_order |
| `payments` | id, user_id, plan_id, provider_slug, amount_cents, currency, status (pending/succeeded/canceled/failed/refunded), external_id, confirmation_url, metadata, granted_subscription_id, paid_at |
| `site_contacts` | Single-row (id=1): owner_name, owner_role, about, avatar_url, email, telegram, discord, vk, github, website, **custom_links (JSON)**, updated_by, updated_at |
| `note_shares` | user_id (PK), **code (UNIQUE 8 chars)**, snapshot (JSON массив заметок), notes_count, updated_at — для share-by-code |

**Важно:** есть авто-инициализация в `init-db.js` — при первом запуске сервера создаёт таблицы и заливает seed.
**Также `init-db.js` запускает миграции на каждом старте** (через `runMigrations()` + хелпер `ensureColumn`) — туда добавляются `CREATE TABLE IF NOT EXISTS` и `ALTER ADD COLUMN IF NOT EXISTS` для новых полей, чтобы апгрейд работал без ручного SQL. Сейчас миграция создаёт: `maintenance`, `support_tickets`, `support_messages`, `subscription_plans` (+ ALTER для price_cents/currency/duration_days/is_purchasable), `user_subscriptions`, `payment_providers`, `payments`, `site_contacts`, `note_shares`, и ALTER `users` добавляет `locked_server_id`. Сидятся: план `lite` (149₽/30д), `premium` (299₽/30д), провайдеры `yookassa` (выкл) и `manual` (вкл).

**Известная особенность Railway → MySQL → Query:** UI выполняет только ОДИН statement за раз и автоматически дописывает `LIMIT 100` к SELECT — запрос с `;` или своим `LIMIT` ломается. Если применяешь миграции вручную — разбивай на несколько запросов и не ставь `;` в конце SELECT.

---

## 🔌 REST API эндпойнты

База: `/api`

### Auth (`/auth`) — rate-limit 20 req / 15 min
- `POST /register` — `{ email, username, password, acceptTerms, serverId }` — **serverId обязателен** (закрепляется как locked_server_id)
- `POST /login` — `{ email, password }` → JWT + user
- `GET /me` — текущий пользователь (требует JWT) — возвращает `lockedServerId`
- `PUT /me` — обновить username
- `PUT /locked-server` — `{ serverId }` сменить закреплённый сервер. Если у юзера уже есть и он другой → требует фичу `multi_server`, иначе 403 `MULTI_SERVER_REQUIRED`
- `POST /change-password` — `{ currentPassword, newPassword }`
- `POST /logout` / `POST /logout-all`
- `GET /discord?app_callback=...` — старт Discord OAuth (опционально с callback на 127.0.0.1)
- `GET /discord/callback` — обработка ответа от Discord (login + link + app flow)
- `POST /discord/link-url` — URL для привязки Discord к текущему юзеру
- `POST /discord/unlink` — отвязать Discord
- `GET /discord/status` — публичная диагностика конфигурации

### Servers / Categories / Articles
- Стандартные CRUD: `GET /`, `GET /all` (admin), `POST`, `PUT /:id`, `DELETE /:id`
- `GET /articles?serverId=X&categoryId=Y` — **серверный гейт**: если у юзера есть Bearer-токен, нет `multi_server` и есть `locked_server_id` → бэк ПРИНУДИТЕЛЬНО подменяет `serverId` на `locked_server_id` (через `optionalAuth` + `effectiveLockedServer()` из `middleware/auth.js`). Чужие сервера невидимы.
- `GET /articles/search?q=...` — то же поведение.

### Users (admin)
- `GET /users` — отдаёт **массив пользователей напрямую** (не `{users: [...]}`)
- `PUT /users/:id/role` — `{ role: 'user' | 'admin' | 'moderator' }`
- `DELETE /users/:id`

### Parser (admin)
- `POST /parser/preview` — `{ url }` или `{ rawText }` → массив статей
- `POST /parser/import` — `{ serverId, categoryId, articles, mode }` ручной импорт
- `GET /parser/lawsdb/structure` — список серверов и файлов alamantik
- `GET /parser/lawsdb/sync-status` — diff локальных и удалённых данных
- `POST /parser/lawsdb/import-server` — `{ file, mode }` импорт одного сервера
- `POST /parser/lawsdb/import-rules` — `{ targetServerId?, mode }` — если targetServerId опущен → импорт во ВСЕ серверы
- `POST /parser/lawsdb/import-all` — `{ mode, includeRules }` — массовый импорт 19 серверов + правил для каждого
- `POST /parser/json/preview-server` — `{ serverId, json }` — предпросмотр статей из JSON (формат alamantik `{data: {UK, AK, ...}}` или плоский массив)
- `POST /parser/json/import-server` — `{ serverId, json, mode }` — импорт законов одного сервера из произвольного JSON

### Maintenance
- `GET /maintenance` — публично, текущий статус (`{ active, enabled, message, endsAt, ... }`)
- `PUT /maintenance` (admin) — `{ enabled, message?, endsAt? }`, **upsert** (INSERT...ON DUPLICATE KEY UPDATE) чтобы работало даже если строки нет

### Support
- `POST /support/tickets` (auth) — `{ type, subject, body, source?, appVersion? }`
- `GET /support/tickets/mine` — свои тикеты
- `GET /support/tickets/all` (admin) — фильтры `status`/`type`/`search`/`unread=1`
- `GET /support/tickets/:id` — тикет с сообщениями (admin видит любой, user — только свой). Auto-mark-read для своей стороны.
- `POST /support/tickets/:id/messages` — ответ
- `PUT /support/tickets/:id/status` (admin) — изменить статус
- `GET /support/unread-count` — счётчик непрочитанного (для бейджей)

### Subscriptions
- `GET /subscriptions/features` (auth) — справочник известных ключей-фич с лейблами
- `GET /subscriptions/me` — активная подписка пользователя
- `GET /subscriptions/plans` — список планов (admin видит все включая выключенные)
- `POST /subscriptions/plans` (admin) — `{ slug, name, description?, color?, features?: [], sortOrder?, isActive? }`
- `PUT /subscriptions/plans/:id` (admin)
- `DELETE /subscriptions/plans/:id` (admin) — нельзя удалить план с активными выдачами
- `GET /subscriptions/grants` (admin) — фильтры `active`/`userId`/`search`
- `POST /subscriptions/grants` (admin) — `{ userId, planId, durationDays: 7|14|30 | expiresAt, notes? }`; при выдаче старые активные подписки юзера автоматически отзываются
- `POST /subscriptions/grants/:id/extend` (admin) — `{ days: 7|14|30 }` от максимума(now, текущей даты)
- `PUT /subscriptions/grants/:id` (admin) — `{ isActive?, expiresAt?, notes? }`
- `DELETE /subscriptions/grants/:id` (admin) — soft revoke (is_active=0)

### AI Assistant
- `GET /ai/status` (auth) — `{ enabled, configured, model, roles, limitsPerHour }`. `enabled=true` если у юзера активная подписка с фичей `ai_assistant`.
- `POST /ai/chat` (auth + feature `ai_assistant` + rate-limit) — `{ messages: [{role,content}], persona?: 'lawyer'|'prosecutor'|'cop'|'judge'|'civilian', serverId?: string }` → `{ reply, model, usage, persona, serverId, serverName }`. История диалога не хранится на сервере — клиент шлёт последние сообщения каждый раз. Если передан `serverId`, бэк подтягивает название сервера + список активных категорий с количеством статей и кладёт их в system-prompt, чтобы AI опирался именно на законы этого сервера.

### Payments
- `GET /subscriptions/plans/public` — публично, без auth: тарифы с ценой/сроком для страницы /pricing.html
- `GET /payments/providers` (auth) — включённые способы оплаты
- `POST /payments/create` (auth) — `{ planId, providerSlug, returnUrl? }` → создаёт pending платёж, зовёт адаптер провайдера, возвращает `{ payment: { id, status, confirmationUrl, ... } }`
- `GET /payments/mine` (auth) — история своих платежей
- `POST /payments/webhook/:slug` — без auth, провайдер сам валидирует (для YooKassa — IP whitelist)
- Admin: `GET /payments/all` (фильтры status/providerSlug/search), `PUT /payments/:id/mark` (вручную подтвердить/отменить), `GET/POST/PUT/DELETE /payments/providers[/:id]`

### Releases
- `GET /releases/latest` — публично, последний installer + portable
- `GET /releases/download/:id` — требует JWT, отдаёт файл
- `GET /releases` / `POST /releases/upload` / `PUT /releases/:id` / `DELETE /releases/:id` — admin
- `GET /releases/feed/latest.yml` — для electron-updater (требует JWT)
- `GET /releases/feed/:filename` — для electron-updater

### Devlog / Donate / Misc
- `GET /devlog` — публично, опубликованные
- `GET /devlog/all`, `POST`, `PUT /:id`, `DELETE /:id` — admin
- `GET /donate` — публично (используется и сайтом, и приложением)
- `POST /donate/:id/click` — счётчик кликов
- `GET /health` — диагностика подключения и таблиц

### Contacts
- `GET /contacts` — публично, отдаёт `{ ownerName, ownerRole, about, avatarUrl, email, telegram, discord, vk, github, website, customLinks: [{label, url, icon}], updatedAt }`
- `PUT /contacts` (admin) — upsert single-row через `INSERT ... ON DUPLICATE KEY UPDATE`

### Notes share (заметки приложения)
- `GET /notes/share` (auth) — лениво создаёт snapshot-запись + 8-символьный код. Возвращает `{ code, notesCount, updatedAt }`
- `PUT /notes/share/snapshot` (auth) — `{ notes: [{id, title, content, createdAt, updatedAt}] }` сохраняет снимок (валидирует, обрезает до 1000 шт.). Приложение вызывает после каждого изменения (debounced 1.5с)
- `POST /notes/share/regenerate` (auth) — новый код, старый перестаёт работать
- `GET /notes/share/lookup/:code` (auth) — получить снимок другого юзера. Возвращает `{ ownerName, notes, notesCount }`. Свой код → 400

---

## 🔐 Авторизация

### Email + пароль
- Регистрация **только через сайт**. В приложении регистрация удалена — кнопка ведёт на `site/login.html?mode=register` в браузере
- Пароль: bcrypt 10 раундов
- JWT действует 30 дней (настраивается через `JWT_EXPIRES_IN`)

### Discord OAuth
- **Login на сайте**: обычный redirect flow → `/api/auth/discord` → Discord → `/api/auth/discord/callback?code=X&state=login:NONCE`
- **Link Discord** к существующему аккаунту: `POST /auth/discord/link-url` возвращает URL с подписанным state `link:USER_ID:HMAC`
- **Login в Electron-приложении**: 
  - Приложение поднимает локальный HTTP-сервер на 127.0.0.1 с random портом
  - Передаёт `app_callback=http://127.0.0.1:PORT/?state=NONCE` в OAuth URL
  - Backend подписывает callback HMAC-ом, в callback вернётся `state=app:base64(url):HMAC`
  - После Discord-авторизации backend редиректит на локальный сервер с JWT, сервер закрывается, приложение залогинено

### Discord credentials (Railway Variables)
```
DISCORD_CLIENT_ID=1375443563890085959
DISCORD_CLIENT_SECRET=<secret>
DISCORD_REDIRECT_URI=https://gosassistent.su/api/auth/discord/callback
```

**Важно:** переменные должны быть обычными Variables, **не Build Secrets** (иначе билд падает с "secret X not found").

В **Discord Developer Portal → OAuth2 → Redirects** должен быть точно тот же URI.

### Согласие с Условиями
- При регистрации обязательный чекбокс с ссылками на `/terms.html` и `/privacy.html`
- Backend проверяет `acceptTerms === true` иначе 400
- Сохраняется `users.terms_accepted_at` и `users.terms_version` (текущая `'1.0'`)

---

## 🔄 Auto-update

**Как работает:**
1. Приложение собрано с `electron-builder.yml` где `publish: { provider: generic, url: <Railway-URL>/api/releases/feed }`
2. Файл `resources/app-update.yml` встраивается в установщик
3. После старта (через 10 сек) и каждые 4 часа: `autoUpdater.checkForUpdates()`
4. Запрос идёт на `GET /api/releases/feed/latest.yml` с `Authorization: Bearer <JWT>`
5. Backend генерирует YAML с актуальной версией и SHA-512 из БД
6. Если новая версия → скачивание `.exe` с `GET /api/releases/feed/<filename>` (тоже с JWT)
7. electron-updater проверяет SHA-512 → пишет файл → UI показывает «Установить и перезапустить»
8. `autoUpdater.quitAndInstall()` — приложение закрывается, ставится новая версия

**На стороне админа:**
- В админке → Релизы → загружает `.exe` файл
- Backend считает SHA-512 при загрузке (stream-based, не грузит память)
- При активации тогглом → файл становится «latest» в манифесте

---

## ⚙️ Переменные окружения

### Сайт (Railway Variables)
| Переменная | Значение |
|-----------|----------|
| `MYSQL_URL` или `DATABASE_URL` | Reference на MySQL-сервис (автоматически) |
| `JWT_SECRET` | Длинная случайная строка |
| `JWT_EXPIRES_IN` | `30d` |
| `DISCORD_CLIENT_ID` | `1375443563890085959` |
| `DISCORD_CLIENT_SECRET` | Secret из Discord Developer Portal |
| `DISCORD_REDIRECT_URI` | `https://gosassistent.su/api/auth/discord/callback` |
| `CORS_ORIGIN` | `*` |
| `NODE_ENV` | `production` |
| `UPLOADS_DIR` | `/app/uploads` (если подключён Volume) |
| `AI_API_KEY` | Ключ AI-провайдера (`sk-or-vv-...` для vsegpt.ru). Без него `/api/ai/chat` вернёт 503 |
| `AI_API_BASE_URL` | База OpenAI-совместимого API. Дефолт `https://api.vsegpt.ru/v1` |
| `AI_MODEL` | Имя модели, по умолчанию `google/gemini-3.1-flash-lite` |
| `AI_MAX_TOKENS` | Лимит ответа, по умолчанию 800 |
| `AI_TEMPERATURE` | По умолчанию 0.4 |
| `AI_RATE_LIMIT_PER_HOUR` | Лимит запросов на юзера в час (по user.id), дефолт 60 |

**Локально**: те же переменные в `D:\Site GOS\backend\.env` (gitignored). Файл `db.js` загружает env через `dotenv.config({ path: path.join(__dirname, '.env') })`.

### Приложение
- `D:\MVD Assistant\.env` — опционально для dev (`API_URL=http://localhost:3000/api`)
- В production API URL зашит в `api-client.js`: `DEFAULT_API_URL = 'https://gosassistent.su/api'`

---

## 📦 Деплой

### Сайт
```bash
cd "D:\Site GOS"
git add -A
git commit -m "..."
git push                  # Railway автодеплоит при push в main
```

### Приложение
```powershell
cd "D:\MVD Assistant"
# 1. Бамп версии в package.json
# 2. Очистить старую сборку
Remove-Item -Recurse -Force release -ErrorAction SilentlyContinue
# 3. Собрать (predist автоматически сгенерит icon.ico)
npm run dist
# 4. Загрузить release/*.exe в админку сайта → Релизы (installer + portable)
# 5. Пользователи получат обновление автоматически через ~4 часа
```

**Текущая версия приложения: 1.0.6** (бампать перед каждой сборкой)

После добавления share-by-code / лимита заметок / AI / закрепления сервера — бампнуть до 1.0.7 минимум перед следующим релизом.

### Volume для релизов (Railway)
Файлы `.exe` хранятся на файловой системе app-сервиса. Без Volume они **пропадают при каждом редеплое**. Подключи Volume в Railway → app-сервис → Volumes → New Volume:
- **Mount path:** `/app/uploads`
- **Size:** 1 GB
- Затем добавь Variable `UPLOADS_DIR=/app/uploads` и сделай редеплой.

**Не путать с MySQL-диском** — у MySQL свой отдельный Volume, и переполнение MySQL-диска не лечится Volume для app. Если MySQL переполняется (FULLTEXT-индекс от ~24k статей + индексы) — увеличивай Disk на **MySQL-сервисе** или дропни неиспользуемый FULLTEXT: `ALTER TABLE articles DROP INDEX idx_fulltext`.

---

## 🪟 Окна приложения

| Окно | Размер | Свойства | Назначение |
|------|--------|----------|-----------|
| `auth` | 450×550 | frameless, transparent | Вход (только email/пароль + Discord). Регистрация удалена — ссылка ведёт на сайт |
| `main` | 900×580 | frameless, transparent | Sidebar + табы: Главная (карточка подписки), **AI Ассистент (бейдж PRO)**, Настройки, О программе. Sidebar-айтемы: Заметки, Поддержка (с бейджем непрочитанных), Поддержать (донат — скрыт если ссылок нет). **Server-dropdown** показывает 🔒 на серверах, недоступных без `multi_server` |
| `search` | 900×600 | frameless, transparent, **always-on-top**, resizable: false | Поиск законов и правил. Категории через **dropdown с группами и фильтром** (Кодексы / Правила / Прочее), пустые скрыты, цветные бейджи сокращений. Бэк сам прижимает серверный фильтр к закреплённому |
| `notes` | 460×560 | frameless, transparent, **resizable**, always-on-top (опц.) | Заметки. Прозрачность 0-80% слайдером. **Лимит 2 без подписки** — баннер сверху, тост на превышение. Иконки titlebar: булавка, **share (мой код)**, **import (по коду)**, новая заметка, скрыть |

**Корректное закрытие:** при клике X на главном окне срабатывает `mainWindow.on('close')` → `destroyAllWindows(mainWindow)` → `window-all-closed` → `app.quit()`. Все таймеры (poll updates / maintenance / subscription) обёрнуты в `trackedSetInterval`/`trackedSetTimeout` и очищаются в `before-quit`. `globalShortcut.unregisterAll()` тоже там. Это критично — иначе скрытые `searchWindow`/`notesWindow` (`skipTaskbar: true`) держали процесс в Task Manager.

**Maintenance overlay:** при `maintenanceState.locked === true` (active И юзер НЕ admin/moderator) во всех окнах показывается блокирующий `.maintenance-overlay` с обратным отсчётом до `endsAt`. Auto-hide поиска отключается. Опрос статуса каждые 60с через `scheduleMaintenancePolling`.

**Update modal:** при `update-available` событии от electron-updater в главном окне показывается модалка с версиями `vX → vY`, прогресс-баром скачивания и кнопкой «Установить и перезапустить» по завершении. Состояние последнего события кэшируется в `lastUpdateEvent`, чтобы окно открытое позже не пропустило сигнал.

**Горячие клавиши** (через `globalShortcut`):
- `Ctrl+Shift+K` — поиск (настраиваемая)
- `Ctrl+Shift+N` — заметки (настраиваемая)
- Проверка конфликтов между ними

**Хранилище:**
- Настройки: `app.getPath('userData')/config.json`
- Заметки: `app.getPath('userData')/notes.json` (локально). **Снимок** заметок периодически пушится на сервер в `note_shares.snapshot` для share-by-code (через debounced `scheduleNotesSync` 1.5с после изменения)
- Логи: `app.getPath('userData')/logs/`

---

## 🌍 Сайт — структура страниц

| URL | Описание |
|-----|----------|
| `/` | Лендинг с фичами, скачиванием, донатами, ссылками на DevLog |
| `/login.html` | Вход + регистрация (`?mode=register`). **При регистрации обязательный селектор сервера** — закрепляется как `users.locked_server_id` |
| `/pricing.html` | Публичная страница тарифов. Карточки планов (Lite/Premium) с ценой/сроком/фичами. Модалка «Купить» с выбором провайдера оплаты |
| `/contacts.html` | Контакты владельца — карточка с аватаром, соцсетями, кастомными ссылками |
| `/cabinet.html` | Личный кабинет — вкладки: **Профиль (с карточкой подписки сверху)**, Безопасность (включая привязку Discord), Приложение (скачивание), Данные (серверы, поиск), **Поддержка (с бейджем непрочитанных)** |
| `/admin.html` | Админ-панель (требует role: admin). Вкладки: Дашборд, Серверы, Категории, Статьи, Пользователи, Парсер, Релизы, Донат, DevLog, **Тех. работы**, **Поддержка (с бейджем)**, **Подписки**, **Платежи**, **Контакты** |
| `/devlog.html` | Публичный журнал изменений |
| `/terms.html` | Условия использования |
| `/privacy.html` | Политика конфиденциальности |

**Видимость через `data-auth`:**
- `data-auth="guest"` — для незалогиненных
- `data-auth="user"` — для залогиненных
- `data-auth="admin"` — только админам

---

## 📜 Парсер законов

### Источник
`https://github.com/alamantik/majestic-laws-db` — 19 серверов × ~9500 статей + 790 правил в 21 категории. Базовый URL: `https://raw.githubusercontent.com/alamantik/majestic-laws-db/main`.

### Структура файлов
- `repo_structure.json` — индекс
- `laws/<server>-<N>.json` — `{ updatedAt, data: { UK, AK, DK, PK, UAK } }`. UAK → маппится в `uk`
- `rules/general.json` — секции: `main-rules`, `game-zones`, `faction-leaders`, `forum-rules`, `cheat-check`, `admin-rules`
- `rules/events.json` — `workshops-dealers`, `supply-hijack`, `fort-zancudo`, `cayo-perico`, `material-war`
- `rules/organizations.json` — 10 секций (criminal, state, raids и т.д.)

### Что делает парсер
- **`backend/parsers/lawsdb.js`**: загружает JSON, нормализует имена серверов (`las vegas-9.json` → id `las-vegas-9`, name `Las Vegas`), маппит секции в наши категории, есть **fallback** `getRuleCategory()` для неизвестных секций
- **`backend/parsers/generic.js`**: универсальный — извлекает `Статья N.N`, разделяет части `ч.1 / ч.2` в отдельные статьи (через `splitInlineParts`), пропускает `Глава X` / `Раздел X`, удаляет пустых родителей частей через `removeEmptyParents`
- **`backend/parsers/majestic.js`**: для прямых URL — но **не работает** из-за DDoS-Guard на форуме (требует JS), возвращает понятную ошибку

### Импорт всех данных
В админке → Парсер → блок «Majestic-Laws-DB» → «Импортировать ВСЁ (19 серверов + правила)» → ~60 секунд → ~24 000 статей в БД.

**Правила импортируются для ВСЕХ серверов** — они общие. Объект rules с GitHub качается раз, потом INSERT для каждого сервера.

---

## 🚧 Тех. работы (maintenance mode)

**Бэкенд:** [`backend/routes/maintenance.js`](backend/routes/maintenance.js) + таблица `maintenance` (single-row, id=1).
- `GET /api/maintenance` — публично, возвращает `{active, enabled, message, endsAt, startsAt, expired}`. `active = enabled && !expired` (ends_at в прошлом → автоматически inactive).
- `PUT /api/maintenance` (admin) — `{enabled, message?, endsAt?}`. **Использует INSERT...ON DUPLICATE KEY UPDATE** на случай отсутствия seed-строки.

**Админка:** вкладка «Тех. работы» — чекбокс enabled, textarea сообщения, `<input type="datetime-local">` для endsAt, кнопки быстрой длительности (15м / 30м / 1ч / 2ч / 4ч / 1 сутки), pill-индикатор статуса, точка в навигации когда активно. Опрос каждые 60с для актуализации.

**Приложение:** [`main.js`](../MVD Assistant/main.js) — `scheduleMaintenancePolling()` опрашивает `/api/maintenance` каждые 60с, кэширует, broadcast`maintenance:changed` во все окна. Renderer ([`main-window.js`](../MVD Assistant/src/js/main-window.js), [`search-window.js`](../MVD Assistant/src/js/search-window.js)) показывает блокирующий `.maintenance-overlay` (z-index 9999) с обратным отсчётом и кнопкой «Проверить снова». Админы/модераторы бипасс через `effectiveMaintenance().locked = active && !isUserExempt()` (роль admin/moderator).

---

## 🎫 Система поддержки

**Бэкенд:** [`backend/routes/support.js`](backend/routes/support.js) + таблицы `support_tickets`, `support_messages`.
- Типы тикетов: `question`, `suggestion`, `bug`
- Статусы: `open` → `in_progress` → `answered` → `closed`. Ответ админа: open/in_progress → answered. Ответ юзера на answered → in_progress.
- `source: 'site'|'app'` + `app_version` для контекста.
- Флаги `unread_for_user` / `unread_for_admin` — сбрасываются при просмотре тикета своей стороной, выставляются при ответе другой.
- Endpoints: `/tickets` (POST create), `/tickets/mine` (GET), `/tickets/all` (admin GET с фильтрами status/type/search/unread), `/tickets/:id` (GET), `/tickets/:id/messages` (POST reply), `/tickets/:id/status` (PUT admin), `/unread-count` (для бейджей).

**Сайт-кабинет:** вкладка «Поддержка» с бейджем. Список → форма (3 типа карточками) → детально (чат-стиль, админ слева, юзер справа). **Live polling** каждые 5с в открытом тикете с умным диффом (не перерисовывает если ничего не изменилось, сохраняет недописанный ответ и позицию скролла). Тост «Новый ответ от поддержки» при появлении сообщения от админа.

**Админка:** вкладка «Поддержка» с бейджем непрочитанных в навигации. Таблица с фильтрами (статус/тип/только непрочитанные/поиск по теме и email). Колонка «Источник» показывает `App vX.X.X` или `Сайт`. Детальный вид с переключателем статуса. Те же polling и диф.

**Приложение:** sidebar-item «Поддержка» с бейджем. То же UI (список / форма / чат). При создании тикета автоматически передаются `source: 'app'` и `appVersion: app.getVersion()`. IPC: `support.{listMine, get, create, reply, unreadCount}` в [`preload.js`](../MVD Assistant/preload.js).

---

## 💎 Подписки

**Бэкенд:** [`backend/routes/subscriptions.js`](backend/routes/subscriptions.js) + таблицы `subscription_plans`, `user_subscriptions`.

**Архитектура планов:** план — это `name` + `slug` + `color` + **массив ключей-фич в JSON**. Известные ключи в `KNOWN_FEATURES` (notes_unlimited, notes_sync, themes_extra, priority_support, early_access, no_ads, export_data, custom_hotkeys). Админ может добавить свой ключ через UI — он сохранится и будет работать, если в коде appа/сайта есть соответствующий гейт.

**Архитектура выдач:** `user_subscriptions` хранит историю. Активная — `is_active=1 AND expires_at > NOW()`. **При новой выдаче все предыдущие активные подписки юзера автоматически отзываются** (`is_active=0, revoked_at=NOW()`) — у юзера всегда одна актуальная. Endpoints:
- Plans CRUD: `GET/POST/PUT/DELETE /subscriptions/plans[/:id]` (admin)
- `GET /subscriptions/me` — активная подписка с фичами и `remainingDays`
- `GET /subscriptions/grants` (admin) с фильтрами `active=1|0`, `userId`, `search`
- `POST /subscriptions/grants` — `{userId, planId, durationDays: 7|14|30}` ИЛИ `expiresAt: ISO`
- `POST /subscriptions/grants/:id/extend` — продление от `max(now, expires_at)`
- `DELETE /subscriptions/grants/:id` — soft revoke

**Админка:** вкладка «Подписки». Три блока:
1. **Планы** — карточки с цветом, slug, чипами фич, статусом активен/выключен. Клик → модалка редактирования (название/описание/цвет/сортировка/активность + чекбоксы фич + добавление произвольного ключа).
2. **Выдать подписку** — поиск пользователя (по email/имя через `/api/users` который **отдаёт массив напрямую**), селектор плана, переключатель 7/14/30 дней, поле заметки.
3. **Выданные подписки** — таблица с фильтром, поиском, инлайн-кнопками `+7д / +14д / +30д` и `Отозвать` / `Включить`.

**Кабинет:** карточка «Подписка» сверху вкладки «Профиль» — цветной бейдж, дата истечения, оставшиеся дни (оранжевый при ≤3), плитки доступных фич.

**Приложение:** карточка на главной вкладке (компактная). Поллинг каждые 15 минут через `scheduleSubscriptionPolling()`, broadcast `subscription:changed`. Helper в renderer:
```js
window.GosSubscription.hasFeature('notes_unlimited')  // bool
window.GosSubscription.current                         // объект подписки или null
window.GosSubscription.features                        // массив ключей
window.GosAPI.subscription.onChange((sub) => { ... })  // слушатель изменений
```

**Сейчас реально гейтятся:**
- `ai_assistant` — `backend/routes/ai.js` через `requireAiFeature`. В дефолтном плане `premium` включена в seed.
- `notes_unlimited` — в приложении в `main.js` (`hasNotesUnlimited()` смотрит в `subscriptionCache`), лимит 2 заметки. На бэке `INSERT` идёт в любом случае — клиент сам обеспечивает.
- `multi_server` — на бэке в `middleware/auth.js` (`effectiveLockedServer()`), который используют `routes/articles.js` (GET + search). Также `PUT /auth/locked-server` требует эту фичу для смены сервера. В приложении dropdown показывает 🔒 на недоступных серверах.

**Известные ключи** (`KNOWN_FEATURES` в `subscriptions.js`): `notes_unlimited`, `notes_sync`, `themes_extra`, `priority_support`, `early_access`, `no_ads`, `export_data`, `custom_hotkeys`, `ai_assistant`, `multi_server`. Админ может добавить любой произвольный ключ через UI.

---

## 🤖 AI Ассистент

**Бэкенд:** [`backend/routes/ai.js`](backend/routes/ai.js). Не хранит историю — клиент шлёт последние сообщения каждый раз.
- `GET /ai/status` — `{enabled, configured, model, roles, limitsPerHour}`. `enabled` зависит от подписки.
- `POST /ai/chat` — проксирует запрос в OpenAI-совместимый API (`POST {AI_API_BASE_URL}/chat/completions` с Bearer `AI_API_KEY`). К сообщениям приклеивается system-prompt по выбранной роли (lawyer/prosecutor/cop/judge/civilian) с инструкциями про статьи УК/АК/ДК/ПК Majestic RP. Если в запросе есть `serverId` — подтягивается контекст сервера: название + список кодексов/правил с количеством статей через JOIN `articles`→`categories`.
- **RAG-lite:** перед отправкой в AI делается `MATCH(title, text) AGAINST(? IN NATURAL LANGUAGE MODE)` по таблице `articles` (FULLTEXT-индекс `idx_fulltext` уже есть в schema.sql) для последнего сообщения юзера. Топ-10 статей с обрезанным до 240 символов текстом приклеиваются к system-prompt блоком «Релевантные статьи сервера». При ошибке FULLTEXT — fallback на LIKE по топ-5 ключевым словам.
- **Пост-валидация:** регулярка вытаскивает из ответа AI ссылки типа `УК ст. 1.1`, `АК 2.3`, `ст. 5.1 ДК`. Каждая сверяется с набором реальных `(catShort, code)` пар сервера. Несуществующие возвращаются в поле `invalidRefs` ответа, чтобы UI показал юзеру предупреждение. УАК нормализуется в УК. Возвращается также `usedArticles` — список статей из БД, которые ушли в prompt.
- Rate-limit: `AI_RATE_LIMIT_PER_HOUR` запросов/час на user.id (через `express-rate-limit`).
- Проверка подписки: `loadCurrentSubscription(userId)` + `features.includes('ai_assistant')`.

**Приложение:** sidebar-item «AI Ассистент» с бейджем PRO. Открывает вкладку в главном окне с **селектором сервера** (синхронизирован с глобальным `currentServerId`), переключателем ролей и чат-интерфейсом. Если у юзера нет фичи → показывается gate-карточка с кнопкой «Узнать о подписке» (открывает кабинет на сайте) и «Я уже оплатил» (форс-рефреш статуса). История диалога живёт только в памяти renderer'а — закрытие окна / Очистить очищают её.

**IPC:** `window.GosAPI.ai.status()` и `window.GosAPI.ai.chat(messages, persona, serverId)`.

**Безопасность:** ключ `AI_API_KEY` хранится **только в Railway Variables** на бэке, никогда не попадает в дистрибутив приложения.

---

## 💳 Платежи и покупка подписок

**Архитектура:** pluggable провайдеры. Адаптер — модуль в [`backend/providers/payments/`](backend/providers/payments/) с интерфейсом `{ slug, isOnline, createPayment({ payment, plan, user, provider, returnUrl }), parseWebhook({ body, headers, provider }), ipAllowed?(ip) }`. Реестр в `index.js` — чтобы добавить нового, положи модуль и зарегистрируй там.

**Встроенные адаптеры:**
- **YooKassa** ([`yookassa.js`](backend/providers/payments/yookassa.js)) — онлайн-оплата картами/СБП. Создаёт `POST https://api.yookassa.ru/v3/payments` с Idempotence-Key, отдаёт `confirmation.confirmation_url` для редиректа. Конфиг (в `payment_providers.config`): `{ shop_id, secret_key, return_url? }`. Webhook URL для ЮКассы: `/api/payments/webhook/yookassa`. Дополнительно проверяется IP whitelist YooKassa.
- **Manual** ([`manual.js`](backend/providers/payments/manual.js)) — заявка без онлайн-оплаты. Юзер видит на /pricing.html кнопку «Заявка», админ потом помечает платёж succeeded руками в Платежи → таблица.

**Жизненный цикл платежа:**
1. Юзер на `/pricing.html` выбирает план → модалка с выбором провайдера → `POST /payments/create`
2. Backend создаёт строку `payments(status=pending)`, зовёт адаптер → получает `externalId, confirmationUrl`
3. Юзер редиректится (онлайн) или просто видит «заявка принята» (manual)
4. **Онлайн:** ЮКасса присылает webhook → `POST /payments/webhook/yookassa` → парсим, сверяем external_id, при `succeeded` → вызываем `grantSubscription()` (single-active policy), пишем `paid_at` и `granted_subscription_id`
5. **Manual:** админ заходит в Платежи → нажимает «Подтвердить» → тот же `grantSubscription()`

**`grantSubscription({ userId, planId, durationDays, ... })`** экспортируется из `subscriptions.js` и используется и админкой, и webhook'ом, и `/payments/:id/mark`. Логика единая — старые активные подписки автоматически отзываются.

**Идемпотентность webhook'а** — по `(provider_slug, external_id)`. Если статус уже applied — возвращаем 200 без повторной выдачи.

**Админка → Платежи:**
- **Способы оплаты** — карточки провайдеров с индикатором включено/выключено и метой shop_id/secret_key. Клик → модалка с JSON-конфигом. YooKassa и Manual нельзя удалить (только отключить); кастомные — можно.
- **История платежей** — таблица с фильтрами status/provider/search. Pending платежи можно подтвердить или отменить вручную. Для каждого видна ссылка confirmation_url (если есть).

**Frontend `/pricing.html`** — публичная страница тарифов. Тянет `/subscriptions/plans/public`. При клике «Купить» гость отправляется на /login.html (с `gos_buy_intent` в sessionStorage чтобы вернуться к покупке после входа), залогиненный — открывает модалку выбора провайдера → редирект на confirmationUrl.

---

## 🔒 Закрепление сервера (locked_server_id + multi_server)

**Идея:** при регистрации пользователь выбирает один сервер Majestic RP. Без подписки он видит **только** этот сервер; для просмотра остальных нужна фича `multi_server` (есть в Lite и Premium).

**БД:** `users.locked_server_id VARCHAR(64) NULL` (добавляется идемпотентно через `ensureColumn` на каждом старте).

**Бэкенд (`middleware/auth.js`):**
- `optionalAuth(req)` — мягкая авторизация, прикрепляет `req.user` если Bearer есть, иначе пропускает.
- `effectiveLockedServer(user)` — возвращает `locked_server_id` если у юзера нет `multi_server` И он не admin/moderator; иначе `null` (без ограничений).
- В [`routes/articles.js`](backend/routes/articles.js) GET `/` и `/search` используют это: подменяют `req.query.serverId` на locked, если применимо. Запросы без Bearer (e.g. с лендинга) — без ограничений.

**Бэкенд (`routes/auth.js`):**
- `POST /register` теперь требует `serverId` (валидирует существование и активность сервера, сохраняет в `locked_server_id`).
- `GET /me` возвращает `lockedServerId` через расширенный `userPublic()`.
- `PUT /locked-server` — `{serverId}`: если юзер ещё не привязан или сервер тот же → меняем. Если другой и нет `multi_server` → 403 с `code: 'MULTI_SERVER_REQUIRED'`.

**Сайт `/login.html?mode=register`:** селектор сервера обязательный. Загружается из `/api/servers`.

**Приложение:** в `main-window.js` функция `canUseServer(srvId)` смотрит на `State.user.lockedServerId` + `window.GosSubscription.hasFeature('multi_server')`. В dropdown серверов недоступные пункты получают класс `.locked` и иконку 🔒. Клик по 🔒 → тост «Просмотр законов этого сервера — с подпиской Lite или Premium».

**Существующие юзеры** (миграционный случай): `locked_server_id IS NULL` → нет ограничений (backward-compat). Чтобы принудить — `UPDATE users SET locked_server_id = ? WHERE locked_server_id IS NULL`.

---

## 📒 Заметки: лимит и share-by-code

**Лимит:** 2 заметки в `notes.json` без фичи `notes_unlimited`. Проверка локальная в `main.js` (`hasNotesUnlimited()` смотрит на `subscriptionCache`). `ipcMain.handle('notes:create')` возвращает `{error, code: 'NOTES_LIMIT'}` при превышении. UI в `notes-window.js` показывает баннер «Заметок: X из 2» и тост при попытке создать сверх лимита.

**Share-by-code:**
- Таблица `note_shares (user_id PK, code UNIQUE 8 chars, snapshot JSON, notes_count, updated_at)`.
- Код генерится из алфавита `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (без визуально похожих) в [`routes/notes.js`](backend/routes/notes.js).
- Снимок **автоматически** пушится на сервер при каждом изменении заметок через debounced `scheduleNotesSync()` (1.5с) в `main.js`. Локальное хранение остаётся в `userData/notes.json`.
- IPC: `window.GosAPI.notes.{getShare, regenerateCode, lookup, syncNow, getLimit}`.
- В titlebar окна заметок две иконки: **share** (открывает модалку с моим кодом) и **import** (поле ввода чужого кода). Импорт идёт по одной заметке, уважая локальный лимит у получателя — пропущенные считаются и показываются в тосте «Импортировано X, Y пропущено (лимит)».

---

## 📞 Контакты владельца

**Таблица `site_contacts`** — single-row (id=1), с полями: ownerName, ownerRole, about, avatarUrl, email, telegram, discord, vk, github, website, customLinks JSON (массив `{label, url, icon?}`).

**API:** [`routes/contacts.js`](backend/routes/contacts.js):
- `GET /api/contacts` — публично, отдаёт всю карточку.
- `PUT /api/contacts` (admin) — upsert через `INSERT ON DUPLICATE KEY UPDATE`. Валидирует и обрезает поля.

**Публичная страница `/contacts.html`** — карточка с аватаром (или инициалами), описанием, иконками соцсетей (svg для tg/discord/vk/github/email/website), кастомными ссылками. JS автоматически нормализует значения: `@username` → `https://t.me/username`, голый домен → `https://...`, email → `mailto:`.

**Админка → вкладка «Контакты»** — форма редактирования (имя/роль/аватар/about + 6 соцсетей + блок «Произвольные ссылки» с inline-добавлением/удалением). Кнопка «Открыть страницу» рядом с «Сохранить».

---

## 🎨 Темы и стили

CSS-переменные в `styles.css`:
- Тёмная по умолчанию
- Светлая через `html[data-theme="light"]`
- Акцент: `--accent-primary: #DF005B` (розовый)

Темы синхронизируются между окнами через `localStorage.theme` + broadcast event.

---

## 🔧 Известные проблемы и нюансы

1. **`backend/.env` не деплоится** — он в `.gitignore`. Все переменные должны быть в Railway Variables
2. **Railway автоматически перезапускает** при изменении Variables — но иногда нужно вручную через Deployments → Redeploy
3. **Файлы релизов на Railway эфемерные** — без Volume пропадут при пересоздании контейнера. Нужно `UPLOADS_DIR=/app/uploads` + подключённый Volume на app-сервисе (НЕ на MySQL)
4. **electron-updater работает только в подписанной сборке** или в режиме production. В `npm run dev` авто-обновления нет
5. **NSIS требует ICO с кадрами до 256×256** — `scripts/make-icon.js` ограничивает размеры
6. **Discord OAuth redirect URI** должен быть точно одинаковый в:
   - Discord Developer Portal → OAuth2 → Redirects
   - `DISCORD_REDIRECT_URI` в Railway Variables
   - Иначе ошибка `redirect_uri_mismatch`
7. **Forum.majestic-rp.ru закрыт DDoS-Guard** — прямой парсинг URL невозможен, используем `alamantik/majestic-laws-db`
8. **Railway → MySQL → Query** автоматически дописывает `LIMIT 100` к SELECT и выполняет ровно один statement. Хвостовой `;` и свой `LIMIT` ломают запрос. Для миграции — разбивай на отдельные запросы.
9. **MySQL диск может переполниться** от `articles` (~24k строк) + FULLTEXT-индекса. Лечится `ALTER TABLE articles DROP INDEX idx_fulltext` или апгрейдом Disk на MySQL-сервисе.
10. **`GET /api/users` отдаёт массив напрямую** (не `{users: [...]}`) — учитывать в новом клиентском коде.
11. **`maintenance.PUT` использует INSERT...ON DUPLICATE KEY UPDATE** — на случай если seed-строки с id=1 нет (например миграция INSERT IGNORE не выполнилась).
12. **Полное закрытие приложения** — `searchWindow` и `notesWindow` имеют `skipTaskbar: true`, поэтому при закрытии главного окна их надо принудительно destroy через `destroyAllWindows(except)`. Все интервалы должны быть обёрнуты в `trackedSetInterval`/`trackedSetTimeout` и очищаться в `before-quit`.

---

## 🚀 Запуск локально

### Сайт
```bash
cd "D:\Site GOS"
# Установить MySQL локально или указать MYSQL_URL в backend/.env
npm install
npm start
# → http://localhost:3000
```

### Приложение
```bash
cd "D:\MVD Assistant"
npm install
npm start                  # запуск
# или
npm run dev                # с DevTools
```

---

## 📋 Текущее состояние / Что готово

### ✅ Готово
- [x] Регистрация и вход (email/пароль) на сайте
- [x] В приложении только вход — регистрация через сайт
- [x] Discord OAuth (login, register, link, unlink) — на сайте
- [x] Discord OAuth в Electron через локальный HTTP-сервер
- [x] Личный кабинет с 5 вкладками (Профиль с подпиской, Безопасность, Приложение, Данные, Поддержка)
- [x] Админ-панель: 12 вкладок (Дашборд, Серверы, Категории, Статьи, Пользователи, Парсер, Релизы, Донат, DevLog, **Тех. работы, Поддержка, Подписки**)
- [x] Парсер из alamantik/majestic-laws-db (массовый импорт всего) + **JSON-импорт для одного сервера** (alamantik-формат или плоский массив, файлом или вставкой)
- [x] Загрузка релизов админом + SHA-512 для верификации
- [x] Авто-обновление приложения через electron-updater + **модалка «Доступно обновление» в главном окне** с прогресс-баром и кнопкой установки
- [x] Согласие с Условиями + Политикой при регистрации
- [x] Страницы /terms.html и /privacy.html с полным текстом
- [x] DevLog (журнал изменений) — на сайте и в приложении
- [x] Донат-ссылки (с подсчётом кликов) — синхронизированы между сайтом и **карточками в приложении (sidebar-item «Поддержать»)**
- [x] Окно заметок с прозрачностью, закреплением, изменяемым размером
- [x] Создание заметок через модалку с вводом названия
- [x] Переименование заметок из списка
- [x] Категории законов в окне поиска через **dropdown с группами (Кодексы/Правила/Прочее), фильтром, скрытием пустых, цветными бейджами сокращений**
- [x] Sidebar-item «Заметки» в главном окне
- [x] Auto-update инфраструктура (latest.yml, SHA-512 verify)
- [x] **Тех. работы**: админ включает с дедлайном, у обычных юзеров в приложении блокирующий overlay с обратным отсчётом, админы/модераторы бипасс
- [x] **Система поддержки**: тикеты (Вопрос/Идея/Баг), переписка с админом, live-обновление через polling каждые 5с в открытом тикете (умный диф, не теряет ввод/скролл), бейджи непрочитанных, статусы (open/in_progress/answered/closed), фильтры в админке
- [x] **Подписки**: 3 длительности (7/14/30 дней) + произвольная expiresAt, единственная активная на юзера (старая авто-отзывается), редактируемые планы с произвольным набором фич, продление/отзыв из админки, бейдж подписки в кабинете и приложении, helper `window.GosSubscription.hasFeature(key)` для гейтов
- [x] Полное закрытие процесса приложения по X (нет висящих в Task Manager)

### 🔄 Потенциальные улучшения
- [ ] Кэш статей в IndexedDB на стороне приложения для офлайна
- [ ] Push-уведомления о новых релизах через Discord webhook
- [ ] Markdown поддержка в DevLog, заметках и сообщениях поддержки
- [ ] Полнотекстовый поиск через MySQL FULLTEXT (уже есть индекс, но не используется в запросах)
- [ ] Аналитика использования (опционально)
- [ ] Code signing для Windows (убрать SmartScreen warning)
- [ ] WebSocket вместо polling в чате поддержки (когда количество онлайн-сессий станет высоким)
- [ ] Email/Discord-нотификации при ответе в тикете
- [ ] Code signing для Windows (убрать SmartScreen warning при установке)
- [ ] WebSocket вместо polling для AI стрима и заметок-sync
- [ ] Email/Discord-нотификации при ответе в тикете и оплате

---

## 🆘 При обращении к новому ассистенту

Дай ему этот файл. Также упомяни:
1. Какая проблема — конкретно
2. На каком этапе (локально / на Railway)
3. Логи или скриншоты ошибки
4. Какую команду запускал

Ассистент работает в `git bash` и `PowerShell` на Windows. Если нужны изменения — он напрямую правит файлы в `D:\Site GOS` или `D:\MVD Assistant`.

---

## 🔑 Памятка по безопасности

- **`.env` файлы в .gitignore** — никогда не коммитить
- **`DISCORD_CLIENT_SECRET`** — если попал в Git, ротировать через Discord Developer Portal
- **`JWT_SECRET`** — длинная случайная строка; смена потребует повторного логина всех пользователей
- **Admin role** — назначать вручную в БД через UPDATE: `UPDATE users SET role='admin' WHERE email='...'`

---

## 📞 Связанные ID и константы

- **App ID** (electron-builder): `com.gos.assistant`
- **Product Name**: `GOS Assistant`
- **Default search hotkey**: `CommandOrControl+Shift+K`
- **Default notes hotkey**: `CommandOrControl+Shift+N`
- **Auto-hide search timeout**: 20 секунд
- **Auto-update check interval**: каждые 4 часа + первая проверка через 10 сек после старта
- **Terms version**: `1.0`
- **Discord Client ID**: `1375443563890085959`
- **JWT expiry**: `30d`
- **Rate limit на /auth**: 20 запросов / 15 минут
- **Maintenance poll interval (app)**: 60 сек (первая проверка через 3 сек)
- **Support ticket poll interval (открытый тикет)**: 5 сек
- **Support unread badge poll**: 60 сек
- **Subscription poll interval (app)**: 15 минут
- **Subscription durations**: 7, 14, 30 дней (валидируется на backend как whitelist)
- **Support ticket types**: `question`, `suggestion`, `bug`
- **Support ticket statuses**: `open`, `in_progress`, `answered`, `closed`
- **Default seeded subscription plans**:
  - `lite` (149₽ / 30 дней) — фичи: `notes_unlimited, themes_extra, no_ads, multi_server`
  - `premium` (299₽ / 30 дней) — фичи: `notes_unlimited, themes_extra, priority_support, early_access, no_ads, export_data, ai_assistant, multi_server`
  - Цены редактируются админом через UI (поля `price_cents` в копейках, `currency`, `duration_days`, `is_purchasable`).
- **Default seeded payment providers**: `yookassa` (выключен — нужно прописать `shop_id`/`secret_key`) и `manual` (включен по дефолту, для заявок)
- **Free notes limit**: 2 заметки без `notes_unlimited`. `FREE_NOTES_LIMIT` в `main.js`.
- **Notes share code length**: 8 символов, алфавит без визуально похожих
- **Notes sync debounce**: 1500ms после изменения
- **AI default provider**: `vsegpt.ru` (`https://api.vsegpt.ru/v1`)
- **AI default model**: `google/gemini-3.1-flash-lite` (переопределяется `AI_MODEL`)
- **AI rate limit**: 60 req/час на user.id (`AI_RATE_LIMIT_PER_HOUR`)
- **YooKassa webhook URL**: `https://gosassistent.su/api/payments/webhook/yookassa`
- **Locked server**: обязателен при регистрации, смена требует фичу `multi_server`
- **AI feature key**: `ai_assistant` (гейтит роут `/api/ai/chat`)
- **Default AI provider**: `vsegpt.ru` (`https://api.vsegpt.ru/v1`)
- **Default AI model**: `google/gemini-3.1-flash-lite` (переопределяется `AI_MODEL`)
