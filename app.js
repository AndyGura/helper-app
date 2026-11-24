// UI (Ukrainian). Single-user, local-first, encrypted vault (crypto.js).
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Escape, keep line breaks, make http(s) links clickable (e.g. video tutorials in coach notes).
const linkify = t => esc(t).replace(/(?:https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)[^\s<]+/g, u => `<a href="${/^https?:/.test(u) ? u : 'https://' + u}" target="_blank" rel="noopener">▶ відкрити</a>`).replace(/\n/g, '<br>');
const LOCK_AFTER_MS = 60e3;
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel = null, editId = null, qLater = [];
let vapidMsg = null, data = null, tab = 'home', skipped = [], current = null, hiddenAt = 0, tick = null, wakeLock = null, faceOk = false, busy = false;
const CRED = 'helper.cred';

const save = async () => { Logic.rollMonthly(data); await Vault.save(data); Sync.schedule(data, async () => { await Vault.save(data); render(); }); };
async function syncNow(quiet = true) {
  try { if (await Sync.sync(data)) { await Vault.save(data); render(); } if (!quiet) alert('Синхронізовано'); }
  catch (e) { if (!quiet) alert('Помилка синхронізації: ' + e.message); }
}
function render() { data ? ((tab === 'agents' || (!Agents.chosen(data) && tab !== 'settings') ? views.agents() : views[tab]()), restoreDrafts()) : lockView(); }
// Unsent text survives a lock/reload: drafts live in data.drafts (encrypted vault, never synced), keyed by form + item id + field.
const DRAFT_SKIP = new Set(['settings', 'timer']);
const draftKey = el => { const f = el.form, n = el.name || el.id; if (!n || el.type === 'password' || el.type === 'hidden' || el.id === 'imp' || (f && DRAFT_SKIP.has(f.dataset.form))) return null;
  return `${f?.dataset.form || tab}|${f?.elements.id?.value || ''}|${n}`; };
let draftTimer = null;
function draftSave() { clearTimeout(draftTimer); draftTimer = null; if (data) Vault.save(data).catch(() => {}); }
function restoreDrafts() { const d = data.drafts || {};
  for (const el of $app.querySelectorAll('textarea, input')) { const k = draftKey(el); if (k && d[k] != null && !el.value) el.value = d[k]; } }
function clearDrafts(form) { if (!data.drafts) return; const p = `${form.dataset.form}|${form.elements.id?.value || ''}|`;
  for (const k of Object.keys(data.drafts)) if (k.startsWith(p)) delete data.drafts[k]; }
$app.addEventListener('input', e => { const el = e.target, k = data && draftKey(el); if (!k || el.type === 'checkbox') return;
  const d = (data.drafts = data.drafts || {}); if (el.value) d[k] = el.value; else delete d[k];
  clearTimeout(draftTimer); draftTimer = setTimeout(draftSave, 400); });

// ---------- Lock ----------
// ---------- Face ID (WebAuthn platform passkey, local gate before the PIN) ----------
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const toB64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function faceEnable() {
  try {
    const c = await navigator.credentials.create({ publicKey: {
      challenge: rnd(32), rp: { name: 'Helper', id: location.hostname },
      user: { id: rnd(16), name: 'helper', displayName: 'Helper' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000 } });
    localStorage.setItem(CRED, toB64(c.rawId)); alert('Face ID увімкнено');
  } catch (e) { alert('Не вдалося: ' + e.message); }
  render();
}
async function faceCheck() {
  try {
    await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: fromB64(localStorage.getItem(CRED)) }] } });
    faceOk = true; lockView();
  } catch { lockView('Face ID не пройдено'); }
}

