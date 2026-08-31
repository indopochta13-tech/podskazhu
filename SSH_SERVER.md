# SoulVoice — вход на сервер по SSH

Краткая шпаргалка: как зайти на живой сервер и где лежит код.  
Для **Cursor Cloud** — дайте агенту этот файл и убедитесь, что на машине, с которой он работает, есть SSH-ключ (см. ниже).

---

## Подключение

| | |
|---|---|
| **Приложение** | SoulVoice (voicecapture) |
| **IP** | `201.51.3.63` |
| **Hostname** | `soulvoice-test` |
| **Пользователь** | `root` |
| **Сайт** | https://soulvoicee.ru |
| **SSH-ключ** (на вашем Mac) | `~/.ssh/id_rei_do` |

### Войти в терминале

```bash
ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes -o StrictHostKeyChecking=no root@201.51.3.63
```

Первый раз может спросить fingerprint хоста — ответьте `yes`.

### Скопировать файл на сервер

```bash
scp -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes ЛОКАЛЬНЫЙ_ФАЙЛ root@201.51.3.63:/ПУТЬ/НА_СЕРВЕРЕ
```

### Скопировать файл с сервера к себе

```bash
scp -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63:/ПУТЬ/НА_СЕРВЕРЕ ЛОКАЛЬНЫЙ_ФАЙЛ
```

> **Не путать со старым IP** `167.71.72.87` — сейчас всё на **`201.51.3.63`**.

---

## Где код на сервере

После входа по SSH:

```bash
cd /opt/voicecapture
ls -la
```

| Что | Путь |
|---|---|
| Точка входа Node | `/opt/voicecapture/server.js` |
| Разбор речи (NLU) | `/opt/voicecapture/lib/parse.js` |
| Остальная логика | `/opt/voicecapture/lib/` |
| Веб-интерфейс | `/opt/voicecapture/public/` (главное: `public/app.js`) |
| Версия APK для клиента | `/opt/voicecapture/public/app-version.json` |
| APK | `/opt/voicecapture/public/download/` |
| База пользователей | `/var/lib/voicecapture/db.json` |
| Секреты (не открывать в чат) | `/etc/voicecapture.env` |

На сервере лежит **содержимое локальной папки** `voicecapture/app/` — не весь репозиторий с Android.

Локальная копия того же кода (в Cursor):

```
/Users/valerii/Downloads/voicecapture/app/
```

---

## Полезные команды на сервере

```bash
# статус сервиса
systemctl status voicecapture

# перезапуск после правок
systemctl restart voicecapture

# логи (последние 100 строк)
journalctl -u voicecapture -n 100 --no-pager

# логи в реальном времени (выход: Ctrl+C)
journalctl -u voicecapture -f

# версия, которую видит приложение
cat /opt/voicecapture/public/app-version.json

# проверка API с самого сервера
curl -s http://127.0.0.1:8790/app-version.json
```

Сервис слушает **только localhost:8790**; снаружи — HTTPS через Caddy.

---

## Для Cursor Cloud

1. **Ключ:** Cloud-агент должен иметь доступ к приватному ключу `~/.ssh/id_rei_do` (или вы добавляете ключ в настройки Cloud / даёте агенту команду с путём к ключу на вашей машине, если сессия идёт с вашего компьютера).
2. **После входа** смотреть код: `cd /opt/voicecapture && find . -maxdepth 2 -type f | head -50`
3. **Не читать и не вставлять в чат** содержимое `/etc/voicecapture.env` и `db.json` с личными данными.
4. Подробный handoff для ИИ: `voicecapture/AI_HANDOFF.md` в этом же репозитории.

### Быстрый просмотр кода без полного входа

С локальной машины (одна команда):

```bash
ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63 'head -80 /opt/voicecapture/server.js'
```

Или скачать папку к себе:

```bash
rsync -az -e "ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes" \
  root@201.51.3.63:/opt/voicecapture/ ./server-copy/
```

---

## Деплой с Mac (кратко)

Полная синхронизация кода `app/`:

```bash
cd /Users/valerii/Downloads/voicecapture

rsync -az --delete --exclude node_modules --exclude data \
  -e "ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes" \
  voicecapture/app/ root@201.51.3.63:/opt/voicecapture/

ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63 \
  'cd /opt/voicecapture && npm install --omit=dev && sh deploy/fix-public-perms.sh && systemctl restart voicecapture'
```

---

*Обновлено: август 2026. Актуальный хост: `201.51.3.63`.*
