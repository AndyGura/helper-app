# Helper PWA (MVP)

Generic, local-first PWA. No build step, no backend, no personal data in code.

- `crypto.js` — encrypted vault (PIN → PBKDF2 → AES-GCM in localStorage), 5 wrong PINs wipe it, auto-lock after 60 s in background.
- `logic.js` — rule-based "Що мені робити?" picker (tasks by deadline/focus + daily routines by time window, late-night prefers short items). Node-testable.
- `app.js` — Ukrainian UI: home button + focus timer (end timestamp, wake lock, sound, iOS Shortcut fallback `FocusTimer`), shopping by store, tasks & routines, JSON import/export.

Run locally: `python3 -m http.server`. Hosted on GitHub Pages from `main` (root). Personal data never lives here: import it via Налаштування → Імпорт.

TODO: Face ID passkey on top of PIN, hosting, sync (Firestore), Web Push from the Pi.
