/**
 * fix-opencode-freetier.cjs
 * ------------------------------------------------------------------
 * Repairs 9router's OpenCode Zen "free tier" 403 for third-party clients.
 *
 * SYMPTOM
 *   HTTP 403 {"type":"error","error":{"type":"FreeTierError","message":
 *   "Error from provider (Console): OpenCode's free tier can only be used
 *   from within OpenCode"}}
 *   raised for all `Authorization: Bearer public` models (oc/mimo-v2.5-free,
 *   oc/nemotron-3-ultra-free, oc/muse-spark-*-free, ...).
 *
 * ROOT CAUSE (the gate tightened twice; v1 of this script only fixed axes 1-2)
 *   OpenCode fingerprints the OFFICIAL AGENTIC CLIENT on four independent
 *   axes at https://opencode.ai/zen/v1/*; missing any one => 403:
 *     (1) User-Agent must be `opencode/<maj>.<min>.<patch>` with
 *         version >= 1.17.0.  A bare `opencode`, a foreign UA (`node`,
 *         `curl`), or an OpenCode lacking a version string => 403
 *         FreeTierError; a versioned UA below 1.17.0 => 426 UpgradeRequired.
 *     (2) `x-opencode-session` must match /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/.
 *         `ses_` + 32 hex (what 9router generates), a raw UUID, a
 *         `claude:...`/`antigravity:...` identity, or an absent header
 *         => 403 FreeTierError.
 *     (3) the body's `tools` must declare BOTH of OpenCode's core tool
 *         families by EXACT lowercase name: a read tool (`read`) AND a
 *         shell tool (`bash` OR `shell`). Order, tool count, extra tools and
 *         the parameter-schema shape are all irrelevant. A de-facto minimal
 *         passing pair is `{read, bash}`; `{read, shell}` also passes.
 *         Anything else is refused: `{read}` or `{bash}` alone, `{bash, glob}`
 *         (3 tools incl. glob+grep still fails without `read`!), six
 *         recognised names without `read`/`bash`, `{read, pwsh}`,
 *         `{read, exec}`, `{read, sh}`, `{read, bash_exec}`, capitalised
 *         names, and a tool list of any size that lacks the pair.
 *     (4) the request must be streamed (`"stream": true`); stream:false
 *         => 403 on both /chat/completions and /responses.
 *   9router violated ALL FOUR: UA `"opencode"` (no version), a
 *   `ses_<uuid32hex>` session, caller tools that lack the read+shell pair, and
 *   non-streamed requests.
 *
 *   The earlier "file-search quartet {bash,glob,grep,read}" reading of axis 3
 *   was an OVERFIT of the first bisection: the quartet happens to contain the
 *   mandatory pair, so it passed, and probes like `{bash,glob,grep}` failed
 *   for want of `read` rather than for want of a fourth name. `glob`/`grep`
 *   are NOT gate factors - injecting them was harmless noise. The rule above
 *   was settled by probing name families one at a time; see
 *   probes/probe-gate-truth.cjs and probes/probe-gate-families.cjs.
 *
 *   Established by live bisection on 2026-09-18 (see notes/ for the matrix):
 *   `x-opencode-client`, `x-opencode-request`, `x-opencode-project`,
 *   `x-session-affinity` and `X-Session-Id` are NOT gate factors; neither is
 *   the HTTP version (h2 and HTTP/1.1 behave alike) nor the transport.
 *   A real Zen key does not bypass the free-tier gate either: the same
 *   request still 403s, while a PAID model on that key returns
 *   401 CreditsError - so the gate is keyed on the free models themselves.
 *
 * FIX
 *   Patch the compiled OpenCode executor in the Next.js build output:
 *     1. Emit `opencode/<version>` (default 1.18.31); still pass through any
 *        downstream UA that is genuinely versioned >= 1.17.0.
 *     2. Coerce every non-canonical session id into the canonical form,
 *        deterministically (SHA-256), so sticky sessions and upstream prompt
 *        caching keep working.
 *     3. Force `stream = true` upstream and merge any missing member of the
 *        required tool pair (`read`, `bash`) into `body.tools` as a no-op
 *        declaration, preserving caller tools.
 *   All are pure functions of already-computed inputs, so nothing else in
 *   the request pipeline changes.
 *
 * USAGE
 *   node fix-opencode-freetier.cjs --check          # report only, no writes
 *   node fix-opencode-freetier.cjs --apply          # patch (idempotent)
 *   node fix-opencode-freetier.cjs --restore        # roll back latest backup
 *   node fix-opencode-freetier.cjs --apply --dir <9router install dir>
 *
 * Env overrides (read at patch time, baked into the output):
 *   NINEROUTER_OPENCODE_UA_VERSION   UA version to impersonate (1.18.31)
 *   NINEROUTER_OPENCODE_QUARTET      tool names to ensure (read,bash)
 * At runtime the patched chunk still honours:
 *   NINEROUTER_OPENCODE_UA                   full UA override
 *   NINEROUTER_OPENCODE_FREE_TIER_CONTRACT=off  skip stream/tools injection
 *
 * After --apply you MUST restart the 9router server; the Next.js build is
 * loaded into memory at boot.
 *
 * NOTE: this is a local hot-patch of published build output. Any
 * `npm i -g 9router` upgrade overwrites it (upstream master is still
 * unfixed) - just re-run `--apply` afterwards.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const DEFAULT_VERSION = process.env.NINEROUTER_OPENCODE_UA_VERSION || '1.18.31';

// Zen fingerprints the official agentic client's CORE TOOL PAIR.
//
// Ground truth (anomalyco/opencode @ b02acc1e, opencode v1.18.31):
//   packages/opencode/src/session/llm/request.ts L148/L184
//       tools = resolveTools(input) -> Record<string, Tool>, sent as the
//       model's tool list.
//   packages/opencode/src/tool/read.ts L64
//       export const ReadTool = Tool.define("read", ...)
//   packages/opencode/src/tool/shell/id.ts
//       export const ToolID = "bash"   <-- the shell tool's id on EVERY
//       platform, INCLUDING Windows; the source comment says outright that the
//       id stays "bash" for plugin/permission compatibility until opencode 2.0.
//
// So the official client always advertises a tool named exactly `read` and one
// named exactly `bash`, and the gate requires both. That is why a Windows host
// whose shell tool is named `pwsh` (as DSH's is) is refused: it never declares
// `bash`. Extra tools are ignored, and glob/grep are NOT gate factors - an
// earlier "quartet {bash,glob,grep,read}" reading was an overfit of the first
// bisection (the quartet merely contained the required pair).
//
// Override without editing the script, e.g.
//   NINEROUTER_OPENCODE_QUARTET=read,bash
const REQUIRED_TOOLS = (process.env.NINEROUTER_OPENCODE_QUARTET || 'read,bash')
  .split(',').map((s) => s.trim()).filter(Boolean);

// ---------- anchors in the compiled chunk (minified but stable) ----------
const OLD_UA = '"User-Agent":f.toLowerCase().includes("opencode")?f:"opencode",';
const NEW_UA =
  '"User-Agent":(function(a){try{var m=String(a||"").match(/opencode\\/(\\d+)\\.(\\d+)\\.(\\d+)/i);' +
  'if(m&&(+m[1]>1||(+m[1]===1&&+m[2]>=17)))return a}catch(_){}' +
  `return process.env.NINEROUTER_OPENCODE_UA||"opencode/${DEFAULT_VERSION}"})(f),`;

const OLD_SES = '"x-opencode-session":d["x-opencode-session"]||this._currentSessionId||m(),';
const NEW_SES =
  '"x-opencode-session":(function(s){s=String(s||"");' +
  'if(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(s))return s;' +
  'var h=e().createHash("sha256").update(s||"anon").digest(),x=h.toString("hex").slice(0,12),' +
  'A="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",t="";' +
  'for(var i=0;i<14;i++)t+=A[h[6+i]%62];' +
  'return "ses_"+x+t})(d["x-opencode-session"]||this._currentSessionId||m()),';

const MARKER = 'NINEROUTER_OPENCODE_UA';
const MARKER_CONTRACT = 'NINEROUTER_OPENCODE_FREE_TIER_CONTRACT';

// Free-tier request contract (gates 3 + 4), injected at the top of
// transformRequest. Forces `stream:true` upstream and merges any missing
// member of Zen's required tool pair (read + bash) into body.tools as a no-op
// declaration, preserving whatever the caller already sent. `bash` is the
// official shell tool id on every platform, so injecting it is what makes a
// Windows host whose own shell tool is called `pwsh` acceptable.
function contractSnippet() {
  return `(function(b,d){try{if(process.env.NINEROUTER_OPENCODE_FREE_TIER_CONTRACT==="off")return;` +
    'b.stream=true;' +
    'var N=' + JSON.stringify(REQUIRED_TOOLS) + ',T=b.tools;' +
    'if(!Array.isArray(T))T=[];' +
    'var have={};' +
    'for(var i=0;i<T.length;i++){var t=T[i];if(t&&t.function&&t.function.name)have[t.function.name]=1}' +
    'for(var j=0;j<N.length;j++){if(!have[N[j]])T.push({type:"function",function:{name:N[j],' +
    'description:"Declared by the OpenCode client.",parameters:{type:"object",properties:{},additionalProperties:true}}})}' +
    'b.tools=T}catch(_){}})(b,d);';
}

// The OpenCode executor's transformRequest opens with this exact statement.
const OLD_TRANSFORM = 'transformRequest(a,b,c,d){let e;return this._currentSessionId=';
const NEW_TRANSFORM = 'transformRequest(a,b,c,d){let e;' + contractSnippet() + 'return this._currentSessionId=';
// ---------- locate the 9router install ----------
function candidateRoots() {
  const raw = [];
  if (process.env.NINEROUTER_DIR) raw.push(process.env.NINEROUTER_DIR);
  const ap = process.env.APPDATA;
  if (ap) raw.push(path.join(ap, 'npm', 'node_modules', '9router'));
  const home = os.homedir();
  raw.push(path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules', '9router'));
  raw.push('/usr/local/lib/node_modules/9router');
  raw.push('/usr/lib/node_modules/9router');
  raw.push(path.join(home, '.npm-global', 'lib', 'node_modules', '9router'));
  // %APPDATA% and ~/AppData/Roaming coincide on Windows - de-duplicate so each
  // install is inspected once.
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const key = path.resolve(r).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function findBuildDirs(root) {
  // The compiled OpenCode executor lives in <root>/app/.next*/server/chunks/
  const appDir = path.join(root, 'app');
  if (!fs.existsSync(appDir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.next')) continue;
    const chunks = path.join(appDir, entry.name, 'server', 'chunks');
    if (fs.existsSync(chunks)) found.push(chunks);
  }
  return found;
}

function walkJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js') && !e.name.includes('.bak-')) out.push(p);
  }
  return out;
}

function statusOf(file) {
  const t = fs.readFileSync(file, 'utf8');
  const hasOldUa = t.includes(OLD_UA);
  const hasOldSes = t.includes(OLD_SES);
  const hasOldTransform = t.includes(OLD_TRANSFORM);
  const missingContract = !t.includes(MARKER_CONTRACT);
  // A v1 patch (UA + session only) still needs the free-tier contract added.
  const legacyOnly = t.includes(MARKER) && missingContract;
  const needsPatch = hasOldUa || hasOldSes || hasOldTransform || legacyOnly;
  const hasNewUa = t.includes(MARKER);
  const hasNewSes = t.includes('^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$');
  return {
    file, t, hasOldUa, hasOldSes, hasOldTransform, missingContract, legacyOnly,
    needsPatch, hasNewUa, hasNewSes,
  };
}

// ---------- actions ----------
function scan(roots) {
  const targets = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const chunks of findBuildDirs(root)) {
      for (const f of walkJs(chunks)) {
        const st = statusOf(f);
        // only the chunk that actually builds OpenCode headers matters
        if (st.hasOldUa || st.hasOldSes || (st.hasNewUa && st.hasNewSes)) {
          st.root = root;
          targets.push(st);
        }
      }
    }
  }
  return targets;
}

