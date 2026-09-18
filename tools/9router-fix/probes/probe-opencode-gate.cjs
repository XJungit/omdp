/**
 * probe-opencode-gate.cjs
 * ------------------------------------------------------------------
 * Ad-hoc gate recon: figure out what opencode.ai/zen free tier wants NOW.
 * Not part of the shipped fix; used while re-deriving the gate rules.
 *
 *   node probe-opencode-gate.cjs ua            # sweep UA versions
 *   node probe-opencode-gate.cjs header <name> # sweep one known header's presence
 *   node probe-opencode-gate.cjs full          # a few combos
 */
'use strict';

const crypto = require('crypto');

const BASE = process.env.ZEN_BASE || 'https://opencode.ai/zen/v1/chat/completions';
const MODEL = process.env.ZEN_MODEL || 'mimo-v2.5-free';
const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const hex12 = () => crypto.randomBytes(6).toString('hex');
const canonical = (p) => p + hex12() + rnd(14);

function baseHeaders(over = {}) {
  return {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'desktop',
    'x-opencode-session': canonical('ses_'),
    'x-opencode-request': canonical('msg_'),
    'x-opencode-project': 'global',
    ...over,
  };
}

async function chat(headers) {
  let r;
  try {
    r = await fetch(BASE, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: false }),
    });
  } catch (e) {
    return { status: 0, type: 'NETWORK', raw: e.message };
  }
  const t = await r.text();
  let type = '';
  try { type = JSON.parse(t)?.error?.type || JSON.parse(t)?.error?.message || ''; } catch { /* plain */ }
  return { status: r.status, type, raw: t.replace(/\s+/g, ' ').slice(0, 180) };
}

async function sweep(label, variants) {
  console.log(`\n### ${label}`);
  for (const [name, headers] of variants) {
    const res = await chat(baseHeaders(headers));
    const verdict = res.status === 200 ? 'OK  ' : (res.type === 'FreeTierError' ? 'GATE' : 'ERR ');
    console.log(`  ${verdict} ${String(res.status).padEnd(3)} ${name.padEnd(46)} ${res.type || ''}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

const uaVariants = [
  ['UA opencode (bare, control)', { 'User-Agent': 'opencode' }],
  ['UA opencode/1.18.31', { 'User-Agent': 'opencode/1.18.31' }],
  ['UA opencode/1.19.0', { 'User-Agent': 'opencode/1.19.0' }],
  ['UA opencode/1.20.0', { 'User-Agent': 'opencode/1.20.0' }],
  ['UA opencode/1.21.0', { 'User-Agent': 'opencode/1.21.0' }],
  ['UA opencode/1.22.0', { 'User-Agent': 'opencode/1.22.0' }],
  ['UA opencode/1.25.0', { 'User-Agent': 'opencode/1.25.0' }],
  ['UA opencode/2.0.0', { 'User-Agent': 'opencode/2.0.0' }],
];

const headerDrops = [
  ['drop x-opencode-client', { 'x-opencode-client': undefined }],
  ['drop x-opencode-request', { 'x-opencode-request': undefined }],
  ['drop x-opencode-project', { 'x-opencode-project': undefined }],
  ['client=cli', { 'x-opencode-client': 'cli' }],
  ['session ses_+32hex', { 'x-opencode-session': 'ses_' + crypto.randomBytes(16).toString('hex') }],
  ['session raw uuid', { 'x-opencode-session': crypto.randomUUID() }],
];

const sessionSweeps = [
  ['ses_ + 12hex + 14b62 (canonical)', { 'x-opencode-session': canonical('ses_') }],
  ['ses_ + 16hex + 14b62', { 'x-opencode-session': 'ses_' + crypto.randomBytes(8).toString('hex') + rnd(14) }],
  ['ses_ + 8hex + 14b62', { 'x-opencode-session': 'ses_' + crypto.randomBytes(4).toString('hex') + rnd(14) }],
  ['ses_ + 12hex + 14hex', { 'x-opencode-session': 'ses_' + hex12() + crypto.randomBytes(7).toString('hex') }],
  ['ses_ + 12hex + 14 digits', { 'x-opencode-session': 'ses_' + hex12() + '12345678901234' }],
];

(async () => {
  const mode = process.argv[2] || 'ua';
  if (mode === 'ua') await sweep('UA version sweep (canonical session/request)', uaVariants);
  else if (mode === 'session') await sweep('session format sweep', sessionSweeps);
  else if (mode === 'headers') await sweep('header presence/drop sweep', headerDrops);
  else {
    await sweep('UA version sweep (canonical session/request)', uaVariants);
    await sweep('session format sweep', sessionSweeps);
    await sweep('header presence/drop sweep', headerDrops);
  }
  console.log('');
})();
