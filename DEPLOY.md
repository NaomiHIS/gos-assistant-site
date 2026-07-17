# 🚀 Деплой на VPS

**Сервер:** `157.22.231.192` (Ubuntu 22.04 + FastPanel)
**Путь:** `/var/www/gos`
**Пользователь:** `gos`
**Сервис:** `gos-assistant.service`

---

## Быстрый деплой обновления (обычный случай)

Один раз локально задеплоил push в main:
```powershell
cd "D:/Site GOS"
git add .
git commit -m "описание"
git push
```

Затем на сервере:
```bash
ssh gos@157.22.231.192
cd /var/www/gos
git pull
sudo systemctl restart gos-assistant
```

Проверить что взлетело:
```bash
sudo systemctl status gos-assistant --no-pager | head -8
curl -s http://127.0.0.1:3000/api/health
```

---

## Деплой с новыми зависимостями

Если менялся `package.json`:
```bash
ssh gos@157.22.231.192
cd /var/www/gos
git pull
npm ci --omit=dev
sudo systemctl restart gos-assistant
```

---

## Одной строкой (когда всё стабильно)

```bash
ssh gos@157.22.231.192 "cd /var/www/gos && git pull && npm ci --omit=dev && sudo systemctl restart gos-assistant && echo === OK ==="
```

---

## Просмотр логов

**Последние 50 строк:**
```bash
sudo journalctl -u gos-assistant -n 50 --no-pager
```

**Живой поток (Ctrl+C для выхода):**
```bash
sudo journalctl -u gos-assistant -f
```

**За последний час:**
```bash
sudo journalctl -u gos-assistant --since "1 hour ago"
```

**Только ошибки:**
```bash
sudo journalctl -u gos-assistant -p err --since today
```

**Логи Nginx (FastPanel):**
```bash
sudo tail -f /var/www/gosassistent_usr/data/logs/gosassistent.su-frontend.access.log
sudo tail -f /var/www/gosassistent_usr/data/logs/gosassistent.su-frontend.error.log
```

---

## Управление сервисом

```bash
sudo systemctl status gos-assistant       # статус
sudo systemctl restart gos-assistant      # рестарт
sudo systemctl stop gos-assistant         # остановить
sudo systemctl start gos-assistant        # запустить
sudo systemctl reload nginx               # перечитать конфиг Nginx
```

---

## Загрузка релиза приложения (`.exe`)

Собери локально:
```powershell
cd "D:/MVD Assistant"
Remove-Item -Recurse -Force release -ErrorAction SilentlyContinue
npm run dist
```

Файлы `release\GOS Assistant Setup X.X.X.exe` и `release\GOS Assistant-X.X.X-portable.exe` загрузи через **админку сайта** → **Релизы** → **Загрузить релиз**. Дальше юзеры получат обновление автоматом через ~4 часа.

---

## Работа с БД

**Бэкап вручную (перед рискованным изменением):**
```bash
mysqldump -u gos -p'ТВОЙ_ПАРОЛЬ' gos_assistant \
  --single-transaction --quick --routines --triggers --no-tablespaces \
  | gzip > ~/backup-manual-$(date +%Y%m%d-%H%M).sql.gz

ls -lh ~/backup-manual-*.sql.gz
```

**Восстановление из бэкапа:**
```bash
gunzip < ~/backup-manual-YYYYMMDD-HHMM.sql.gz | mysql -u gos -p'ТВОЙ_ПАРОЛЬ' gos_assistant
```

**Автоматические бэкапы** лежат в `/var/backups/gos/` (крон в 04:00 ежедневно, 14 последних хранятся).

**Экспорт/импорт через админку сайта:** `/admin.html` → **База данных** → «Скачать SQL-дамп» / «Восстановить из файла».

---

## Диагностика при проблемах

**Сайт не открывается:**
```bash
sudo systemctl status gos-assistant | head -8
sudo systemctl status nginx | head -8
curl -H "Host: gosassistent.su" http://127.0.0.1/api/health
```

**500 от `/api/*`:**
```bash
sudo journalctl -u gos-assistant -n 30 --no-pager
```

**502 Bad Gateway от Nginx:**
Значит Node упал. Смотри логи выше и рестартуй:
```bash
sudo systemctl restart gos-assistant
```

**Все юзеры разлогинились после апдейта:**
Значит `JWT_SECRET` в `.env` поменялся. Проверь:
```bash
grep JWT_SECRET /var/www/gos/backend/.env
```
Если случайно перезаписал — верни старый (или ротируй новый, но тогда все зайдут заново).

