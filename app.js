// UI (Ukrainian). Single-user, local-first, encrypted vault (crypto.js).
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Escape, keep line breaks, make http(s) links clickable (e.g. video tutorials in coach notes).
const linkify = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">▶ відкрити</a>`).replace(/\n/g, '<br>');
const LOCK_AFTER_MS = 60e3;
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel = null, editId = null, qLater = [];
let data = null, tab = 'home', skipped = [], current = null, hiddenAt = 0, tick = null, wakeLock = null, faceOk = false, busy = false;
const CRED = 'helper.cred';

const save = async () => { await Vault.save(data); Sync.schedule(data, async () => { await Vault.save(data); render(); }); };
async function syncNow(quiet = true) {
  try { if (await Sync.sync(data)) { await Vault.save(data); render(); } if (!quiet) alert('Синхронізовано'); }
  catch (e) { if (!quiet) alert('Помилка синхронізації: ' + e.message); }
}
function render() { data ? views[tab]() : lockView(); }

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
  if (document.hidden) hiddenAt = Date.now();
  // Reload instead of a plain lock: clears memory and picks up the latest app version.
  else if (Date.now() - hiddenAt > LOCK_AFTER_MS) { data = null; Vault.lock(); location.reload(); }
  else if (data) { render(); syncNow(); }
});

// ---------- Layout ----------
// Chat tab hidden for now (API is billed separately); code kept in chat.js.
const TABS = [['home', 'Головна'], ['cal', 'Календар'], ['shop', 'Покупки'], ['tasks', 'Справи'], ['settings', '⚙️']];
const shell = body => {
  $app.innerHTML = `<div class="page">${body}</div><nav>${TABS.map(([k, t]) =>
    `<button data-act="tab" data-v="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</nav>`;
};

