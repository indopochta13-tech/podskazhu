# SoulVoice — доступ к серверу

Краткая шпаргалка для входа по SSH и проверки логики приложения на проде.

## SSH (с Mac владельца)

```bash
ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes -o StrictHostKeyChecking=no root@201.51.3.63
```

Копирование файла:

```bash
scp -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes LOCAL_PATH root@201.51.3.63:/REMOTE_PATH
```

## Сервер приложения

| | |
|---|---|
| **IP** | `201.51.3.63` |
| **URL** | https://soulvoicee.ru |
| **SSH** | `root@201.51.3.63` |
| **Ключ** | `~/.ssh/id_rei_do` |

## Где лежит код и данные

| Что | Путь |
|-----|------|
| Код приложения | `/opt/voicecapture/` |
| Точка входа | `/opt/voicecapture/server.js` |
| Логика парсинга / NLP | `/opt/voicecapture/lib/parse.js` |
| Клиент (PWA) | `/opt/voicecapture/public/app.js` |
| Версия для клиента | `/opt/voicecapture/public/app-version.json` |
| APK | `/opt/voicecapture/public/download/soulvoice.apk` |
| База данных | `/var/lib/voicecapture/db.json` |
| Логи сервиса | `journalctl -u voicecapture -f` |

## Архитектура

```
Интернет → Caddy (TLS, soulvoicee.ru)
              ↓ reverse_proxy
         127.0.0.1:8790  (Node, только localhost)
              ↓
         /opt/voicecapture/server.js   (код, user vcapp)
              ↓
         /var/lib/voicecapture/db.json (данные)
```

| Что | Где |
|---|---|
| Секреты | `/etc/voicecapture.env` (**не читать в чат, не коммитить**) |
| systemd unit | `/etc/systemd/system/voicecapture.service` |
| Caddy | `/etc/caddy/Caddyfile` |
| Access log Caddy | `/var/log/caddy/access.log` |

## Полезные команды на сервере

```bash
systemctl status voicecapture
systemctl restart voicecapture
journalctl -u voicecapture -n 100 --no-pager
journalctl -u voicecapture -f

curl -s https://soulvoicee.ru/app-version.json
curl -sI http://127.0.0.1:8790/
```

## Локальный репозиторий (на Mac)

```
/Users/valerii/Downloads/voicecapture/
```

Подробный handoff: [AI_HANDOFF.md](./AI_HANDOFF.md)

---

**Не открывать в чат:** `/etc/voicecapture.env` (секреты Prodamus и др.)