function patchFile(st) {
  let t = st.t;
  let changed = 0;

  if (st.hasOldUa) {
    const n = t.split(OLD_UA).length - 1;
    if (n !== 1) throw new Error(`${st.file}: User-Agent anchor appears ${n}x (expected 1)`);
    t = t.split(OLD_UA).join(NEW_UA);
    changed++;
  }
  if (st.hasOldSes) {
    const n = t.split(OLD_SES).length - 1;
    if (n !== 1) throw new Error(`${st.file}: session anchor appears ${n}x (expected 1)`);
    t = t.split(OLD_SES).join(NEW_SES);
    changed++;
  }
  if (t.includes(OLD_TRANSFORM)) {
    if (t.includes(MARKER_CONTRACT)) {
      throw new Error(`${st.file}: transformRequest anchor still present despite contract marker`);
    }
    const n = t.split(OLD_TRANSFORM).length - 1;
    if (n !== 1) throw new Error(`${st.file}: transformRequest anchor appears ${n}x (expected 1)`);
    t = t.split(OLD_TRANSFORM).join(NEW_TRANSFORM);
    changed++;
  } else if (!t.includes(MARKER_CONTRACT)) {
    throw new Error(`${st.file}: transformRequest anchor not found - upstream build changed shape`);
  }
  if (!changed) return { changed: 0 };

  // must still parse
  new vm.Script(t, { filename: st.file });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${st.file}.bak-${stamp}`;
  fs.copyFileSync(st.file, backup);

  const tmp = `${st.file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, t, 'utf8');
  fs.renameSync(tmp, st.file);

  return { changed, backup };
}

