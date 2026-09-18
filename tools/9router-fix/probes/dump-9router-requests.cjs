/**
 * dump-9router-requests.cjs — inspect 9router's own request log
 * (data.sqlite) to see what it actually sent upstream, and the raw upstream
 * error. Read-only.
 *
 *   node dump-9router-requests.cjs [limit]
 */
'use strict';

const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR
  || (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), '9router')
    : path.join(require('os').homedir(), '.9router'));

const db = path.join(dataDir, 'db', 'data.sqlite');
const nm = path.join(dataDir, 'runtime', 'node_modules', 'better-sqlite3');
const limit = Number(process.argv[2] || 12);

if (!fs.existsSync(db)) { console.log('no db at ' + db); process.exit(1); }
if (!fs.existsSync(path.join(nm, 'package.json'))) { console.log('no better-sqlite3 at ' + nm); process.exit(1); }

const Database = require(nm);
const d = new Database(db, { readonly: true, fileMustExist: true });

const tables = d.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name);
console.log('tables: ' + tables.join(', ') + '\n');

const interesting = tables.filter((t) => /request|detail|log|error/i.test(t));
for (const t of interesting) {
  const cols = d.prepare(`pragma table_info("${t}")`).all().map((c) => c.name);
  console.log(`--- ${t} (${cols.join(', ')})`);
  const rows = d.prepare(`select * from "${t}" order by rowid desc limit ${limit}`).all();
  for (const row of rows) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) continue;
      let s = typeof v === 'string' ? v : JSON.stringify(v);
      if (s && s.length > 700) s = s.slice(0, 700) + '…';
      out[k] = s;
    }
    console.log('  ' + JSON.stringify(out));
  }
  console.log('');
}
d.close();