function lockView(msg = '') {
  const isNew = !Vault.exists();
  if (!isNew && localStorage.getItem(CRED) && !faceOk) {
    $app.innerHTML = `<section class="lock"><h1>Helper</h1><button class="primary" data-act="faceCheck">Face ID</button><p class="err">${esc(msg)}</p></section>`;
    return;
  }
  $app.innerHTML = `<section class="lock">
    <h1>${isNew ? 'Придумай PIN' : 'Введи PIN'}</h1>
    <p class="muted">${isNew ? '4–6 цифр. Не такий, як код телефона.' : `Спроб: ${Vault.triesLeft()}`}</p>
    ${isNew ? `<input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off">
    <input id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="Ще раз" autocomplete="off">
    <button class="primary" data-act="unlock">Створити</button>` : `
    <input id="pin" type="password" readonly inputmode="none" maxlength="6" autocomplete="off">
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-act="key" data-v="${n}">${n}</button>`).join('')}
      <button data-act="key" data-v="back">⌫</button><button data-act="key" data-v="0">0</button><button class="primary" data-act="unlock">✓</button></div>`}
    <p class="err">${esc(msg)}</p></section>`;
  if (isNew) document.getElementById('pin').focus();
}
async function unlock() {
  const pin = document.getElementById('pin').value;
  if (!/^\d{4,6}$/.test(pin)) return lockView('Потрібно 4–6 цифр');
  if (!Vault.exists()) {
    if (pin !== document.getElementById('pin2').value) return lockView('PIN не збігається');
    data = Logic.empty(); await Vault.create(pin, data);
  } else {
    data = await Vault.open(pin);
    if (!data) return lockView(Vault.exists() ? 'Невірний PIN' : 'Забагато спроб — дані стерто');
  }
  Logic.pruneShopping(data); tab = 'home'; render();
  syncNow();
}
function lock() { data = null; faceOk = false; current = null; Vault.lock(); clearInterval(tick); render(); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); if (draftTimer) draftSave(); }
  // Reload instead of a plain lock: clears memory and picks up the latest app version.
  else if (Date.now() - hiddenAt > LOCK_AFTER_MS) { data = null; Vault.lock(); location.reload(); }
  else if (data) { render(); syncNow(); }
});

// ---------- Layout ----------
// Chat tab hidden for now (API is billed separately); code kept in chat.js.
const UNDER_MENU = ['menu', 'role', 'plan', 'settings', 'agents', 'trip', 'visits', 'taskInfo'];
// Usage analytics, local only (encrypted vault, synced to the user's own data repo, no third party): usage[day][screen] = opens.
// Bottom bar = Home + the 3 most used screens of the last 30 days (role dashboards included) + menu.
let lastScreen = null;
function countScreen() { const k = tab === 'role' ? 'role:' + roleId : tab; if (!data || k === lastScreen || ['agents', 'print'].includes(k)) return; lastScreen = k;
  const d = Logic.localDay(), u = (data.usage = data.usage || {}); (u[d] = u[d] || {})[k] = (u[d][k] || 0) + 1;
  const old = Logic.localDay(new Date(Date.now() - 60 * 864e5)); for (const x of Object.keys(u)) if (x < old) delete u[x]; }
let navCache = null; // computed once per app start, so buttons don't jump around while using the app
function navTabs() { if (navCache) return navCache;
  const u = data.usage || {}, from = Logic.localDay(new Date(Date.now() - 30 * 864e5)), n = {};
  for (const [d, m] of Object.entries(u)) if (d >= from) for (const [k, c] of Object.entries(m)) n[k] = (n[k] || 0) + c;
  const label = k => k.startsWith('role:') ? (data.roles || []).find(r => 'role:' + r.id === k)?.emoji : ({ tasks: 'Справи', shop: 'Покупки', cal: 'Календар', plan: '🎯', visits: '🩺', settings: '⚙️' })[k];
  const def = ['tasks', 'shop', 'cal'], cand = [...new Set([...Object.keys(n), ...def])].filter(k => label(k) && k !== 'home' && k !== 'menu');
  const top = cand.sort((a, b) => (n[b] || 0) - (n[a] || 0) || (def.indexOf(a) + 1 || 9) - (def.indexOf(b) + 1 || 9)).slice(0, 3);
  return navCache = [['home', 'Головна'], ...top.map(k => [k, label(k)]), ['menu', '☰']];
}
const shell = body => {
  countScreen(); const cur = tab === 'role' ? 'role:' + roleId : tab, nav = navTabs();
  $app.innerHTML = `<div class="page">${body}</div>${sheetTask ? taskSheet() : ''}<nav>${nav.map(([k, t]) =>
    `<button data-act="${k.startsWith('role:') ? 'role' : 'tab'}" data-v="${k.replace('role:', '')}" class="${k === cur || (k === 'menu' && UNDER_MENU.includes(tab) && !nav.some(([x]) => x === cur)) ? 'on' : ''}">${t}</button>`).join('')}</nav>`;
};

// ---------- Home: "Що мені робити?" + focus timer ----------
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1e3)), p = n => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`; };
const views = {};
// Timers: data.timers = [{id, title, kind, ref, dur (ms | null = stopwatch), acc (ms), run (ms | null)}].
// Only one runs at a time; starting another pauses the running one.
// Instant habits (e.g. bedtime) have no duration: no timer for them.
const timed = r => !!(r.goal || r.minutes >= 5);
const elapsed = t => t.acc + (t.run ? Date.now() - t.run : 0);
const shown = t => t.dur ? fmt(t.dur - elapsed(t)) : fmt(elapsed(t));
function timers() {
  if (data.timer) { const o = data.timer; data.timers = [{ id: Logic.id(), title: o.title, kind: o.kind, ref: o.id, dur: o.minutes * 6e4, acc: o.minutes * 6e4 - (o.end - Date.now()), run: Date.now() }]; data.timer = null; }
  return (data.timers = data.timers || []);
}
// Credit timer time to its routine (for daily goals). Called on pause/finish and every minute while running.
function logTime(t) {
  if (t.kind !== 'routine' || !t.ref) return;
  const e = elapsed(t), delta = e - (t.logged || 0);
  if (delta > 0) { Logic.addTime(data, Logic.localDay(), t.ref, delta); t.logged = e; }
}
const hm = ms => { const m = Math.floor(ms / 6e4); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
async function startTimer(title, minutes, kind = 'free', ref = null) {
  for (const t of timers()) if (t.run) { logTime(t); t.acc = elapsed(t); t.run = null; }
  timers().push({ id: Logic.id(), title, kind, ref, dur: minutes ? minutes * 6e4 : null, acc: 0, run: Date.now() });
  await save(); render();
}
views.home = () => {
  clearInterval(tick);
  const all = timers(), t = all.find(x => x.run), paused = all.filter(x => !x.run);
  const pausedHtml = paused.length ? `<h3>На паузі</h3><ul class="list">${paused.map(p => `<li><div><b>${esc(p.title)}</b><small>${shown(p)}${p.dur ? ' залишилось' : ''}</small></div>
    <button class="mini primary" data-act="timerResume" data-v="${p.id}">▶</button><button class="mini" data-act="timerDone" data-v="${p.id}">✓</button></li>`).join('')}</ul>` : '';
  if (t) {
    shell(`<section class="timer"><p class="muted">Тільки це:</p><h2>${esc(t.title)}</h2>
      <div class="clock" id="clock">${shown(t)}</div>
      ${(() => { const r = t.kind === 'routine' && data.routines.find(x => x.id === t.ref); return r?.goal ? `<p class="muted" id="goal">Сьогодні: ${hm(Logic.timeOn(data, Logic.localDay(), r.id))} з ${hm(r.goal * 6e4)}</p><button data-act="timerGoal" data-v="${t.id}">Ціль виконана ✓</button>` : ''; })()}
      <div class="row"><button data-act="timerPause" data-v="${t.id}">Пауза</button><button data-act="timerDone" data-v="${t.id}" class="primary">Готово</button></div>
      ${t.dur ? `<a class="btn" href="shortcuts://run-shortcut?name=FocusTimer&input=${Math.ceil((t.dur - elapsed(t)) / 6e4)}">Таймер iPhone (офлайн)</a>` : ''}
      <button data-act="timerStop" data-v="${t.id}">Скасувати</button>${pausedHtml}</section>`);
    keepAwake(true);
    tick = setInterval(() => {
      const el = document.getElementById('clock'); if (!el) return clearInterval(tick);
      el.textContent = shown(t);
      if (t.dur && elapsed(t) >= t.dur) { clearInterval(tick); ring(); finishTimer(t.id); return; }
      if (t.kind === 'routine' && elapsed(t) - (t.logged || 0) >= 6e4) {
        logTime(t); save(); const g = document.getElementById('goal'), r = data.routines.find(x => x.id === t.ref);
        if (g && r) g.textContent = `Сьогодні: ${hm(Logic.timeOn(data, Logic.localDay(), r.id))} з ${hm(r.goal * 6e4)}`;
      }
    }, 500);
    return;
  }
  keepAwake(false);
  const c = current;
  shell(`<section class="home">
    ${pausedHtml ? `<div class="paused">${pausedHtml}</div>` : ''}
    ${(data.inbox || []).length ? `<div class="inbox"><h3>Від помічника</h3>${data.inbox.map(n => `<div class="note"><p>${linkify(n.text)}</p>
      <button class="x" data-act="dismiss" data-v="${n.id}">✕</button></div>`).join('')}</div>` : ''}
    ${(ns => ns.length ? `<div class="inbox"><h3>Помічено</h3>${ns.map(n => `<div class="note"><p>${esc(n.text)}</p>
      <button class="x" data-act="hideNote" data-v="${esc(n.id)}">✕</button></div>`).join('')}</div>` : '')(Logic.noticed(data).filter(n => !hiddenNotes().includes(n.id)))}
    ${(data.checkins || []).some(c => c.date === Logic.localDay()) ? '' : `<form data-form="checkin" class="add quick checkin"><h3>Як ти сьогодні?</h3>
      <textarea name="text" rows="2" placeholder="Своїми словами: настрій, сили, сон, що на душі" required></textarea>
      <button class="primary">Записати</button></form>`}
    ${(qs => qs.length ? `<form data-form="answer" class="add quick checkin"><h3>Питання від помічника${qs.length > 1 ? ` (ще ${qs.length - 1})` : ''}</h3>
      <p>${esc(qs[0].q)}</p><input type="hidden" name="id" value="${qs[0].id}">
      <textarea name="a" rows="3" placeholder="Скільки хочеш, своїми словами" required></textarea>
      <div class="row"><button class="primary">Відповісти</button><button type="button" data-act="qLater" data-v="${qs[0].id}">Пізніше</button></div></form>` : '')((data.questions || []).filter(q => !q.a && !qLater.includes(q.id)))}
    <button class="big" data-act="next">Що мені робити?</button>
    ${c && c.kind === 'sleep' ? `<div class="card"><h2>${esc(c.title)}</h2></div>` : c ? `<div class="card"><h2>${esc(c.title)}</h2>
      ${c.minutes ? `<p class="muted">${c.minutes} хв</p>` : ''}${c.item && c.item.link ? `<p class="note">${linkify(c.item.link)}</p>` : ''}${planHint(c.item)}
      <div class="row">
        ${timed(c) ? `<button class="primary" data-act="start">Почати ${c.minutes} хв</button>` : ''}
        <button data-act="done">Зроблено</button><button data-act="other">Інше</button>
      </div></div>` : current === false ? `<div class="card"><h2>План на сьогодні виконано 🎉</h2><p class="muted">Решта — бонус, без тиску.</p><button data-act="bonus">Є сили? Бонус</button></div>` : ''}
    <form data-form="timer" class="add quick"><h3>Таймер</h3>
      <select name="ref"><option value="">Своє (впиши нижче)</option>${data.routines.filter(timed).map(r => `<option value="${r.id}">${esc(r.title)}${r.goal ? ` (ціль ${hm(r.goal * 6e4)})` : ''}</option>`).join('')}</select>
      <input name="title" placeholder="Що робиш">
      <div class="row"><input name="minutes" type="number" min="1" placeholder="хв (порожньо = секундомір)"><button class="primary">Почати</button></div></form>
    <form data-form="memo" class="add quick"><h3>Запам'ятай</h3>
      <textarea name="text" rows="2" placeholder="Факт, ідея, що завгодно (напр. розмір шин 275/45 R20)" required></textarea>
      <button class="primary">Зберегти</button>
      ${(() => { const ms = data.memos || [], wait = ms.filter(m => !m.result);
        return (wait.length ? `<p class="muted">Чекають, поки помічник розкладе (щодня о 21:17): ${wait.length}</p>` : '')
          + ms.filter(m => m.result).map(m => `<div class="note"><p><b>${esc(m.text)}</b><br><small class="muted">→ ${linkify(m.result)}</small></p>
            <button type="button" class="x" data-act="dismissMemo" data-v="${m.id}">✕</button></div>`).join(''); })()}</form>
  </section>`);
};
// Today's items of the linked long-term plan (routine.plan = plan id), shown on the home card.
function planHint(r) {
  const p = r?.plan && (data.plans || []).find(x => x.id === r.plan); if (!p) return '';
  const n = Logic.planNow(p, Logic.localDay());
  return n.items.length ? `<ul class="hint">${n.items.map(x => `<li>${esc(x.t)}</li>`).join('')}</ul>` : '';
}
function hiddenNotes() { try { return JSON.parse(localStorage.getItem('hidden-' + Logic.localDay()) || '[]'); } catch { return []; } }
function next(all = false) { current = Logic.pickNext(data, new Date(), skipped, all) || false; render(); }
async function finishTimer(id) {
  const t = timers().find(x => x.id === id); if (!t) return;
  data.timers = timers().filter(x => x.id !== id);
  logTime(t);
  const r = t.kind === 'routine' && data.routines.find(x => x.id === t.ref);
  if (t.kind === 'task' || (r && !r.goal)) Logic.markDone(data, { kind: t.kind, id: t.ref });
  current = null; await save(); render();
}
function ring() {
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = .2;
    o.start(); o.stop(a.currentTime + 1.2);
  } catch {}
  navigator.vibrate?.([300, 150, 300]);
}
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

// ---------- Shopping ----------
views.shop = () => {
  const stores = [...new Set(data.shopping.map(i => i.store))];
  shell(`<h1>Покупки</h1>
    ${stores.map(s => `<h3>${esc(s)}</h3><ul class="list">${data.shopping.filter(i => i.store === s).map(i =>
      `<li class="${i.done ? 'done' : ''}" data-act="toggleShop" data-v="${i.id}"><span class="box"></span>
       <div><b>${esc(i.text)}</b>${i.note ? `<small>${esc(i.note)}</small>` : ''}</div></li>`).join('')}</ul>`).join('')
    || '<p class="muted">Список порожній</p>'}
    <form data-form="addShop" class="add">
      ${stores.length ? `<select name="storeSel">${stores.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}<option value="">+ Новий магазин…</option></select>` : ''}
      <input name="store" placeholder="${stores.length ? 'або впиши новий магазин' : 'Магазин'}">
      <input name="text" placeholder="Що купити" required>
      <input name="note" placeholder="Розмір, модель, нотатка">
      <button class="primary">Додати</button></form>`);
};

