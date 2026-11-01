// Encrypted local vault: AES-GCM key derived from the app PIN (PBKDF2).
// Nothing is stored unencrypted. 5 wrong PINs wipe the vault.
const Vault = (() => {
  const KEY = 'helper.vault', TRIES = 'helper.tries', MAX_TRIES = 5;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  let key = null, salt = null;

  async function derive(pin, s) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: s, iterations: 310000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const exists = () => !!localStorage.getItem(KEY);
  const triesLeft = () => MAX_TRIES - (+localStorage.getItem(TRIES) || 0);
  function wipe() { localStorage.removeItem(KEY); localStorage.removeItem(TRIES); key = null; }

  async function save(data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
    localStorage.setItem(KEY, JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  }
  async function create(pin, data) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(pin, salt);
    await save(data);
    localStorage.removeItem(TRIES);
  }
  // Returns data, or null on wrong PIN (vault wiped after MAX_TRIES).
  async function open(pin) {
    const v = JSON.parse(localStorage.getItem(KEY));
    salt = unb64(v.salt);
    const k = await derive(pin, salt);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, k, unb64(v.ct));
      key = k; localStorage.removeItem(TRIES);
      return JSON.parse(dec.decode(pt));
    } catch {
      const n = (+localStorage.getItem(TRIES) || 0) + 1;
      if (n >= MAX_TRIES) wipe(); else localStorage.setItem(TRIES, n);
      return null;
    }
  }
  const lock = () => { key = null; };
  return { exists, triesLeft, wipe, create, open, save, lock };
})();
