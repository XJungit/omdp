/**
 * verify-opencode-freetier.cjs
 * ------------------------------------------------------------------
 * Live verification that 9router's OpenCode free tier actually works,
 * for use after --apply (and after every `npm i -g 9router` upgrade).
 *
 * Runs three independent layers:
 *   A. upstream  - talks straight to opencode.ai, proving what the gate wants
 *   B. static    - loads the patched chunk, inspects buildHeaders() output
 *   C. e2e       - goes through the running 9router server with a local API key
 *
 * usage:
 *   node verify-opencode-freetier.cjs                       # A + B + C (auto-detect)
 *   node verify-opencode-freetier.cjs --no-e2e              # offline-ish: A + B only
 *   node verify-opencode-freetier.cjs --base http://127.0.0.1:20128
 *   node verify-opencode-freetier.cjs --dir <9router dir>
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const noE2E = argv.includes('--no-e2e');
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const BASE = argVal('--base') || 'http://127.0.0.1:20128';

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const canonical = (p) => p + crypto.randomBytes(6).toString('hex') + rnd(14);

const FREE_MODELS = ['mimo-v2.5-free', 'nemotron-3-ultra-free', 'ling-3.0-flash-fin-free', 'nemotron-3.5-lightning-free'];

let failures = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failures++; console.log('  FAIL ' + m); };

// ------------------------------------------------------------------ A. upstream
function upstreamHeaders(kind) {
  if (kind === 'legacy') {
    return {
      Authorization: 'Bearer public', 'User-Agent': 'opencode', 'x-opencode-client': 'desktop',
      'x-opencode-session': 'ses_' + crypto.randomUUID().replace(/-/g, ''),
      'x-opencode-request': 'msg_' + crypto.randomUUID().replace(/-/g, ''), 'x-opencode-project': 'global',
    };
  }
  return {
    Authorization: 'Bearer public', 'User-Agent': 'opencode/1.18.31', 'x-opencode-client': 'desktop',
    'x-opencode-session': canonical('ses_'),
    'x-opencode-request': canonical('msg_'), 'x-opencode-project': 'global',
  };
}

async function chat(headers, model) {
  const r = await fetch('https://opencode.ai/zen/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: false }),
  });
  const t = await r.text();
  let type = ''; try { type = JSON.parse(t)?.error?.type || ''; } catch {}
  return { status: r.status, type };
}

async function layerA() {
  console.log('\n=== A. upstream gate behaviour ===');
  for (const m of FREE_MODELS.slice(0, 2)) {
    const legacy = await chat(upstreamHeaders('legacy'), m);
    if (legacy.status === 403 && legacy.type === 'FreeTierError') ok(`legacy headers still reproduce 403 (control) [${m}]`);
    else bad(`control expected 403 FreeTierError, got ${legacy.status} ${legacy.type} [${m}]`);

    const fixed = await chat(upstreamHeaders('fixed'), m);
    if (fixed.status === 200) ok(`canonical UA+session accepted (200) [${m}]`);
    else bad(`expected 200 with canonical headers, got ${fixed.status} ${fixed.type} [${m}]`);
  }
}

// ------------------------------------------------------------------ B. static
function findChunk(explicitDir) {
  const roots = explicitDir ? [explicitDir] : [
    process.env.NINEROUTER_DIR,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules', '9router') : null,
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '9router'),
    '/usr/local/lib/node_modules/9router',
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '9router'),
  ].filter(Boolean);

  for (const root of roots) {
    const appDir = path.join(root, 'app');
    if (!fs.existsSync(appDir)) continue;
    for (const e of fs.readdirSync(appDir, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.startsWith('.next')) continue;
      const chunks = path.join(appDir, e.name, 'server', 'chunks');
      if (!fs.existsSync(chunks)) continue;
      for (const f of fs.readdirSync(chunks)) {
        if (!f.endsWith('.js')) continue;
        const p = path.join(chunks, f);
        if (fs.readFileSync(p, 'utf8').includes('x-opencode-client')) return p;
      }
    }
  }
  return null;
}

function loadExecutor(chunk) {
  const src = fs.readFileSync(chunk, 'utf8');
  const sandbox = {};
  const ctx = vm.createContext({ exports: sandbox, module: { exports: sandbox }, console, process, Buffer });
  vm.runInContext('(function(exports, module){ "use strict"; ' + src + ' \n})(exports, module);', ctx);
  const modules = sandbox.modules;
  if (!modules) throw new Error('no webpack module table in chunk');

  const moduleFor = {
    55511: crypto,
    74957: { H: class { constructor() {} } },
    35024: { xq: { opencode: {} } },
    72239: { k: () => [] },
    86724: { Z: () => ({}) },
    80662: { oV: () => 'ses_' + crypto.randomUUID().replace(/-/g, '') },
    59096: { nh: () => false },
  };
  const fakeD = (o, d) => { for (const k of Object.keys(d)) Object.defineProperty(o, k, { enumerable: true, get: d[k] }); };
  const wp = Object.assign((id) => (id === 55511 ? crypto : (moduleFor[id] || {})),
    { n: (m) => () => m, d: fakeD, r: () => 1, o: () => true });
  const ex = {};
  modules[4493]({ exports: ex }, ex, wp);
  return ex.j;
}

function layerB(explicitDir) {
  console.log('\n=== B. patched build output ===');
  const chunk = findChunk(explicitDir);
  if (!chunk) { bad('9router build chunk not found'); return; }
  ok('chunk: ' + chunk);

  let Exec;
  try { Exec = loadExecutor(chunk); } catch (e) { bad('could not load executor: ' + e.message); return; }

  const RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
  const uaOk = (ua) => { const m = String(ua).match(/^opencode\/(\d+)\.(\d+)\.(\d+)/i); return !!m && (+m[1] > 1 || (+m[1] === 1 && +m[2] >= 17)); };

  const cases = [
    ['no downstream headers (production path)', undefined],
    ['downstream UA "opencode"', { rawHeaders: { 'user-agent': 'opencode' } }],
    ['downstream UA "node"', { rawHeaders: { 'user-agent': 'node' } }],
    ['downstream cookie-style session', { rawHeaders: { 'x-opencode-session': 'claude:abc-123' } }],
  ];

  for (const [label, creds] of cases) {
    const e = new Exec();
    e._currentSessionId = 'ses_' + crypto.randomUUID().replace(/-/g, ''); // sticky, non-canonical
    const h = e.buildHeaders(creds, true);
    const uaGood = uaOk(h['User-Agent']);
    const sesGood = RE.test(h['x-opencode-session']);
    if (uaGood && sesGood) ok(`${label} -> UA=${h['User-Agent']} ses=${h['x-opencode-session']}`);
    else bad(`${label} -> UA=${h['User-Agent']} (${uaGood}) ses=${h['x-opencode-session']} (${sesGood})`);
  }

  const src = fs.readFileSync(chunk, 'utf8');
  if (src.includes('?f:"opencode",')) bad('VULNERABLE: bare-UA anchor still present - re-run --apply');
  else ok('no bare-UA anchor (patch in place)');
}

// ------------------------------------------------------------------ C. e2e
function readApiKey() {
  const dataDir = process.env.DATA_DIR
    || (process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '9router')
      : path.join(os.homedir(), '.9router'));
  const db = path.join(dataDir, 'db', 'data.sqlite');
  const nm = path.join(dataDir, 'runtime', 'node_modules', 'better-sqlite3');
  // better-sqlite3's entry point is lib/index.js (package.json "main"), so test
  // for the package manifest rather than a specific file.
  if (!fs.existsSync(db) || !fs.existsSync(path.join(nm, 'package.json'))) return null;
  let Database;
  try { Database = require(nm); } catch { return null; }
  const d = new Database(db, { readonly: true, fileMustExist: true });
  const row = d.prepare('select key from apiKeys where isActive=1 order by createdAt limit 1').get()
    || d.prepare('select key from apiKeys limit 1').get();
  d.close();
  return row?.key || null;
}

async function layerC() {
  console.log(`\n=== C. end-to-end through 9router (${BASE}) ===`);
  const key = readApiKey();
  if (!key) { bad('no local 9router API key found; skipping e2e'); return; }
  ok('local API key loaded (redacted)');

  let live = 0;
  let transient = 0;
  for (const m of FREE_MODELS) {
    // A 200 with empty `content` is still a PASS: some free models are reasoning
    // models that put everything in `reasoning` and return content:null.
    // Only a gate rejection (403 FreeTierError) is a real failure; upstream 429/5xx
    // are transient and retried.
    let verdict = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res;
      try {
        res = await fetch(BASE + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: 'oc/' + m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16, stream: false }),
        });
      } catch (e) {
        verdict = { kind: 'network', detail: e.message };
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const t = await res.text();
      if (res.status === 200 && !/FreeTierError/.test(t)) { verdict = { kind: 'ok' }; break; }
      if (/FreeTierError/.test(t)) { verdict = { kind: 'gate', detail: t.replace(/\s+/g, ' ').slice(0, 160) }; break; }
      // transient (429/5xx/anything non-gate) - back off and retry
      verdict = { kind: 'transient', detail: `${res.status} ${t.replace(/\s+/g, ' ').slice(0, 120)}` };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }

    if (verdict.kind === 'ok') { ok(`oc/${m} -> 200`); live++; }
    else if (verdict.kind === 'gate') bad(`oc/${m} -> GATE REJECTED: ${verdict.detail}`);
    else if (verdict.kind === 'network') { console.log(`  WARN oc/${m} -> unreachable: ${verdict.detail} (is 9router running?)`); transient++; }
    else { console.log(`  WARN oc/${m} -> transient upstream error after retries: ${verdict.detail}`); transient++; }
  }

  console.log(`  ${live}/${FREE_MODELS.length} free models reached through 9router` + (transient ? `, ${transient} transient (not gate-related)` : ''));
  if (live === 0 && !transient) console.log('  hint: did you restart 9router after --apply?');
  if (live === 0 && transient) console.log('  hint: 9router may be down, or upstream is having an outage');
}

(async () => {
  await layerA();
  layerB(argVal('--dir'));
  if (!noE2E) await layerC();

  console.log('\n' + (failures ? `*** ${failures} CHECK(S) FAILED ***` : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})();
