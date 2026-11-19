// Light push job for a Raspberry Pi (cron every 15 min). Zero AI tokens.
// Reads data/app.json from the private data repo (read-only token), sends neutral Web Push reminders.
// Env: GH_TOKEN (fine-grained, Contents: Read), GH_REPO (owner/repo), VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (mailto:...),
//      TZ_NAME (IANA zone, e.g. Europe/Berlin; default: the Pi's system zone), STATE (default ~/.helper-push.json). Run: node notify.mjs   |   node notify.mjs test
import webpush from 'web-push';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const E = process.env, TZ = E.TZ_NAME || Intl.DateTimeFormat().resolvedOptions().timeZone, STATE = E.STATE || homedir() + '/.helper-push.json';
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
  .formatToParts(new Date()).map(p => [p.type, p.value]));
const today = `${parts.year}-${parts.month}-${parts.day}`, min = +parts.hour * 60 + +parts.minute, weekend = ['Sat', 'Sun'].includes(parts.weekday);

const r = await fetch(`https://api.github.com/repos/${E.GH_REPO}/contents/data/app.json`, { headers: { Authorization: `Bearer ${E.GH_TOKEN}`, Accept: 'application/vnd.github.raw+json' } });
if (!r.ok) throw new Error('GitHub ' + r.status);
const data = await r.json(), sub = data.push?.sub;
if (!sub) { console.log('no push subscription in app.json yet'); process.exit(0); }
webpush.setVapidDetails(E.VAPID_SUBJECT || 'mailto:helper@example.com', E.VAPID_PUBLIC, E.VAPID_PRIVATE);

let state = {}; try { state = JSON.parse(readFileSync(STATE, 'utf8')); } catch {}
if (state.day !== today) state = { day: today, sent: [] };

// Reminders: [key, minute of day, condition, text]. Text stays neutral (others may see the lock screen).
const open = (data.tasks || []).filter(t => !t.done);
const due = open.filter(t => t.due && t.due <= today).length;
const freshNote = (data.inbox || []).some(n => Date.now() - (n.u || 0) < 6 * 3600e3);
const rules = [
  ['morning', weekend ? 570 : 510, true, due ? `План на сьогодні готовий · ${due} на сьогодні` : 'План на сьогодні готовий'],
  ['note', 1305, freshNote, 'Є нотатка від помічника'],
  ['sleep', 1395, true, 'Час закруглятися 🌙'],
];
const send = body => webpush.sendNotification(sub, JSON.stringify({ title: 'Помічник', body, tag: 'helper' }));

if (process.argv[2] === 'test') { await send('Тест: нагадування працюють ✓'); console.log('sent test'); process.exit(0); }
for (const [key, at, cond, text] of rules) {
  if (!cond || state.sent.includes(key) || min < at || min > at + 30) continue; // fire once, within 30 min of the slot
  try { await send(text); state.sent.push(key); console.log(today, key, 'sent'); }
  catch (e) { console.error(key, e.statusCode || e.message); if (e.statusCode === 404 || e.statusCode === 410) console.error('Subscription expired: re-enable push in the app.'); }
}
writeFileSync(STATE, JSON.stringify(state));
