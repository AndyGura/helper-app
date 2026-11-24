// Agent (role) catalog for onboarding. Generic: no country, bank, lab or tax rules here;
// local specifics are the user's own config in their private data repo.
// Text is localizable: add a language key next to `uk` / `en`; settings.lang picks it (default 'uk').
const Agents = (() => {
  const CATALOG = [
    { id: 'r_manager', skill: 'helper-manager', emoji: '🧭', required: true,
      name: { uk: 'Менеджер помічника', en: 'Helper manager' },
      about: { uk: 'Стежить, щоб агенти не мовчали й працювали разом; раз на тиждень пропонує покращення', en: 'Keeps agents moving and working together; proposes weekly improvements' } },
    { id: 'r_coach', skill: 'life-coach', emoji: '💬',
      name: { uk: 'Коуч', en: 'Coach' },
      about: { uk: 'Чек-іни, звички, сон, план на день і питання про цілі', en: 'Check-ins, habits, sleep, daily plan and questions about goals' } },
    { id: 'r_secretary', skill: 'email-secretary', emoji: '📬',
      name: { uk: 'Секретар', en: 'Secretary' },
      about: { uk: 'Розбирає пошту, ловить важливе, готує чернетки (ніколи не надсилає)', en: 'Triages email, flags what matters, drafts replies (never sends)' } },
    { id: 'r_travel', skill: 'travel-agent', emoji: '🧳',
      name: { uk: 'Тур-агент', en: 'Travel agent' },
      about: { uk: 'Планує поїздки: дати, маршрут, житло, бюджет, речі', en: 'Plans trips: dates, route, stay, budget, gear' } },
    { id: 'r_finance', skill: 'finance-analyst', emoji: '💰',
      name: { uk: 'Фінансовий аналітик', en: 'Finance analyst' },
      about: { uk: 'Бюджет, борги, великі покупки; перевіряє витрати інших агентів', en: 'Budget, debts, big purchases; checks other agents’ spending' } },
    { id: 'r_doctor', skill: 'lab-results-review', emoji: '🩺',
      name: { uk: 'Лікар-консультант', en: 'Health consultant' },
      about: { uk: 'Розбирає аналізи, радить наступні кроки, готує до візиту до лікаря', en: 'Reviews lab results, suggests next steps, prepares doctor visits' } },
  ];
  const UI = {
    uk: { title: 'Обери свою команду', intro: 'Кожен агент — окрема роль помічника. Менеджер увімкнений завжди. Змінити можна в налаштуваннях.',
      always: 'завжди', done: 'Готово', change: 'Змінити агентів', start: 'перший крок — короткі питання в аппці', have: 'Вже маю дані → Налаштування' },
    en: { title: 'Pick your team', intro: 'Each agent is a separate helper role. The manager is always on. You can change this in settings.',
      always: 'always on', done: 'Done', change: 'Change agents', start: 'first step: a few short questions in the app', have: 'I already have data → Settings' },
  };
  const tr = (o, lang) => o[lang] || o.uk || o.en;
  const ui = lang => UI[lang] || UI.uk;
  const chosen = data => (data.roles || []).some(r => r.id === 'r_manager');
  // Selected agents become active `roles` items; deselected ones are retired (hidden). The manager can't be deselected.
  // Agents in the data repo read active roles and run the role-creation checklist for any role without a registry row.
  function apply(data, ids, lang = 'uk', now = Date.now()) {
    const on = new Set([...ids, ...CATALOG.filter(a => a.required).map(a => a.id)]);
    data.roles = data.roles || [];
    for (const a of CATALOG) {
      const r = data.roles.find(x => x.id === a.id), status = on.has(a.id) ? 'active' : 'retired';
      if (r) { if (r.status !== status && !(status === 'active' && r.status === 'paused')) Object.assign(r, { status, u: +now }); }
      else if (status === 'active') data.roles.push({ id: a.id, u: +now, skill: a.skill, emoji: a.emoji, name: tr(a.name, lang), about: tr(a.about, lang), status, next: ui(lang).start, date: null });
    }
    return data;
  }
  return { CATALOG, UI, tr, ui, chosen, apply };
})();
if (typeof module !== 'undefined') module.exports = Agents;