// ---------- Tasks & routines ----------
// Tap on a task opens an action sheet (never marks done by accident); long text lives in a separate details view.
let sheetTask = null, infoTask = null;
const taskMeta = t => [t.due && ddm(t.due), t.monthly && `${t.months === 3 ? 'щокварталу' : t.months > 1 ? `кожні ${t.months} міс.` : 'щомісяця'} ${t.monthly}-го`, t.minutes && t.minutes + ' хв', (t.details || t.link || t.visitId || t.title.length > 80) && 'є подробиці'].filter(Boolean).join(' · ');
function taskSheet() { const t = data.tasks.find(x => x.id === sheetTask); if (!t) { sheetTask = null; return ''; }
  return `<div class="sheetbg" data-act="sheetClose"><div class="sheetbox" data-act="noop"><p class="clamp"><b>${esc(t.title)}</b></p>${t.due ? `<p class="muted">до ${ddm(t.due)}</p>` : ''}
    ${t.done ? `<button class="primary" data-act="taskUndo" data-v="${t.id}">↩ Повернути в справи</button>` : `<button class="primary" data-act="taskDone" data-v="${t.id}">✓ Відмітити зробленим</button>`}
    <button data-act="taskInfo" data-v="${t.id}">Подробиці</button>
    <div class="row"><button data-act="taskEdit" data-v="${t.id}">✎ Змінити</button><button class="danger" data-act="delTask" data-v="${t.id}">Видалити</button></div>
    <button data-act="sheetClose">Закрити</button></div></div>`; }
views.taskInfo = () => { const t = data.tasks.find(x => x.id === infoTask); if (!t) { tab = 'tasks'; return views.tasks(); }
  shell(`<div class="row cal-head"><button data-act="tab" data-v="tasks">‹</button><h1>Справа</h1></div>
    <p><b>${linkify(t.title)}</b></p><p class="muted">${[t.done ? 'зроблено' : '', taskMeta(t).replace(/ · є подробиці|є подробиці/, '')].filter(Boolean).join(' · ')}</p>
    ${t.details ? `<p>${linkify(t.details)}</p>` : ''}${t.visitId ? `<button data-act="tab" data-v="visits">🩺 Що сказати лікарю</button>` : ''}${t.link ? `<p class="note">${linkify(t.link)}</p>` : ''}
    ${t.done ? `<button data-act="taskUndo" data-v="${t.id}">↩ Повернути в справи</button>` : `<button class="primary" data-act="taskDone" data-v="${t.id}">✓ Відмітити зробленим</button>`}
    <button data-act="taskEdit" data-v="${t.id}">✎ Змінити</button>`); };

views.tasks = () => {
  const open = data.tasks.filter(t => !t.done).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
  const today = Logic.doneSet(data, Logic.localDay());
  const taskLi = t => t.id === editId ? `<li class="edit">${taskFormHtml(t)}</li>` : `<li class="${t.done ? 'done' : ''}" data-act="taskMenu" data-v="${t.id}"><span class="box"></span>
      <div><b class="clamp">${t.focus ? '★ ' : ''}${esc(t.title)}</b><small>${taskMeta(t)}</small></div></li>`;
  const ld = Logic.localDay(), doneToday = data.tasks.filter(t => t.done && t.doneAt && Logic.localDay(new Date(t.doneAt)) === ld); // done ones stay until tomorrow
  const top = open.slice(0, 3), later = open.slice(3);
  const routineLi = routineLiFactory(today);
  const plan = Logic.dayPlan(data, Logic.localDay()), inPlan = data.routines.filter(r => plan.has(r.id)), rest = data.routines.filter(r => !plan.has(r.id));
  shell(`<h1>Справи</h1><ul class="list">${top.map(taskLi).join('') || '<p class="muted">Немає справ</p>'}${doneToday.map(taskLi).join('')}</ul>
    ${later.length ? `<details ${later.some(t => t.id === editId) ? 'open' : ''}><summary>Пізніше (${later.length})</summary><ul class="list">${later.map(taskLi).join('')}</ul></details>` : ''}
    ${taskFormHtml()}
    <h1>Сьогодні</h1><p class="muted">Обов'язкові — завжди. Решта: до ${Logic.dailyCap(data, Logic.localDay())} на день${Logic.isKidsWeek(data, Logic.localDay()) ? ' (тиждень з дітьми)' : ''}.</p>
    <ul class="list">${inPlan.map(routineLi).join('')}</ul>
    ${rest.length ? `<details ${rest.some(r => r.id === editId) ? 'open' : ''}><summary>Бонус і пізніше (${rest.length})</summary><ul class="list">${rest.map(routineLi).join('')}</ul></details>` : ''}
    <p class="muted">Зробив щось учора без аппки? Календар → тапни день → відміть.</p>
    <details><summary>+ Нова звичка</summary>${routineFormHtml()}</details>`);
};
function taskFormHtml(t) { const v = k => t?.[k] != null ? `value="${esc(String(t[k]))}"` : ''; return `
    <form data-form="${t ? 'saveTask' : 'addTask'}" class="add">${t ? `<input type="hidden" name="id" value="${t.id}">` : ''}
      <input name="title" placeholder="Нова справа" required ${v('title')}>
      <div class="row"><input name="due" type="date" ${v('due')}><input name="minutes" type="number" min="1" placeholder="хв" ${v('minutes')}></div>
      <textarea name="details" rows="2" placeholder="Подробиці (необов'язково)">${esc(t?.details || '')}</textarea>
      <input name="monthly" type="number" min="1" max="31" placeholder="Щомісяця, число (необов'язково)" ${v('monthly')}>
      <label><input name="focus" type="checkbox" ${t?.focus ? 'checked' : ''}> Фокус ★</label>
      <button class="primary">${t ? 'Зберегти' : 'Додати'}</button>${t ? '<button type="button" data-act="edit" data-v="">Скасувати</button>' : ''}</form>`; }
function routineLiFactory(today) { return r => r.id === editId ? `<li class="edit">${routineFormHtml(r)}</li>` : `<li class="${today.has(r.id) ? 'done' : ''}" data-act="toggleRoutine" data-v="${Logic.localDay()}|${r.id}"><span class="box"></span>
      <div><b>${esc(r.title)}${(st => st >= 2 ? ` <span class="streak">🔥${st}</span>` : '')(Logic.streak(data, r))}</b><small>${r.perWeek ? `${Logic.weekCount(data, r, Logic.localDay())}/${r.perWeek} цього тижня · ` : ''}${r.every ? `раз на ${r.every} дн · ${(n => n === Infinity ? 'ще не було' : n === 1 && !today.has(r.id) ? 'вчора' : today.has(r.id) ? 'сьогодні' : n + ' дн тому')(Logic.sinceLast(data, r, Logic.localDay()))} · ` : ''}${r.goal ? `ціль ${hm(r.goal * 6e4)}/день (${hm(Logic.timeOn(data, Logic.localDay(), r.id))}) · ` : ''}${r.minutes ? r.minutes + ' хв · ' : ''}${r.from ?? 0}:00–${r.to ?? 24}:00${r.days ? ' · ' + (r.days.join() === '1,2,3,4,5' ? 'будні' : r.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(x => ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][x]).join(' ')) : ''}</small></div>
      <button class="x" data-act="edit" data-v="${r.id}">✎</button><button class="x" data-act="delRoutine" data-v="${r.id}">✕</button></li>`; }
