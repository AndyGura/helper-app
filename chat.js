// Chat with Claude straight from the browser (BYO API key, stored in the encrypted vault).
// Context = a few files from the personal repo. Tools let the agent write back.
const Chat = (() => {
  const CONTEXT_FILES = ['habits.md', 'backlog.md', 'profile/README.md', 'shopping.md'];
  let ctx = null;
  const SYSTEM = `You are Andy's personal assistant and caring life coach (a friend, not a lecturer).
Reply in Ukrainian, short and concrete. Help him prioritize, not forget things, and grow.
Use tools to save tasks, shopping items and journal notes when he mentions them; ask for missing details (size, model, deadline) briefly.
Never suggest therapy. Never ask for numeric mood scores.`;

  const TOOLS = [
    { name: 'add_task', description: 'Add a one-off task to the app.', strict: true,
      input_schema: { type: 'object', additionalProperties: false, required: ['title', 'due', 'minutes', 'focus'], properties: {
        title: { type: 'string' }, due: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
        minutes: { type: ['integer', 'null'] }, focus: { type: 'boolean' } } } },
    { name: 'add_shopping', description: 'Add an item to the shopping list, grouped by store/context.', strict: true,
      input_schema: { type: 'object', additionalProperties: false, required: ['store', 'text', 'note'], properties: {
        store: { type: 'string' }, text: { type: 'string' }, note: { type: 'string', description: 'size, model, qty; empty if none' } } } },
    { name: 'journal_note', description: "Append a line to today's journal in Andy's repo (English, concise: wins, sleep, mood inferred, events).", strict: true,
      input_schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } } },
  ];

  async function loadContext(d) {
    if (ctx) return ctx;
    const c = Sync.cfg(d); if (!c) return (ctx = '');
    const parts = await Promise.all(CONTEXT_FILES.map(p => GH.read(c, p).then(f => f ? `## ${p}\n${f.text}` : '').catch(() => '')));
    return (ctx = parts.filter(Boolean).join('\n\n'));
  }

  async function runTool(d, name, input) {
    if (name === 'add_task') d.tasks.push({ id: Logic.id(), title: input.title, due: input.due, minutes: input.minutes || undefined, focus: input.focus, done: false });
    else if (name === 'add_shopping') d.shopping.push({ id: Logic.id(), store: input.store, text: input.text, note: input.note, done: false });
    else if (name === 'journal_note') {
      const c = Sync.cfg(d); if (!c) return 'Repo not connected';
      await GH.append(c, `journal/${Logic.localDay()}.md`, `- ${input.text}`, 'journal: note from app');
    } else return 'Unknown tool';
    return 'ok';
  }

  async function call(d, messages) {
    const s = d.settings, model = s.model || 'claude-opus-5-5';
    const ctxText = await loadContext(d);
    const body = { model, max_tokens: 16000, output_config: { effort: 'low' }, tools: TOOLS, messages,
      system: [{ type: 'text', text: SYSTEM + (ctxText ? '\n\n# Andy\'s notes\n' + ctxText : ''), cache_control: { type: 'ephemeral' } }] };
    const headers = { 'content-type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true' };
    if (!model.startsWith('claude-haiku')) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `API ${r.status}`);
    return j;
  }

  // Sends one user message, runs the tool loop, appends everything to d.chat (append-only history).
  async function send(d, text) {
    d.chat = d.chat || [];
    const now = new Date();
    d.chat.push({ role: 'user', content: `[${Logic.localDay(now)} ${now.toTimeString().slice(0, 5)}] ${text}` });
    for (let i = 0; i < 6; i++) {
      const res = await call(d, d.chat);
      if (res.stop_reason === 'refusal') { d.chat.pop(); throw new Error('Модель відмовилась відповідати'); }
      d.chat.push({ role: 'assistant', content: res.content });
      if (res.stop_reason !== 'tool_use') return;
      const results = [];
      for (const b of res.content.filter(b => b.type === 'tool_use')) {
        let out; try { out = await runTool(d, b.name, b.input); } catch (e) { out = 'Error: ' + e.message; }
        results.push({ type: 'tool_result', tool_use_id: b.id, content: out, ...(out !== 'ok' ? { is_error: true } : {}) });
      }
      d.chat.push({ role: 'user', content: results });
    }
  }

  // Text to show for a stored message (skips thinking/tool blocks).
  function display(m) {
    if (typeof m.content === 'string') return m.content.replace(/^\[[^\]]+\] /, '');
    return m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      + m.content.filter(b => b.type === 'tool_use').map(b => `\n✓ ${({ add_task: 'Справа', add_shopping: 'Покупка', journal_note: 'Журнал' })[b.name] || b.name}: ${b.input.title || b.input.text}`).join('');
  }
  const resetContext = () => { ctx = null; };
  return { send, display, resetContext };
})();
