# SoulVoice — handoff для Cloud Agent

> **Обновлено:** 31 августа 2026  
> Этот файл — точка входа для **Cursor Cloud Agent**. Общий handoff по серверу и деплою: [`AI_HANDOFF.md`](AI_HANDOFF.md). Продуктовые решения: [`SOSTOYANIE_PROEKTA.md`](SOSTOYANIE_PROEKTA.md).

---

## TL;DR

| Что | Значение |
|---|---|
| Рабочий корень | `/Users/valerii/Downloads/voicecapture` |
| Бренд | **SoulVoice** |
| Android `applicationId` | `ru.soulvoice.app` (было `ru.zapisala.app`) |
| Домен | https://soulvoicee.ru |
| Прод-сервер | `201.51.3.63`, SSH `~/.ssh/id_rei_do` |
| Текущий релиз | **1.9.50** (`versionCode` 208, `shellVersion` 129) |
| Git | `master`, коммит `a9f466d`, **remote нет** |
| Сборка APK | `cd mobile && npm run apk:release` |

---

## 1. Split — 31 августа 2026

**SoulVoice / VoiceCapture больше НЕ внутри `psyche_circles`.** Проекты разделены.

| Проект | Путь | Git |
|---|---|---|
| **SoulVoice** (этот) | `/Users/valerii/Downloads/voicecapture` | Свежий репо, `master`, без remote |
| **Psyche** (другой продукт) | `/Users/valerii/Downloads/psyche_circles` | Ветка `etap-3-vneshniy-vid`, каталог `voicecapture/` удалён |
| Backup до split | `/Users/valerii/Downloads/psyche_circles.backup` | Только для справки, не рабочий |

**Начальный коммит SoulVoice:** `a9f466d` — «SoulVoice: начальный коммит после split из psyche_circles (ru.soulvoice.app)».

---

## 2. Rebrand — 31 августа 2026

| Было (Zapisala) | Стало (SoulVoice) |
|---|---|
| Display name «Записала» | **SoulVoice** |
| `ru.zapisala.app` | **`ru.soulvoice.app`** |
| `zapisala://` | **`soulvoice://`** |
| `ZapisalaWidget` | **`SoulVoiceWidget`** |
| Старый keystore | **`mobile/keys/soulvoice-release.jks`** |

### Домен и URL

- **Канонический домен:** https://soulvoicee.ru
- **PWA:** https://soulvoicee.ru/app/
- **APK (latest):** https://soulvoicee.ru/download/soulvoice.apk
- **Версионные APK:** `/download/soulvoice-X.Y.Z.apk`

### Deep links и App Links

- Custom scheme: `soulvoice://` (виджет, интенты)
- Digital Asset Links: `app/public/.well-known/assetlinks.json` → package `ru.soulvoice.app`

### ⚠️ Миграция для пользователей

- Старое приложение **`ru.zapisala.app` нужно удалить** перед установкой нового APK.
- Два пакета на одном устройстве — разные приложения, данные не переносятся автоматически.
- **RuStore:** ещё **не зарегистрировано** — регистрировать как `ru.soulvoice.app`.

---

## 3. Production (не менялся split/rebrand локально)

| | |
|---|---|
| **IP** | `201.51.3.63` |
| **Hostname** | `soulvoice-test` |
| **SSH** | `ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63` |
| **Код на сервере** | `/opt/voicecapture/` |
| **Данные** | `/var/lib/voicecapture/` (`db.json`) |
| **Секреты** | `/etc/voicecapture.env` — **не читать, не коммитить** |
| **systemd** | `voicecapture.service`, порт `127.0.0.1:8790` |
| **Caddy** | TLS для `soulvoicee.ru` |

**Текущая версия на сервере (локальный источник правды):**

```json
// app/public/app-version.json
{ "versionName": "1.9.50", "versionCode": 208, "shellVersion": 129 }
```

Подробнее: [`AI_HANDOFF.md`](AI_HANDOFF.md), [`SERVER_ACCESS.md`](SERVER_ACCESS.md), [`SSH_SERVER.md`](SSH_SERVER.md).

---

## 4. Правила для Cloud Agent

### ✅ Делать

1. **Работать ТОЛЬКО** в `/Users/valerii/Downloads/voicecapture` для задач SoulVoice.
2. После изменений Capacitor-конфига: `npx cap sync android` (или `npm run sync` из `mobile/`).
3. Перед деплоем APK — проверить сборку локально; перед деплоем сервера — `node test/parse.test.js`.
4. Коммиты — **только по явной просьбе** владельца.
5. Поднимать `versionCode` / `versionName` / `app-version.json` **одновременно** при релизе APK.

### ❌ Не делать

1. **Не `git add` из `psyche_circles`** и не смешивать проекты.
2. **Не деплоить сломанные Cloud APK-сборки.** Инцидент **1.9.51–1.9.60**: Cloud Agent собирал и выкладывал нерабочие APK без проверки на устройстве. Не повторять.
3. **Не деплоить на прод** без явной просьбы владельца.
4. **Не печатать** секреты (`voicecapture.env`, keystore, токены).
5. Правило **«статичные кадры»** (без Ken Burns/zoompan) относится к **psyche_circles**, **не к SoulVoice**.