const DAYS = [1, 2, 3, 4, 5, 6, 0], DN = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
function routineFormHtml(r) { const v = k => r?.[k] != null ? `value="${r[k]}"` : '', pr = r?.prio || (r?.fixed ? 1 : 2); return `
    <form data-form="${r ? 'saveRoutine' : 'addRoutine'}" class="add">${r ? `<input type="hidden" name="id" value="${r.id}">` : ''}
      <input name="title" placeholder="Звичка" required ${r ? `value="${esc(r.title)}"` : ''}>
      <div class="row"><input name="from" type="number" min="0" max="23" step="0.5" placeholder="з (год)" ${v('from')}><input name="to" type="number" min="1" max="24" step="0.5" placeholder="до (год)" ${v('to')}><input name="minutes" type="number" min="1" placeholder="хв" ${v('minutes')}></div>
      <input name="goal" type="number" min="1" placeholder="Ціль на день у хвилинах, через таймер (напр. 360 = 6 год)" ${v('goal')}>
      <select name="prio">${[[1, "Обов'язкова (завжди в плані)"], [2, 'Бажана'], [3, 'Бонус (якщо є сили)']].map(([k, t]) => `<option value="${k}" ${pr === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <div class="days">${DAYS.map(d => `<label><input name="d${d}" type="checkbox" ${r?.days?.includes(d) ? 'checked' : ''}>${DN[d]}</label>`).join('')}</div>
      <small class="muted">Дні не відмічені = будь-який день</small>
      <input name="perWeek" type="number" min="1" max="6" placeholder="Або N разів на тиждень (будь-які дні)" ${v('perWeek')}>
      <input name="every" type="number" min="2" max="365" placeholder="Або раз на N днів (нагадує щодня, поки не зробиш)" ${v('every')}>
      <button class="primary">${r ? 'Зберегти' : 'Додати'}</button>${r ? '<button type="button" data-act="edit" data-v="">Скасувати</button>' : ''}</form>`; }

// ---------- Plans: long-term goals (exam prep), stages + progress vs targets ----------
views.plan = (rid = null) => {
  const F = (a, c) => (a || []).filter(x => !rid || mine(x, c, rid));
  const ps = F(data.plans, 'plans'), today = Logic.localDay(), dm = d => `${+d.slice(8)}.${d.slice(5, 7)}`;
  const tr = F(data.trips, 'trips').filter(t => t.status !== 'done'), old = F(data.trips, 'trips').filter(t => t.status === 'done');
  const tripLi = t => `<li data-act="trip" data-v="${t.id}"><div><b>${esc(t.title)}</b><small>${[TRIP[t.status], t.from && dm(t.from) + (t.to ? '–' + dm(t.to) : '')].filter(Boolean).join(' · ')}</small></div><span>›</span></li>`;
  const fm = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('uk-UA');
  const bud = F(data.budgets, 'budgets').map(b => `<h3>${esc(b.title)}</h3>${b.note ? `<p class="muted">${linkify(b.note)}</p>` : ''}${(b.months || []).map(m => { const tot = (m.rows || []).reduce((a, r) => a + (+r.v || 0), 0);
    return `<details${m.open ? ' open' : ''}><summary><b>${esc(m.name)}</b>: <span style="color:var(${tot < 0 ? '--bad' : '--acc'})">${fm(tot)} ${esc(b.cur || '')}</span></summary><ul class="list">${(m.rows || []).map(r => `<li><div><b>${esc(r.t)}</b>${r.note ? `<small>${linkify(r.note)}</small>` : ''}</div><span style="${r.v < 0 ? 'color:var(--bad)' : ''}">${r.v == null ? '?' : fm(r.v)}</span></li>`).join('')}</ul>${m.note ? `<p class="muted">${linkify(m.note)}</p>` : ''}</details>`; }).join('')}`).join('');
  shell(`${rid ? roleHead(rid) : ''}${bud ? `<h1>Бюджет</h1>${bud}` : ''}${tr.length || old.length ? `<h1>Подорожі</h1><ul class="list">${tr.map(tripLi).join('')}</ul>${old.length ? `<details><summary>Минулі (${old.length})</summary><ul class="list">${old.map(tripLi).join('')}</ul></details>` : ''}` : ''}
    ${ps.length || !rid ? '<h1>Цілі</h1>' : ''}${!rid && data.prefs && data.prefs.vision ? `<p class="muted">✨ ${esc(data.prefs.vision)}</p>` : ''}${ps.map(p => { const n = Logic.planNow(p, today), st = p.stages || [], ts = p.targets || [];
    const pct = t => t.now == null ? 0 : Math.min(1, t.now / t.goal);
    const avg = ts.length ? Math.round(100 * ts.reduce((a, t) => a + pct(t), 0) / ts.length) : 0;
    return `<h3>${esc(p.title)}</h3>${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}
    <div class="stages">${st.map((s, i) => `<div class="${i === n.i && n.stage ? 'on' : i < n.i ? 'past' : ''}"><b>${i + 1}. ${esc(s.name)}</b><small>${dm(s.from)}–${dm(s.to)}</small></div>`).join('')}</div>
    ${n.stage ? `<p>${today < n.stage.from ? `Старт ${dm(n.stage.from)}.` : `Етап ${n.i + 1}: ще ${Math.round((Date.parse(n.stage.to) - Date.parse(today)) / 864e5)} дн.`} ${esc(n.stage.goal || '')}</p>
      <p class="muted">Вдома сьогодні (≤15 хв):</p><ul class="hint">${n.items.map(x => `<li>${esc(x.t)}</li>`).join('') || '<li>відпочинок</li>'}</ul>` : '<p>Усі етапи пройдено 💪</p>'}
    ${(p.habits || []).length ? `<p class="muted">Вдома за 4 тижні (тренування з аппки):</p><ul class="list">${p.habits.map(id => data.routines.find(r => r.id === id)).filter(Boolean).map(r => {
      const wk = [3, 2, 1, 0].map(w => { const d = new Date(Date.now() - w * 7 * 864e5); return Logic.weekDays(Logic.localDay(d)).filter(k => k <= today && Logic.doneSet(data, k).has(r.id)).length; });
      return `<li><div><b>${esc(r.title)}${(st => st >= 2 ? ` <span class="streak">🔥${st}</span>` : '')(Logic.streak(data, r))}</b><small>по тижнях: ${wk.join(' · ')} (з 7)</small></div></li>`; }).join('')}</ul>` : ''}
    <form data-form="planNow" class="add"><input type="hidden" name="id" value="${p.id}">
      <p class="muted">До екзамену: ${avg}% · онови цифри після тесту</p>
      ${ts.map((t, i) => `<div class="target"><span>${esc(t.name)}</span><input name="t${i}" type="number" step="any" min="0" value="${t.now ?? ''}" placeholder="?"><small>/ ${t.goal} ${esc(t.unit || '')}</small>
        <i style="--p:${pct(t)}"></i></div>`).join('')}
      <button class="primary">Зберегти результати</button></form><button data-act="printPlan" data-v="${p.id}">📄 PDF / друк плану</button>`; }).join('') || (rid ? '' : '<p class="muted">Поки немає довгих цілей.</p>')}`);
};

// ---------- Menu + one dashboard per role (built from the roles list, so a new role gets a screen automatically) ----------
// An item belongs to a role if it has `role: <id>`, else if the role owns its whole collection (Agents.owner).
const mine = (x, coll, rid) => x.role ? x.role === rid : Agents.owner(coll) === rid;
let roleId = null;
const activeRoles = () => (data.roles || []).filter(r => r.status === 'active' || r.status === 'paused');
views.menu = () => shell(`<h1>Меню</h1><ul class="list">${activeRoles().map(r => `<li data-act="role" data-v="${r.id}"><span>${esc(r.emoji || '•')}</span><div><b>${esc(r.name)}</b><small>${esc(r.about || '')}</small></div><span>›</span></li>`).join('')}</ul>
  <ul class="list"><li data-act="tab" data-v="plan"><span>🎯</span><div><b>Усі цілі, бюджети й поїздки</b></div><span>›</span></li>
  <li data-act="tab" data-v="settings"><span>⚙️</span><div><b>Налаштування</b></div><span>›</span></li></ul>`);
function roleHead(rid) {
  const r = (data.roles || []).find(x => x.id === rid) || { name: rid }, ld = Logic.localDay();
  const notes = (data.inbox || []).filter(n => n.role === rid).slice(-3).reverse();
  const tasks = (data.tasks || []).filter(t => t.role === rid && (!t.done || (t.doneAt && Logic.localDay(new Date(t.doneAt)) === ld)));
  const habits = (data.routines || []).filter(h => h.role === rid), ds = Logic.doneSet(data, ld);
  const vis = F2(data.visits, 'visits', rid).filter(v => !v.done);
  return `<div class="row cal-head"><button data-act="tab" data-v="menu">‹</button><h1>${esc(r.emoji || '')} ${esc(r.name)}</h1></div>
    ${r.about ? `<p class="muted">${esc(r.about)}</p>` : ''}${r.next ? `<p>Далі: ${esc(r.next)}${r.date ? ' · ' + ddm(r.date) : ''}</p>` : ''}
    ${(r.summary || []).length ? `<h3>Що вже є</h3><ul class="hint">${r.summary.map(x => `<li>${linkify(x)}</li>`).join('')}</ul>` : ''}
    ${notes.map(n => `<div class="note"><p>${linkify(n.text)}</p></div>`).join('')}
    ${tasks.length ? `<h3>Справи</h3><ul class="list">${tasks.map(t => `<li class="${t.done ? 'done' : ''}" data-act="taskMenu" data-v="${t.id}"><span class="box"></span><div><b class="clamp">${esc(t.title)}</b><small>${taskMeta(t)}</small></div></li>`).join('')}</ul>` : ''}
    ${habits.length ? `<h3>Звички</h3><ul class="list">${habits.map(h => `<li class="${ds.has(h.id) ? 'done' : ''}" data-act="toggleRoutine" data-v="${ld}|${h.id}"><span class="box"></span><div><b>${esc(h.title)}${(st => st >= 2 ? ` <span class="streak">🔥${st}</span>` : '')(Logic.streak(data, h))}</b></div></li>`).join('')}</ul>` : ''}
    ${vis.length ? `<h3>Візити</h3><ul class="list">${vis.map(v => `<li data-act="tab" data-v="visits"><div><b>${esc(v.title)}</b><small>${ddm(v.date)} · ${(v.items || []).length} пунктів</small></div><span>›</span></li>`).join('')}</ul>` : ''}`;
}
const F2 = (a, c, rid) => (a || []).filter(x => mine(x, c, rid));
views.role = () => views.plan(roleId);

// ---------- Print / PDF: a clean white A4 sheet with ONLY the given content (shareable, fridge-friendly). ----------
// Uses the system print dialog → "Save as PDF" / share. No app chrome, no other data on the sheet.
let printing = null;
const plink = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a>`).replace(/\n/g, '<br>');
const WD = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], ddm = d => d ? `${+d.slice(8)}.${d.slice(5, 7)}` : '';
// Self-hosted html2pdf (vendor/, MIT), loaded only on demand. Text becomes an image: fine for sharing and printing.
const loadPdfLib = () => window.html2pdf ? Promise.resolve() : new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'vendor/html2pdf.bundle.min.js'; sc.onload = ok; sc.onerror = () => no(new Error('бібліотека PDF не завантажилась')); document.head.appendChild(sc); });
async function pdfShare(title, el) {
  await loadPdfLib();
  const box = document.createElement('div'), cl = el.cloneNode(true); // fixed A4 text width, independent of the phone screen
  box.style.cssText = 'position:fixed;left:-10000px;top:0'; cl.style.cssText = 'width:700px;max-width:none;margin:0;padding:0'; box.appendChild(cl); document.body.appendChild(box);
  try { return await pdfMake(title, cl); } finally { box.remove(); }
}
async function pdfMake(title, el) {
  const name = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
  const blob = await html2pdf().set({ margin: 12, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, backgroundColor: '#fff' },
    jsPDF: { unit: 'mm', format: 'a4' }, pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'h2', 'li', 'p'] } }).from(el).outputPdf('blob');
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title });
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 6e4);
}
// Shareable copy: any object with `private: true` (option, day, day item {t}, budget row, packing item, task, stage item…)
// is dropped; `privateNote` fields are never printed. Returns [copy, hiddenCount].
function pub(x) { let n = 0; const walk = v => Array.isArray(v) ? v.filter(i => !(i && i.private && ++n)).map(walk)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'privateNote').map(([k, w]) => [k, walk(w)])) : v;
  const c = walk(x); return [c, n]; }
