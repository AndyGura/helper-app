// UI (Ukrainian). Single-user, local-first, encrypted vault (crypto.js).
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOCK_AFTER_MS = 60e3;
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel = null;
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
    <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off">
    ${isNew ? '<input id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="Ще раз" autocomplete="off">' : ''}
    <button class="primary" data-act="unlock">${isNew ? 'Створити' : 'Відкрити'}</button>
    <p class="err">${esc(msg)}</p></section>`;
  document.getElementById('pin').focus();
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
const TABS = [['home', 'Головна'], ['cal', 'Календар'], ['shop', 'Покупки'], ['tasks', 'Справи'], ['settings', '⚙︎']];
const shell = body => {
  $app.innerHTML = `<div class="page">${body}</div><nav>${TABS.map(([k, t]) =>
    `<button data-act="tab" data-v="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</nav>`;
};

// ---------- Home: "Що мені робити?" + focus timer ----------
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1e3)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const views = {};
views.home = () => {
  clearInterval(tick);
  const t = data.timer;
  if (t) {
    shell(`<section class="timer"><p class="muted">Тільки це:</p><h2>${esc(t.title)}</h2>
      <div class="clock" id="clock">${fmt(t.end - Date.now())}</div>
      <button data-act="timerDone" class="primary">Готово</button>
      <a class="btn" href="shortcuts://run-shortcut?name=FocusTimer&input=${t.minutes}">Таймер iPhone (офлайн)</a>
      <button data-act="timerStop">Скасувати</button></section>`);
    keepAwake(true);
    tick = setInterval(() => {
      const left = t.end - Date.now();
      document.getElementById('clock').textContent = fmt(left);
      if (left <= 0) { clearInterval(tick); ring(); finishTimer(); }
    }, 500);
    return;
  }
  keepAwake(false);
  const c = current;
  shell(`<section class="home">
    <button class="big" data-act="next">Що мені робити?</button>
    ${c ? `<div class="card"><h2>${esc(c.title)}</h2>
      ${c.minutes ? `<p class="muted">${c.minutes} хв</p>` : ''}
      <div class="row">
        ${c.minutes ? `<button class="primary" data-act="start">Почати ${c.minutes} хв</button>` : ''}
        <button data-act="done">Зроблено</button><button data-act="other">Інше</button>
      </div></div>` : current === false ? '<p class="muted">Все зроблено. Відпочинь 🙂</p>' : ''}
  </section>`);
};
function next() { current = Logic.pickNext(data, new Date(), skipped) || false; render(); }
async function finishTimer() {
  const t = data.timer; data.timer = null;
  Logic.markDone(data, { kind: t.kind, id: t.id }); current = null; await save(); render();
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
      <input name="store" list="stores" placeholder="Магазин" required>
      <datalist id="stores">${stores.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <input name="text" placeholder="Що купити" required>
      <input name="note" placeholder="Розмір, модель, нотатка">
      <button class="primary">Додати</button></form>`);
};

// ---------- Tasks & routines ----------
views.tasks = () => {
  const open = data.tasks.filter(t => !t.done).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
  const today = new Set(data.log[Logic.localDay()] || []);
  shell(`<h1>Справи</h1><ul class="list">${open.map(t => `<li data-act="toggleTask" data-v="${t.id}"><span class="box"></span>
      <div><b>${t.focus ? '★ ' : ''}${esc(t.title)}</b><small>${[t.due, t.minutes && t.minutes + ' хв'].filter(Boolean).join(' · ')}</small></div>
      <button class="x" data-act="delTask" data-v="${t.id}">✕</button></li>`).join('') || '<p class="muted">Немає справ</p>'}</ul>
    <form data-form="addTask" class="add">
      <input name="title" placeholder="Нова справа" required>
      <div class="row"><input name="due" type="date"><input name="minutes" type="number" min="1" placeholder="хв"></div>
      <label><input name="focus" type="checkbox"> Фокус ★</label>
      <button class="primary">Додати</button></form>
    <h1>Щоденні звички</h1><ul class="list">${data.routines.map(r => `<li class="${today.has(r.id) ? 'done' : ''}"><span class="box"></span>
      <div><b>${esc(r.title)}</b><small>${r.minutes ? r.minutes + ' хв · ' : ''}${r.from ?? 0}:00–${r.to ?? 24}:00</small></div>
      <button class="x" data-act="delRoutine" data-v="${r.id}">✕</button></li>`).join('')}</ul>
    <form data-form="addRoutine" class="add">
      <input name="title" placeholder="Звичка" required>
      <div class="row"><input name="from" type="number" min="0" max="23" placeholder="з (год)"><input name="to" type="number" min="1" max="24" placeholder="до (год)"><input name="minutes" type="number" min="1" placeholder="хв"></div>
      <button class="primary">Додати</button></form>`);
};

// ---------- Calendar: habit marks + tasks by due date ----------
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
views.cal = () => {
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), today = Logic.localDay();
  const key = d => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const total = data.routines.length, n = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells = Array(lead).fill('<div></div>');
  for (let d = 1; d <= n; d++) {
    const k = key(d), done = (data.log[k] || []).filter(id => data.routines.some(r => r.id === id)).length;
    const due = data.tasks.some(t => t.due === k && !t.done), pct = total ? done / total : 0;
    cells.push(`<button class="day ${k === today ? 'today' : ''} ${k === calSel ? 'sel' : ''}" data-act="calDay" data-v="${k}"
      style="--p:${pct}">${d}${due ? '<i></i>' : ''}</button>`);
  }
  const sel = calSel && (() => {
    const ids = new Set(data.log[calSel] || []);
    const tasks = data.tasks.filter(t => t.due === calSel || (t.doneAt || '').startsWith(calSel));
    return `<h3>${calSel}</h3><ul class="list">${data.routines.map(r => `<li class="${ids.has(r.id) ? 'done' : ''}"><span class="box"></span><div><b>${esc(r.title)}</b></div></li>`).join('')}
      ${tasks.map(t => `<li class="${t.done ? 'done' : ''}"><span class="box"></span><div><b>${esc(t.title)}</b><small>справа</small></div></li>`).join('')}</ul>`;
  })();
  shell(`<div class="row cal-head"><button data-act="calMove" data-v="-1">‹</button><h1>${MONTHS[m]} ${y}</h1><button data-act="calMove" data-v="1">›</button></div>
    <div class="cal">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map(w => `<span>${w}</span>`).join('')}${cells.join('')}</div>
    <p class="muted">Заливка дня = частка виконаних звичок, крапка = є справа з дедлайном.</p>${sel || ''}`);
};

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
  <h3>Перенесення даних</h3><p class="muted">Експорт — незашифрований JSON. Не зберігай його в спільних місцях.</p>
  <button data-act="export">Скопіювати експорт</button>
  <textarea id="imp" rows="5" placeholder="Встав JSON для імпорту"></textarea>
  <button data-act="import">Імпортувати (замінить усе)</button>
  <h3>Небезпечно</h3><button class="danger" data-act="wipe">Стерти всі дані</button>`); };