**429 Too Many Requests при логине:**
Rate limit сработал (20 req / 15 min на `/auth`). Рестарт сбрасывает счётчик:
```bash
sudo systemctl restart gos-assistant
```

**Invalid token у авторизованных запросов:**
Обычно значит, что в браузере лежит старый токен от предыдущего сервера. Юзер очищает localStorage (`F12 → Application → Local Storage → Clear`) и логинится заново.

**MySQL ошибки:**
```bash
sudo journalctl -u mysql -n 20 --no-pager
mysql -u gos -p gos_assistant -e "SELECT COUNT(*) FROM users;"
```

**Место на диске:**
```bash
df -h
du -sh /var/backups/gos/
du -sh /var/www/gos/uploads/
```

---

## Откат к предыдущей версии

Если последний деплой сломал прод:

```bash
cd /var/www/gos
git log --oneline -5              # видишь последние коммиты
git reset --hard HEAD~1           # откатиться на 1 коммит назад
sudo systemctl restart gos-assistant
```

Если менялась схема БД и надо откатить и её — восстановить из бэкапа перед проблемным деплоем:
```bash
ls -lht /var/backups/gos/ | head -5
gunzip < /var/backups/gos/db-YYYYMMDD-HHMM.sql.gz | mysql -u gos -p'ТВОЙ_ПАРОЛЬ' gos_assistant
sudo systemctl restart gos-assistant
```

---

## Обновление `.env`

Добавить/поменять переменную:
```bash
sudo nano /var/www/gos/backend/.env
# ...правишь
sudo systemctl restart gos-assistant   # обязательно, иначе не подхватит
```

**Никогда не коммить `.env` в git** — `.gitignore` его игнорит, но проверь на всякий:
```bash
grep -n "backend/\.env\|^\.env" /var/www/gos/.gitignore
```

---

## Nginx конфиг сайта (FastPanel)

Если нужно поправить прокси/лимиты:
```bash
sudo nano /etc/nginx/fastpanel2-available/gosassistent_usr/gosassistent.su.conf
sudo nginx -t
sudo systemctl reload nginx
```

**Не редактируй через FastPanel-UI и файл одновременно** — FastPanel может перезаписать твои правки. Выбери один способ.

Текущий live-конфиг после запуска: `/etc/nginx/fastpanel2-sites/gosassistent.conf`.

---

## GitHub Actions авто-деплой (если настроен)

Просто `git push` — GitHub Actions сам зайдёт по SSH и обновит.
Смотри статус: репо → **Actions** → последний run.

Если workflow упал:
- Пропали SSH-secrets в репо → Settings → Secrets and variables → Actions
- Пароль/ключ сменился на сервере
- Сервер недоступен

Ручной запуск того же workflow: репо → Actions → выбор workflow → **Run workflow** → main.

---

## Полезные команды разово

**Проверить кто зашёл по SSH:**
```bash
last -n 20
```

**Firewall статус:**
```bash
sudo ufw status
```

**Место MySQL и топ таблиц по размеру:**
```bash
sudo du -sh /var/lib/mysql
mysql -u gos -p gos_assistant -e "
SELECT table_name, ROUND((data_length + index_length) / 1024 / 1024, 2) AS mb
FROM information_schema.tables
WHERE table_schema = 'gos_assistant'
ORDER BY (data_length + index_length) DESC LIMIT 10;"
```

**Перезапустить весь стек:**
```bash
sudo systemctl restart mysql
sudo systemctl restart gos-assistant
sudo systemctl reload nginx
```

---

## Обновление сертификата SSL

FastPanel обычно обновляет автоматом. Проверить:
```bash
sudo certbot certificates
```

Ручное обновление (если не автоматом):
```bash
sudo certbot renew --nginx
```

---

## Чек-лист перед крупным деплоем

- [ ] Бэкап БД сделан (`mysqldump` или через `/admin.html → База данных`)
- [ ] Локально протестировал через `npm start`
- [ ] Изменения в `.env` (если есть) применены на сервере тоже
- [ ] Миграции БД (`init-db.js`) отработают чисто (посмотрел логи после рестарта)
- [ ] Приложение (Electron) собрано и залито в админку, если менялся API-контракт
- [ ] Юзерам не пришлось перелогиниваться (JWT_SECRET не менялся)
