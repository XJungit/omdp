/**
 * probe-paid-vs-free.cjs — with a REAL Zen key from 9router's DB, compare a
 * paid model against a free model, with and without the OpenCode identity
 * headers. Decides whether the key works at all and whether only the free
 * tier is fenced off.
 *
 *   node probe-paid-vs-free.cjs
 */
'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

function headers(auth, identity) {
  const h = { Authorization: auth, 'content-type': 'application/json' };
  if (identity) {
    h['User-Agent'] = 'opencode/1.18.31';
    h['x-opencode-client'] = 'cli';
    h['x-opencode-session'] = ses();
    h['x-opencode-request'] = 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14);
    h['x-opencode-project'] = 'global';
  } else {
    h['User-Agent'] = 'node';
  }
  return h;
}

const TOOL = { type: 'function', function: { name: 'ping', description: 'noop', parameters: { type: 'object', properties: {}, required: [] } } };

async function call(label, auth, model, identity, path_) {
  const body = JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: true, tools: [TOOL] });
  let r;
  try {
    r = await fetch(`https://opencode.ai/zen/v1/${path_}`, { method: 'POST', headers: headers(auth, identity), body });
  } catch (e) { console.log(`  NET  ${label}`); return; }
  const t = await r.text();
  let type = '';
  try {
    const j = JSON.parse(t);
    type = j?.error ? (j.error.type || (j.error.message || '').slice(0, 60)) : 'OK';
  } catch { type = t.replace(/\s+/g, ' ').slice(0, 60); }
  const v = r.status === 200 ? 'OK  ' : (type === 'FreeTierError' ? 'GATE' : 'ERR ');
  console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(52)} ${type}`);
}

function keys() {
  const dataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '9router');
  const db = path.join(dataDir, 'db', 'data.sqlite');
  const nm = path.join(dataDir, 'runtime', 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(db) || !fs.existsSync(path.join(nm, 'package.json'))) return [];
  const Database = require(nm);
  const d = new Database(db, { readonly: true, fileMustExist: true });
  const out = [];
  for (const row of d.prepare('select name, data from providerConnections').all()) {
    let data; try { data = JSON.parse(row.data); } catch { continue; }
    if (typeof data?.apiKey === 'string' && /opencode\.ai/i.test(data?.providerSpecificData?.baseUrl || '')) {
      if (!out.includes(data.apiKey)) out.push(data.apiKey);
    }
  }
  d.close();
  return out;
}

(async () => {
  const ks = keys();
  if (!ks.length) { console.log('no zen keys found'); return; }
  const key = ks[0];
  console.log(`\nusing real key ${key.slice(0, 6)}…${key.slice(-4)} (len=${key.length})\n`);

  const auth = 'Bearer ' + key;
  await call('PAID claude-fable-5 + identity', auth, 'claude-fable-5', true, 'chat/completions');
  await call('PAID claude-fable-5, no identity', auth, 'claude-fable-5', false, 'chat/completions');
  await call('FREE mimo-v2.5-free + identity', auth, 'mimo-v2.5-free', true, 'chat/completions');
  await call('FREE mimo-v2.5-free, no identity', auth, 'mimo-v2.5-free', false, 'chat/completions');
  await call('FREE mio-v2.5-free + identity (responses)', auth, 'mimo-v2.5-free', true, 'responses');
  await call('ANON PAID claude-fable-5 + identity', 'Bearer public', 'claude-fable-5', true, 'chat/completions');
  console.log('');
})();
