/**
 * dump-9router-connections.cjs — show configured provider connections (secrets
 * redacted to last 4 chars) so we can tell whether the OpenCode Zen lane uses
 * the anonymous `public` key or a real one. Read-only.
 *
 *   node dump-9router-connections.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const dataDir = process.env.DATA_DIR
  || (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '9router')
    : path.join(os.homedir(), '.9router'));

const db = path.join(dataDir, 'db', 'data.sqlite');
const nm = path.join(dataDir, 'runtime', 'node_modules', 'better-sqlite3');
if (!fs.existsSync(db) || !fs.existsSync(path.join(nm, 'package.json'))) {
  console.log('9router db or better-sqlite3 not found');
  process.exit(1);
}

const Database = require(nm);
const d = new Database(db, { readonly: true, fileMustExist: true });

const redact = (v) => {
  if (typeof v !== 'string' || !v) return v;
  if (v.length <= 8) return '***';
  return `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})`;
};

function walk(obj, depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 3).map((x) => walk(x, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /key|token|secret|password|cookie|auth/i.test(k)) out[k] = redact(v);
    else out[k] = walk(v, depth + 1);
  }
  return out;
}

console.log('=== providerConnections ===');
for (const row of d.prepare('select * from providerConnections').all()) {
  const { id, provider, name, isActive, ...rest } = row;
  console.log(`  ${provider} | ${name || '-'} | active=${isActive} | ${id}`);
  const r = walk(rest);
  if (r.data) {
    let parsed = r.data;
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { /* keep */ } }
    console.log('     data: ' + JSON.stringify(walk(parsed)).slice(0, 900));
  } else {
    console.log('     ' + JSON.stringify(r).slice(0, 500));
  }
}

d.close();
