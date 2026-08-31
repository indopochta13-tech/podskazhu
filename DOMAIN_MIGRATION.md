# Миграция SoulVoice на свой домен

> **Канонический домен:** **soulvoicee.ru** (`https://soulvoicee.ru`, продление ~399 ₽/год).  
> В имени две буквы «e» (`soulvoicee` вместо `soulvoice`) — осознанный компромисс: `soulvoice.ru` занят/дорог, а `.ru` нужен для RuStore и доверия модерации.

**Статус (август 2026): миграция завершена.** DNS → `201.51.3.63`. Caddy обслуживает:
- **soulvoicee.ru** + **www** — только приложение (RuStore, диплинки, APK, API);
- **vc.201-51-3-63.sslip.io** — лендинг / портфолио разработчика (отдельный домен, тот же backend).

Цель: постоянный домен без IP в имени — для RuStore, диплинков Android, Prodamus, QR «Подключить рядом».

> **Домен ещё не выбран?** Пройдите шаги ниже в панели регистратора, затем напишите ассистенту:
> `DOMAIN=ваш-домен.ru` — он обновит все файлы из чеклиста.

---

## 1. Купить новый или добавить существующий?

| Ситуация | Что нажать в панели регистратора |
|---|---|
| **Домена ещё нет** | **«Купить домен»** — зарегистрировать новое имя (.ru / .app / .online) |
| **Домен уже куплен** (у другого регистратора или «лежит» без сайта) | **«Добавить домен»** — привязать к этому аккаунту и управлять DNS отсюда |
| **Покупаете именно у этого регистратора** (RU-Center / nic.ru и т.п.) | После покупки NS уже будут их — менять ничего не нужно, только A-запись |

**Не покупайте домен через ассистента** — только вы в панели регистратора.

### Какое имя выбрать (SoulVoice / RuStore)

Приоритет для российского магазина — **`.ru`**: доверие модерации, политика конфиденциальности, ссылки в карточке приложения.

| Вариант | Комментарий |
|---|---|
| **`podskazhu.ru`** | Близко к бренду UI «Подскажу» — проверьте свободность в поиске регистратора |
| **`soulvoice.ru`** | Идеально по бренду APK, но **сейчас продаётся** в магазине RU-Center (дорого) |
| **`soulvoice.app`** | Хорош для приложения; `.app` требует HTTPS (Caddy даст автоматически) |
| **`app.ваш-домен.ru`** | Если основной домен занят — поддомен `app.` или `vc.` |
| ~~`zapisi.ru`~~ | **Занят** другим владельцем |
| **`getsoulvoice.ru`**, **`mysoulvoice.ru`** | Запасные, если короткие заняты |

Рекомендация: **`podskazhu.ru`** или **`soulvoice.app`**, если `soulvoice.ru` не готовы покупать у перекупщика.

---

## 2. Пошагово в панели регистратора

### Вариант A — «Купить домен»

1. Нажмите **«Купить домен»**.
2. Введите имя (например `podskazhu.ru`) → проверка свободности.
3. Добавьте в корзину → оплатите (обычно ~200–500 ₽/год за `.ru`).
4. Домен появится в списке «Мои домены» — NS уже у регистратора.
5. Откройте **Управление DNS** / **Ресурсные записи** для домена.
6. Добавьте записи (см. раздел 3).
7. Сохраните. Распространение DNS: **5–30 мин**, иногда до 24 ч.

### Вариант B — «Добавить домен» (уже куплен elsewhere)

1. Нажмите **«Добавить домен»**.
2. Введите существующее имя → подтвердите владение (письмо на admin@ / DNS TXT / файл).
3. **Смените NS** у старого регистратора на NS, которые покажет панель (обычно `ns1.nic.ru`, `ns2.nic.ru` или аналог).
4. Дождитесь делегирования (до 24–48 ч).
5. В панели этого регистратора → DNS → A-запись (раздел 3).

> Если не хотите менять NS — оставьте DNS у старого регистратора и добавьте там только **A → 201.51.3.63** (раздел 3). Кнопку «Добавить домен» тогда можно не использовать.

---

## 3. DNS: что прописать

**Сервер приложения:** `201.51.3.63`

### Минимум (корневой домен)

| Тип | Имя / Host | Значение | TTL |
|---|---|---|---|
| **A** | `@` (или пусто) | `201.51.3.63` | 300–3600 |
| **A** | `www` | `201.51.3.63` | 300–3600 *(опционально)* |

Пример: домен `podskazhu.ru` → сайт `https://podskazhu.ru`.

### Если нужен поддомен (как сейчас `vc.`)

| Тип | Имя | Значение |
|---|---|---|
| **A** | `vc` | `201.51.3.63` |

Пример: `https://vc.podskazhu.ru`.

**Caddy** на сервере выпустит Let's Encrypt автоматически, когда DNS укажет на IP и порт 80/443 открыт.

Проверка с Mac:

```bash
dig +short podskazhu.ru A
# должно вернуть: 201.51.3.63
```

---

## 4. Что написать ассистенту после покупки

Скопируйте одной строкой:

```
DOMAIN=podskazhu.ru
```

или с поддоменом:

```
DOMAIN=vc.podskazhu.ru
```

