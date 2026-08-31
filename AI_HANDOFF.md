# SoulVoice — handoff для другого ИИ

Документ, чтобы сразу подключиться к живому серверу и коду и помогать без разведки с нуля.

Бренд в UI: **SoulVoice**. Пакет Android: `ru.soulvoice.app`. Код и сервис на сервере часто называются **voicecapture** (историческое имя каталога).

---

## 1. Живой сервер (актуальный)

| | |
|---|---|
| **IP** | `201.51.3.63` |
| **Hostname** | `soulvoice-test` |
| **Публичный URL** | https://soulvoicee.ru |
| **APK** | https://soulvoicee.ru/download/soulvoice.apk |
| **Версия на сервере (на момент handoff)** | **1.9.38** (`versionCode` 185) |
| **SSH** | `root@201.51.3.63` |
| **Ключ на машине владельца** | `~/.ssh/id_rei_do` |

### Вход по SSH

```bash
ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes -o StrictHostKeyChecking=no root@201.51.3.63
```

Копирование файла:

```bash
scp -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes LOCAL_PATH root@201.51.3.63:/REMOTE_PATH
```

> **Устарело:** в `README.md` ещё встречается старый хост `167.71.72.87`.  
> **Сейчас приложение живёт на `201.51.3.63`, канонический домен `soulvoicee.ru`.** Не деплой на старый IP, пока владелец явно не скажет иначе.

---

## 2. Как устроено на сервере

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
| Код приложения | `/opt/voicecapture/` |
| Точка входа | `/opt/voicecapture/server.js` |
| NLP / разбор речи | `/opt/voicecapture/lib/parse.js` (+ другие файлы в `lib/`) |
| Статика / PWA / APK | `/opt/voicecapture/public/` |
| APK для обновления | `/opt/voicecapture/public/download/soulvoice.apk` (+ версионные копии) |
| Версия для клиента | `/opt/voicecapture/public/app-version.json` |
| Данные | `/var/lib/voicecapture/` (`db.json`, `backups/`, `sim-audio/`) |
| Секреты | `/etc/voicecapture.env` (**не читать в чат, не коммитить**) |
| systemd unit | `/etc/systemd/system/voicecapture.service` |
| Caddy | `/etc/caddy/Caddyfile` → сайты `soulvoicee.ru`, `www.soulvoicee.ru` |
| Бэкап БД | `/etc/cron.daily/voicecapture-backup` → `/var/lib/voicecapture/backups/` (14 дней) |
| Логи | `journalctl -u voicecapture -f` |
| Access log Caddy | `/var/log/caddy/access.log` |

Сервис крутится от пользователя **`vcapp`**, порт **`8790`** только на `127.0.0.1`. Снаружи — только Caddy с HTTPS.

### Полезные команды на сервере

```bash
systemctl status voicecapture
systemctl restart voicecapture
journalctl -u voicecapture -n 100 --no-pager
journalctl -u voicecapture -f

# быстрая проверка API/статики с самого хоста
curl -sI http://127.0.0.1:8790/
curl -s https://soulvoicee.ru/app-version.json
```

### Переменные в unit + env

В unit заданы (пример с живого сервера):

- `VC_PORT=8790`
- `VC_HOST=127.0.0.1`
- `VC_DATA_DIR=/var/lib/voicecapture`
- `VC_ORIGIN=https://soulvoicee.ru`
- `VC_CONTACT=mailto:admin@soulvoicee.ru`
- `EnvironmentFile=-/etc/voicecapture.env`

В `/etc/voicecapture.env` обычно лежат (значения секретов **не копировать в ответы**):

- Telegram поддержка: `VC_TG_BOT_TOKEN`, `VC_TG_CHAT_ID`
- Тренажёр / идеи: `VC_SIM_PROVIDER`, `VC_YC_API_KEY`, `VC_YC_FOLDER_ID`, модели `VC_YC_MODEL_*`
- Опционально: `VC_OPENAI_KEY`, `VC_ELEVENLABS_KEY`, …

Шаблон без секретов: в репозитории `app/deploy/voicecapture.env.example`.

---

## 3. Локальный репозиторий

На машине владельца (Cursor workspace):

```
/Users/valerii/Downloads/voicecapture/
├── app/                 ← Node-сервер + веб UI (источник правды для бэка)
│   ├── server.js
│   ├── lib/parse.js     ← разбор русской речи → задачи
│   ├── lib/time.js, store.js, billing.js, sim/, …
│   ├── public/          ← PWA, стили, app.js, APK download path
│   ├── test/            ← parse.test.js, api.test.js, …
│   └── deploy/          ← systemd unit, harden scripts
└── mobile/              ← Capacitor Android
    ├── capacitor.config.json   (appName: SoulVoice, appId: ru.soulvoice.app)
    ├── native/native.js        ← LocalNotifications, syncReminders, обновления
    └── android/                ← виджет, AlarmManager, STT с виджета
```

**Отдельный репозиторий SoulVoice** (раньше каталог `voicecapture/` в монорепо `psyche_circles`).

---

## 4. Деплой: что куда класть

### A) Правки только сервера (NLP, API, web UI)

Частый быстрый путь (отдельные файлы):

```bash
# с локальной машины
scp -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes \
  voicecapture/app/lib/parse.js \
  root@201.51.3.63:/tmp/parse.js

scp -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes \
  voicecapture/app/server.js \
  root@201.51.3.63:/tmp/server.js

ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63 '
  cp /tmp/parse.js /opt/voicecapture/lib/parse.js
  cp /tmp/server.js /opt/voicecapture/server.js
  systemctl restart voicecapture
  systemctl is-active voicecapture
'
```