const itxt = i => typeof i === 'string' ? i : i?.t || '';
// The ONLY way to export: every PDF goes through pub(), so private items never reach a shared sheet.
function printDoc(src, build, extraHidden = 0) { const [c, n] = pub(src); printing = { title: c.title, html: build(c), hidden: n + extraHidden, back: tab }; tab = 'print'; render(); }
views.print = () => {
  if (!printing) { tab = 'home'; return render(); }
  $app.innerHTML = `<div class="noprint printbar"><button data-act="printBack">‹ Назад</button><button class="primary" data-act="printGo">Зберегти PDF / друк</button></div>
    ${printing.hidden ? `<p class="noprint muted printbar">🔒 Особисте не потрапить у PDF: приховано ${printing.hidden}.</p>` : ''}
    <article class="sheet"><h1>${esc(printing.title)}</h1>${printing.html}</article>`;
};
function tripPrint(t) {
  const cur = esc(t.currency || ''), sum = (t.budget || []).reduce((a, b) => a + (+b.sum || 0), 0), ch = (t.options || []).find(o => o.id === t.chosen);
  const tasks = (t.taskIds || []).map(id => data.tasks.find(x => x.id === id)).filter(x => x && !x.private);
  return `<p>${t.from ? `<b>${ddm(t.from)}${t.to ? '–' + ddm(t.to) : ''}</b> · ` : ''}${TRIP[t.status] || ''}</p>${t.note ? `<p>${plink(t.note)}</p>` : ''}
    ${(t.options || []).length ? `<h2>${ch ? 'Обраний варіант' : 'Варіанти'}</h2><table>${(ch ? [ch] : t.options).map(o => `<tr><td><b>${esc(o.title || '')}</b>${o.note ? `<br>${plink(o.note)}` : ''}${o.link ? `<br>${plink(o.link)}` : ''}</td><td>${esc(o.dates || '')}</td><td class="num">${o.budget ? o.budget + ' ' + cur : ''}</td></tr>`).join('')}</table>` : ''}
    ${t.route ? `<h2>Дорога</h2><p>${plink(t.route)}</p>` : ''}${t.stay ? `<h2>Житло</h2><p>${plink(t.stay)}</p>` : ''}
    ${(t.days || []).length ? `<h2>По днях</h2><table>${t.days.map(d => `<tr><td class="nowrap"><b>${d.date ? WD[new Date(d.date + 'T12:00:00').getDay()] + ' ' + ddm(d.date) : ''}</b>${d.title ? `<br>${esc(d.title)}` : ''}</td><td>${(d.items || []).map(i => plink(itxt(i))).join('<br>')}</td></tr>`).join('')}</table>` : ''}
    ${(t.budget || []).length ? `<h2>Бюджет</h2><table>${t.budget.map(b => `<tr><td>${esc(b.item)}${b.paid ? ' ✓' : ''}</td><td class="num">${b.sum ?? '?'} ${cur}</td></tr>`).join('')}<tr><td><b>Разом</b></td><td class="num"><b>${sum} ${cur}</b></td></tr></table>` : ''}
    ${tasks.length ? `<h2>Що зробити</h2><ul class="chk">${tasks.map(x => `<li>${x.done ? '☑' : '☐'} ${esc(x.title)}${x.due ? ` — до ${ddm(x.due)}` : ''}</li>`).join('')}</ul>` : ''}
    ${(t.packing || []).length ? `<h2>Речі</h2><ul class="chk cols">${t.packing.map(i => `<li>☐ ${esc(i.t)}</li>`).join('')}</ul>` : ''}`;
}
function planPrint(p) {
  const days = x => x.days ? x.days.map(d => WD[d]).join(', ') : 'щодня';
  return `${p.note ? `<p>${plink(p.note)}</p>` : ''}${(p.stages || []).map((s, i) => `<h2>${i + 1}. ${esc(s.name)} <small>${ddm(s.from)}–${ddm(s.to)}</small></h2>${s.goal ? `<p>${esc(s.goal)}</p>` : ''}
    ${(s.home || []).length ? `<table>${s.home.map(x => `<tr><td>${plink(x.t)}</td><td class="nowrap">${days(x)}${x.from || x.to ? `<br><small>${x.from ? 'з ' + ddm(x.from) : ''} ${x.to ? 'до ' + ddm(x.to) : ''}</small>` : ''}</td></tr>`).join('')}</table>` : ''}`).join('')}
    ${(p.targets || []).length ? `<h2>Цілі</h2><table><tr><th>Вправа</th><th class="num">Зараз</th><th class="num">Ціль</th></tr>${p.targets.map(t => `<tr><td>${esc(t.name)}</td><td class="num">${t.now ?? '—'}</td><td class="num">${t.goal} ${esc(t.unit || '')}</td></tr>`).join('')}</table>` : ''}`;
}

// ---------- "Tell the doctor": per upcoming visit, what to say / ask / bring; tick off at the appointment ----------
const VK = { say: 'Сказати', ask: 'Спитати', bring: 'Взяти з собою' };
const openVisits = () => (data.visits || []).filter(v => !v.done).sort((a, b) => (a.date || '9') < (b.date || '9') ? -1 : 1);
views.visits = () => {
  const vs = openVisits();
  const one = v => { const it = v.items || [], left = it.filter(i => !i.done).length;
    return `<h3>${esc(v.title)}${v.date ? ` · ${WD[new Date(v.date + 'T12:00:00').getDay()]} ${ddm(v.date)}` : ''}</h3>${v.note ? `<p class="muted">${linkify(v.note)}</p>` : ''}
    ${Object.keys(VK).map(k => (xs => xs.length ? `<p class="muted">${VK[k]}</p><ul class="list">${xs.map(i => `<li class="${i.done ? 'done' : ''}" data-act="visitTog" data-v="${v.id}|${i.id}"><span class="box"></span><div><b>${esc(i.t)}</b></div></li>`).join('')}</ul>` : '')(it.filter(i => (i.kind || 'say') === k))).join('')}
    <form data-form="visitAdd" class="add"><input type="hidden" name="id" value="${v.id}"><textarea name="t" rows="2" placeholder="Симптом, питання чи що взяти" required></textarea>
      <div class="row"><select name="kind">${Object.entries(VK).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><button class="primary">Додати</button></div></form>
    <form data-form="visitResult" class="add"><input type="hidden" name="id" value="${v.id}"><textarea name="result" rows="3" placeholder="Що сказав лікар: діагноз, призначення, аналізи">${esc(v.result || '')}</textarea>
      <div class="row"><button>Зберегти відповідь</button><button type="button" data-act="visitPrint" data-v="${v.id}">📄 PDF</button></div>
      <button type="button" data-act="visitDone" data-v="${v.id}">Візит завершено${left ? ` (не відмічено ${left})` : ''}</button></form>`; };
  shell(`<div class="row cal-head"><button data-act="tab" data-v="${infoTask ? 'taskInfo' : 'tasks'}">‹</button><h1>Сказати лікарю</h1></div>
    ${vs.map(one).join('') || '<p class="muted">Немає запланованих візитів.</p>'}
    <details ${vs.length ? '' : 'open'}><summary>+ Новий візит</summary><form data-form="visitNew" class="add"><input name="title" placeholder="До кого (напр. терапевт)" required><input name="date" type="date"><button class="primary">Додати</button></form></details>`);
};
function visitPrint(v) { return `${v.date ? `<p><b>${ddm(v.date)}</b></p>` : ''}${Object.keys(VK).map(k => (xs => xs.length ? `<h2>${VK[k]}</h2><ul class="chk">${xs.map(i => `<li>☐ ${plink(i.t)}</li>`).join('')}</ul>` : '')((v.items || []).filter(i => (i.kind || 'say') === k))).join('')}`; }

