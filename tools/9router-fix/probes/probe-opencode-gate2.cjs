/**
 * probe2 — dump the FULL response (status, headers, body) for a canonical
 * OpenCode-Zen request, to see what the gate is keyed on now.
 *
 *   node probe-opencode-gate2.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const canonical = (p) => p + crypto.randomBytes(6).toString('hex') + rnd(14);

const PATHS = [
  'https://opencode.ai/zen/v1/chat/completions',
  'https://opencode.ai/zen/v1/models',
];

async function hit(url, headers, body) {
  console.log(`\n=== ${url} ===`);
  let r;
  try {
    r = await fetch(url, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    console.log('  NETWORK ERROR: ' + e.message);
    return;
  }
  console.log(`  status: ${r.status} ${r.statusText}`);
  console.log('  response headers:');
  for (const [k, v] of r.headers) console.log(`    ${k}: ${v}`);
  const t = await r.text();
  console.log(`  body (${t.length}b): ${t.replace(/\s+/g, ' ').slice(0, 600)}`);
}

(async () => {
  // 1. GET /models — is the endpoint even alive, and does the gate apply to it?
  await hit(PATHS[1], {
    Authorization: 'Bearer public',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': canonical('ses_'),
  });

  // 2. canonical POST/chat
  await hit(PATHS[0], {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': canonical('ses_'),
    'x-opencode-request': canonical('msg_'),
    'x-opencode-project': 'global',
  }, { model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: false });
})();
