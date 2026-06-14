# GOS Assistant — Site & API

Полный стек для GOS Assistant: REST API на Node.js + MySQL, лендинг, страница входа/регистрации и админ-панель.

## Структура

```
Site GOS/
├── backend/          # Express + MySQL + JWT
│   ├── server.js
│   ├── db.js
│   ├── middleware/auth.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── servers.js
│   │   ├── categories.js
│   │   ├── articles.js
│   │   └── users.js
│   ├── .env
│   └── package.json
├── frontend/         # Лендинг, авторизация, админка
│   ├── index.html    # Главная (лендинг)
│   ├── login.html    # Вход / Регистрация
│   ├── admin.html    # Админ-панель
│   ├── css/styles.css
│   └── js/
│       ├── api.js    # Клиент REST API
│       ├── landing.js
│       ├── auth.js
│       └── admin.js
└── database/
    ├── schema.sql    # Структура БД
    └── seed.sql      # Начальные данные
```

## Установка

### 1. База данных

Установи MySQL 8 (или MariaDB 10.5+). Создай БД и применить схему:

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

### 2. Backend

```bash
cd backend
npm install
```

Отредактируй `backend/.env` под свои настройки БД:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=твой_пароль
DB_NAME=gos_assistant
JWT_SECRET=сгенерируй_длинную_случайную_строку
```

Запусти сервер:

```bash
npm start
```

Сервер слушает `http://localhost:3000`. Сайт доступен по тому же адресу.

### 3. Создание первого администратора

После первой регистрации обнови роль вручную в БД:

```sql
UPDATE users SET role = 'admin' WHERE email = 'твой@email';
```

### 4. Подключение Electron-приложения

В приложении GOS Assistant (папка `D:\MVD Assistant`) открой настройки → API URL и впиши:

```
http://localhost:3000/api
```

Приложение начнёт брать данные из реальной БД вместо моков.

## API эндпойнты

### Аутентификация
- `POST /api/auth/register` — `{ email, username, password }`
- `POST /api/auth/login` — `{ email, password }`
- `GET /api/auth/me` — текущий пользователь (требует JWT)
- `POST /api/auth/logout`
- `GET /api/auth/discord` — старт Discord OAuth
- `GET /api/auth/discord/callback` — колбэк Discord

### Серверы
- `GET /api/servers` — список активных (публично)
- `GET /api/servers/all` — все (admin)
- `POST /api/servers` — создать (admin)
- `PUT /api/servers/:id` — обновить (admin)
- `DELETE /api/servers/:id` — удалить (admin)

### Категории
- `GET /api/categories` — публично
- `POST/PUT/DELETE /api/categories[/:id]` — admin

### Статьи
- `GET /api/articles?serverId=...&categoryId=...`
- `GET /api/articles/search?q=...&serverId=...`
- `POST/PUT/DELETE /api/articles[/:id]` — admin

### Пользователи (admin)
- `GET /api/users`
- `PUT /api/users/:id/role` — `{ role: 'user' | 'admin' | 'moderator' }`
- `DELETE /api/users/:id`

### Системные
- `GET /api/health` — статус сервера и БД

## Discord OAuth (опционально)

1. Создай приложение на https://discord.com/developers/applications
2. В OAuth2 → Redirects добавь `http://localhost:3000/api/auth/discord/callback`
3. Скопируй Client ID и Client Secret в `.env`
4. После рестарта сервера кнопка "Войти через Discord" станет рабочей.

## Производство

- Используй nginx как reverse-proxy перед Node
- Включи HTTPS (Let's Encrypt)
- Поменяй `JWT_SECRET` на длинную случайную строку
- Поставь `NODE_ENV=production`
- Используй PM2 или systemd для управления процессом

## Безопасность

- Пароли хешируются bcrypt (10 раундов)
- JWT с сроком 30 дней (настраивается через `JWT_EXPIRES_IN`)
- Rate limit на `/api/auth/*` — 20 запросов / 15 минут с IP
- CORS настраивается через `CORS_ORIGIN`
- SQL — только prepared statements (`mysql2.execute`)
