/**
 * probe-project-id.cjs — last untested delta vs jasonxu114514/opencode2api:
 * it sends `x-opencode-project: prj_<sha256-12hex>` (identity.StableID) instead
 * of the literal `global`, plus x-session-affinity / X-Session-Id mirrors.
 *
 *   node probe-project-id.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);
const stable = (prefix, value) => prefix + '_' + crypto.createHash('sha256').update(prefix + '\0' + value).digest('hex').slice(0, 24);

const TOOL = { type: 'function', function: { name: 'ping', description: 'noop', parameters: { type: 'object', properties: {}, required: [] } } };

async function call(label, over = {}) {
  const session = ses();
  const headers = {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': session,
    'x-opencode-request': 'req_' + crypto.randomBytes(16).toString('hex'),
    'x-opencode-project': 'global',
    ...over,
  };
  const body = JSON.stringify({ model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: true, tools: [TOOL] });
  let r;
  try { r = await fetch('https://opencode.ai/zen/v1/chat/completions', { method: 'POST', headers, body }); }
  catch (e) { console.log(`  NET  ${label}: ${e.message}`); return; }
  const t = await r.text();
  let type = '';
  try { const j = JSON.parse(t); type = j?.error ? (j.error.type || (j.error.message || '').slice(0, 50)) : 'OK'; }
  catch { type = t.replace(/\s+/g, ' ').slice(0, 50); }
  const v = r.status === 200 ? 'OK  ' : (type === 'FreeTierError' ? 'GATE' : 'ERR ');
  console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(46)} ${type}`);
}

(async () => {
  const s = ses();
  console.log('\n### project / request-id / affinity variants (stream=true + tools)');
  const variants = [
    ['project=global, req=msg_ canonical', { 'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14) }],
    ['project=prj_<sha256>, req=req_<hex>', { 'x-opencode-project': stable('prj', 'opencode2api:default-project'), 'x-opencode-request': 'req_' + crypto.randomBytes(16).toString('hex') }],
    ['project dropped', { 'x-opencode-project': undefined }],
    ['project=prj_<sha256> only', { 'x-opencode-project': stable('prj', 'opencode2api:default-project') }],
    ['+ affinity headers (all)', { 'x-session-affinity': s, 'X-Session-Id': s, 'x-opencode-project': stable('prj', 'opencode2api:default-project') }],
  ];
  for (const [label, over] of variants) {
    await call(label, over);
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log('');
})();
