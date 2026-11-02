// Minimal GitHub Contents API client (token + repo come from the encrypted vault).
const GH = (() => {
  const b64e = s => { const b = new TextEncoder().encode(s); let x = ''; b.forEach(c => x += String.fromCharCode(c)); return btoa(x); };
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const api = (cfg, path, opt = {}) => fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    ...opt, headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', ...(opt.headers || {}) },
  });
  // -> {text, sha} or null if missing
  async function read(cfg, path) {
    const r = await api(cfg, path);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = await r.json();
    return { text: b64d(j.content), sha: j.sha };
  }
  async function write(cfg, path, text, message, sha) {
    if (sha === undefined) sha = (await read(cfg, path))?.sha;
    const r = await api(cfg, path, { method: 'PUT', body: JSON.stringify({ message, content: b64e(text), ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return (await r.json()).content.sha;
  }
  async function append(cfg, path, line, message) {
    const f = await read(cfg, path);
    const text = f ? f.text.replace(/\n*$/, '\n') + line + '\n' : line + '\n';
    return write(cfg, path, text, message, f?.sha || null);
  }
  return { read, write, append };
})();

// Sync app data to <repo>/data/app.json with an item-level merge (see Logic.merge),
// so edits from the phone and from the Claude project never overwrite each other.
// Settings, chat and timer stay on the device.
const Sync = (() => {
  const PATH = 'data/app.json';
  let timer = null;
  const cfg = d => d.settings?.ghToken && d.settings?.ghRepo ? { token: d.settings.ghToken, repo: d.settings.ghRepo } : null;
  const shareable = ({ settings, chat, timer, timers, updatedAt, ...rest }) => rest;
  // Pull, merge into d (in place), push back if the merge changed anything. Returns true if d changed.
  async function sync(d, retry = true) {
    const c = cfg(d); if (!c) return false;
    const f = await GH.read(c, PATH);
    const remote = f ? JSON.parse(f.text) : {};
    const before = JSON.stringify(shareable(d));
    const merged = Logic.merge(shareable(d), remote);
    const after = JSON.stringify(merged);
    Object.assign(d, merged);
    const remoteNorm = JSON.stringify(shareable(Logic.merge(remote, remote)));
    if (after !== remoteNorm) {
      try { await GH.write(c, PATH, JSON.stringify(merged, null, 1), 'app: sync data', f?.sha || null); }
      catch (e) { if (retry) return (await sync(d, false)) || before !== after; throw e; } // sha conflict: re-merge once
    }
    return before !== after;
  }
  const schedule = (d, onChange) => { if (!cfg(d)) return; clearTimeout(timer); timer = setTimeout(() => sync(d).then(ch => ch && onChange?.()).catch(() => {}), 3000); };
  return { sync, schedule, cfg };
})();
