// Pure, rule-based logic (zero AI tokens). Kept DOM-free so it can be tested in Node.
const Logic = (() => {
  const day = d => d.toISOString().slice(0, 10);
  const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  function empty() {
    return { shopping: [], tasks: [], routines: [], inbox: [], memos: [], log: {}, deleted: {}, timer: null };
  }

  // Candidates: open one-off tasks + routines whose time window is now and not done today.
  function candidates(data, now = new Date()) {
    const today = localDay(now), h = now.getHours() + now.getMinutes() / 60, wd = now.getDay();
    const doneToday = doneSet(data, today);
    const late = h >= 22 || h < 4;
    const out = [];
    for (const t of data.tasks) {
      if (t.done) continue;
      let s = 10;
      if (t.due) {
        const d = daysBetween(today, t.due);
        s = d < 0 ? 100 - d * 5 : d === 0 ? 80 : d <= 3 ? 50 - d * 5 : 15;
      }
      if (t.focus) s += 30;
      out.push({ kind: 'task', id: t.id, title: t.title, minutes: t.minutes || 0, score: s, item: t });
    }
    for (const r of data.routines) {
      if (doneToday.has(r.id) || !appliesOn(r, today) || offOn(data, today, r.id) || coveredAhead(data, r, today)) continue;
      const wk = r.perWeek ? weekCount(data, r, today) : 0;
      if (r.perWeek && wk >= r.perWeek) continue;
      const from = r.from ?? 0, to = r.to ?? 24;
      const inWin = from <= to ? h >= from && h < to : h >= from || h < to; // supports overnight windows
      if (!inWin) continue;
      const span = (to - from + 24) % 24 || 24, passed = (h - from + 24) % 24;
      out.push({ kind: 'routine', id: r.id, title: r.title, minutes: r.minutes || 0, score: 60 + 30 * passed / span - (r.perWeek ? 25 - 25 * Math.min(1, (r.perWeek - wk) / (7 - (wd + 6) % 7)) : 0), item: r });
    }
    for (const c of out) {
      if (late && c.minutes && c.minutes <= 15) c.score += 15;
      if (late && c.minutes > 45) c.score -= 30;
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // ONE next action; `skipped` = ids the user already declined this session.
  // At night (00:00–05:00) only quick things (≤5 min) that are due now count; otherwise: go to sleep.
  const SLEEP = ['Йди спи, трудяга 😴', 'Йди спи, сова ти така 🦉', 'Йди спи, невгамовний 😄', 'Йди спи, вічний двигун ⚡',
    'Йди спи, непосида 🙃', 'Йди спи, трудоголік ти мій 💤', 'Йди спи, шило ти невгамовне 😜'];
  const isNight = now => now.getHours() < 5;
  function pickNext(data, now = new Date(), skipped = []) {
    let list = candidates(data, now).filter(c => !skipped.includes(c.id));
    if (isNight(now)) {
      const today = localDay(now);
      list = list.filter(c => c.minutes && c.minutes <= 5 && (c.kind === 'routine' || (c.item.due && c.item.due <= today)));
      if (!list.length) return { kind: 'sleep', id: 'sleep', title: SLEEP[Math.floor(Math.random() * SLEEP.length)], minutes: 0 };
    }
    return list[0] || null;
  }

  // Habit log: log[day] = {routineId: ms}; positive = done, negative = un-marked (abs = when). Old array format = done.
  const dayLog = (data, day) => { const v = data.log?.[day]; return Array.isArray(v) ? Object.fromEntries(v.map(id => [id, 1])) : (v || {}); };
  const doneSet = (data, day) => new Set(Object.entries(dayLog(data, day)).filter(([, t]) => t > 0).map(([id]) => id));
  function setRoutine(data, day, id, done, now = Date.now()) {
    data.log[day] = { ...dayLog(data, day), [id]: done ? +now : -now };
  }

  // Time tracked by timers: time[day][routineId] = ms. Routine with `goal` (min/day) is auto-marked when reached.
  // Routine applies on a day (r.days = weekday numbers, 0 = Sunday). Off = excused that day: 'vacation' | 'sick'.
  // Week (Mon–Sun) containing `day`, as day keys up to and including it.
  function weekDays(day) {
    const d0 = new Date(day + 'T12:00:00'), out = [];
    for (let x = new Date(d0); out.unshift(localDay(x)), (x.getDay() + 6) % 7 > 0; x.setDate(x.getDate() - 1));
    return out;
  }
  // N-times-a-week routines: how many times done this week (up to and including `day`).
  const weekCount = (data, r, day) => weekDays(day).filter(k => doneSet(data, k).has(r.id)).length;
  // "Never miss twice" streak: scheduled days counted back from today (today counts only if done),
  // a single miss is forgiven, two scheduled misses in a row end the streak.
  function streak(data, r, today = localDay()) {
    if (r.perWeek) return 0;
    let n = 0, miss = 0, x = new Date(today + 'T12:00:00');
    for (let i = 0; i < 400; i++, x.setDate(x.getDate() - 1)) {
      const k = localDay(x);
      if (!appliesOn(r, k) || offOn(data, k, r.id)) continue;
      const done = doneSet(data, k).has(r.id) || coveredAhead(data, r, k);
      if (done) { n++; miss = 0; } else if (k !== today) { if (++miss >= 2) break; }
    }
    return n;
  }
  const appliesOn = (r, day) => !r.days || r.days.includes(new Date(day + 'T12:00:00').getDay());
  // Done ahead: doing a scheduled routine on a non-scheduled day covers its next missed scheduled day
  // in the same week (Mon–Sun). Walk the week chronologically, carrying credits.
  function coveredAhead(data, r, day) {
    if (!r.days) return false;
    const d0 = new Date(day + 'T12:00:00'), mon = new Date(d0); mon.setDate(d0.getDate() - (d0.getDay() + 6) % 7);
    let credit = 0;
    for (let x = new Date(mon); ; x.setDate(x.getDate() + 1)) {
      const k = localDay(x), sched = appliesOn(r, k), done = doneSet(data, k).has(r.id);
      if (k === day) return sched && !done && credit > 0;
      if (!sched && done) credit++;
      else if (sched && !done && credit > 0) credit--;
    }
  }
  const offOn = (data, day, id) => data.off?.[day]?.[id]?.s || '';
  function setOff(data, day, id, status) {
    const d = ((data.off = data.off || {})[day] = data.off[day] || {});
    d[id] = { s: status, u: Date.now() };
  }

  function addTime(data, day, id, ms) {
    const d = ((data.time = data.time || {})[day] = data.time[day] || {});
    d[id] = (d[id] || 0) + ms;
    const r = data.routines.find(x => x.id === id);
    if (r?.goal && d[id] >= r.goal * 6e4 && !doneSet(data, day).has(id)) setRoutine(data, day, id, true);
  }
  const timeOn = (data, day, id) => data.time?.[day]?.[id] || 0;

  function markDone(data, c, now = new Date()) {
    if (c.kind === 'task') {
      const t = data.tasks.find(x => x.id === c.id);
      if (t) { t.done = true; t.doneAt = now.toISOString(); t.u = +now; }
    } else {
      const k = localDay(now);
      setRoutine(data, k, c.id, true, now);
    }
  }

  // Bought items disappear a week after being checked off.
  function pruneShopping(data, now = new Date()) {
    for (const i of data.shopping) if (i.done && now - Date.parse(i.doneAt) >= 7 * 864e5) remove(data, 'shopping', i.id, now);
  }

  // ---- Sync merge: items carry `u` (ms of last change); deletions are tombstones in `deleted`. ----
  const COLLECTIONS = ['shopping', 'tasks', 'routines', 'inbox', 'memos', 'checkins']; // inbox: notes from the coach; memos: facts to remember
  const touch = (item, now = Date.now()) => { item.u = +now; return item; };
  function remove(data, coll, id, now = Date.now()) {
    data[coll] = data[coll].filter(x => x.id !== id);
    (data.deleted = data.deleted || {})[id] = +now;
  }
  function merge(local, remote, now = Date.now()) {
    const out = { ...local, deleted: { ...(remote.deleted || {}) } };
    for (const [id, t] of Object.entries(local.deleted || {})) out.deleted[id] = Math.max(t, out.deleted[id] || 0);
    for (const [id, t] of Object.entries(out.deleted)) if (now - t > 60 * 864e5) delete out.deleted[id];
    for (const c of COLLECTIONS) {
      const m = new Map();
      for (const it of [...(remote[c] || []), ...(local[c] || [])]) {
        const prev = m.get(it.id);
        if (!prev || (it.u || 0) >= (prev.u || 0)) m.set(it.id, it);
      }
      out[c] = [...m.values()].filter(it => !(out.deleted[it.id] >= (it.u || 0)));
    }
    out.log = {};
    for (const src of [remote, local]) for (const d of Object.keys(src.log || {})) {
      const day = (out.log[d] = out.log[d] || {});
      for (const [id, t] of Object.entries(dayLog(src, d))) if (Math.abs(t) >= Math.abs(day[id] || 0)) day[id] = t;
    }
    out.time = { ...(remote.time || {}) };
    for (const [d, m] of Object.entries(local.time || {})) {
      const day = (out.time[d] = { ...(out.time[d] || {}) });
      for (const [id, ms] of Object.entries(m)) day[id] = Math.max(ms, day[id] || 0);
    }
    out.off = JSON.parse(JSON.stringify(remote.off || {}));
    for (const [d, m] of Object.entries(local.off || {})) {
      const day = (out.off[d] = out.off[d] || {});
      for (const [id, v] of Object.entries(m)) if (!day[id] || v.u >= day[id].u) day[id] = v;
    }
    return out;
  }

  const id = () => Math.random().toString(36).slice(2, 10);
  return { weekCount, streak, coveredAhead, appliesOn, offOn, setOff, addTime, timeOn, doneSet, setRoutine, empty, candidates, pickNext, markDone, pruneShopping, localDay, id, touch, remove, merge, COLLECTIONS };
})();
if (typeof module !== 'undefined') module.exports = Logic;
