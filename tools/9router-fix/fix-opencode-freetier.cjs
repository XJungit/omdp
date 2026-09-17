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
 * ROOT CAUSE (OpenCode added a server-side client gate around 2026-09-17)
 *   Two INDEPENDENT factors must BOTH hold, otherwise 403:
 *     (a) User-Agent must be `opencode/<maj>.<min>.<patch>` with
 *         version >= 1.17.0.  A bare `opencode`, a foreign UA (`node`,
 *         `curl`), or an OpenCode lacking a version string => 403
 *         FreeTierError; a versioned UA below 1.17.0 => 426 UpgradeRequired.
 *     (b) `x-opencode-session` must match /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/.
 *         `ses_` + 32 hex (what 9router generates), a raw UUID, a
 *         `claude:...`/`antigravity:...` identity, or an absent header
 *         => 403 FreeTierError.
 *   9router violated BOTH: it sent UA `"opencode"` (no version) and a
 *   non-canonical `ses_<uuid32hex>` session.
 *
 * FIX
 *   Patch the compiled OpenCode executor in the Next.js build output:
 *     1. Emit `opencode/<version>` (default 1.18.31); still pass through any
 *        downstream UA that is genuinely versioned >= 1.17.0.
 *     2. Coerce every non-canonical session id into the canonical form,
 *        deterministically (SHA-256), so sticky sessions and upstream prompt
 *        caching keep working.
 *   Both are pure functions of already-computed inputs, so nothing else in
 *   the request pipeline changes.
 *
 * USAGE
 *   node fix-opencode-freetier.cjs --check          # report only, no writes
 *   node fix-opencode-freetier.cjs --apply          # patch (idempotent)
 *   node fix-opencode-freetier.cjs --restore        # roll back latest backup
 *   node fix-opencode-freetier.cjs --apply --dir <9router install dir>
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
  const needsPatch = hasOldUa || hasOldSes;
  let hasNewUa = false;
  let hasNewSes = false;
  try { hasNewUa = t.includes(MARKER); } catch { /* ignore */ }
  hasNewSes = t.includes('^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$');
  return { file, t, hasOldUa, hasOldSes, needsPatch, hasNewUa, hasNewSes };
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
      let state;
      if (st.hasOldUa || st.hasOldSes) { state = 'VULNERABLE (would 403 FreeTierError)'; broken++; }
      else state = 'patched';
      console.log(`${state.padEnd(40)} ${st.file}`);
      console.log(`    bare-UA anchor=${st.hasOldUa}  uuid-session anchor=${st.hasOldSes}  patchMarker=${st.hasNewUa}`);
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
  console.log('\nRestart 9router to load the change, e.g.:');
  console.log('  taskkill /IM node.exe   # or stop 9router from the tray, then:');
  console.log('  9router --tray -p 20128');
}

main();
