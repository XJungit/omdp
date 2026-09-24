/**
 * verify-opencode-freetier.cjs
 * ------------------------------------------------------------------
 * Live verification that 9router's OpenCode free tier actually works,
 * for use after --apply (and after every `npm i -g 9router` upgrade).
 *
 * Runs three independent layers:
 *   A. upstream  - talks straight to opencode.ai, proving what the gate wants
 *   B. static    - loads the patched chunk, inspects buildHeaders()/transformRequest()
 *   C. e2e       - goes through the running 9router server with a local API key
 *
 * Both upstream LANES are covered. The executor routes muse-spark-* to
 * /zen/v1/responses and everything else to /zen/v1/chat/completions, and the
 * two want different tool shapes (flat {name} vs nested {function:{name}}),
 * so a regression that only breaks one lane must show up here.
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
// Models the executor routes to /zen/v1/responses instead of /chat/completions
// (see the `o(a)` predicate feeding buildUrl in the OpenCode executor chunk).
const RESPONSES_LANE_MODELS = ['muse-spark-1.3-contributor-free', 'muse-spark-1.2-contributor-free'];

let failures = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failures++; console.log('  FAIL ' + m); };

// ------------------------------------------------------------------ A. upstream
//
// Zen fingerprints the official agentic client on FOUR axes; missing any one
// yields 403 FreeTierError (a stale-but-versioned UA yields 426). Ground truth
// is the official source (anomalyco/opencode @ b02acc1e, v1.18.31):
//   session/llm/request.ts L18/L184/L191-194 - UA `opencode/<version>`, the
//     x-opencode-* headers, and `tools` sent as a name-keyed record;
//   schema/src/identifier.ts - the 26-char "ses_" id shape;
//   tool/read.ts L64 - Tool.define("read", ...);
//   tool/shell/id.ts - `export const ToolID = "bash"` on EVERY platform,
//     Windows included (the official shell tool is never called "pwsh").
// So the client always declares tools named exactly `read` and `bash`.
// Live bisection matrix lives in notes/.
const REQUIRED_TOOLS = ['read', 'bash'];
const mkTool = (name) => ({
  type: 'function',
  function: { name, description: 'noop', parameters: { type: 'object', properties: {}, required: [] } },
});
/** A plausible official tool set: the pair plus the other builtins. */
const officialTools = () =>
  [...REQUIRED_TOOLS, 'glob', 'grep', 'edit', 'write', 'task', 'fetch', 'todo', 'search', 'skill'].map(mkTool);

// `over` lets a probe break exactly one axis at a time.
function upstreamHeaders(kind, over = {}) {
  const legacy = kind === 'legacy';
  return {
    Authorization: 'Bearer public',
    'User-Agent': legacy ? 'opencode' : 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': legacy
      ? 'ses_' + crypto.randomUUID().replace(/-/g, '')
      : canonical('ses_'),
    'x-opencode-request': canonical('msg_'),
    'x-opencode-project': 'global',
    ...over,
  };
}

// body: stream + the tool pair are gate axes, so they are parameters.
async function chat(headers, model, { stream = true, tools = officialTools() } = {}) {
  const body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream };
  if (tools) body.tools = tools;
  const r = await fetch('https://opencode.ai/zen/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let type = '';
  try { const j = JSON.parse(t); type = j?.error?.type || (j?.choices ? '' : j?.error?.message || ''); } catch { /* SSE/plain */ }
  return { status: r.status, type };
}

