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
- Поиск по законам/правилам всех 19 серверов Majestic RP
- Окно поверх игры с регулируемой прозрачностью
- Личные заметки с собственной горячей клавишей `Ctrl+Shift+N` (с прозрачностью, закреплением, изменяемым размером)
- Авто-обновление через сайт
- Авторизация через email/пароль или Discord
- Тёмная/светлая темы

**Возможности сайта:**
- Лендинг с описанием и кнопкой скачивания
- Регистрация (с обязательным согласием с Условиями использования и Политикой конфиденциальности)
- Личный кабинет (профиль, безопасность, скачивание, привязка Discord)
- Админ-панель (серверы, категории, статьи, пользователи, парсер, релизы, донаты, DevLog)
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
│   │   ├── auth.js        # Login, register, Discord OAuth, profile, password
│   │   ├── servers.js     # CRUD серверов
│   │   ├── categories.js  # CRUD категорий
│   │   ├── articles.js    # CRUD + поиск статей
│   │   ├── users.js       # Список пользователей, смена роли
│   │   ├── parser.js      # Парсер URL + импорт из alamantik/majestic-laws-db
│   │   ├── releases.js    # Релизы приложения (с SHA-512 для авто-обновления)
│   │   ├── donate.js      # Ссылки на пожертвования
│   │   └── devlog.js      # Журнал изменений
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
│   ├── terms.html         # Условия использования
│   ├── privacy.html       # Политика конфиденциальности
│   ├── css/styles.css     # Общие стили
│   └── js/
│       ├── api.js         # HTTP-клиент → window.GosClient
│       ├── landing.js
│       ├── auth.js
│       ├── cabinet.js
│       ├── admin.js
│       └── devlog.js
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

- **Сайт:** `https://gos-assistant-site-production.up.railway.app`
- **API:** `https://gos-assistant-site-production.up.railway.app/api`
- **Хостинг:** Railway (MySQL подключён через MYSQL_URL Reference)
- **Источник законов:** `https://github.com/alamantik/majestic-laws-db`

---

## 🗃 База данных (MySQL)

Схема в `database/schema.sql`. Основные таблицы:

| Таблица | Что хранит |
|---------|-----------|
| `users` | id, email, username, password_hash, discord_id, avatar_url, role (user/admin/moderator), terms_accepted_at, terms_version, created_at, last_login |
| `servers` | id (slug), name, color, icon, sort_order, is_active |
| `categories` | id (slug), name, short_name, color, type (laws/rules/other), sort_order, is_active |
| `articles` | id, server_id, category_id, code, title, text, penalty, wanted_stars, sort_order |
| `sessions` | Заготовка под JWT-сессии (пока не используется активно) |
| `releases` | type (installer/portable), version, filename, original_name, size, **sha512**, notes, is_active, download_count |
| `donate_links` | title, url, description, icon (эмодзи), color, sort_order, is_active, click_count |
| `devlog_entries` | version, title, content, tag (feature/fix/news/major), is_published, published_at |
| `sync_state` | source, resource, source_updated_at, articles_count — для отслеживания обновлений из alamantik |

**Важно:** есть авто-инициализация в `init-db.js` — при первом запуске сервера создаёт таблицы и заливает seed.

---

## 🔌 REST API эндпойнты

База: `/api`

### Auth (`/auth`) — rate-limit 20 req / 15 min
- `POST /register` — `{ email, username, password, acceptTerms }` (acceptTerms обязателен)
- `POST /login` — `{ email, password }` → JWT + user
- `GET /me` — текущий пользователь (требует JWT)
- `PUT /me` — обновить username
- `POST /change-password` — `{ currentPassword, newPassword }`
- `POST /logout` / `POST /logout-all`
- `GET /discord?app_callback=...` — старт Discord OAuth (опционально с callback на 127.0.0.1)
- `GET /discord/callback` — обработка ответа от Discord (login + link + app flow)
- `POST /discord/link-url` — URL для привязки Discord к текущему юзеру
- `POST /discord/unlink` — отвязать Discord
- `GET /discord/status` — публичная диагностика конфигурации

### Servers / Categories / Articles
- Стандартные CRUD: `GET /`, `GET /all` (admin), `POST`, `PUT /:id`, `DELETE /:id`
- `GET /articles?serverId=X&categoryId=Y`
- `GET /articles/search?q=...`

### Users (admin)
- `GET /users`
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

### Releases
- `GET /releases/latest` — публично, последний installer + portable
- `GET /releases/download/:id` — требует JWT, отдаёт файл
- `GET /releases` / `POST /releases/upload` / `PUT /releases/:id` / `DELETE /releases/:id` — admin
- `GET /releases/feed/latest.yml` — для electron-updater (требует JWT)
- `GET /releases/feed/:filename` — для electron-updater

