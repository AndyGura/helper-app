#!/usr/bin/env bash
# Optional: nightly monobank sync. Run after setup.sh, from this folder: bash bank-setup.sh
set -e
cd "$(dirname "$0")"
ENV=~/.helper-push.env
[ -f "$ENV" ] || { echo "Run setup.sh first."; exit 1; }
read -rsp "monobank token (hidden, paste and press Enter): " T; echo
[ -n "$T" ] || { echo "Empty token."; exit 1; }
umask 077
{ grep -v '^MONO_TOKEN=' "$ENV" || true; echo "MONO_TOKEN=$T"; } > "$ENV.tmp" && mv "$ENV.tmp" "$ENV" && chmod 600 "$ENV"
set -a; . "$ENV"; set +a
node bank-mono.mjs test
LINE="17 3 * * * cd $PWD && set -a && . $ENV && $(command -v node) bank-mono.mjs >> ~/.helper-bank.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'bank-mono.mjs'; echo "$LINE" ) | crontab -
nohup node bank-mono.mjs >> ~/.helper-bank.log 2>&1 &
echo "Nightly sync installed (03:17). First full sync is running in the background (~5–10 min): tail -f ~/.helper-bank.log"
