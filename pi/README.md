# Push reminders from a Raspberry Pi

What you get: 3 neutral notifications a day on the phone (the Pi's local time, or `TZ_NAME` in the env file): plan 08:30 (weekends 09:30), coach note 21:45 (only if there is a fresh one), sleep 23:15.
How it works: every 15 min the Pi reads `data/app.json` from the private data repo and sends a push. No AI, no server, no open ports, nothing to forward on the router.

Time: ~15 min. You need: the laptop, the Pi (on, in the network), the phone with the helper app on the home screen.

---

## 1. On the laptop: create a read-only GitHub token (browser, 2 min)

1. Open https://github.com/settings/personal-access-tokens/new
2. Name: `pi-push`. Expiration: 1 year (or "No expiration").
3. Repository access → **Only select repositories** → your private data repo (the one the app syncs to).
4. Permissions → Repository permissions → **Contents: Read-only**. Nothing else.
5. **Generate token**, copy it (starts with `github_pat_`). Keep the tab open, you paste it in step 3.

## 2. On the laptop: connect to the Pi

```bash
ssh pi@raspberrypi.local      # or ssh <user>@<pi-ip>
```
Everything below in section 3 runs **in this ssh window, i.e. on the Pi**.

## 3. On the Pi: get the code and run setup

```bash
# Node 18+ and tools (skip what you already have; check with: node -v)
sudo apt update && sudo apt install -y git nodejs npm qrencode

# Get the code (public repo, no login needed)
cd ~ && git clone <URL of this repo>.git helper-app
cd ~/helper-app/pi

# Time zone: reminders use the Pi's clock. Check with: timedatectl
# If wrong: sudo timedatectl set-timezone <Region/City>

# Setup: asks for the repo and the token, creates keys, installs the cron job
bash setup.sh
```
When asked:
- `Data repo`: `owner/repo` of your private data repo (same as in the app's ⚙️)
- `GitHub token`: paste the token from step 1 (input is hidden, that's fine)

At the end it prints the **public key** and a **QR code** with it.

## 4. On the phone: turn push on

1. Point the iPhone camera at the QR code on the laptop screen → tap the text → **Copy**.
   (No QR? Copy the key from the terminal and send it to yourself, e.g. Telegram "Saved messages".)
2. Open the helper app **from the home-screen icon** (push does not work in Safari tabs).
3. ⚙️ → **Нагадування** → paste into `VAPID public key` → **Зберегти ключ**.
4. **Увімкнути нагадування** → allow notifications. The app syncs the subscription to the repo.

## 5. On the Pi: test

Wait ~1 min for the sync, then:
```bash
cd ~/helper-app/pi && set -a && . ~/.helper-push.env && node notify.mjs test
```
The phone should show "Тест: нагадування працюють ✓". Done, cron does the rest.

---

## Later

- **Ad-hoc push**: add an `inbox` item with `"push": "<neutral text>"` to `data/app.json`; it is sent once on the next run (≤15 min).

- **Logs**: `tail ~/.helper-push.log` (on the Pi).
- **Update code**: `cd ~/helper-app && git pull` (on the Pi).
- **New phone**: install the app, set PIN, ⚙️ repo + token, **Синхронізувати зараз**, then **Увімкнути нагадування на цьому телефоні**. The VAPID key comes with the sync (saved with the last subscription), so no Pi access is needed. Only if the key field is empty: on the Pi `grep VAPID_PUBLIC ~/.helper-push.env`.
- **"Subscription expired" in the log**: on the phone press **Увімкнути нагадування** again.
- **"GitHub 401"**: token expired → make a new one (step 1), then on the Pi `nano ~/.helper-push.env`, replace `GH_TOKEN=`.
- **Re-run setup from scratch**: `rm ~/.helper-push.env && bash setup.sh` (new keys → repeat step 4).
- **Stop**: `crontab -e` and delete the `notify.mjs` line.
