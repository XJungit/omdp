/**
 * probe-opencode-gate4.cjs — combined matrix to find the CURRENT gate
 * conditions. Varies UA (with the other reported conditions satisfied) and
 * probes both /v1/chat/completions and /v1/responses.
 *
 *   node probe-opencode-gate4.cjs ua        # UA sweep WITH stream+tools
 *   node probe-opencode-gate4.cjs endpoints # chat/completions vs responses
 *   node probe-opencode-gate4.cjs drop      # drop one condition at a time
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

const CHAT = 'https://opencode.ai/zen/v1/chat/completions';
const RESP = 'https://opencode.ai/zen/v1/responses';

const TOOL = {
  type: 'function',
  function: { name: 'ping', description: 'noop', parameters: { type: 'object', properties: {}, required: [] } },
};

function hdrs(over = {}) {
  return {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': ses(),
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
    ...over,
  };
}

async function post(url, headers, body) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) { return { status: 0, type: 'NET:' + e.message }; }
  const t = await r.text();
  let type = '';
  try {
    const j = JSON.parse(t);
    if (j?.error) type = j.error.type || (j.error.message || '').slice(0, 60);
    else if (j?.choices || j?.output) type = 'OK';
    else type = '?';
  } catch { type = t.replace(/\s+/g, ' ').slice(0, 60); }
  return { status: r.status, type };
}

const chatBody = (over = {}) => ({
  model: 'mimo-v2.5-free',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 8,
  stream: true,
  tools: [TOOL],
  ...over,
});

const respBody = () => ({
  model: 'muse-spark-1.3-contributor-free',
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'say OK' }] }],
  stream: true,
  tools: [{ type: 'function', name: 'ping', description: 'noop', parameters: { type: 'object', properties: {} } }],
});

const show = (r, label, extra = '') => {
  const v = r.status === 200 ? 'OK  ' : (r.type === 'FreeTierError' ? 'GATE' : 'ERR ');
  console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(34)} ${r.type} ${extra}`);
};

async function uaSweep() {
  console.log('\n### UA sweep, WITH stream=true + tools (chat/completions)');
  const uas = ['opencode/1.18.31', 'opencode/1.18.30', 'opencode/1.19.0', 'opencode/1.20.0',
    'opencode/1.25.0', 'opencode/2.0.0', 'opencode/beta/1.18.31/cli', 'opencode', 'node'];
  for (const ua of uas) {
    show(await post(CHAT, hdrs({ 'User-Agent': ua }), chatBody()), ua);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function endpoints() {
  console.log('\n### endpoint comparison');
  show(await post(CHAT, hdrs(), chatBody()), 'chat/completions (mimo free)');
  await new Promise((r) => setTimeout(r, 400));
  show(await post(RESP, hdrs(), respBody()), '/responses (muse free)');
  await new Promise((r) => setTimeout(r, 400));
  show(await post(CHAT, hdrs(), chatBody({ model: 'ling-3.0-flash-fin-free' })), 'chat/completions (ling free)');
  await new Promise((r) => setTimeout(r, 400));
  show(await post(CHAT, hdrs(), chatBody({ model: 'nemotron-3.5-lightning-free' })), 'chat/completions (nemotron free)');
}

async function drop() {
  console.log('\n### drop one condition at a time from the 4-condition baseline');
  show(await post(CHAT, hdrs(), chatBody()), 'baseline (all 4)');
  await new Promise((r) => setTimeout(r, 400));
  show(await post(CHAT, hdrs(), chatBody({ stream: false })), 'no stream');
  await new Promise((r) => setTimeout(r, 400));
  show(await post(CHAT, hdrs(), chatBody({ tools: undefined })), 'no tools');
  await new Promise((r) => setTimeout(r, 400));
  const h = hdrs(); delete h['x-opencode-session'];
  show(await post(CHAT, h, chatBody()), 'no session header');
  await new Promise((r) => setTimeout(r, 400));
  const h2 = hdrs({ 'User-Agent': 'curl/8.0' });
  show(await post(CHAT, h2, chatBody()), 'foreign UA');
}

(async () => {
  const mode = process.argv[2] || 'ua';
  if (mode === 'ua') await uaSweep();
  else if (mode === 'endpoints') await endpoints();
  else if (mode === 'drop') await drop();
  else { await drop(); await uaSweep(); await endpoints(); }
  console.log('');
})();
