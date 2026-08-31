#!/bin/sh
# После scp/rsync с Mac файлы часто остаются uid 501 и mode 600/700.
# Node (User=vcapp) не может их читать → CHDIR и /app-version.json падают.
set -eu
ROOT="${1:-/opt/voicecapture}"
chown -R vcapp:vcapp "$ROOT"
find "$ROOT" -type d -exec chmod 755 {} \;
find "$ROOT" -type f -exec chmod 644 {} \;
if [ -d "$ROOT/node_modules/.bin" ]; then
  chmod 755 "$ROOT/node_modules/.bin"/* 2>/dev/null || true
fi