Ассистент:

1. Обновит файлы из чеклиста (ниже).
2. Подготовит блок Caddy для `/etc/caddy/Caddyfile`.
3. Подскажет команды на сервере (`VC_ORIGIN`, `systemctl reload caddy`, пересборка APK).

**Не присылайте** содержимое `/etc/voicecapture.env` и ключи.

---

## 5. Сервер: Caddy

В `/etc/caddy/Caddyfile` один блок: `soulvoicee.ru, www.soulvoicee.ru` (прокси на `127.0.0.1:8790`).

Шаблон — **`app/deploy/caddy-site.txt`**.

```bash
# на сервере, от root
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -sI "https://soulvoicee.ru/app-version.json"
```

### systemd: VC_ORIGIN

```bash
# /etc/systemd/system/voicecapture.service
Environment=VC_ORIGIN=https://soulvoicee.ru
Environment=VC_CONTACT=mailto:admin@soulvoicee.ru

systemctl daemon-reload
systemctl restart voicecapture
```

Если в `/etc/voicecapture.env` есть `VC_PRODAMUS_*_URL` — обновите на новый домен и **пересохраните webhook в кабинете Prodamus**.

---

## 6. Чеклист файлов в репозитории (выполнено для soulvoicee.ru)

Все перечисленные файлы обновлены на `https://soulvoicee.ru`. Fallback на sslip.io удалён из клиентов.

### Критично (ломает приложение без этого)

| Файл | Что менять |
|---|---|
| `app/deploy/caddy-site.txt` | имя сайта в первой строке |
| `app/deploy/voicecapture.service` | `VC_ORIGIN`, `VC_CONTACT` |
| `mobile/android/app/src/main/AndroidManifest.xml` | `android:host` в intent-filter (диплинк `/?join=`) |
| `mobile/android/app/src/main/java/ru/soulvoice/app/WidgetApi.java` | `DEFAULT_API` (виджет без открытого приложения) |
| `mobile/build-www.mjs` | fallback `VC_API_BASE` → зашивается в APK при сборке |
| `app/public/.well-known/assetlinks.json` | домен не в JSON, но файл должен отдаваться с **нового** HTTPS-хоста для App Links |

### Сборка APK (команда)

```bash
cd voicecapture/mobile
VC_API_BASE=https://YOUR_DOMAIN npm run build:www
# затем release-сборка AAB/APK
```

### Сервер / env

| Файл | Что менять |
|---|---|
| `/etc/systemd/system/voicecapture.service` *(на сервере)* | `VC_ORIGIN`, `VC_CONTACT` |
| `/etc/caddy/Caddyfile` *(на сервере)* | новый site block |
| `/etc/voicecapture.env` *(на сервере, секреты)* | `VC_PRODAMUS_NOTIFICATION_URL`, `VC_PRODAMUS_RETURN_URL` если заданы |
| `app/deploy/voicecapture.env.example` | комментарии-примеры URL |
| `app/lib/prodamus.js` | fallback return URL (если не задан `VC_ORIGIN`) |

### Документация и RuStore

| Файл | Что менять |
|---|---|
| `AI_HANDOFF.md` | публичный URL, APK, Caddy, curl-примеры |
| `SSH_SERVER.md` | строка «Сайт» |
| `mobile/README.md` | политика, APK, `VC_API_BASE` (сейчас устаревший IP 167.x) |
| `app/README.md` | живой адрес (сейчас 167.x) |
| `SOSTOYANIE_PROEKTA.md` | пункт про домен — отметить выполненным |

### Вторично (портфолио, QA)

| Файл | Что менять |
|---|---|
| `portfolio/index.html` | ссылки на приложение (soulvoicee.ru) и APK |
| `portfolio/privacy.html` | URL сайта портфолио (sslip.io) в тексте политики |
| `portfolio/consent.html` | URL в согласии |
| `qa/fix-live.mjs` | URL для Playwright (если используете) |

### Не требуют смены домена

| Файл | Почему |
|---|---|
| `app/server.js` `APP_ORIGINS` | Capacitor origins (`localhost`), не домен сервера |
| `app/public/app-version.json` | `apkUrl` относительный (`/download/...`) |
| `app/public/app.js` | берёт `window.VC_API_BASE` из сборки |

---

## 7. После миграции

1. **Проверить HTTPS:** `curl -sI https://soulvoicee.ru/`
2. **App Links:** `curl -s https://soulvoicee.ru/.well-known/assetlinks.json`
3. **API:** `curl -s https://soulvoicee.ru/app-version.json`
4. **Собрать и выложить новый APK/AAB** — иначе в телефоне останется старый API URL.
5. **RuStore:** URL политики — `https://soulvoicee.ru/privacy.html`
6. **Prodamus:** webhook `https://soulvoicee.ru/api/billing/prodamus/webhook`, return `https://soulvoicee.ru/?billing=return`

---

## 8. Быстрый поиск по репозиторию

```bash
cd voicecapture
rg -n 'sslip\.io|201-51-3-63|VC_ORIGIN|VC_API_BASE|android:host'
```

---

*Обновлено: август 2026. Сервер: `201.51.3.63`, SSH: `~/.ssh/id_rei_do`.*