// ---------- Trip plan: options → chosen, route/stay, day-by-day, budget, packing, linked tasks ----------
const lk = x => x?.private ? '🔒 ' : '';
const TRIP = { idea: '💡 ідея', choosing: '🤔 вибираємо', booked: '✅ заброньовано', done: '🏁 минула' };
let tripId = null;
views.trip = () => {
  const t = (data.trips || []).find(x => x.id === tripId); if (!t) { tab = 'plan'; return views.plan(); }
  const dm = d => d ? `${+d.slice(8)}.${d.slice(5, 7)}` : '', cur = t.currency || '', sum = (t.budget || []).reduce((a, b) => a + (+b.sum || 0), 0);
  const tasks = (t.taskIds || []).map(id => data.tasks.find(x => x.id === id)).filter(Boolean), pk = t.packing || [];
  const wd = d => ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(d + 'T12:00:00').getDay()];
  shell(`<div class="row cal-head"><button data-act="tab" data-v="plan">‹</button><h1>${esc(t.title)}</h1></div>
    <p>${TRIP[t.status] || ''}${t.from ? ` · ${dm(t.from)}${t.to ? '–' + dm(t.to) : ''}` : ''}</p>${t.note ? `<p class="muted">${linkify(t.note)}</p>` : ''}${t.privateNote ? `<p class="muted">🔒 ${linkify(t.privateNote)}</p>` : ''}
    ${(t.options || []).length ? `<h3>Варіанти</h3><ul class="list">${t.options.map(o => `<li class="${t.chosen && t.chosen !== o.id ? 'done' : ''}"><div><b>${lk(o)}${t.chosen === o.id ? '✓ ' : ''}${esc(o.title || o.dates || '')}</b>
      <small>${[o.dates && o.title ? o.dates : '', o.budget && o.budget + ' ' + cur].filter(Boolean).map(esc).join(' · ')}</small>${o.note ? `<small>${linkify(o.note)}</small>` : ''}${o.link ? `<small class="note">${linkify(o.link)}</small>` : ''}</div></li>`).join('')}</ul>` : ''}
    ${t.route || t.stay ? `<h3>Дорога і житло</h3>${t.route ? `<p>🚗 ${linkify(t.route)}</p>` : ''}${t.stay ? `<p>🏠 ${linkify(t.stay)}</p>` : ''}` : ''}
    ${(t.days || []).length ? `<h3>По днях</h3>${t.days.map(d => `<p><b>${d.date ? `${wd(d.date)} ${dm(d.date)}` : esc(d.title || '')}</b>${d.date && d.title ? ' · ' + esc(d.title) : ''}</p><ul class="hint">${(d.items || []).map(i => `<li>${i.private ? '🔒 ' : ''}${linkify(itxt(i))}</li>`).join('')}</ul>`).join('')}` : ''}
    ${(t.budget || []).length ? `<h3>Бюджет: ${sum} ${esc(cur)}</h3><ul class="list">${t.budget.map(b => `<li class="${b.paid ? 'done' : ''}"><div><b>${lk(b)}${esc(b.item)}</b>${b.paid ? '<small>оплачено</small>' : ''}</div><span>${b.sum ?? '?'} ${esc(cur)}</span></li>`).join('')}</ul>` : ''}
    ${tasks.length ? `<h3>Справи</h3><ul class="list">${tasks.map(x => `<li class="${x.done ? 'done' : ''}" data-act="taskMenu" data-v="${x.id}"><span class="box"></span><div><b>${lk(x)}${esc(x.title)}</b>${x.due ? `<small>до ${dm(x.due)}</small>` : ''}</div></li>`).join('')}</ul>` : ''}
    ${pk.length ? `<h3>Речі (${pk.filter(i => i.done).length}/${pk.length})</h3><ul class="list">${pk.map(i => `<li class="${i.done ? 'done' : ''}" data-act="packTog" data-v="${t.id}|${i.id}"><span class="box"></span><div><b>${lk(i)}${esc(i.t)}</b></div></li>`).join('')}</ul>` : ''}
    <button data-act="printTrip" data-v="${t.id}">📄 PDF / друк</button>
    <form data-form="packAdd" class="add"><input type="hidden" name="id" value="${t.id}"><div class="row"><input name="t" placeholder="Додати річ" required><button class="primary" style="flex:0 0 64px">+</button></div></form>`);
};

// ---------- Calendar: habit marks + tasks by due date ----------
const OFF = { vacation: '🌴 відпустка', sick: '🤒 лікарняний' };
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
views.cal = () => {
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), today = Logic.localDay();
  const key = d => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const n = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells = Array(lead).fill('<div></div>');
  for (let d = 1; d <= n; d++) {
    const k = key(d), ds = Logic.doneSet(data, k), pl = Logic.dayPlan(data, k), act = data.routines.filter(r => pl.has(r.id) && !Logic.offOn(data, k, r.id));
    const done = act.filter(r => ds.has(r.id) || Logic.coveredAhead(data, r, k)).length, total = act.length, off = data.routines.map(r => Logic.offOn(data, k, r.id)).find(Boolean);
    const due = data.tasks.some(t => !t.done && (t.due === k || (k === today && t.due && t.due < today))), pct = total ? done / total : 0;
    cells.push(`<button class="day ${k === today ? 'today' : ''} ${k === calSel ? 'sel' : ''}" data-act="calDay" data-v="${k}"
      style="--p:${pct}">${d}${due ? '<i></i>' : ''}${off ? `<em>${OFF[off].slice(0, 2)}</em>` : ''}</button>`);
  }
  const sel = calSel && (() => {
    const ids = Logic.doneSet(data, calSel);
    // Today also carries every overdue open task forward (missed one shows up the next day, and keeps coming).
    const tasks = data.tasks.filter(t => t.due === calSel || (t.doneAt || '').startsWith(calSel) || (calSel === today && !t.done && t.due && t.due < today));
    const pl = Logic.dayPlan(data, calSel), main = r => pl.has(r.id) || ids.has(r.id) || Logic.timeOn(data, calSel, r.id);
    const li = r => { const off = Logic.offOn(data, calSel, r.id), ahead = Logic.coveredAhead(data, r, calSel); return `<li class="${ids.has(r.id) || off || ahead ? 'done' : ''}" data-act="toggleRoutine" data-v="${calSel}|${r.id}"><span class="box"></span><div><b>${esc(r.title)}</b>${off ? `<small>${OFF[off]}</small>` : ahead ? '<small>зроблено наперед</small>' : !Logic.appliesOn(r, calSel, data) ? '<small>поза графіком (наперед)</small>' : ''}${r.goal || Logic.timeOn(data, calSel, r.id) ? `<small>${hm(Logic.timeOn(data, calSel, r.id))}${r.goal ? ' з ' + hm(r.goal * 6e4) : ''}</small>` : ''}</div>
      ${r.goal ? Object.keys(OFF).map(k => `<button class="mini ${off === k ? 'primary' : ''}" data-act="setOff" data-v="${calSel}|${r.id}|${k}" title="${OFF[k]}">${OFF[k].slice(0, 2)}</button>`).join('') : ''}</li>`; };
    const others = data.routines.filter(r => !main(r));
    return `<h3>${calSel}</h3><ul class="list">${data.routines.filter(main).map(li).join('')}
      ${tasks.map(t => `<li class="${t.done ? 'done' : ''}" data-act="toggleTaskDone" data-v="${t.id}|${calSel}"><span class="box"></span><div><b>${esc(t.title)}</b><small>${!t.done && t.due < calSel ? `справа · прострочено з ${+t.due.slice(8)}.${t.due.slice(5, 7)}` : 'справа'}</small></div></li>`).join('')}</ul>
      ${others.length ? `<details><summary>Інші звички — відмітити заднім числом (${others.length})</summary><ul class="list">${others.map(li).join('')}</ul></details>` : ''}`;
  })();
  shell(`<div class="row cal-head"><button data-act="calMove" data-v="-1">‹</button><h1>${MONTHS[m]} ${y}</h1><button data-act="calMove" data-v="1">›</button></div>
    <div class="cal">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map(w => `<span>${w}</span>`).join('')}${cells.join('')}</div>
    <div id="mood"></div>
    <p class="muted">Заливка дня = частка виконаних звичок, крапка = справа з дедлайном. Натисни день, потім пункт, щоб відмітити.</p>${sel || ''}`);
  loadMood();
};

// Mood chart: last 14 days from journal/mood.csv (scores inferred by the coach from check-ins).
let moodCache = null;
async function loadMood() {
  const c = Sync.cfg(data), el = () => document.getElementById('mood');
  if (!c || !el()) return;
  if (!moodCache) {
    try { const f = await GH.read(c, 'journal/mood.csv'); moodCache = f ? f.text.trim().split('\n').slice(1).map(l => l.split(',')) : []; }
    catch { return; }
  }
  const days = [...Array(14)].map((_, i) => Logic.localDay(new Date(Date.now() - (13 - i) * 864e5)));
  const by = Object.fromEntries(moodCache.map(r => [r[0], r]));
  const bar = (v, cls) => `<i class="${cls}" style="height:${(+v || 0) * 8}px"></i>`;
  // Check-ins skew to bad/boring days; good days often have none. Days without a check-in row: energy guessed from done habits/tasks (hollow bar). Rows with src=tasks were inferred by the coach.
  const en = d => by[d]?.[2] ? [by[d][2], by[d][6] === 'tasks' ? 'e g' : 'e'] : [Logic.energyGuess(data, d), 'e g'];
  if (el()) el().innerHTML = `<h3>Настрій і сили, 14 днів</h3><div class="moodchart">${days.map(d => { const [v, c] = en(d); const mo = by[d]?.[1] ? [by[d][1], 'm'] : v ? [Math.max(3, v), 'm g'] : [0, 'm']; // no check-in usually means an OK day, not a bad one
      return `<div>${bar(mo[0], mo[1])}${bar(v, c)}<span>${+d.slice(8)}</span></div>`; }).join('')}</div>
    <p class="muted"><b class="lm">■</b> настрій <b class="le">■</b> сили з чек-інів <b class="le">□</b> оцінка за виконаними справами, без чек-іну (1–5)</p>`;
}

// ---------- Chat ----------
views.chat = () => {
  const s = data.settings || {};
  if (!s.apiKey) return shell('<h1>Чат</h1><p class="muted">Додай ключ Claude API в ⚙︎, щоб говорити з агентом.</p>');
  const msgs = (data.chat || []).filter(m => typeof m.content === 'string' || m.content.some(b => b.type === 'text' || b.type === 'tool_use'));
  shell(`<div class="chat">${msgs.map(m => `<div class="msg ${m.role}">${esc(Chat.display(m)).replace(/\n/g, '<br>')}</div>`).join('')}
    ${busy ? '<div class="msg assistant muted">…</div>' : ''}</div>
    <form data-form="chat" class="add"><textarea name="text" rows="2" placeholder="Напиши…" required></textarea>
    <div class="row"><button class="primary" ${busy ? 'disabled' : ''}>Надіслати</button><button type="button" data-act="newChat">Новий чат</button></div></form>`);
  window.scrollTo(0, document.body.scrollHeight);
};

