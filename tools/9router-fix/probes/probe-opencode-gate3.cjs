/**
 * probe-opencode-gate3.cjs
 * ------------------------------------------------------------------
 * Verify the 4-condition hypothesis for the OpenCode Zen free-tier gate
 * (reported 2026-09-17 by maxmad64bis on OmniRoute#13935):
 *
 *   1. body has `stream: true`
 *   2. body has a non-empty `tools` array
 *   3. `x-opencode-session` shaped `ses_` + 12 hex + 14 base62
 *   4. `User-Agent` = `opencode/<version >= 1.17>`
 *
 *   node probe-opencode-gate3.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const canonical = (p) => p + crypto.randomBytes(6).toString('hex') + rnd(14);

const DUMMY_TOOL = {
  type: 'function',
  function: {
    name: 'ping',
    description: 'Do not call this tool.',
    parameters: { type: 'object', properties: { x: { type: 'string' } }, required: [] },
  },
};

function headers(over = {}) {
  return {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': canonical('ses_'),
    'x-opencode-request': canonical('msg_'),
    'x-opencode-project': 'global',
    ...over,
  };
}

async function chat(body, hdrs, url = 'https://opencode.ai/zen/v1/chat/completions') {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
  } catch (e) {
    return { status: 0, type: 'NETWORK:' + e.message };
  }
  const t = await r.text();
  let type = '';
  try {
    const j = JSON.parse(t);
    type = j?.error?.type || j?.error?.message?.slice(0, 60) || (j?.choices ? 'OK/choices' : '');
  } catch { type = t.replace(/\s+/g, ' ').slice(0, 60); }
  return { status: r.status, type: type || t.replace(/\s+/g, ' ').slice(0, 50) };
}

const variants = [
  ['stream=false, no tools', { model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: false }],
  ['stream=true,  no tools', { model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: true }],
  ['stream=false, tools', { model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: false, tools: [DUMMY_TOOL] }],
  ['stream=true,  tools', { model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: true, tools: [DUMMY_TOOL] }],
  ['stream=true,  empty tools', { model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: true, tools: [] }],
];

(async () => {
  console.log('### /v1/chat/completions — canonical headers, vary BODY only\n');
  for (const [label, body] of variants) {
    const r = await chat(body, headers());
    const v = r.status === 200 ? 'OK  ' : (r.type === 'FreeTierError' ? 'GATE' : 'ERR ');
    console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(26)} ${r.type}`);
    await new Promise((res) => setTimeout(res, 500));
  }

  console.log('\n### header conditions on a PASSING body (stream=true + tools)\n');
  const passing = { model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: true, tools: [DUMMY_TOOL] };
  const hdrVariants = [
    ['canonical (control)', {}],
    ['UA bare "opencode"', { 'User-Agent': 'opencode' }],
    ['UA opencode/1.16.0', { 'User-Agent': 'opencode/1.16.0' }],
    ['session random 26 alnum', { 'x-opencode-session': 'ses_' + rnd(26) }],
    ['session ses_+32hex', { 'x-opencode-session': 'ses_' + crypto.randomBytes(16).toString('hex') }],
  ];
  for (const [label, over] of hdrVariants) {
    const r = await chat(passing, headers(over));
    const v = r.status === 200 ? 'OK  ' : (r.type === 'FreeTierError' ? 'GATE' : 'ERR ');
    console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(26)} ${r.type}`);
    await new Promise((res) => setTimeout(res, 500));
  }
  console.log('');
})();
