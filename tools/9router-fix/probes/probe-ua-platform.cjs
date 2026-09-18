/**
 * probe-ua-platform.cjs
 * ------------------------------------------------------------------
 * Hypothesis from jasonxu114514/opencode2api's fix: the free-tier gate now
 * wants the FULL OpenCode user-agent the real client sends — version PLUS the
 * platform parenthetical — roughly
 *
 *   opencode/1.18.31 (windows amd64; node24.20.0)
 *
 * plus the correlation headers the official 1.18.x client adds
 * (x-session-affinity, X-Session-Id) alongside x-opencode-session.
 *
 *   node probe-ua-platform.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

const TOOL = { type: 'function', function: { name: 'ping', description: 'noop', parameters: { type: 'object', properties: {}, required: [] } } };

async function call(label, ua, extra = {}) {
  const session = ses();
  const headers = {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': ua,
    'x-opencode-client': 'cli',
    'x-opencode-session': session,
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
    ...extra,
  };
  const body = JSON.stringify({
    model: 'mimo-v2.5-free',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 8, stream: true, tools: [TOOL],
  });
  let r;
  try {
    r = await fetch('https://opencode.ai/zen/v1/chat/completions', { method: 'POST', headers, body });
  } catch (e) { console.log(`  NET  ${label}: ${e.message}`); return; }
  const t = await r.text();
  let type = '';
  try { const j = JSON.parse(t); type = j?.error ? (j.error.type || (j.error.message || '').slice(0, 55)) : 'OK'; }
  catch { type = t.replace(/\s+/g, ' ').slice(0, 55); }
  const v = r.status === 200 ? 'OK  ' : (type === 'FreeTierError' ? 'GATE' : 'ERR ');
  console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(56)} ${type}`);
}

(async () => {
  console.log('\n### A. UA shape (x-opencode-session only)');
  await call('opencode/1.18.31', 'opencode/1.18.31');
  await new Promise((r) => setTimeout(r, 500));
  await call('opencode/1.18.31 (windows amd64; node24.20.0)', 'opencode/1.18.31 (windows amd64; node24.20.0)');
  await new Promise((r) => setTimeout(r, 500));
  await call('opencode/1.18.31 (win32 x64)', 'opencode/1.18.31 (win32 x64)');
  await new Promise((r) => setTimeout(r, 500));
  await call('opencode/latest/1.18.31/cli', 'opencode/latest/1.18.31/cli');

  console.log('\n### B. UA with platform + correlation headers (opencode2api parity)');
  const s = 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);
  await call('UA(platform) + x-session-affinity + X-Session-Id',
    'opencode/1.18.31 (windows amd64; node24.20.0)',
    { 'x-session-affinity': s, 'X-Session-Id': s });
  await new Promise((r) => setTimeout(r, 500));
  await call('UA(plain) + x-session-affinity + X-Session-Id',
    'opencode/1.18.31',
    { 'x-session-affinity': s, 'X-Session-Id': s });
  console.log('');
})();