// ---------- Settings: backup / import ----------
// VAPID key: typed on this device, else the one synced with the last subscription (so a new phone needs no Pi access).
const PUSH_EP = 'pushEndpoint', vapidKey = () => (data.settings?.vapid || data.push?.vapid || '').trim();
// Read-only "team": the assistant's roles (maintained by the agents in the data repo): emoji, name, purpose, next step.
const teamHtml = () => (rs => rs.length ? `<details><summary>Команда помічника (${rs.length})</summary><ul class="list">${rs.map(r => `<li class="${r.status === 'paused' ? 'done' : ''}"><span>${esc(r.emoji || '•')}</span><div><b>${esc(r.name)}</b><small>${esc(r.about || '')}</small>${r.next ? `<small>Далі: ${esc(r.next)}${r.date ? ' · ' + ddm(r.date) : ''}</small>` : ''}</div></li>`).join('')}</ul><button data-act="tab" data-v="agents">${esc(Agents.ui(data.settings?.lang || 'uk').change)}</button></details>` : '')((data.roles || []).filter(r => r.status !== 'retired'));
// Onboarding: pick which agents (roles) to enable. Shown until the manager role exists; reopened from settings.
let agentsShown = '';
views.agents = () => { const L = data.settings?.lang || 'uk', T = Agents.ui(L), act = new Set(Agents.active(data)); agentsShown = JSON.stringify(Agents.active(data));
  $app.innerHTML = `<div class="page"><h1>${esc(T.title)}</h1><p class="muted">${esc(T.intro)}</p><ul class="list">${Agents.CATALOG.map(a =>
    `<li><label class="pick"><input type="checkbox" name="agent" value="${a.id}" ${a.required ? 'checked disabled' : act.has(a.id) ? 'checked' : ''}><span>${a.emoji}</span><div><b>${esc(Agents.tr(a.name, L))}</b>${a.required ? ` <small>· ${esc(T.always)}</small>` : ''}<small>${esc(Agents.tr(a.about, L))}</small></div></label></li>`).join('')}</ul>
    <button class="primary" data-act="agentsDone">${esc(T.done)}</button>${Agents.chosen(data) ? '' : `<button data-act="tab" data-v="settings">${esc(T.have)}</button>`}</div>`; };
views.settings = () => { const s = data.settings || {}; shell(`${teamHtml()}<h1>Налаштування</h1>
  <button data-act="lock">Заблокувати</button>
  ${localStorage.getItem(CRED) ? '<button data-act="faceOff">Вимкнути Face ID</button>' : '<button data-act="faceEnable">Увімкнути Face ID</button>'}
  <h3>Репозиторій з даними</h3>
  <form data-form="settings">
    <input name="ghRepo" placeholder="owner/repo" value="${esc(s.ghRepo)}">
    <input name="ghToken" type="password" placeholder="GitHub токен (fine-grained, Contents: RW)" value="${esc(s.ghToken)}">
    <button class="primary">Зберегти</button></form>
  <button data-act="syncNow">Синхронізувати зараз</button>
  <h3>Тиждень з дітьми</h3><p class="muted">Чергується щотижня. Зараз: ${Logic.isKidsWeek(data, Logic.localDay()) ? '<b>мій тиждень з дітьми</b> (план менший)' : 'звичайний тиждень'}.</p>
  <button data-act="kidsWeek">${Logic.isKidsWeek(data, Logic.localDay()) ? 'Ні, цей тиждень звичайний' : 'Цей тиждень — мій з дітьми'}</button>
  <h3>Нагадування (пуш)</h3><p class="muted">Ранок, дедлайни, час спати. Текст нейтральний. На iPhone працює лише з іконки на головному екрані. Ключ VAPID дає скрипт на Raspberry Pi.</p>
  <form data-form="vapid"><input name="vapid" placeholder="VAPID public key" value="${esc(vapidKey())}"><button>Зберегти ключ</button></form>
  ${vapidMsg ? `<p class="${vapidMsg.ok ? 'ok' : 'err'}">${esc(vapidMsg.text)}</p>` : vapidKey() ? '<p class="muted">Ключ є ✓</p>' : ''}
  <button data-act="pushOn">${data.push?.sub?.endpoint && data.push.sub.endpoint === localStorage.getItem(PUSH_EP) ? 'Пуш увімкнено ✓ (оновити)' : 'Увімкнути нагадування на цьому телефоні'}</button>
  <h3>Перенесення даних</h3><p class="muted">Експорт — незашифрований JSON. Не зберігай його в спільних місцях.</p>
  <button data-act="export">Скопіювати експорт</button>
  <textarea id="imp" rows="5" placeholder="Встав JSON для імпорту"></textarea>
  <button data-act="import">Імпортувати (замінить усе)</button>
  <h3>Небезпечно</h3><button class="danger" data-act="wipe">Стерти всі дані</button>`); };