// ---------- Home: "Що мені робити?" + focus timer ----------
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1e3)), p = n => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`; };
const views = {};
// Timers: data.timers = [{id, title, kind, ref, dur (ms | null = stopwatch), acc (ms), run (ms | null)}].
// Only one runs at a time; starting another pauses the running one.
// Instant habits (Pro Flex, bedtime) have no duration: no timer for them.
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
    ${(data.checkins || []).some(c => c.date === Logic.localDay()) ? '' : `<form data-form="checkin" class="add quick checkin"><h3>Як ти сьогодні?</h3>
      <textarea name="text" rows="2" placeholder="Своїми словами: настрій, сили, сон, що на душі" required></textarea>
      <button class="primary">Записати</button></form>`}
    ${(qs => qs.length ? `<form data-form="answer" class="add quick checkin"><h3>Питання від помічника${qs.length > 1 ? ` (ще ${qs.length - 1})` : ''}</h3>
      <p>${esc(qs[0].q)}</p><input type="hidden" name="id" value="${qs[0].id}">
      <textarea name="a" rows="3" placeholder="Скільки хочеш, своїми словами" required></textarea>
      <div class="row"><button class="primary">Відповісти</button><button type="button" data-act="qLater" data-v="${qs[0].id}">Пізніше</button></div></form>` : '')((data.questions || []).filter(q => !q.a && !qLater.includes(q.id)))}
    <button class="big" data-act="next">Що мені робити?</button>
    ${c && c.kind === 'sleep' ? `<div class="card"><h2>${esc(c.title)}</h2></div>` : c ? `<div class="card"><h2>${esc(c.title)}</h2>
      ${c.minutes ? `<p class="muted">${c.minutes} хв</p>` : ''}
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
views.tasks = () => {
  const open = data.tasks.filter(t => !t.done).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
  const today = Logic.doneSet(data, Logic.localDay());
  const taskLi = t => t.id === editId ? `<li class="edit">${taskFormHtml(t)}</li>` : `<li data-act="toggleTask" data-v="${t.id}"><span class="box"></span>
      <div><b>${t.focus ? '★ ' : ''}${esc(t.title)}</b><small>${[t.due, t.minutes && t.minutes + ' хв'].filter(Boolean).join(' · ')}</small></div>
      <button class="x" data-act="edit" data-v="${t.id}">✎</button><button class="x" data-act="delTask" data-v="${t.id}">✕</button></li>`;
  const top = open.slice(0, 3), later = open.slice(3);
  const routineLi = routineLiFactory(today);
  const plan = Logic.dayPlan(data, Logic.localDay()), inPlan = data.routines.filter(r => plan.has(r.id)), rest = data.routines.filter(r => !plan.has(r.id));
  shell(`<h1>Справи</h1><ul class="list">${top.map(taskLi).join('') || '<p class="muted">Немає справ</p>'}</ul>
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
    const due = data.tasks.some(t => t.due === k && !t.done), pct = total ? done / total : 0;
    cells.push(`<button class="day ${k === today ? 'today' : ''} ${k === calSel ? 'sel' : ''}" data-act="calDay" data-v="${k}"
      style="--p:${pct}">${d}${due ? '<i></i>' : ''}${off ? `<em>${OFF[off].slice(0, 2)}</em>` : ''}</button>`);
  }
  const sel = calSel && (() => {
    const ids = Logic.doneSet(data, calSel);
    const tasks = data.tasks.filter(t => t.due === calSel || (t.doneAt || '').startsWith(calSel));
    const pl = Logic.dayPlan(data, calSel), main = r => pl.has(r.id) || ids.has(r.id) || Logic.timeOn(data, calSel, r.id);
    const li = r => { const off = Logic.offOn(data, calSel, r.id), ahead = Logic.coveredAhead(data, r, calSel); return `<li class="${ids.has(r.id) || off || ahead ? 'done' : ''}" data-act="toggleRoutine" data-v="${calSel}|${r.id}"><span class="box"></span><div><b>${esc(r.title)}</b>${off ? `<small>${OFF[off]}</small>` : ahead ? '<small>зроблено наперед</small>' : !Logic.appliesOn(r, calSel, data) ? '<small>поза графіком (наперед)</small>' : ''}${r.goal || Logic.timeOn(data, calSel, r.id) ? `<small>${hm(Logic.timeOn(data, calSel, r.id))}${r.goal ? ' з ' + hm(r.goal * 6e4) : ''}</small>` : ''}</div>
      ${r.goal ? Object.keys(OFF).map(k => `<button class="mini ${off === k ? 'primary' : ''}" data-act="setOff" data-v="${calSel}|${r.id}|${k}" title="${OFF[k]}">${OFF[k].slice(0, 2)}</button>`).join('') : ''}</li>`; };
    const others = data.routines.filter(r => !main(r));
    return `<h3>${calSel}</h3><ul class="list">${data.routines.filter(main).map(li).join('')}
      ${tasks.map(t => `<li class="${t.done ? 'done' : ''}" data-act="toggleTaskDone" data-v="${t.id}|${calSel}"><span class="box"></span><div><b>${esc(t.title)}</b><small>справа</small></div></li>`).join('')}</ul>
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
  if (el()) el().innerHTML = `<h3>Настрій і сили, 14 днів</h3><div class="moodchart">${days.map(d => `<div>${bar(by[d]?.[1], 'm')}${bar(by[d]?.[2], 'e')}<span>${+d.slice(8)}</span></div>`).join('')}</div>
    <p class="muted"><b class="lm">■</b> настрій <b class="le">■</b> сили (1–5, помічник оцінює з твоїх чек-інів)</p>`;
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
views.settings = () => { const s = data.settings || {}; shell(`<h1>Налаштування</h1>
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
  <h3>Перенесення даних</h3><p class="muted">Експорт — незашифрований JSON. Не зберігай його в спільних місцях.</p>
  <button data-act="export">Скопіювати експорт</button>
  <textarea id="imp" rows="5" placeholder="Встав JSON для імпорту"></textarea>
  <button data-act="import">Імпортувати (замінить усе)</button>
  <h3>Небезпечно</h3><button class="danger" data-act="wipe">Стерти всі дані</button>`); };

// ---------- Events ----------
const acts = {
  key: v => { const el = document.getElementById('pin'); el.value = v === 'back' ? el.value.slice(0, -1) : (el.value + v).slice(0, 6); },
  bonus: () => next(true),
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
  toggleShop: async v => { const i = data.shopping.find(x => x.id === v); i.done = !i.done; i.doneAt = new Date().toISOString(); Logic.touch(i); await save(); render(); },
  toggleTask: async v => { Logic.markDone(data, { kind: 'task', id: v }); await save(); render(); },
  dismissMemo: async v => { Logic.remove(data, 'memos', v); await save(); render(); },
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
  delTask: async v => { Logic.remove(data, 'tasks', v); await save(); render(); },
  delRoutine: async v => { if (!confirm('Видалити звичку?')) return; Logic.remove(data, 'routines', v); await save(); render(); },
  export: async () => { await navigator.clipboard.writeText(JSON.stringify(data)); alert('Скопійовано'); },
  import: async () => {
    try { const d = JSON.parse(document.getElementById('imp').value); const keep = { settings: data.settings, chat: data.chat }; data = Object.assign(Logic.empty(), d, keep); Logic.COLLECTIONS.forEach(c => (data[c] = data[c] || []).forEach(i => Logic.touch(i))); await save(); alert('Імпортовано'); render(); }
    catch { alert('Невірний JSON'); }
  },
  wipe: () => { if (confirm('Стерти всі дані на цьому пристрої?')) { Vault.wipe(); lock(); } },
};
$app.addEventListener('click', e => {
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
  addTask: f => data.tasks.push({ u: Date.now(), id: Logic.id(), title: f.title.trim(), due: f.due || null, minutes: num(f.minutes), focus: !!f.focus, done: false }),
  settings: f => { data.settings = { ...data.settings, ...f }; Chat.resetContext(); },
  addRoutine: f => data.routines.push(routineFrom(f, { id: Logic.id() })),
  saveRoutine: f => { const i = data.routines.findIndex(r => r.id === f.id); if (i >= 0) data.routines[i] = routineFrom(f, data.routines[i]); editId = null; },
  answer: f => { const q = (data.questions || []).find(x => x.id === f.id); if (q) Object.assign(q, { a: f.a.trim(), u: Date.now() }); },
  saveTask: f => { const t = data.tasks.find(x => x.id === f.id); if (t) Object.assign(t, { u: Date.now(), title: f.title.trim(), due: f.due || null, minutes: num(f.minutes), focus: !!f.focus }); editId = null; },
};
$app.addEventListener('submit', async e => {
  e.preventDefault();
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