// ---------- Events ----------
const acts = {
  unlock, lock, next, faceEnable, faceCheck,
  faceOff: () => { localStorage.removeItem(CRED); render(); },
  newChat: async () => { data.chat = []; Chat.resetContext(); await save(); render(); },
  syncNow: () => syncNow(false),
  calMove: v => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + +v, 1); render(); },
  calDay: v => { calSel = v; render(); },
  tab: v => { tab = v; render(); },
  other: () => { skipped.push(current.id); next(); },
  done: async () => { Logic.markDone(data, current); current = null; await save(); next(); },
  start: async () => { const c = current; data.timer = { kind: c.kind, id: c.id, title: c.title, minutes: c.minutes, end: Date.now() + c.minutes * 6e4 }; await save(); render(); },
  timerDone: () => { clearInterval(tick); finishTimer(); },
  timerStop: async () => { data.timer = null; await save(); render(); },
  toggleShop: async v => { const i = data.shopping.find(x => x.id === v); i.done = !i.done; i.doneAt = new Date().toISOString(); Logic.touch(i); await save(); render(); },
  toggleTask: async v => { Logic.markDone(data, { kind: 'task', id: v }); await save(); render(); },
  delTask: async v => { Logic.remove(data, 'tasks', v); await save(); render(); },
  delRoutine: async v => { if (!confirm('Видалити звичку?')) return; Logic.remove(data, 'routines', v); await save(); render(); },
  export: async () => { await navigator.clipboard.writeText(JSON.stringify(data)); alert('Скопійовано'); },
  import: async () => {
    try { const d = JSON.parse(document.getElementById('imp').value); const keep = { settings: data.settings, chat: data.chat }; data = Object.assign(Logic.empty(), d, keep); Logic.COLLECTIONS.forEach(c => data[c].forEach(i => Logic.touch(i))); await save(); alert('Імпортовано'); render(); }
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
const forms = {
  addShop: f => data.shopping.push({ u: Date.now(), id: Logic.id(), store: f.store.trim(), text: f.text.trim(), note: f.note.trim(), done: false }),
  addTask: f => data.tasks.push({ u: Date.now(), id: Logic.id(), title: f.title.trim(), due: f.due || null, minutes: num(f.minutes), focus: !!f.focus, done: false }),
  settings: f => { data.settings = { ...data.settings, ...f }; Chat.resetContext(); },
  addRoutine: f => data.routines.push({ u: Date.now(), id: Logic.id(), title: f.title.trim(), from: num(f.from), to: num(f.to), minutes: num(f.minutes) }),
};
$app.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.dataset.form === 'chat') {
    const text = new FormData(e.target).get('text').trim(); if (!text || busy) return;
    busy = true; render();
    try { await Chat.send(data, text); } catch (err) { alert('Помилка: ' + err.message); }
    busy = false; await save(); render(); return;
  }
  forms[e.target.dataset.form](Object.fromEntries(new FormData(e.target)));
  await save(); render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
render();