// ---------- Events ----------
const acts = {
  agentsDone: async () => { const ids = [...$app.querySelectorAll('input[name=agent]:checked')].map(i => i.value);
    const had = Agents.chosen(data); if (data.settings?.ghRepo) await syncNow(); // never overwrite roles the data repo already has
    if (!had && Agents.chosen(data)) { tab = 'settings'; return render(); } // server already had roles/data: keep them, show the team list
    if (JSON.stringify(Agents.active(data)) !== agentsShown) { tab = 'agents'; return render(); } // roles changed during sync: show the fresh state, apply nothing
    Agents.apply(data, ids, data.settings?.lang || 'uk'); tab = 'home'; await save(); render(); },
  key: v => { const el = document.getElementById('pin'); el.value = v === 'back' ? el.value.slice(0, -1) : (el.value + v).slice(0, 6); },
  bonus: () => { skipped = []; next(true); }, // declined items come back in bonus mode
  pushOn: async () => {
    const msg = (ok, text) => { vapidMsg = { ok, text }; render(); };
    const key = vapidKey(); if (!key) return msg(false, 'Спершу встав і збережи ключ VAPID.');
    if (!('PushManager' in window)) return msg(false, 'Пуш недоступний. На iPhone відкрий застосунок з іконки на головному екрані.');
    try {
      if (await Notification.requestPermission() !== 'granted') return msg(false, 'Сповіщення не дозволені. Увімкни їх у Параметри → Сповіщення → Помічник.');
      const b = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), k = Uint8Array.from(b, c => c.charCodeAt(0));
      const reg = await navigator.serviceWorker.ready; let old = await reg.pushManager.getSubscription();
      const same = (x, y) => x && x.byteLength === y.byteLength && new Uint8Array(x).every((v, i) => v === y[i]);
      if (old && !same(old.options?.applicationServerKey, k)) { await old.unsubscribe(); old = null; } // key changed → resubscribe
      const sub = old || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: k });
      data.push = { sub: sub.toJSON(), vapid: key, u: Date.now() }; localStorage.setItem(PUSH_EP, sub.endpoint); await save(); await syncNow(true);
      msg(true, 'Нагадування увімкнено ✓ (на Pi можна запустити тест, крок 5 інструкції).');
    } catch (e) { msg(false, 'Не вдалося увімкнути: ' + e.message); }
  },

  kidsWeek: async () => { const mon = d => { const x = new Date(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return Logic.localDay(x); };
    const now = new Date(), on = Logic.isKidsWeek(data, Logic.localDay()); data.prefs = { ...(data.prefs || {}), kidsWeekStart: mon(on ? now.getTime() + 7 * 864e5 : now), u: Date.now() }; await save(); render(); },
  unlock, lock,
  next: () => next(), faceEnable, faceCheck,
  faceOff: () => { localStorage.removeItem(CRED); render(); },
  newChat: async () => { data.chat = []; Chat.resetContext(); await save(); render(); },
  syncNow: () => syncNow(false),
  calMove: v => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + +v, 1); render(); },
  calDay: v => { calSel = v; render(); },
  tab: v => { tab = v; render(); },
  other: () => { skipped.push(current.id); next(); },
  done: async () => { Logic.markDone(data, current); current = null; await save(); next(); },
  start: () => { const c = current; startTimer(c.title, c.minutes, c.kind, c.id); },
  timerDone: v => { clearInterval(tick); finishTimer(v); },
  timerStop: async v => { data.timers = timers().filter(x => x.id !== v); await save(); render(); },
  timerPause: async v => { const t = timers().find(x => x.id === v); logTime(t); t.acc = elapsed(t); t.run = null; await save(); render(); },
  timerResume: async v => { for (const t of timers()) if (t.run) { logTime(t); t.acc = elapsed(t); t.run = null; } timers().find(x => x.id === v).run = Date.now(); await save(); render(); },
  printTrip: v => { const t = data.trips.find(x => x.id === v); if (t) printDoc(t, tripPrint, (t.taskIds || []).filter(id => data.tasks.find(x => x.id === id)?.private).length); },
  printPlan: v => { const p = data.plans.find(x => x.id === v); if (p) printDoc(p, planPrint); },
  printBack: () => { tab = printing?.back || 'home'; printing = null; render(); },
  printGo: async () => { // iOS home-screen apps ignore window.print → build a real PDF and open the share sheet.
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (!standalone) { const old = document.title; document.title = printing.title; window.print(); setTimeout(() => { document.title = old; }, 1000); return; }
    const btn = document.querySelector('[data-act=printGo]'); btn.disabled = true; btn.textContent = 'Готую PDF…';
    try { await pdfShare(printing.title, document.querySelector('.sheet')); } catch (e) { if (e.name !== 'AbortError') alert('Не вдалося: ' + e.message); }
    btn.disabled = false; btn.textContent = 'Зберегти PDF / друк'; },
  visitTog: async v => { const [vid, iid] = v.split('|'), x = data.visits.find(y => y.id === vid), i = x?.items?.find(y => y.id === iid); if (!i) return; i.done = !i.done; Logic.touch(x); await save(); render(); },
  visitDone: async v => { const x = data.visits.find(y => y.id === v); if (!x) return; x.done = true; Logic.touch(x); await save(); render(); },
  visitPrint: v => { const x = data.visits.find(y => y.id === v); if (x) printDoc(x, visitPrint); },
  role: v => { roleId = v; tab = 'role'; render(); },
  trip: v => { tripId = v; tab = 'trip'; render(); },
  packTog: async v => { const [tid, iid] = v.split('|'), t = (data.trips || []).find(x => x.id === tid), i = t?.packing?.find(x => x.id === iid); if (!i) return;
    i.done = !i.done; Logic.touch(t); await save(); render(); },
  toggleShop: async v => { const i = data.shopping.find(x => x.id === v); i.done = !i.done; i.doneAt = new Date().toISOString(); Logic.touch(i); await save(); render(); },
  toggleTask: async v => { Logic.markDone(data, { kind: 'task', id: v }); await save(); render(); },
  taskMenu: v => { sheetTask = v; render(); },
  sheetClose: () => { sheetTask = null; render(); }, noop: () => {},
  taskDone: async v => { Logic.markDone(data, { kind: 'task', id: v }); sheetTask = null; await save(); render(); },
  taskUndo: async v => { const t = data.tasks.find(x => x.id === v); if (t) { t.done = false; delete t.doneAt; Logic.touch(t); } sheetTask = null; await save(); render(); },
  taskInfo: v => { infoTask = v; sheetTask = null; tab = 'taskInfo'; render(); },
  taskEdit: v => { editId = v; sheetTask = null; tab = 'tasks'; render(); document.querySelector('li.edit')?.scrollIntoView({ block: 'center' }); },
  dismissMemo: async v => { Logic.remove(data, 'memos', v); await save(); render(); },
  hideNote: v => { try { const k = 'hidden-' + Logic.localDay(); localStorage.setItem(k, JSON.stringify([...hiddenNotes(), v])); } catch {} render(); },
  dismiss: async v => { Logic.remove(data, 'inbox', v); await save(); render(); },
  setOff: async v => { const [day, id, st] = v.split('|'); Logic.setOff(data, day, id, Logic.offOn(data, day, id) === st ? '' : st); await save(); render(); },
  toggleRoutine: async v => { const [day, id] = v.split('|'); Logic.setRoutine(data, day, id, !Logic.doneSet(data, day).has(id)); await save(); render(); },
  toggleTaskDone: async v => {
    const [id, day] = v.split('|'), t = data.tasks.find(x => x.id === id); if (!t) return;
    t.done = !t.done; t.doneAt = t.done ? (day === Logic.localDay() ? new Date().toISOString() : day + 'T12:00:00.000Z') : undefined; Logic.touch(t); await save(); render();
  },
  qLater: v => { qLater.push(v); render(); },
  edit: v => { editId = v || null; render(); },
  timerGoal: v => { const t = timers().find(x => x.id === v), r = t && data.routines.find(x => x.id === t.ref); if (!r) return; clearInterval(tick); logTime(t); const left = r.goal * 6e4 - Logic.timeOn(data, Logic.localDay(), r.id); if (left > 0) Logic.addTime(data, Logic.localDay(), r.id, left); finishTimer(v); },
  delTask: async v => { if (!confirm('Видалити справу?')) return; Logic.remove(data, 'tasks', v); sheetTask = null; await save(); render(); },
  delRoutine: async v => { if (!confirm('Видалити звичку?')) return; Logic.remove(data, 'routines', v); await save(); render(); },
  export: async () => { await navigator.clipboard.writeText(JSON.stringify(data)); alert('Скопійовано'); },
  import: async () => {
    try { const d = JSON.parse(document.getElementById('imp').value); const keep = { settings: data.settings, chat: data.chat }; data = Object.assign(Logic.empty(), d, keep); Logic.COLLECTIONS.forEach(c => (data[c] = data[c] || []).forEach(i => Logic.touch(i))); await save(); alert('Імпортовано'); render(); }
    catch { alert('Невірний JSON'); }
  },
  wipe: () => { if (confirm('Стерти всі дані на цьому пристрої?')) { Vault.wipe(); lock(); } },
};
$app.addEventListener('click', e => {
  if (e.target.closest('a[href]')) return; // links open, never toggle the row
  const el = e.target.closest('[data-act]'); if (!el) return;
  e.stopPropagation(); acts[el.dataset.act]?.(el.dataset.v);
});
$app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id?.startsWith('pin')) unlock(); });
const num = v => v === '' ? undefined : +v;
function routineFrom(f, old) {
  const r = { ...old, u: Date.now(), title: f.title.trim() };
  for (const k of ['from', 'to', 'minutes', 'goal', 'days', 'perWeek', 'every', 'prio']) delete r[k];
  const days = DAYS.filter(d => f['d' + d]);
  for (const k of ['from', 'to', 'minutes', 'goal', 'perWeek', 'every']) if (num(f[k]) != null) r[k] = num(f[k]);
  if (days.length && days.length < 7) r.days = days;
  if (+f.prio !== 2) r.prio = +f.prio; if (+f.prio !== 1) delete r.fixed;
  return r;
}
const forms = {
  checkin: f => (data.checkins = data.checkins || []).push({ u: Date.now(), id: Logic.id(), date: Logic.localDay(), text: f.text.trim() }),
  memo: f => (data.memos = data.memos || []).push({ u: Date.now(), id: Logic.id(), text: f.text.trim(), date: new Date().toISOString() }),
  addShop: f => data.shopping.push({ u: Date.now(), id: Logic.id(), store: f.store.trim() || f.storeSel || 'Інше', text: f.text.trim(), note: f.note.trim(), done: false }),
  visitNew: f => { (data.visits = data.visits || []).push({ id: Logic.id(), u: Date.now(), title: f.title.trim(), date: f.date || null, items: [] }); },
  visitAdd: f => { const v = (data.visits || []).find(x => x.id === f.id); if (!v) return; (v.items = v.items || []).push({ id: Logic.id(), t: f.t.trim(), kind: f.kind, done: false }); Logic.touch(v); },
  visitResult: f => { const v = (data.visits || []).find(x => x.id === f.id); if (!v) return; v.result = f.result.trim(); Logic.touch(v); },
  packAdd: f => { const t = (data.trips || []).find(x => x.id === f.id); if (!t) return; (t.packing = t.packing || []).push({ id: Logic.id(), t: f.t.trim(), done: false }); Logic.touch(t); },
  addTask: f => data.tasks.push({ u: Date.now(), id: Logic.id(), title: f.title.trim(), details: f.details?.trim() || undefined, ...monthlyFields(f), minutes: num(f.minutes), focus: !!f.focus, done: false }),
  settings: f => { data.settings = { ...data.settings, ...f }; Chat.resetContext(); },
  addRoutine: f => data.routines.push(routineFrom(f, { id: Logic.id() })),
  saveRoutine: f => { const i = data.routines.findIndex(r => r.id === f.id); if (i >= 0) data.routines[i] = routineFrom(f, data.routines[i]); editId = null; },
  answer: f => { const q = (data.questions || []).find(x => x.id === f.id); if (q) Object.assign(q, { a: f.a.trim(), u: Date.now() }); },
  planNow: f => { const p = (data.plans || []).find(x => x.id === f.id); if (!p) return;
    p.targets.forEach((t, i) => { const v = num(f['t' + i]); if (v === undefined) delete t.now; else t.now = v; }); p.u = Date.now(); },
  vapid: f => { const k = (f.vapid || '').trim().replace(/\s+/g, '');
    let ok = false; try { const b = atob(k.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - k.length % 4) % 4)); ok = b.length === 65 && b.charCodeAt(0) === 4; } catch {}
    if (!ok) { vapidMsg = { ok: false, text: 'Це не схоже на ключ VAPID. Скопіюй увесь рядок Public key з Pi (≈87 символів).' }; return; }
    data.settings = { ...data.settings, vapid: k }; vapidMsg = { ok: true, text: 'Ключ збережено ✓ Тепер натисни «Увімкнути нагадування».' }; },
  saveTask: f => { const t = data.tasks.find(x => x.id === f.id); if (t) Object.assign(t, { u: Date.now(), title: f.title.trim(), details: f.details?.trim() || undefined, ...monthlyFields(f), minutes: num(f.minutes), focus: !!f.focus }); editId = null; },
};
// Monthly day (1–31) without a date → due on the next such day (today counts).
function monthlyFields(f) { const m = Math.min(31, Math.max(0, Math.round(num(f.monthly) || 0))) || undefined;
  const yest = Logic.localDay(new Date(Date.now() - 864e5));
  const due = f.due || (m ? Logic.monthlyDue(m, yest) : null);
  return { monthly: m, due, from: m ? due : undefined }; }
$app.addEventListener('submit', async e => {
  e.preventDefault();
  if (data) clearDrafts(e.target);
  if (e.target.dataset.form === 'timer') {
    const f = Object.fromEntries(new FormData(e.target)), r = data.routines.find(x => x.id === f.ref);
    if (!r && !f.title.trim()) return alert('Вибери звичку або впиши назву');
    return startTimer(r ? r.title : f.title.trim(), +f.minutes > 0 ? +f.minutes : null, r ? 'routine' : 'free', r?.id || null);
  }
  if (e.target.dataset.form === 'chat') {
    const text = new FormData(e.target).get('text').trim(); if (!text || busy) return;
    busy = true; render();
    try { await Chat.send(data, text); } catch (err) { alert('Помилка: ' + err.message); }
    busy = false; await save(); render(); return;
  }
  forms[e.target.dataset.form](Object.fromEntries(new FormData(e.target)));
  await save(); render();
});

// Block iOS pinch/double-tap zoom (iOS ignores user-scalable=no in some modes).
['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
render();
