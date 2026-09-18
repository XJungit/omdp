/**
 * test-patched-body.cjs
 * ------------------------------------------------------------------
 * Loads the PATCHED chunk 318 out of the real 9router install, stubs its
 * webpack dependencies, and drives the OpenCode executor to prove what body it
 * produces now (stream flag + tool quartet) and to surface any exception the
 * injected block might be swallowing.
 *
 *   node test-patched-body.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = process.env.NINEROUTER_DIR
  || path.join(process.env.APPDATA, 'npm', 'node_modules', '9router');
const chunksDir = path.join(root, 'app', '.next-cli-build', 'server', 'chunks');

let target = null;
for (const f of fs.readdirSync(chunksDir)) {
  if (!f.endsWith('.js')) continue;
  const p = path.join(chunksDir, f);
  const t = fs.readFileSync(p, 'utf8');
  if (t.includes('x-opencode-session')) { target = p; break; }
}
if (!target) { console.error('executor chunk not found in ' + chunksDir); process.exit(1); }
console.log('chunk: ' + target);

const src = fs.readFileSync(target, 'utf8');

// ---- webpack module stubs (ids seen in the chunk) ----
class BaseExecutor {
  constructor(p, c) { this.provider = p; this.config = c; }
  makeHttp2Request() { return null; }
  makeFetchRequest() { return null; }
}
const stubs = {
  55511: crypto,                                                  // crypto
  74957: { H: BaseExecutor },
  35024: { xq: { opencode: { baseUrl: 'https://opencode.ai' } } },
  72239: { k: () => [] },
  86724: { Z: (req) => req },
  80662: { oV: () => 'ses_' + crypto.randomUUID().replace(/-/g, '') },
  59096: { nh: () => false },
};

const requireFn = (id) => (stubs[id] !== undefined ? stubs[id] : {});
// webpack's __webpack_require__.n(mod) returns a getter: e() === mod (or mod.default)
requireFn.n = (mod) => () => (mod && mod.default !== undefined ? mod.default : mod);
// webpack's __webpack_require__.d — defines getter exports on a module object.
requireFn.d = (exports, definition) => {
  for (const key of Object.keys(definition)) {
    Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
  }
};

const moduleObj = { exports: {} };
const sandbox = { module: moduleObj, exports: moduleObj.exports, require: requireFn, process, console, crypto };
sandbox.globalThis = sandbox;

try {
  vm.runInNewContext(src, sandbox, { filename: target });
} catch (e) {
  console.error('chunk evaluation failed: ' + e.message);
  process.exit(1);
}

const mods = moduleObj.exports.modules;
const factory = mods && mods[4493];
if (!factory) {
  console.error('module 4493 missing; keys=' + Object.keys(mods || {}).slice(0, 8).join(','));
  process.exit(1);
}

const inner = { exports: {} };
factory(inner, inner.exports, requireFn);

const Cls = inner.exports.j || Object.values(inner.exports)[0];
const inst = new Cls();

const headers = inst.buildHeaders({ rawHeaders: {} }, true);
const body = { model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 16, stream: false };
inst.transformRequest('mimo-v2.5-free', body, true, { rawHeaders: {}, connectionId: 'x' });

console.log('\n--- headers ---');
console.log('  User-Agent        : ' + headers['User-Agent']);
console.log('  x-opencode-session: ' + headers['x-opencode-session']);
console.log('\n--- body after transformRequest ---');
console.log('  stream: ' + JSON.stringify(body.stream));
console.log('  tools : ' + (Array.isArray(body.tools) ? body.tools.map((t) => t.function?.name).join(', ') : '(absent)'));
console.log('\n--- raw body ---');
console.log('  ' + JSON.stringify(body).slice(0, 400));

// Audit that the injected block is reachable (i.e. not silently swallowed).
const contractStart = src.indexOf('NINEROUTER_OPENCODE_FREE_TIER_CONTRACT==="off"');
console.log('\ninjected contract offset: ' + contractStart);