### Cursor rule

Файл `.cursor/rules/no-monorepo.mdc` — alwaysApply: SoulVoice живёт отдельно от psyche.

---

## 5. Сборка Android

```bash
cd /Users/valerii/Downloads/voicecapture/mobile
npm run apk:release
```

Скрипт делает: lint web → `build-www.mjs` → patch speech → `cap sync android` → `gradlew assembleRelease`.

**Выход APK:** `mobile/android/app/build/outputs/apk/release/app-release.apk`

**Подпись:** `mobile/android/keystore.properties` (локально, не в git) → `mobile/keys/soulvoice-release.jks`

**AAB для RuStore:** `npm run aab:release`

---

## 6. Структура репозитория — ключевые пути

```
/Users/valerii/Downloads/voicecapture/
├── CLOUD_HANDOFF.md          ← этот файл
├── AI_HANDOFF.md             ← сервер, SSH, деплой
├── SOSTOYANIE_PROEKTA.md     ← продуктовые решения, этапы
├── SERVER_ACCESS.md
├── SSH_SERVER.md
├── DOMAIN_MIGRATION.md       ← история миграции домена
├── .cursor/rules/no-monorepo.mdc
│
├── app/                      ← Node-сервер + PWA (источник правды для бэка)
│   ├── server.js             ← API, handleCapture
│   ├── lib/
│   │   ├── parse.js          ← разбор RU-речи → create/cancel/move
│   │   ├── voice.js          ← реплики (не менять без нужды)
│   │   ├── store.js, time.js, billing.js, …
│   ├── public/
│   │   ├── app.js            ← UI полок, настройки, виджет-конструктор
│   │   ├── app-version.json  ← версия для клиента
│   │   ├── .well-known/assetlinks.json
│   │   └── download/         ← soulvoice.apk (+ версионные копии)
│   ├── deploy/               ← systemd unit, harden scripts
│   └── test/                 ← parse.test.js, api.test.js, …
│
├── mobile/                   ← Capacitor Android
│   ├── capacitor.config.json ← appId: ru.soulvoice.app, appName: SoulVoice
│   ├── package.json          ← apk:release, aab:release, sync
│   ├── build-www.mjs         ← копирует app/public → mobile/www
│   ├── native/native.js      ← LocalNotifications, syncReminders
│   ├── keys/soulvoice-release.jks
│   ├── android/
│   │   ├── keystore.properties   ← локально, не в git
│   │   └── app/build.gradle      ← versionCode 208, versionName 1.9.50
│   └── android/app/src/main/java/ru/soulvoice/app/
│       ├── SoulVoiceWidget.java
│       ├── WidgetRecordActivity.java   ← STT → /api/capture
│       ├── WidgetRowActionActivity.java
│       ├── ReminderScheduler.java
│       ├── ReminderAlarmReceiver.java
│       ├── MainActivity.java
│       ├── UpdateBridge.java
│       └── BillingBridge.java
│
├── qa/                       ← скрипты проверки auth/fix
├── docs/                     ← pipeline/UX документы
├── brand/                    ← бренд-ассеты
├── legal/                    ← политики, согласия
└── site/                     ← лендинг
```

---

## 7. Git

| Репозиторий | Состояние |
|---|---|
| **voicecapture** | `master`, HEAD `a9f466d`, **remote не настроен** |
| **psyche_circles** | `etap-3-vneshniy-vid`, `voicecapture/` удалён — **не трогать** для SoulVoice |

```bash
cd /Users/valerii/Downloads/voicecapture
git log -1 --oneline
# a9f466d SoulVoice: начальный коммит после split из psyche_circles (ru.soulvoice.app)
```

---

## 8. Быстрый чеклист Cloud-сессии

```bash
# 1) Убедиться, что workspace = voicecapture, не psyche_circles
pwd   # /Users/valerii/Downloads/voicecapture

# 2) Версия
cat app/public/app-version.json
grep version mobile/android/app/build.gradle

# 3) Тесты parse (если трогали NLP)
cd app && node test/parse.test.js

# 4) Сервер жив (если нужна проверка)
ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63 \
  'systemctl is-active voicecapture && cat /opt/voicecapture/public/app-version.json'
```

---

## 9. Связанные документы

| Файл | Содержание |
|---|---|
| [`AI_HANDOFF.md`](AI_HANDOFF.md) | SSH, деплой A/B, архитектура, баги |
| [`SOSTOYANIE_PROEKTA.md`](SOSTOYANIE_PROEKTA.md) | Этапы 1–3, продуктовые решения, долги |
| [`DOMAIN_MIGRATION.md`](DOMAIN_MIGRATION.md) | Миграция zapisala → soulvoicee.ru |
| [`etap-2-harakter-i-golos.md`](etap-2-harakter-i-golos.md) | Этап 2 — голос |
| [`etap-3-vneshniy-vid.md`](etap-3-vneshniy-vid.md) | Этап 3 — UI |

---

*Обновляй этот файл при split/rebrand/релизе/смене сервера.*
