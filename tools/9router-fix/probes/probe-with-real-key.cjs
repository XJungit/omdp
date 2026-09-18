/**
 * probe-with-real-key.cjs
 * ------------------------------------------------------------------
 * Decisive experiment: is the anonymous (`Bearer public`) lane dead while a
 * REAL OpenCode Zen key still works?
 *
 * Loads the opencode provider keys already stored in 9router's own DB
 * (read-only), never prints them in full, and sends the same request the
 * canonical client sends:
 *   - 4 reported conditions: stream=true, non-empty tools, canonical
 *     ses_ + 12hex + 14b62, UA opencode/1.18.31
 *
 *   node probe-with-real-key.cjs
 */
'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

const TOOL = {
  type: 'function',
  function: { name: 'ping', description: 'noop', parameters: { type: 'object', properties: {}, required: [] } },
};

const body = JSON.stringify({
  model: 'mimo-v2.5-free',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 8,
  stream: true,
  tools: [TOOL],
});

function headers(auth) {
  return {
    Authorization: auth,
    'content-type': 'application/json',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': ses(),
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
  };
}

async function tryAuth(label, auth) {
  let r;
  try {
    r = await fetch('https://opencode.ai/zen/v1/chat/completions', { method: 'POST', headers: headers(auth), body });
  } catch (e) { console.log(`  ${label.padEnd(30)} NETWORK ${e.message}`); return; }
  const t = await r.text();
  let type = '';
  try {
    const j = JSON.parse(t);
    type = j?.error ? (j.error.type || (j.error.message || '').slice(0, 70)) : 'OK';
  } catch { type = t.replace(/\s+/g, ' ').slice(0, 70); }
  const v = r.status === 200 ? 'OK  ' : (type === 'FreeTierError' ? 'GATE' : 'ERR ');
  console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(30)} ${type}`);
}

function storedZenKeys() {
  const dataDir = process.env.DATA_DIR
    || (process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '9router')
      : path.join(os.homedir(), '.9router'));
  const db = path.join(dataDir, 'db', 'data.sqlite');
  const nm = path.join(dataDir, 'runtime', 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(db) || !fs.existsSync(path.join(nm, 'package.json'))) return [];
  const Database = require(nm);
  const d = new Database(db, { readonly: true, fileMustExist: true });
  const out = [];
  for (const row of d.prepare('select id, name, data from providerConnections').all()) {
    let data;
    try { data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data; } catch { continue; }
    const base = data?.providerSpecificData?.baseUrl || '';
    const key = data?.apiKey;
    if (typeof key === 'string' && key && /opencode\.ai/i.test(base)) {
      out.push({ name: row.name || row.id, key, base, active: data.testStatus });
    }
  }
  d.close();
  return out;
}

(async () => {
  console.log('\n### anonymous lane (control)');
  await tryAuth('Bearer public', 'Bearer public');

  console.log('\n### keys stored in 9router pointing at opencode.ai');
  const keys = storedZenKeys();
  if (!keys.length) { console.log('  (none found)'); }
  for (const k of keys) {
    const shown = `${k.key.slice(0, 6)}…${k.key.slice(-4)} (len=${k.key.length})`;
    console.log(`  -- "${k.name}" status=${k.active} base=${k.base} key=${shown}`);
    await tryAuth('Bearer ' + k.key.slice(0, 6) + '…', 'Bearer ' + k.key);
  }
  console.log('');
})();
