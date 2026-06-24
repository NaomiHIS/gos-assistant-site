# Деплой GOS Assistant на Railway

Бесплатный хостинг с Node.js + MySQL, без домена. Railway даёт $5 кредита каждый месяц — этого хватает для небольшого проекта.

## Шаг 1 — Создай GitHub-репозиторий

Сайт нужно загрузить на GitHub, чтобы Railway мог его подтянуть.

1. Зайди на https://github.com и зарегистрируйся (если ещё нет аккаунта)
2. Создай новый репозиторий: кнопка **New** → имя: `gos-assistant-site` → **Private** (или Public — на твой выбор) → **Create repository**
3. На своём компьютере открой PowerShell в папке `D:\Site GOS` и выполни:

```powershell
cd "D:\Site GOS"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/gos-assistant-site.git
git push -u origin main
```

> Если Git не установлен — скачай с https://git-scm.com/download/win и установи (стандартные настройки).

## Шаг 2 — Регистрация на Railway

1. Зайди на https://railway.com
2. Нажми **Login** → **Login with GitHub**
3. Подтверди доступ Railway к твоему GitHub-аккаунту

Railway даст тебе $5 бесплатного кредита каждый месяц.

## Шаг 3 — Создай проект

1. На дашборде Railway нажми **New Project**
2. Выбери **Deploy from GitHub repo**
3. Найди свой репозиторий `gos-assistant-site` → **Deploy now**

Railway автоматически:
- Запустит сборку (увидит `nixpacks.toml` и `railway.json`)
- Установит зависимости в `backend/`
- Запустит `node server.js`

Пока не работает — нет БД. Добавим её.

## Шаг 4 — Добавь MySQL

1. В проекте нажми **+ New** → **Database** → **Add MySQL**
2. Railway создаст MySQL-сервис рядом с твоим приложением
3. Кликни на сервис **MySQL** → вкладка **Variables** → найди `MYSQL_URL` (или `DATABASE_URL`) — скопируй имя

## Шаг 5 — Подключи приложение к БД

1. Кликни на сервис **gos-assistant-site** (приложение, не БД)
2. Открой вкладку **Variables**
3. Нажми **+ New Variable** → **Add Reference** → выбери **MYSQL_URL** из MySQL-сервиса
4. Добавь ещё несколько переменных вручную (кнопка **+ New Variable**):

```
JWT_SECRET = длинная-случайная-строка-минимум-32-символа-замени-это
NODE_ENV = production
CORS_ORIGIN = *
```

Чтобы сгенерировать `JWT_SECRET`, можешь использовать https://www.random.org/strings/ или PowerShell:
```powershell
[System.Web.Security.Membership]::GeneratePassword(48, 8)
```

## Шаг 6 — Получи публичный URL

1. В сервисе **gos-assistant-site** → вкладка **Settings**
2. Раздел **Networking** → **Generate Domain**
3. Railway выдаст URL вида `gosassistent.su`
4. Открой этот URL в браузере — должен открыться твой сайт

## Шаг 7 — Создай первого администратора

1. Открой свой сайт → `/login.html` → зарегистрируйся
2. На дашборде Railway открой сервис **MySQL** → вкладка **Data**
3. Найди таблицу `users` → найди свой email → измени `role` с `user` на `admin` → сохрани

Альтернативно: через подключение к MySQL по строке `MYSQL_URL` (любой клиент типа DBeaver/HeidiSQL/MySQL Workbench):
```sql
UPDATE users SET role='admin' WHERE email='твой@email.com';
```

## Шаг 8 — Подключи Electron-приложение

1. Запусти GOS Assistant (`D:\MVD Assistant`, `npm start`)
2. Войди в аккаунт
3. Открой **Настройки** → найди поле **URL сервера**
4. Впиши: `https://gosassistent.su/api`
5. Нажми **Сохранить**

С этого момента приложение будет брать данные из твоей боевой базы.

> ⚠️ Сейчас Electron-приложение использует mock-логику для авторизации. Чтобы оно реально проверяло пароль через сервер, нужно обновить `main.js`. Скажи, когда понадобится — добавлю.

## Обновления

Когда меняешь код локально:

```powershell
cd "D:\Site GOS"
git add .
git commit -m "Update site"
git push
```

Railway автоматически пересоберёт и задеплоит за 1-2 минуты.

## Полезные команды Railway

В сервисе → вкладка **Deployments** — логи последних запусков.  
В сервисе → вкладка **Metrics** — потребление CPU, RAM, диска (важно для бесплатного лимита).  
В сервисе → **Settings** → **Restart** — перезапуск без передеплоя.

## Стоимость

- $5/мес бесплатный кредит
- Web-сервис на низком трафике: ~$2-3/мес кредита
- MySQL малого размера: ~$1-2/мес кредита

Если кредитов хватает — платить ничего не нужно. Когда сайт начнёт расти — пополняй баланс или мигрируй на VPS.

## Альтернативы

Если Railway не подойдёт:
- **Render** — есть free tier для веб-сервиса, но MySQL платный (PostgreSQL free 30 дней)
- **Fly.io** — 3 машины бесплатно, можно поднять MySQL вручную, сложнее
- **Vercel + PlanetScale** — Vercel для frontend, PlanetScale для MySQL (но требует переписать бэкенд под serverless)

## Если что-то пошло не так

**Билд падает с ошибкой:**
- Проверь логи в **Deployments**
- Убедись, что `backend/package.json` есть в репозитории

**Сайт открывается, но API возвращает 500:**
- Проверь, что MySQL добавлен и `MYSQL_URL` есть в Variables приложения
- Перезапусти приложение (Settings → Restart)
- Посмотри логи последнего деплоя

**Можно зайти на `/` но не на `/login.html`:**
- Это нормально, маршрут есть. Проверь, что нет ошибки JS в консоли браузера.

**Discord OAuth не работает:**
- Это опционально. Нужно создать приложение на https://discord.com/developers и добавить `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` (= `https://твой-url.up.railway.app/api/auth/discord/callback`) в Variables.
