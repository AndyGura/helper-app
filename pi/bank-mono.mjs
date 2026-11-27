// Nightly bank sync for monobank (personal read-only API). Zero AI tokens. Cannot move money: the API is read-only.
// Writes ONLY aggregates (balances, credit limits, monthly totals by category, top merchants) to the private data repo.
// Raw transactions and account ids are never stored. The monobank token lives only in the env file on this machine.
// Env: MONO_TOKEN, GH_TOKEN (fine-grained, Contents: Read and write on the data repo), GH_REPO (owner/repo),
//      BANK_PATH (default data/bank.json), BANK_MONTHS (months to (re)fetch, default 3 incl. current).
// Run: node bank-mono.mjs test  (accounts only, writes the file: checks both tokens)  |  node bank-mono.mjs  (full sync)
const E = process.env, PATH = E.BANK_PATH || 'data/bank.json', MONTHS = +E.BANK_MONTHS || 3, test = process.argv[2] === 'test';
if (!E.MONO_TOKEN) throw new Error('MONO_TOKEN missing in the env file');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CUR = { 980: 'UAH', 840: 'USD', 978: 'EUR', 985: 'PLN', 826: 'GBP' };
const uah = v => Math.round(v / 100);

async function mono(path) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch('https://api.monobank.ua' + path, { headers: { 'X-Token': E.MONO_TOKEN } });
    if (r.status === 429) { await sleep(61e3); continue; } // 1 request / 60 s
    if (!r.ok) throw new Error(`monobank ${r.status} ${path.split('/')[2]}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('monobank: rate limited');
}
const gh = (method, body) => fetch(`https://api.github.com/repos/${E.GH_REPO}/contents/${PATH}`, {
  method, headers: { Authorization: `Bearer ${E.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, body: body && JSON.stringify(body) });

// MCC → category (coarse; the coach refines with the top merchants list).
const MCC = [
  ['groceries', [5411, 5412, 5422, 5441, 5451, 5462, 5499, 5300]], ['food_out', [5811, 5812, 5813, 5814]],
  ['fuel_car', [5541, 5542, 5983, 7523, 7531, 7538, 7542, 5533, 5532]], ['transport', [4111, 4112, 4121, 4131, 4784, 4789]],
  ['health', [5122, 5912, 8011, 8021, 8031, 8041, 8042, 8043, 8049, 8050, 8062, 8071, 8099]],
  ['kids_edu', [5641, 5945, 8211, 8220, 8241, 8244, 8249, 8299, 8351, 5942, 5943]], ['sport', [5655, 5940, 5941, 7911, 7941, 7997]],
  ['shopping', [5045, 5200, 5211, 5251, 5310, 5311, 5331, 5399, 5651, 5661, 5691, 5699, 5712, 5722, 5732, 5977, 5964, 5969]],
  ['digital', [4899, 5734, 5735, 5815, 5816, 5817, 5818, 7372, 7994]], ['utilities_phone', [4814, 4816, 4900]],
  ['travel', [3000, 4411, 4511, 4722, 7011, 7012, 7032, 7033]], ['cash', [6010, 6011]], ['transfers', [4829, 6012, 6050, 6051, 6211, 6536, 6537, 6538, 6540]],
];
const mccCat = m => (m >= 3000 && m <= 3999) ? 'travel' : (MCC.find(([, l]) => l.includes(m)) || ['other'])[0];
// Description rules first (bank-specific wording): installments, jar top-ups, internal moves, taxes.
const DESC = [['installments', /^щомісячний платіж|^платіж (за|по) (покупці|частин)/i], ['jars', /^поповнення «/i], ['internal', /міграції рахунк|^з (чорної|білої|єврової|доларової) картки|^на (чорну|білу) картку/i], ['taxes', /^гук у /i]];
const cat = t => (DESC.find(([, r]) => r.test(t.description || '')) || [mccCat(t.mcc)])[0];

const info = await mono('/personal/client-info');
const accs = (info.accounts || []).map(a => ({ id: a.id, last4: (a.maskedPan?.[0] || '').slice(-4), type: a.type, cur: CUR[a.currencyCode] || String(a.currencyCode),
  balance: uah(a.balance), limit: uah(a.creditLimit || 0), debt: Math.max(0, uah((a.creditLimit || 0) - a.balance)) }));

const old = await gh('GET'); let sha, prev = {};
if (old.ok) { const j = await old.json(); sha = j.sha; try { prev = JSON.parse(Buffer.from(j.content, 'base64').toString()); } catch {} }
else if (old.status !== 404) throw new Error('GitHub read ' + old.status);
const months = prev.months || {};

if (!test) {
  const now = new Date(), starts = [];
  for (let i = MONTHS - 1; i >= 0; i--) starts.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  let first = true;
  for (const s of starts) {
    const key = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`, from = Math.floor(s / 1e3);
    const to = Math.min(Math.floor(new Date(s.getFullYear(), s.getMonth() + 1, 1) / 1e3) - 1, Math.floor(now / 1e3));
    const m = { in: 0, out: 0, cats: {}, top: {}, topIn: {}, byAcc: {}, fromJars: {} };
    for (const a of accs.filter(a => a.cur === 'UAH')) {
      let end = to; const all = [];
      while (true) { // max 500 items per call: page backwards by time
        if (!first) await sleep(61e3); first = false;
        const tx = await mono(`/personal/statement/${a.id}/${from}/${end}`);
        all.push(...tx); console.log(key, a.type, tx.length, 'tx');
        if (tx.length < 500) break;
        end = Math.min(...tx.map(t => t.time)) - 1;
      }
      all.sort((x, y) => x.time - y.time);
      let follow = null; // jar withdrawal → the payments right after it (≤3 h, up to the withdrawn sum) are attributed to that jar
      for (const t of all) {
        const v = uah(t.amount), c = cat(t), d = ((t.description || '?') + (t.counterName ? ' → ' + t.counterName : '')).replace(/\s+/g, ' ').trim().slice(0, 60);
        if (v >= 0) {
          m.in += v; m.topIn[d] = (m.topIn[d] || 0) + v;
          const j = /«([^»]+)»/.exec(t.description || '');
          follow = j ? { jar: j[1], left: v * 1.05, until: t.time + 3 * 3600 } : follow;
          continue;
        }
        m.out -= v; m.cats[c] = (m.cats[c] || 0) - v; m.byAcc[a.last4 || a.type] = (m.byAcc[a.last4 || a.type] || 0) - v;
        m.top[d] = (m.top[d] || 0) - v;
        if (follow && ['transfers', 'kids_edu', 'other', 'travel'].includes(c) && t.time <= follow.until && follow.left > 0) {
          const f = m.fromJars[follow.jar] = m.fromJars[follow.jar] || { sum: 0, pay: [] };
          f.sum -= v; f.pay.push([new Date(t.time * 1e3).toISOString().slice(0, 10), d, -v]); follow.left += v;
        } else if (follow && t.time > follow.until) follow = null;
      }
    }
    m.top = Object.entries(m.top).sort((x, y) => y[1] - x[1]).slice(0, 25);
    m.topIn = Object.entries(m.topIn).sort((x, y) => y[1] - x[1]).slice(0, 10);
    m.partial = to < Math.floor(new Date(s.getFullYear(), s.getMonth() + 1, 1) / 1e3) - 1;
    months[key] = m;
  }
}

const out = { source: 'monobank', updated: new Date().toISOString(), note: 'UAH, whole hryvnias. out/cats/top = spending; in = all incoming (salary, refunds, own transfers).',
  accounts: accs.map(({ id, ...a }) => a), jars: (info.jars || []).map(j => ({ title: j.title, cur: CUR[j.currencyCode] || String(j.currencyCode), balance: uah(j.balance), goal: j.goal ? uah(j.goal) : null })), months };
const w = await gh('PUT', { message: 'Bank sync (aggregates)', content: Buffer.from(JSON.stringify(out, null, 1)).toString('base64'), sha });
if (!w.ok) throw new Error(`GitHub write ${w.status}: token needs Contents "Read and write" on the data repo`);
console.log(new Date().toISOString(), test ? 'TEST OK:' : 'sync OK:', accs.length, 'accounts', test ? '' : Object.keys(months).length + ' months', '→', PATH);