### Devlog / Donate / Misc
- `GET /devlog` — публично, опубликованные
- `GET /devlog/all`, `POST`, `PUT /:id`, `DELETE /:id` — admin
- `GET /donate` — публично
- `POST /donate/:id/click` — счётчик кликов
- `GET /health` — диагностика подключения и таблиц

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
DISCORD_REDIRECT_URI=https://gos-assistant-site-production.up.railway.app/api/auth/discord/callback
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
| `DISCORD_REDIRECT_URI` | `https://gos-assistant-site-production.up.railway.app/api/auth/discord/callback` |
| `CORS_ORIGIN` | `*` |
| `NODE_ENV` | `production` |
| `UPLOADS_DIR` | `/app/uploads` (если подключён Volume) |

**Локально**: те же переменные в `D:\Site GOS\backend\.env` (gitignored). Файл `db.js` загружает env через `dotenv.config({ path: path.join(__dirname, '.env') })`.

### Приложение
- `D:\MVD Assistant\.env` — опционально для dev (`API_URL=http://localhost:3000/api`)
- В production API URL зашит в `api-client.js`: `DEFAULT_API_URL = 'https://gos-assistant-site-production.up.railway.app/api'`

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

**Текущая версия приложения: 1.0.6**

---

## 🪟 Окна приложения

| Окно | Размер | Свойства | Назначение |
|------|--------|----------|-----------|
| `auth` | 450×550 | frameless, transparent | Вход (только email/пароль + Discord). Регистрация удалена — ссылка ведёт на сайт |
| `main` | 800×450 | frameless, transparent | Sidebar + 3 таба (Главная / Настройки / О программе) + sidebar-item «Заметки» |
| `search` | 900×600 | frameless, transparent, **always-on-top**, resizable: false | Поиск законов и правил. Категории через **dropdown** (не chip-слайдер) |
| `notes` | 460×560 | frameless, transparent, **resizable**, always-on-top (опц.) | Заметки. Прозрачность 0-80% настраивается слайдером. Создание через модалку с вводом названия. Переименование из списка по ✎ или двойному клику |

**Горячие клавиши** (через `globalShortcut`):
- `Ctrl+Shift+K` — поиск (настраиваемая)
- `Ctrl+Shift+N` — заметки (настраиваемая)
- Проверка конфликтов между ними

**Хранилище:**
- Настройки: `app.getPath('userData')/config.json`
- Заметки: `app.getPath('userData')/notes.json` (локально, не синхронизируется)
- Логи: `app.getPath('userData')/logs/`

---

## 🌍 Сайт — структура страниц

| URL | Описание |
|-----|----------|
| `/` | Лендинг с фичами, скачиванием, донатами, ссылками на DevLog |
| `/login.html` | Вход + регистрация (`?mode=register`) |
| `/cabinet.html` | Личный кабинет (4 вкладки): Профиль / Безопасность (включая привязку Discord) / Приложение (скачивание) / Данные (серверы, поиск) |
| `/admin.html` | Админ-панель (требует role: admin). Вкладки: Дашборд, Серверы, Категории, Статьи, Пользователи, Парсер, Релизы, Донат, DevLog |
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
3. **Файлы релизов на Railway эфемерные** — без Volume пропадут при пересоздании контейнера. Нужно `UPLOADS_DIR=/app/uploads` + подключённый Volume
4. **electron-updater работает только в подписанной сборке** или в режиме production. В `npm run dev` авто-обновления нет
5. **NSIS требует ICO с кадрами до 256×256** — `scripts/make-icon.js` ограничивает размеры
6. **Discord OAuth redirect URI** должен быть точно одинаковый в:
   - Discord Developer Portal → OAuth2 → Redirects
   - `DISCORD_REDIRECT_URI` в Railway Variables
   - Иначе ошибка `redirect_uri_mismatch`
7. **Forum.majestic-rp.ru закрыт DDoS-Guard** — прямой парсинг URL невозможен, используем `alamantik/majestic-laws-db`

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
- [x] Личный кабинет с 4 вкладками
- [x] Админ-панель: 9 вкладок (Дашборд, Серверы, Категории, Статьи, Пользователи, Парсер, Релизы, Донат, DevLog)
- [x] Парсер из alamantik/majestic-laws-db (массовый импорт всего)
- [x] Загрузка релизов админом + SHA-512 для верификации
- [x] Авто-обновление приложения через electron-updater
- [x] Согласие с Условиями + Политикой при регистрации
- [x] Страницы /terms.html и /privacy.html с полным текстом
- [x] DevLog (журнал изменений) — на сайте и в приложении
- [x] Донат-ссылки (с подсчётом кликов)
- [x] Окно заметок с прозрачностью, закреплением, изменяемым размером
- [x] Создание заметок через модалку с вводом названия
- [x] Переименование заметок из списка
- [x] Категории законов через dropdown (вместо chip-слайдера)
- [x] Sidebar-item «Заметки» в главном окне
- [x] Auto-update инфраструктура (latest.yml, SHA-512 verify)

### 🔄 Потенциальные улучшения
- [ ] Кэш статей в IndexedDB на стороне приложения для офлайна
- [ ] Push-уведомления о новых релизах через Discord webhook
- [ ] Markdown поддержка в DevLog и заметках
- [ ] Полнотекстовый поиск через MySQL FULLTEXT (уже есть индекс, но не используется в запросах)
- [ ] Аналитика использования (опционально)
- [ ] Code signing для Windows (убрать SmartScreen warning)

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
