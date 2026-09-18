/**
 * dump-oc-requests.cjs — show recent opencode/free-tier requests as recorded by
 * 9router itself, including the upstream error and the body preview, so we can
 * see whether the patched executor really sent the tool quartet + stream.
 *
 *   node dump-oc-requests.cjs [limit]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const dir = process.env.DATA_DIR
  || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '9router');
const db = path.join(dir, 'db', 'data.sqlite');
const nm = path.join(dir, 'runtime', 'node_modules', 'better-sqlite3');
const limit = Number(process.argv[2] || 8);

const Database = require(nm);
const d = new Database(db, { readonly: true, fileMustExist: true });

const rows = d.prepare(
  `select id, timestamp, provider, model, status, data from requestDetails
   where provider like '%opencode%' or model like '%free%'
   order by rowid desc limit ${limit}`
).all();

console.log(`${rows.length} matching row(s)\n`);
for (const r of rows) {
  console.log(`--- ${r.timestamp}  ${r.provider} / ${r.model}  status=${r.status}`);
  let j;
  try { j = JSON.parse(r.data); } catch { console.log('  (unparseable)'); continue; }
  if (j.error) console.log('  error: ' + JSON.stringify(j.error).slice(0, 300));
  if (j.latency) console.log('  latency: ' + JSON.stringify(j.latency));
  const pr = j.request?.providerRequest || j.providerRequest;
  if (pr) {
    if (pr._truncated) {
      const p = pr._preview || '';
      console.log(`  providerRequest preview (${pr._originalSize}b, showing ${p.length}):`);
      console.log('    ' + p.slice(0, 700));
      // Does the preview reveal stream/tools?
      for (const k of ['"stream"', '"tools"', 'bash', 'glob', 'grep', '"read"']) {
        console.log(`      contains ${k}: ${p.includes(k)}`);
      }
    } else {
      const s = JSON.stringify(pr);
      console.log(`  providerRequest (${s.length}b): ${s.slice(0, 500)}`);
    }
  }
  const req = j.request;
  if (req && req._truncated) console.log(`  request preview keys: ${Object.keys(req).join(',')}`);
  console.log('');
}
d.close();