async function layerA() {
  console.log('\n=== A. upstream gate behaviour (all four axes) ===');
  for (const m of FREE_MODELS.slice(0, 2)) {
    // Control: the pre-2026-09-17 fingerprint must still be refused.
    const legacy = await chat(upstreamHeaders('legacy'), m, { tools: null });
    if (legacy.status === 403 && legacy.type === 'FreeTierError') ok(`legacy fingerprint still refused (403 FreeTierError) [${m}]`);
    else bad(`control expected 403 FreeTierError, got ${legacy.status} ${legacy.type} [${m}]`);

    // Positive: the complete official fingerprint must be accepted.
    const fixed = await chat(upstreamHeaders('fixed'), m);
    if (fixed.status === 200) ok(`official fingerprint accepted (200) [${m}]`);
    else bad(`expected 200 with UA+session+read+bash+stream, got ${fixed.status} ${fixed.type} [${m}]`);

    // Each axis is independently required.
    const axes = [
      ['UA dropped', upstreamHeaders('fixed', { 'User-Agent': 'opencode' }), {}],
      ['UA stale (1.16.0)', upstreamHeaders('fixed', { 'User-Agent': 'opencode/1.16.0' }), {}],
      ['session non-canonical', upstreamHeaders('fixed', { 'x-opencode-session': 'ses_' + crypto.randomUUID().replace(/-/g, '') }), {}],
      ['read missing', upstreamHeaders('fixed'), { tools: officialTools().filter((t) => t.function.name !== 'read') }],
      ['bash missing (pwsh instead)', upstreamHeaders('fixed'), { tools: [...officialTools().filter((t) => t.function.name !== 'bash'), mkTool('pwsh')] }],
      ['tools missing', upstreamHeaders('fixed'), { tools: null }],
      ['not streamed', upstreamHeaders('fixed'), { stream: false }],
    ];
    for (const [label, h, opts] of axes) {
      const r = await chat(h, m, opts);
      if (r.status === 403 || r.status === 426) ok(`${label} => ${r.status} ${r.type || ''}`.trim());
      else bad(`${label} should be refused, got ${r.status} ${r.type} [${m}]`);
      await new Promise((res) => setTimeout(res, 300));
    }
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

  // Two worlds, because 9router v0.5.86+ absorbed this hot-patch:
  //   upstream - no markers; the build fixes the gate itself, so assert THAT
  //              (the fix is spread over several chunks, hence the whole-dir read)
  //   patched  - our markers are present; unit-test our own injection
  if (!fs.readFileSync(chunk, 'utf8').includes('NINEROUTER_OPENCODE_FREE_TIER_CONTRACT')) {
    const dir = path.dirname(chunk);
    const all = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    const checks = [
      ['upstream injects the required tool set', all.includes('["bash","glob","grep","read"]')],
      ['upstream generates canonical session ids', all.includes('^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$')],
      ['upstream falls back to a versioned UA', all.includes('"opencode/1.18.31"')],
      ['upstream forces stream:true', all.includes('stream=!0')],
    ];
    for (const [label, pass] of checks) (pass ? ok : bad)(label);
    console.log('  (no hot-patch markers: this build fixes the gate itself - layer C is the proof)');
    return;
  }

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

  // The free-tier request contract (axes 3 + 4): transformRequest must force
  // streaming and ensure the required tool pair (read + bash), whatever the
  // caller sent. The third case is the DSH-on-Windows shape: a `pwsh` shell
  // tool with no `bash`, which the official client would never emit.
  const dshStyle = ['read', 'glob', 'grep', 'edit', 'write', 'pwsh', 'todo_write', 'web_search'].map(mkTool);
  const bodyCases = [
    ['caller: stream=false, no tools', { stream: false }],
    ['caller: stream=false, 1 tool', { stream: false, tools: [mkTool('bash')] }],
    ['caller: DSH tool set (pwsh, no bash)', { stream: true, tools: dshStyle }],
    ['caller: read only, non-streamed', { stream: false, tools: [mkTool('read')] }],
  ];
  for (const [label, body] of bodyCases) {
    const e = new Exec();
    e._currentSessionId = 'ses_' + crypto.randomUUID().replace(/-/g, '');
    try {
      e.transformRequest('mimo-v2.5-free', body, true, { rawHeaders: {}, connectionId: 'verify' });
    } catch (err) {
      bad(`${label} -> transformRequest threw: ${err.message}`);
      continue;
    }
    const names = Array.isArray(body.tools) ? body.tools.map((t) => t?.function?.name) : [];
    const missing = REQUIRED_TOOLS.filter((q) => !names.includes(q));
    const streamed = body.stream === true;
    if (streamed && !missing.length) ok(`${label} -> stream=true tools=[${names.join(',')}]`);
    else bad(`${label} -> stream=${body.stream} missing={${missing.join(',')}} tools=[${names.join(',')}]`);
  }

  // Duplicate tool NAMES are rejected upstream with 400 (not 403), so the dedup
  // path matters as much as the injection path: a caller that already declares
  // `read` and `bash` must come out unchanged, with no second copy. Both wire
  // shapes must be recognised, or a flat-declaring caller on the responses lane
  // gets a duplicate appended.
  const dedupCases = [
    ['caller already has read+bash (nested chat shape)', 'mimo-v2.5-free', false],
    ['caller already has read+bash (flat responses shape)', 'muse-spark-1.3-contributor-free', true],
  ];
  for (const [label, model, flat] of dedupCases) {
    const e = new Exec();
    e._currentSessionId = 'ses_' + crypto.randomUUID().replace(/-/g, '');
    const mk = flat
      ? (n) => ({ type: 'function', name: n, description: 'caller', parameters: { type: 'object', properties: {} } })
      : (n) => mkTool(n);
    const body = { stream: true, tools: [mk('read'), mk('bash')] };
    try {
      e.transformRequest(model, body, true, { rawHeaders: {}, connectionId: 'verify' });
    } catch (err) {
      bad(`${label} -> transformRequest threw: ${err.message}`);
      continue;
    }
    const names = body.tools.map((t) => t?.function?.name ?? t?.name);
    const seen = new Set();
    const dupes = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    const added = names.length - 2;
    if (!dupes.length && added === 0) ok(`${label} -> unchanged, no duplicates`);
    else bad(`${label} -> added=${added} duplicates=[${dupes.join(',')}] (upstream returns 400 on duplicate names)`);
  }
  const laneCases = [
    ['chat lane (mimo-v2.5-free)', 'mimo-v2.5-free', 'function'],
    ['responses lane (muse-spark-1.3-contributor-free)', 'muse-spark-1.3-contributor-free', 'flat'],
  ];
  for (const [label, model, want] of laneCases) {
    const e = new Exec();
    e._currentSessionId = 'ses_' + crypto.randomUUID().replace(/-/g, '');
    const body = { stream: false };
    try {
      e.transformRequest(model, body, true, { rawHeaders: {}, connectionId: 'verify' });
    } catch (err) {
      bad(`${label} -> transformRequest threw: ${err.message}`);
      continue;
    }
    const injected = (body.tools || []).filter((t) => REQUIRED_TOOLS.includes(t?.function?.name || t?.name));
    const okChat = injected.length && injected.every((t) => !!t.function && !!t.function.name && t.name === undefined);
    const okFlat = injected.length && injected.every((t) => typeof t.name === 'string' && !t.function);
    const good = want === 'flat' ? okFlat : okChat;
    const shape = injected.map((t) => (t.function ? `nested(${t.function.name})` : `flat(${t.name})`)).join(' ');
    if (good) ok(`${label} -> injected ${shape}`);
    else bad(`${label} -> wrong tool shape, expected ${want}: ${shape || '(none injected)'}`);
  }

  const src = fs.readFileSync(chunk, 'utf8');
  if (src.includes('?f:"opencode",')) bad('VULNERABLE: bare-UA anchor still present - re-run --apply');
  else ok('no bare-UA anchor (patch in place)');
  if (!src.includes('NINEROUTER_OPENCODE_FREE_TIER_CONTRACT')) {
    bad('VULNERABLE: free-tier contract missing (stream/tools injection) - re-run --apply');
  } else ok('free-tier contract present (stream + read/bash injection)');
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
  // Both lanes: FREE_MODELS ride /chat/completions, RESPONSES_LANE_MODELS ride
  // /responses (the executor picks per model). A lane-specific shape bug shows
  // up as a 400 `tools[0]` error, which is NOT a gate rejection, so it must be
  // reported as a failure rather than swallowed as transient.
  const targets = [
    ...FREE_MODELS.map((m) => ({ m, lane: 'chat' })),
    ...RESPONSES_LANE_MODELS.map((m) => ({ m, lane: 'responses' })),
  ];
  for (const { m, lane } of targets) {
    // A 200 with empty `content` is still a PASS: some free models are reasoning
    // models that put everything in `reasoning` and return content:null.
    // Only a gate rejection (403 FreeTierError) or a shape rejection (400
    // tools[0]) is a real failure; upstream 429/5xx are transient and retried.
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
      // A malformed tool declaration is a bug in our injection, not upstream noise.
      if (/tools\[\d+\]/.test(t) || /missing required field/.test(t)) {
        verdict = { kind: 'shape', detail: t.replace(/\s+/g, ' ').slice(0, 200) };
        break;
      }
      // transient (429/5xx/anything non-gate) - back off and retry
      verdict = { kind: 'transient', detail: `${res.status} ${t.replace(/\s+/g, ' ').slice(0, 120)}` };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }

    const tag = `${m} [${lane}]`;
    if (verdict.kind === 'ok') { ok(`oc/${tag} -> 200`); live++; }
    else if (verdict.kind === 'gate') bad(`oc/${tag} -> GATE REJECTED: ${verdict.detail}`);
    else if (verdict.kind === 'shape') bad(`oc/${tag} -> TOOL SHAPE REJECTED (injection bug): ${verdict.detail}`);
    else if (verdict.kind === 'network') { console.log(`  WARN oc/${tag} -> unreachable: ${verdict.detail} (is 9router running?)`); transient++; }
    else { console.log(`  WARN oc/${tag} -> transient upstream error after retries: ${verdict.detail}`); transient++; }
  }

  console.log(`  ${live}/${targets.length} free models reached through 9router` + (transient ? `, ${transient} transient (not gate-related)` : ''));
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