Полный rsync кода `app/` (осторожно с `--delete`):

```bash
rsync -az --delete --exclude node_modules --exclude data \
  -e "ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes" \
  voicecapture/app/ root@201.51.3.63:/opt/voicecapture/

ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63 \
  'cd /opt/voicecapture && npm install --omit=dev && sh deploy/fix-public-perms.sh && systemctl restart voicecapture'
```

**Важно:** на сервере дерево плоское (`/opt/voicecapture/server.js`, `/opt/voicecapture/lib/…`, `/opt/voicecapture/public/…`) — это содержимое локальной папки `voicecapture/app/`, не весь `voicecapture/`.

После деплоя web/parse пользователю **не нужен новый APK**, если менялось только серверное поведение (например команды «внеси правки»).

### B) Правки Android (виджет, AlarmManager, иконки, native bridge)

1. Править код в `voicecapture/mobile/…` и при необходимости web в `app/public` (Capacitor копирует web в `mobile/www` при sync).
2. Поднять версию **одновременно**:
   - `mobile/android/app/build.gradle` → `versionCode` / `versionName`
   - `app/public/app-version.json` → те же значения + `apkUrl`
3. Собрать release APK (`JAVA_HOME` = JBR из Android Studio), подпись из `mobile/android/keystore.properties` (локально, не в git).
4. Выложить:

```bash
# пример
scp -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes \
  mobile/android/app/build/outputs/apk/release/app-release.apk \
  root@201.51.3.63:/opt/voicecapture/public/download/soulvoice.apk

scp … soulvoice-X.Y.Z.apk   # версионная копия рядом
# Версионные копии APK рядом с soulvoice.apk
scp … app-version.json → /opt/voicecapture/public/app-version.json

# после scp/rsync — права для User=vcapp (иначе app-version.json → 500 read)
ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63 \
  'sh /opt/voicecapture/deploy/fix-public-perms.sh'
```

Пользователь обновляет: в приложении **Настройки → Обновление**, либо скачивает APK по ссылке выше (ставить поверх).

Package: `ru.soulvoice.app`. Domains в манифесте: `soulvoicee.ru`.

---

## 5. Архитектура продукта (коротко)

| Слой | Роль |
|---|---|
| `lib/parse.js` | Правила разбора RU-фразы → create / cancel / move (+ target markers) |
| `server.js` `handleCapture` | Применяет parse к `db.json`, create/move/cancel |
| Web `public/app.js` | UI полок, настройки, конструктор виджета, snapshot для виджета |
| Capacitor `native/native.js` | `LocalNotifications.syncReminders` когда открыто приложение |
| Android widget | `SoulVoiceWidget`, `WidgetRecordActivity` (STT→`/api/capture`), `WidgetRowActionActivity` (trash/alarm/edit без полного UI) |
| `ReminderScheduler` + `ReminderAlarmReceiver` | Exact alarm с виджета, даже если приложение закрыто |

### Важные интенты parse

- **create** — новая запись
- **cancel** — отмени/удали/убери…
- **move** — перенеси / измени / поменяй / **внеси правки|изменения** / исправь / поправь / добавь время…  
  Не создавать новую заметку с названием «Внеси правки».

Тесты: `cd voicecapture/app && node test/parse.test.js` (и другие `test/*.test.js`).

---

## 6. Недавние баги и ожидания (контекст)

Уже чинилось (не ломать при следующих правках):

1. Заголовки: «установи будильник…» → **«Будильник…»**, не «Установи».
2. Будильник с виджета должен звонить через native AlarmManager, не только через Capacitor sync.
3. Иконки в строке виджета слева направо: **будильник → карандаш → корзина**; привязка по `R.id`, не по позиции.
4. Тап по будильнику = toggle alarm, **не удаление** строки.
5. «Внеси изменения в заметку X на 9 утра» = **move** существующей записи X.

Палитра UI: тихий teal `#3D7A72` («C Тихий teal»).

---

## 7. Правила работы для ИИ-помощника

1. **Секреты** из `/etc/voicecapture.env`, keystore, токены — не печатать и не коммитить.
2. **Не делать** `git push --force`, не трогать чужие сервисы на том же IP без нужды.
3. Коммиты — только если владелец явно попросил.
4. Перед деплоем на прод: прогнать релевантные тесты (`parse.test.js` минимум для NLP).
5. После `systemctl restart voicecapture` проверить `systemctl is-active voicecapture` и при необходимости `journalctl`.
6. Для Android-багов уточнять: воспроизводится с **виджета** или из **открытого приложения** (разные пути планирования уведомлений).
7. README в репо может врать про старый IP — сверяйся с этим handoff и с живым `voicecapture.service` на сервере.

---

## 8. Быстрый чеклист «я подключился»

```bash
# 1) SSH
ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63

# 2) сервис жив
systemctl is-active voicecapture   # active

# 3) версия
cat /opt/voicecapture/public/app-version.json

# 4) публичка
curl -sI https://soulvoicee.ru/ | head -5

# 5) локальный код
cd /Users/valerii/Downloads/voicecapture/app
node test/parse.test.js
```

Дальше можно править код локально → деплой A или B по разделу 4.

---

*Файл: `voicecapture/AI_HANDOFF.md`. Обновляй IP/версию, если сервер переедет.*
