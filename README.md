# Podskazhu (Zapisala) · Voice → Tasks

**Live:** [soulvoicee.ru](https://soulvoicee.ru) · **APK:** [Download](https://soulvoicee.ru/download/soulvoice.apk)

> Author: **Volkov Valerii** · [GitHub](https://github.com/indopochta13-tech) · indopochte13@gmail.com

## Overview

Podskazhu ("Zapisala") is a voice-first task manager for Russian speakers. Say or type a phrase — the app parses it into a structured task with date, time, location, and reminder. Available as PWA and native Android app with home-screen widget.

**Current version:** 1.9.17 (167) · Capacitor 8 · Node.js 20+

## Features

- **Russian NLP parser** — no external API: understands «завтра в 10 на Таганке», «каждый вторник в 19», «через 20 минут», «по будням в 7:30»
- **Voice recording** — Google STT on Android, Web Speech API on PWA
- **15+ shelves** — Today, Meetings, Tasks, Sport, Cosmetics, Shopping, Notes, Birthdays, etc.
- **Recurring reminders** — daily, weekly, monthly, custom intervals
- **Android widget** — tap to record voice without opening app
- **QR room joining** — connect family/team via QR code or 6-digit code
- **Offline mode** — tasks queue locally, sync when online
- **Web Push + native alarms** — reminders survive phone reboot
- **Auto-update APK** — in-app update check and install

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Android App (Capacitor 8)                   │
│  WebView (app.js)  ·  Native Widget  ·  Google STT      │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS REST API
┌──────────────────────▼──────────────────────────────────┐
│                  Node.js Server                          │
│  server.js  ·  lib/parse.js  ·  lib/store.js            │
├─────────────────────────────────────────────────────────┤
│  Russian speech parser (lib/parse.js)                   │
│  JSON file store with atomic writes                     │
│  Web Push scheduler (30s tick)                          │
│  QR room management                                     │
│  APK version manifest                                   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              JSON data store (VC_DATA_DIR)                 │
└─────────────────────────────────────────────────────────┘
```

## Parser Examples

The Russian parser (`lib/parse.js`) handles:

| Input phrase | Parsed result |
|---|---|
| «встреча завтра в 10 на Таганке» | type: meeting, date: tomorrow, time: 10:00, place: Таганка |
| «каждый день в 8 утра витамины» | recurring: daily, time: 08:00 |
| «по вторникам и четвергам в 19 тренировка» | recurring: weekly [Tue, Thu], time: 19:00 |
| «таймер на 15 минут» | timer: 15 min from now |
| «купить корм коту» | shelf: shopping, no deadline |
| «отмени встречу на Таганке» | cancel matching task |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20+, vanilla JS, 2 npm deps |
| Frontend | Vanilla JS PWA, Service Worker |
| Mobile | Capacitor 8, Java/Kotlin (widget) |
| Parser | Custom Russian NLP (no external API) |
| Storage | JSON file store |
| Push | Web Push (VAPID), Android notification channels |
| Deployment | Caddy, systemd, Linux VPS |
| Tests | 20+ automated test files |

## Test Suite

```bash
node test/parse.test.js          # Russian phrase parsing
node test/voice-hold.test.js     # Voice recording flow
node test/cal-drum-sound.test.js # Calendar UI
node test/api.test.js            # Live API endpoints
node test/shelves-default.test.js # Shelf configuration
```

## Developer

**Volkov Valerii** — Solo developer, architect, and maintainer.

- GitHub: [indopochta13-tech](https://github.com/indopochta13-tech)
- Email: indopochte13@gmail.com

> Full source code is in a private repository. This public repo documents architecture for portfolio and verification purposes.