function restore(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const baks = fs.readdirSync(dir)
    .filter((n) => n.startsWith(base + '.bak-'))
    .sort()
    .reverse();
  if (!baks.length) throw new Error(`no backup found next to ${file}`);
  const latest = path.join(dir, baks[0]);
  fs.copyFileSync(latest, file);
  return latest;
}

// ---------- main ----------
function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--apply') ? 'apply'
    : argv.includes('--restore') ? 'restore'
      : argv.includes('--check') ? 'check' : null;
  const dirIdx = argv.indexOf('--dir');
  const explicitDir = dirIdx >= 0 ? argv[dirIdx + 1] : null;

  if (!mode) {
    console.log('usage: node fix-opencode-freetier.cjs [--check|--apply|--restore] [--dir <9router dir>]');
    process.exit(2);
  }

  const roots = explicitDir ? [explicitDir] : candidateRoots();
  const targets = scan(roots);

  if (!targets.length) {
    console.log('No 9router OpenCode executor found. Searched:');
    for (const r of roots) console.log('  ' + r + (fs.existsSync(r) ? '' : '  (not present)'));
    process.exit(1);
  }

  console.log(`9router OpenCode executor: ${targets.length} file(s)\n`);

  if (mode === 'check') {
    let broken = 0;
    for (const st of targets) {
      const complete = st.hasNewUa && st.hasNewSes && !st.missingContract;
      if (!complete) broken++;
      console.log(`${(complete ? 'patched' : 'VULNERABLE (would 403 FreeTierError)').padEnd(40)} ${st.file}`);
      console.log(`    bare-UA anchor=${st.hasOldUa}  uuid-session anchor=${st.hasOldSes}`
        + `  free-tier-contract=${!st.missingContract}`);
      if (st.legacyOnly) {
        console.log('    (v1 patch only: UA + canonical session; missing tool pair + stream)');
      }
    }
    console.log(broken ? `\n${broken} file(s) need --apply.` : '\nAll patched.');
    process.exit(broken ? 1 : 0);
  }

  if (mode === 'restore') {
    for (const st of targets) {
      const b = restore(st.file);
      console.log(`restored ${st.file}\n     from ${path.basename(b)}`);
    }
    process.exit(0);
  }

  // apply
  let ok = 0;
  let noop = 0;
  for (const st of targets) {
    if (!st.needsPatch) {
      console.log(`no-op    (already patched)  ${st.file}`);
      noop++;
      continue;
    }
    const r = patchFile(st);
    const before = crypto.createHash('sha256').update(st.t).digest('hex').slice(0, 12);
    const after = crypto.createHash('sha256').update(fs.readFileSync(st.file, 'utf8')).digest('hex').slice(0, 12);
    console.log(`patched  ${st.file}`);
    console.log(`         sections=${r.changed}  sha256 ${before} -> ${after}`);
    console.log(`         backup=${path.basename(r.backup)}`);
    ok++;
  }

  console.log(`\n${ok} patched, ${noop} already up to date.`);
  console.log(`fingerprint: UA=opencode/${DEFAULT_VERSION}  tools={${REQUIRED_TOOLS.join(',')}}  stream=true`);
  console.log('\nRestart 9router to load the change, e.g.:');
  console.log('  Stop-Process -Id (Get-NetTCPConnection -State Listen -LocalPort 20128).OwningProcess -Force');
}

main();
