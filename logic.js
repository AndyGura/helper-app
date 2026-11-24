// Pure, rule-based logic (zero AI tokens). Kept DOM-free so it can be tested in Node.
const Logic = (() => {
  const day = d => d.toISOString().slice(0, 10);
  const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  function empty() {
    return { shopping: [], tasks: [], routines: [], inbox: [], memos: [], plans: [], log: {}, deleted: {}, timer: null };
  }

  // Candidates: open one-off tasks + routines whose time window is now and not done today.
  function candidates(data, now = new Date(), all = false) {
    const today = localDay(now), h = now.getHours() + now.getMinutes() / 60, wd = now.getDay();
    const doneToday = doneSet(data, today), plan = all ? null : dayPlan(data, today);
    const late = h >= 22 || h < 4;
    const out = [];
    for (const t of data.tasks) {
      if (t.done || (t.from && t.from > today)) continue; // `from`: hidden from "what next" until then
      let s = 10;
      if (t.due) {
        const d = daysBetween(today, t.due);
        s = d < 0 ? 100 - d * 5 : d === 0 ? 80 : d <= 3 ? 50 - d * 5 : 15;
      }
      if (t.focus) s += 30;
      out.push({ kind: 'task', id: t.id, title: t.title, minutes: t.minutes || 0, score: s, item: t });
    }
    for (const r of data.routines) {
      if (plan && !plan.has(r.id)) continue;
      if (doneToday.has(r.id) || !appliesOn(r, today, data) || offOn(data, today, r.id) || coveredAhead(data, r, today)) continue;
      const wk = r.perWeek ? weekCount(data, r, today) : 0;
      if (r.perWeek && wk >= r.perWeek) continue;
      if (r.every && !dueEvery(data, r, today)) continue;
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
  function pickNext(data, now = new Date(), skipped = [], all = false) {
    let list = candidates(data, now, all).filter(c => !skipped.includes(c.id));
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
  // Every-N-days routines (r.every = N): days since last done before `day` (Infinity if never in 400 days).
  function sinceLast(data, r, day) {
    const x = new Date(day + 'T12:00:00');
    for (let i = 1; i <= 400; i++) { x.setDate(x.getDate() - 1); if (doneSet(data, localDay(x)).has(r.id)) return i; }
    return Infinity;
  }
  // Due every day once N days have passed since last done; a miss doesn't buy a break, it keeps nagging.
  const dueEvery = (data, r, day) => sinceLast(data, r, day) >= r.every;
  // "Never miss twice" streak: scheduled days counted back from today (today counts only if done),
  // a single miss is forgiven, two scheduled misses in a row end the streak.
  function streak(data, r, today = localDay()) {
    if (r.perWeek || r.every) return 0;
    let n = 0, miss = 0, x = new Date(today + 'T12:00:00');
    for (let i = 0; i < 400; i++, x.setDate(x.getDate() - 1)) {
      const k = localDay(x);
      if (!appliesOn(r, k, data) || offOn(data, k, r.id)) continue;
      const done = doneSet(data, k).has(r.id) || coveredAhead(data, r, k);
      if (done) { n++; miss = 0; } else if (k !== today) { if (++miss >= 2) break; }
    }
    return n;
  }
  const appliesOn = (r, day, data) => (!r.days || r.days.includes(new Date(day + 'T12:00:00').getDay())) && (!r.kidsWeek || !data || isKidsWeek(data, day));
  // Alternating weeks when the user is in charge of the kids: prefs.kidsWeekStart = a Monday of such a week.
  function isKidsWeek(data, day) {
    const s = data.prefs?.kidsWeekStart; if (!s) return false;
    const mon = weekDays(day)[0], w = Math.round((Date.parse(mon) - Date.parse(s)) / (7 * 864e5));
    return ((w % 2) + 2) % 2 === 0;
  }
  // Daily cap of planned habits (work / kids transport = `fixed`, outside the cap). Fewer on kids weeks.
  function dailyCap(data, day) {
    const wd = new Date(day + 'T12:00:00').getDay(), c = data.prefs?.caps || {};
    return wd === 0 || wd === 6 ? (c.weekend ?? 5) : isKidsWeek(data, day) ? (c.kids ?? 3) : (c.weekday ?? 4);
  }
  // Habits that could be done on `day` at all.
  function eligible(data, r, day) {
    const done = doneSet(data, day).has(r.id);
    if (done) return true;
    if (!appliesOn(r, day, data) || offOn(data, day, r.id) || coveredAhead(data, r, day)) return false;
    if (r.perWeek && weekCount(data, r, day) >= r.perWeek) return false;
    if (r.every && !dueEvery(data, r, day)) return false;
    return true;
  }
  // Small stable hash so equal-priority habits rotate fairly between days.
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  // Today's plan: fixed items + everything already done + priority 1 (must) + best of the rest up to the cap.
  function dayPlan(data, day) {
    const cap = dailyCap(data, day), ds = doneSet(data, day), wd = new Date(day + 'T12:00:00').getDay();
    const el = data.routines.filter(r => eligible(data, r, day));
    const urgency = r => r.perWeek ? (r.perWeek - weekCount(data, r, day)) / (7 - (wd + 6) % 7) : r.every ? 0.6 : 0.5;
    // Overdue habits climb: late (4+ days) jumps ahead of normal ones within the cap; the single most overdue
    // very-late one (perWeek pace lost, 2x `every`, or 7+ days) breaks through the cap. Never-done habits don't escalate. Fixed-weekday habits don't either.
    const pr = r => { const b = r.prio || 2, s = sinceLast(data, r, day); if (b === 1 || r.days || s === Infinity) return b;
      if (urgency(r) >= 1 || s >= (r.every ? r.every * 2 : 7)) return 1.2;
      return s >= Math.max(4, r.every || 0) ? Math.max(1.5, b - 1) : b; };
    const rest = el.filter(r => !r.fixed).sort((a, b) => (ds.has(b.id) - ds.has(a.id)) || (pr(a) - pr(b)) || (urgency(b) - urgency(a)) || (hash(a.id + day) - hash(b.id + day)));
    const plan = new Set(el.filter(r => r.fixed).map(r => r.id));
    let n = 0, burst = false;
    for (const r of rest) { const p = pr(r), br = p === 1.2 && !burst;
      if (p === 1) { plan.add(r.id); continue; } // must-do: outside the cap
      if (ds.has(r.id) || br || n < cap) { plan.add(r.id); n++; if (br) burst = true; } }
    return plan;
  }
  // Done ahead: doing a scheduled routine on a non-scheduled day covers its next missed scheduled day
  // in the same week (Mon–Sun). Walk the week chronologically, carrying credits.
  function coveredAhead(data, r, day) {
    if (!r.days) return false;
    const d0 = new Date(day + 'T12:00:00'), mon = new Date(d0); mon.setDate(d0.getDate() - (d0.getDay() + 6) % 7);
    let credit = 0;
    for (let x = new Date(mon); ; x.setDate(x.getDate() + 1)) {
      const k = localDay(x), sched = appliesOn(r, k, data), done = doneSet(data, k).has(r.id);
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
  const COLLECTIONS = ['shopping', 'tasks', 'routines', 'inbox', 'memos', 'checkins', 'questions', 'plans', 'trips', 'visits', 'budgets']; // inbox: notes from the coach; memos: facts to remember
  const touch = (item, now = Date.now()) => { item.u = +now; return item; };
  function remove(data, coll, id, now = Date.now()) {
    data[coll] = data[coll].filter(x => x.id !== id);
    (data.deleted = data.deleted || {})[id] = +now;
  }
  function merge(local, remote, now = Date.now()) {
    const out = { ...local, deleted: { ...(remote.deleted || {}) } };
    for (const [id, t] of Object.entries(local.deleted || {})) out.deleted[id] = Math.max(t, out.deleted[id] || 0);
    for (const [id, t] of Object.entries(out.deleted)) if (now - t > 60 * 864e5) delete out.deleted[id];
    // Unknown keys survive (an older app version must not drop data added by agents or a newer version):
    // any array of {id} objects is merged like a collection, other remote-only keys are kept as they are.
    const isColl = v => Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object' && 'id' in x);
    const extra = [...new Set([...Object.keys(remote), ...Object.keys(local)])].filter(k => !COLLECTIONS.includes(k) && (isColl(remote[k]) || isColl(local[k])));
    for (const k of Object.keys(remote)) if (!(k in out) && !extra.includes(k)) out[k] = remote[k];
    for (const c of [...COLLECTIONS, ...extra]) {
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
    const lp = local.prefs, rp = remote.prefs;
    if (lp || rp) out.prefs = (lp?.u || 0) >= (rp?.u || 0) ? lp : rp;
    const lu = local.push, ru = remote.push; // push subscription: newest device wins
    if (lu || ru) out.push = (lu?.u || 0) >= (ru?.u || 0) ? lu : ru;
    return out;
  }

  // Long-term plan (e.g. exam prep): current stage = first whose `to` >= day (stage 1 before the start).
  // Stage items {t, days?, to?} filter by weekday / last day, so the day plan shows only today's home work.
  function planNow(p, day) {
    const st = p.stages || [], i = Math.max(0, st.findIndex(s => s.to >= day)), s = st.findIndex(s => s.to >= day) < 0 ? null : st[i];
    const wd = new Date(day + 'T12:00:00').getDay();
    return { i, stage: s, items: s ? (s.home || []).filter(x => (!x.days || x.days.includes(wd)) && (!x.to || day <= x.to) && (!x.from || day >= x.from)) : [] };
  }
  // Monthly tasks: t.monthly = day of month (1–31, clamped to month length), t.months = interval (default 1, 3 = quarterly).
  // When one is done, the next copy appears, due on that day; suggested from `lead` days before (default 0 = from that day).
  // Until done it stays overdue, so the morning push and the home screen keep reminding daily. Deterministic id → no duplicates across devices.
  // First date with that day-of-month strictly after `after` (YYYY-MM-DD), stepping `step` months (3 = quarterly).
  function monthlyDue(dom, after, step = 1) {
    let [y, m] = after.split('-').map(Number);
    for (;;) { const k = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(dom, new Date(y, m, 0).getDate())).padStart(2, '0')}`;
      if (k > after) return k; m += step; while (m > 12) { m -= 12; y++; } }
  }
  function rollMonthly(data, now = Date.now()) {
    for (const t of [...data.tasks]) {
      if (!t.monthly || !t.done || t.next) continue;
      const base = t.due || (t.doneAt || new Date(now).toISOString()).slice(0, 10), due = monthlyDue(t.monthly, base, t.months || 1);
      const series = t.series || t.id, nid = `${series}_${due.slice(0, 7).replace('-', '')}`;
      const from = localDay(new Date(Date.parse(due + 'T12:00:00') - (t.lead || 0) * 864e5));
      if (!data.tasks.some(x => x.id === nid) && !data.deleted?.[nid])
        data.tasks.push({ ...t, id: nid, series, due, from, done: false, doneAt: undefined, next: undefined, u: +now });
      t.next = nid; t.u = +now;
    }
  }
  const id = () => Math.random().toString(36).slice(2, 10);
  // "Помічено": up to 2 short rule-based observations for the home screen (zero tokens).
  // Overdue / due-soon tasks, a must-do habit missed 3 scheduled days in a row, a good streak worth praising.
  function noticed(data, now = new Date()) {
    const today = localDay(now), out = [];
    const open = (data.tasks || []).filter(t => !t.done && t.due);
    const over = open.filter(t => t.due < today);
    if (over.length) out.push({ id: 'over', text: `Прострочено: «${over[0].title}»${over.length > 1 ? ` і ще ${over.length - 1}` : ''}. Може, закрити або перенести?` });
    const soon = open.filter(t => t.due >= today && daysBetween(today, t.due) <= 2).sort((a, b) => a.due < b.due ? -1 : 1)[0];
    if (soon) { const d = daysBetween(today, soon.due); out.push({ id: 'soon', text: `${d === 0 ? 'Сьогодні' : d === 1 ? 'Завтра' : 'Післязавтра'} дедлайн: «${soon.title}».` }); }
    const missed = r => { let n = 0; const x = new Date(today + 'T12:00:00');
      for (let i = 0; i < 14 && n < 3; i++) { x.setDate(x.getDate() - 1); const k = localDay(x);
        if (!appliesOn(r, k, data) || offOn(data, k, r.id)) continue; if (doneSet(data, k).has(r.id) || coveredAhead(data, r, k)) return 0; n++; }
      return n; };
    const routines = (data.routines || []).filter(r => !r.fixed && !r.perWeek && !r.every);
    const m = routines.find(r => (r.prio || 2) === 1 && missed(r) >= 3) || routines.find(r => missed(r) >= 3 && r.prio !== 3);
    if (m) out.push({ id: 'miss:' + m.id, text: `«${m.title}» не було 3 дні. Хоч 5 хвилин сьогодні?` });
    const best = routines.map(r => [r, streak(data, r, today)]).filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1])[0];
    if (best) out.push({ id: 'streak:' + best[0].id, text: `«${best[0].title}»: ${best[1]} днів поспіль 💪` });
    return out.slice(0, 2);
  }

  return { monthlyDue, rollMonthly, planNow, weekDays, noticed, isKidsWeek, dailyCap, dayPlan, weekCount, sinceLast, dueEvery, streak, coveredAhead, appliesOn, offOn, setOff, addTime, timeOn, doneSet, setRoutine, empty, candidates, pickNext, markDone, pruneShopping, localDay, id, touch, remove, merge, COLLECTIONS };
})();
if (typeof module !== 'undefined') module.exports = Logic;
