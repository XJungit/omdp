/**
 * probe-session-algo.cjs — test whether the gate accepts a session id built
 * with OpenCode's REAL identifier algorithm (time-ordered 12 hex prefix)
 * versus a random-hex prefix.
 *
 * Algorithm from anomalyco/opencode packages/schema/src/identifier.ts:
 *   current = BigInt(Date.now()) * 0x1000 + counter
 *   time    = 6 bytes of `current` as lowercase hex (big-endian, 12 chars)
 *   tail    = 14 chars from [0-9A-Za-z]
 *   id      = time + tail        (26 chars total, prefixed with "ses_")
 *
 *   node probe-session-algo.cjs
 */
'use strict';

const crypto = require('crypto');

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let lastTimestamp = 0;
let counter = 0;

function ascending() {
  const timestamp = Date.now();
  if (timestamp !== lastTimestamp) { lastTimestamp = timestamp; counter = 0; }
  counter++;
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter);
  const time = Array.from({ length: 6 }, (_, i) =>
    Number((current >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')).join('');
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return time + Array.from(bytes, (b) => CHARS[b % 62]).join('');
}

const randHex12 = () => crypto.randomBytes(6).toString('hex');
const randChars = (n) => Array.from({ length: n }, () => CHARS[crypto.randomInt(62)]).join('');

const DUMMY_TOOL = {
  type: 'function',
  function: { name: 'ping', description: 'noop', parameters: { type: 'object', properties: {}, required: [] } },
};

function headers(session) {
  return {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': session,
    'x-opencode-request': 'msg_' + ascending(),
    'x-opencode-project': 'global',
  };
}

async function chat(session, { stream = true, tools = [DUMMY_TOOL], model = 'mimo-v2.5-free' } = {}) {
  const body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream };
  if (tools) body.tools = tools;
  let r;
  try {
    r = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST', headers: headers(session), body: JSON.stringify(body),
    });
  } catch (e) { return { status: 0, type: 'NETWORK:' + e.message }; }
  const t = await r.text();
  let type = '';
  try {
    const j = JSON.parse(t);
    type = j?.error?.type || (j?.choices ? 'OK' : j?.error?.message?.slice(0, 70) || '');
  } catch { type = t.replace(/\s+/g, ' ').slice(0, 70); }
  return { status: r.status, type: type || t.replace(/\s+/g, ' ').slice(0, 60) };
}

(async () => {
  const rows = [
    ['time-ordered 12hex + 14 b62  (REAL algo)', 'ses_' + ascending()],
    ['random 12hex + 14 b62', 'ses_' + randHex12() + randChars(14)],
    ['random 26 b62', 'ses_' + randChars(26)],
  ];

  for (const [label, session] of rows) {
    const r = await chat(session);
    const v = r.status === 200 ? 'OK  ' : (r.type === 'FreeTierError' ? 'GATE' : 'ERR ');
    console.log(`${v} ${String(r.status).padEnd(3)} ${label.padEnd(40)} ${session.slice(0, 34)}…  ${r.type}`);
    await new Promise((res) => setTimeout(res, 600));
  }

  // 3 repeats with the real algorithm, fresh ids each time
  console.log('\n### real algorithm x3 (fresh ids)');
  for (let i = 0; i < 3; i++) {
    const s = 'ses_' + ascending();
    const r = await chat(s);
    const v = r.status === 200 ? 'OK  ' : (r.type === 'FreeTierError' ? 'GATE' : 'ERR ');
    console.log(`${v} ${String(r.status).padEnd(3)} ${s}  ${r.type}`);
    await new Promise((res) => setTimeout(res, 600));
  }
})();
