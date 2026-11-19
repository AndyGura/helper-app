#!/usr/bin/env bash
# One-time setup on the Raspberry Pi. Run from this folder: bash setup.sh
set -e
cd "$(dirname "$0")"
[ "$(id -u)" -ne 0 ] || { echo "Run as your normal user, not with sudo (cron must be yours)."; exit 1; }
command -v crontab >/dev/null || { echo "cron missing: sudo apt install -y cron"; exit 1; }
ENV=~/.helper-push.env
command -v node >/dev/null || { echo "Node.js missing: sudo apt install -y nodejs npm"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Need Node 18+ (node -v)"; exit 1; }
npm install --omit=dev --silent
if [ ! -f "$ENV" ]; then
  read -rp "Data repo (owner/repo): " REPO
  read -rsp "GitHub token (read-only, hidden): " TOKEN; echo
  KEYS=$(npx --yes web-push generate-vapid-keys --json)
  PUB=$(node -p "JSON.parse(process.argv[1]).publicKey" "$KEYS")
  PRIV=$(node -p "JSON.parse(process.argv[1]).privateKey" "$KEYS")
  umask 077
  printf 'GH_TOKEN=%s\nGH_REPO=%s\nVAPID_PUBLIC=%s\nVAPID_PRIVATE=%s\nVAPID_SUBJECT=mailto:helper@example.com\n' "$TOKEN" "$REPO" "$PUB" "$PRIV" > "$ENV"
fi
. "$ENV"
LINE="*/15 * * * * cd $PWD && set -a && . $ENV && $(command -v node) notify.mjs >> ~/.helper-push.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'notify.mjs'; echo "$LINE" ) | crontab -
crontab -l | grep -q notify.mjs || { echo "ERROR: cron job was not installed"; exit 1; }
echo; echo "Cron installed (every 15 min). Public key for the app:"; echo; echo "$VAPID_PUBLIC"; echo
command -v qrencode >/dev/null && qrencode -t ansiutf8 "$VAPID_PUBLIC" || echo "(tip: sudo apt install -y qrencode, run again to get a QR code)"
