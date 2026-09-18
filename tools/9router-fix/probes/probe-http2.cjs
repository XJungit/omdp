/**
 * probe-http2.cjs — same request, two transports: undici fetch (HTTP/1.1)
 * vs node:http2 (ALPN h2). Tests whether the Zen free-tier gate is sensitive
 * to the HTTP transport rather than the application headers.
 *
 *   node probe-http2.cjs
 */
'use strict';

const crypto = require('crypto');
const http2 = require('http2');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

const TOOL = {
  type: 'function',
  function: { name: 'ping', description: 'noop', parameters: { type: 'object', properties: {}, required: [] } },
};

const body = JSON.stringify({
  model: 'mimo-v2.5-free',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 8,
  stream: true,
  tools: [TOOL],
});

const headers = {
  'content-type': 'application/json',
  authorization: 'Bearer public',
  'user-agent': 'opencode/1.18.31',
  'x-opencode-client': 'cli',
  'x-opencode-session': ses(),
  'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
  'x-opencode-project': 'global',
  'content-length': Buffer.byteLength(body),
};

function summarize(raw, status) {
  let type = '';
  try {
    const j = JSON.parse(raw);
    if (j?.error) type = j.error.type || (j.error.message || '').slice(0, 70);
    else if (j?.choices || j?.output) type = 'OK';
    else type = '?';
  } catch { type = raw.replace(/\s+/g, ' ').slice(0, 70); }
  return `HTTP ${status}  ${type}`;
}

async function viaFetch() {
  console.log('\n### A. undici fetch (HTTP/1.1)');
  try {
    const r = await fetch('https://opencode.ai/zen/v1/chat/completions', { method: 'POST', headers, body });
    const t = await r.text();
    console.log('  ' + summarize(t, r.status));
  } catch (e) { console.log('  NETWORK: ' + e.message); }
}

function viaHttp2() {
  console.log('\n### B. node:http2 (ALPN h2)');
  return new Promise((resolve) => {
    const client = http2.connect('https://opencode.ai');
    client.on('error', (e) => { console.log('  connect error: ' + e.message); resolve(); });
    const req = client.request({ ':method': 'POST', ':path': '/zen/v1/chat/completions', ...headers });
    let status = 0;
    let data = '';
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const clean = data.replace(/^data: /gm, '').split('\n').filter(Boolean)[0] || data;
      console.log('  ' + summarize(clean.slice(0, 2000), status));
      if (status === 200) console.log('  (first 160b) ' + data.replace(/\s+/g, ' ').slice(0, 160));
      client.close();
      resolve();
    });
    req.on('error', (e) => { console.log('  request error: ' + e.message); client.close(); resolve(); });
    req.end(body);
  });
}

(async () => {
  await viaFetch();
  await viaHttp2();
  console.log('');
})();
