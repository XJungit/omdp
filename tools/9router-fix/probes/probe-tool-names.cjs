/**
 * probe-tool-names.cjs
 * ------------------------------------------------------------------
 * The FreeTierError gate is narrower than "non-empty tools array": the
 * upstream inspects WHICH tool names are declared (OmniRoute #14013 notes a
 * second measurement on 2026-09-18, and the placeholder they ship is
 * `_noop`, the same name the official OpenCode client injects on its
 * github-copilot path).
 *
 * So: sweep tool-name candidates against the gate, all other reported
 * conditions (stream:true, canonical ses_, UA opencode/1.18.31) held fixed.
 *
 *   node probe-tool-names.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

const mkTool = (name) => ({
  type: 'function',
  function: { name, description: 'noop', parameters: { type: 'object', properties: {}, required: [] } },
});

function headers() {
  return {
    Authorization: 'Bearer public',
    'content-type': 'application/json',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': ses(),
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
  };
}

async function call(tools, label, model = 'mimo-v2.5-free') {
  const body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: true };
  if (tools) body.tools = tools;
  let r;
  try {
    r = await fetch('https://opencode.ai/zen/v1/chat/completions', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  } catch (e) { console.log(`  NET  ${label}: ${e.message}`); return null; }
  const t = await r.text();
  let type = '';
  try { const j = JSON.parse(t); type = j?.error ? (j.error.type || (j.error.message || '').slice(0, 60)) : 'OK'; }
  catch { type = t.replace(/\s+/g, ' ').slice(0, 60); }
  const v = r.status === 200 ? 'OK  ' : (type === 'FreeTierError' ? 'GATE' : 'ERR ');
  console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(40)} ${type}`);
  return r.status;
}

(async () => {
  console.log('\n### tool-name candidates (stream=true, canonical session/UA)');
  const candidates = [
    ['no tools at all', null],
    ['[] (empty array)', []],
    ['_noop', [mkTool('_noop')]],
    ['ping (made-up)', [mkTool('ping')]],
    ['bash', [mkTool('bash')]],
    ['read', [mkTool('read')]],
    ['edit', [mkTool('edit')]],
    ['webfetch', [mkTool('webfetch')]],
    ['todowrite', [mkTool('todowrite')]],
    ['task', [mkTool('task')]],
    ['_noop + bash', [mkTool('_noop'), mkTool('bash')]],
  ];
  for (const [label, tools] of candidates) {
    await call(tools, label);
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log('');
})();
