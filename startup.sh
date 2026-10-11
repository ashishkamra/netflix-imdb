#!/bin/sh
set -eu
cd "$(dirname "$0")"
if curl --fail --silent http://127.0.0.1:8080/ | grep -q 'ShowScore'; then
  exit 0
fi
if curl --fail --silent http://127.0.0.1:8080/ >/dev/null; then
  echo 'Another application owns the preview. Refusing to stop it automatically.' >&2
  exit 1
fi
mkdir -p .grok
nohup npm run dev > .grok/dev.log 2>&1 </dev/null &
