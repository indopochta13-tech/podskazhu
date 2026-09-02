# SoulVoice — проверка сайта после деплоя

> **Зачем:** soulvoicee.ru ломался после деплоя только `app/` — на главной вместо лендинга появлялся PWA («овал телефона» на десктопе и вечное «Загружаю…»). Перед проверкой кассы (Prodamus) и любым релизом — прогонять чеклист ниже.

**Связанные файлы:** [`AI_HANDOFF.md`](AI_HANDOFF.md) (SSH, rsync), [`app/deploy/caddy-site.txt`](app/deploy/caddy-site.txt) (маршруты Caddy).

---

## Два разных «сайта» на одном домене

| URL | Что должно открываться | Откуда на сервере |
|-----|------------------------|-------------------|
| `https://soulvoicee.ru/` | **Лендинг** — текст «Скажите всlух», кнопка «Скачать для Android» | `/opt/site/` ← репо `site/` |
| `https://soulvoicee.ru/app/` | **PWA-приложение** — онбординг или полки | Node `/opt/voicecapture/public/` (Caddy strip `/app`) |
| `https://soulvoicee.ru/download/` | Страница загрузки APK | Node |
| `https://soulvoicee.ru/app-version.json` | JSON с `versionName`, `versionCode` | Node |
| `https://soulvoicee.ru/privacy.html`, `/offer.html` | Юридические страницы | `/opt/site/` (или fallback Node) |
| `https://soulvoicee.ru/api/*` | API, в т.ч. `/api/billing/prodamus/webhook` | Node |

Caddy: если файл есть в `/opt/site` — отдаёт его; иначе проксирует на Node. **Если `/opt/site/index.html` пропал или не обновлён, корень `/` отдаёт PWA** — это и есть типичная поломка.

---

## Что должно работать (обязательные URL)

После **любого** деплоя проверить:

1. **`/`** — лендинг, **не** экран приложения  
   - есть «Скажите вслух» (или актуальный hero-текст из `site/index.html`)  
   - есть ссылка `a.btn[href="/download/soulvoice.apk"]`  
   - **нет** `<div class="boot">Загружаю…</div>` как основного содержимого
2. **`/app/`** — PWA загружается за несколько секунd  
   - исчезает «Загружаю…», появляется онбординг или полки  
   - на десктопе (≥680px) **овал телефона здесь нормален** — это стиль PWA, не баг
3. **`/download/`** — страница с кнопкой APK и ссылкой «в браузере»
4. **`/app-version.json`** — HTTP 200, валидный JSON, не пустой
5. **`/privacy.html`**, **`/offer.html`** — HTTP 200 (нужны для RuStore и кассы)

Быстрая проверка с машины владельца:

```bash
./scripts/check-site.sh
# или полная (Playwright, нужен node + playwright):
node qa/check-site.mjs
```

---

## Чего быть НЕ должно

| Симптом | Вероятная причина |
|---------|-------------------|
| На **`/`** овал телефона и «Загружаю…» | Нет/битый `/opt/site/index.html` → Caddy отдал PWA с корня |
| **`/app/`** зависло на «Загружаю…» | `app.js` 404/500, JS-ошибка, рассинхрон `SW_VERSION` / `__VC_SHELL_V` / `app.js?v=` |
| **`/app-version.json`** → 500 | Права после rsync/scp (`fix-public-perms.sh` не запускали) |
| Белая страница | 502/503 (Node не поднялся), или пустой ответ |
| Лендинг без скриншотов | Не залили `site/shots/` на сервер |

---

## Корневая причина инцидента (сентябрь 2026)

1. Деплоили только **`app/`** → `/opt/voicecapture/` (rsync `voicecapture/app/`).
2. **`site/`** на сервер в **`/opt/site/`** не синхронизировали — или файл пропал.
3. Caddy для `/` не нашёл лендинг → fallback на Node → отдал `public/index.html` (PWA).
4. На широком экране PWA рисуется как «телефон» (`styles.css` `@media (min-width: 680px)` → `.app { border-radius: var(--radius-pill) }`).
5. Если параллельно не подтянулся `app.js` (кэш SW, права, версия) — остаётся только «Загружаю…».

**Вывод:** деплой приложения и деплой лендинга — **две отдельные операции**.

---

## Чеклист: перед деплоем

- [ ] Понятно, **что меняется**: только backend/UI (`app/`), только лендинг (`site/`), или оба.
- [ ] Если трогали shell PWA — поднять **одновременно** в `index.html`: `__VC_SHELL_V`, `app.js?v=`, и в `sw.js` + `app.js`: `SW_VERSION`.
- [ ] `node app/test/parse.test.js` — если меняли NLP/API.
- [ ] Не деплоить на прод без явной просьбы владельца.

---

## Чеклист: деплой приложения (Node + PWA)

```bash
# с локальной машины, из корня voicecapture
rsync -az --delete --exclude node_modules --exclude data \
  -e "ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes" \
  app/ root@201.51.3.63:/opt/voicecapture/

ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63 \
  'cd /opt/voicecapture && npm install --omit=dev && sh deploy/fix-public-perms.sh && systemctl restart voicecapture && systemctl is-active voicecapture'
```

**Не трогает** `/opt/site/`. После — `./scripts/check-site.sh`.

---

## Чеклист: деплой лендинга

```bash
rsync -az \
  -e "ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes" \
  site/ root@201.51.3.63:/opt/site/

# если есть shots/ — они должны попасть вместе с site/
ssh -i ~/.ssh/id_rei_do -o IdentitiesOnly=yes root@201.51.3.63 \
  'chmod -R a+rX /opt/site'
```

Проверить **`curl -s https://soulvoicee.ru/ | head -20`** — должен быть `<title>SoulVoice — голосовой помощник`, не `<title>SoulVoice</title>` без подзаголовка (это PWA).

---

## Чеклист: после деплоя (обязательно)

```bash
./scripts/check-site.sh          # curl, ~10 с
systemctl is-active voicecapture # на сервере
curl -s https://soulvoicee.ru/app-version.json | jq .
```

Ручной smoke для **кассы (Prodamus)**:

- [ ] `https://soulvoicee.ru/` — лендинг жив, оферта и политика доступны
- [ ] `https://soulvoicee.ru/app/` → Настройки → блок подписки открывается, тарифы не «висят» на «Загружаю тарифы…» вечно
- [ ] Webhook жив: `curl -sI https://soulvoicee.ru/api/billing/prodamus/webhook` (ожидается ответ приложения, не 502)
- [ ] Return URL в Prodamus: `https://soulvoicee.ru/?billing=return` (см. `app/deploy/voicecapture.env.example`)

---

## Права и сервис

После **любого** scp/rsync в `public/`:

```bash
ssh … 'sh /opt/voicecapture/deploy/fix-public-perms.sh'
```

Иначе `vcapp` не читает файлы → 500 на `/app-version.json` и статике.

---

## Для агентов Cursor

Правило: [`.cursor/rules/site-deploy.mdc`](.cursor/rules/site-deploy.mdc) — alwaysApply при деплое.

**Кратко:** после деплоя **всегда** `./scripts/check-site.sh`; если правили `site/` — rsync в `/opt/site/`; корень `/` **никогда** не должен показывать PWA.
