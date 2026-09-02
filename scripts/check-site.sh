#!/usr/bin/env bash
# Smoke-check soulvoicee.ru after deploy. Exit 1 on failure.
# Usage: ./scripts/check-site.sh [BASE_URL]
set -euo pipefail

BASE="${1:-https://soulvoicee.ru}"
FAIL=0

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

check_status() {
  local name="$1" url="$2" expect="${3:-200}"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo "000")
  if [[ "$code" == "$expect" ]]; then
    green "OK  [$code] $name — $url"
  else
    red "FAIL [$code] $name — $url (expected $expect)"
    FAIL=1
  fi
}

check_body() {
  local name="$1" url="$2" pattern="$3"
  local body
  body=$(curl -sS --max-time 15 "$url" || true)
  if echo "$body" | grep -qE "$pattern"; then
    green "OK  body $name"
  else
    red "FAIL body $name — pattern /$pattern/ not found in $url"
    FAIL=1
  fi
}

check_body_absent() {
  local name="$1" url="$2" pattern="$3"
  local body
  body=$(curl -sS --max-time 15 "$url" || true)
  if echo "$body" | grep -qE "$pattern"; then
    red "FAIL body $name — unwanted /$pattern/ found in $url"
    FAIL=1
  else
    green "OK  body $name (no unwanted match)"
  fi
}

echo "=== SoulVoice site check: $BASE ==="

# HTTP status
check_status "landing /" "$BASE/"
check_status "PWA /app/" "$BASE/app/"
check_status "download page" "$BASE/download/"
check_status "app-version.json" "$BASE/app-version.json"
check_status "privacy" "$BASE/privacy.html"
check_status "offer" "$BASE/offer.html"
check_status "app.js" "$BASE/app/app.js"

# Landing must look like site/, not PWA shell
check_body "landing hero" "$BASE/" 'Скажите вслух|Скачать для Android'
check_body "landing apk btn" "$BASE/" 'href="/download/soulvoice.apk"'
check_body_absent "landing not PWA boot" "$BASE/" 'class="boot">Загружаю'

# PWA shell markers on /app/ (boot is OK briefly in HTML; app.js must exist)
check_body "PWA index" "$BASE/app/" 'id="app"'
check_body_absent "PWA app.js reachable" "$BASE/app/app.js" '^$'

# app-version.json structure
VER=$(curl -sS --max-time 15 "$BASE/app-version.json" || echo "{}")
if echo "$VER" | grep -q '"versionName"'; then
  green "OK  app-version.json has versionName"
else
  red "FAIL app-version.json missing versionName"
  FAIL=1
fi

# Billing webhook route (must not be 502/000)
WH=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$BASE/api/billing/prodamus/webhook" || echo "000")
if [[ "$WH" != "000" && "$WH" != "502" && "$WH" != "503" ]]; then
  green "OK  billing webhook responds [$WH] (not 502)"
else
  red "FAIL billing webhook — HTTP $WH"
  FAIL=1
fi

echo "=== done ==="
exit "$FAIL"
