/**
 * probe-quartet.cjs
 * ------------------------------------------------------------------
 * Reproduce 9router PR #4132's bisection, which found the missing gate axis:
 * the free tier fingerprints the official agentic client on FOUR axes and
 * 403s if any one is absent:
 *
 *   1. User-Agent   opencode/<version >= 1.17.0>
 *   2. x-opencode-session  ses_ + 12 hex + 14 base62
 *   3. body.tools   the file-search QUARTET {bash, glob, grep, read} present
 *                   (0-3 tools -> 403; the quartet, or quartet + extras -> 200;
 *                    10 unrelated names -> 403)
 *   4. body.stream  true  (stream:false -> 403, "both endpoints")
 *
 *   node probe-quartet.cjs
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
const QUARTET = ['bash', 'glob', 'grep', 'read'];
const quartet = () => QUARTET.map(mkTool);

const MODELS = ['mimo-v2.5-free', 'ling-3.0-flash-fin-free', 'nemotron-3.5-lightning-free', 'nemotron-3-ultra-free'];

function headers(over = {}) {
  return {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': ses(),
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
    ...over,
  };
}

async function call(label, { tools, stream = true, model = 'mimo-v2.5-free', over = {}, path = 'chat/completions' } = {}) {
  const body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream };
  if (tools) body.tools = tools;
  let r;
  try {
    r = await fetch(`https://opencode.ai/zen/v1/${path}`, { method: 'POST', headers: headers(over), body: JSON.stringify(body) });
  } catch (e) { console.log(`  NET  ${label}: ${e.message}`); return null; }
  const t = await r.text();
  let type = '';
  try { const j = JSON.parse(t); type = j?.error ? (j.error.type || (j.error.message || '').slice(0, 45)) : 'OK'; }
  catch { type = /^data:/.test(t) ? 'OK(stream)' : t.replace(/\s+/g, ' ').slice(0, 45); }
  const v = r.status === 200 ? 'OK  ' : (type === 'FreeTierError' ? 'GATE' : 'ERR ');
  console.log(`  ${v} ${String(r.status).padEnd(3)} ${label.padEnd(48)} ${type}`);
  return r.status;
}

(async () => {
  console.log('\n### A. tool-set bisection (UA + canonical session + stream:true held)');
  await call('0 tools', { tools: undefined }); await new Promise((r) => setTimeout(r, 500));
  await call('1 tool  (bash)', { tools: [mkTool('bash')] }); await new Promise((r) => setTimeout(r, 500));
  await call('2 tools (bash, read)', { tools: [mkTool('bash'), mkTool('read')] }); await new Promise((r) => setTimeout(r, 500));
  await call('3 tools (bash, glob, grep)', { tools: ['bash', 'glob', 'grep'].map(mkTool) }); await new Promise((r) => setTimeout(r, 500));
  await call('QUARTET {bash,glob,grep,read}', { tools: quartet() }); await new Promise((r) => setTimeout(r, 500));
  await call('quartet + 2 extras', { tools: [...quartet(), mkTool('webfetch'), mkTool('todowrite')] }); await new Promise((r) => setTimeout(r, 500));
  await call('10 fake names', { tools: Array.from({ length: 10 }, (_, i) => mkTool('fake' + i)) });

  console.log('\n### B. other axes, with the quartet present');
  await call('quartet + stream:false', { tools: quartet(), stream: false }); await new Promise((r) => setTimeout(r, 500));
  await call('quartet + bare UA', { tools: quartet(), over: { 'User-Agent': 'opencode' } }); await new Promise((r) => setTimeout(r, 500));
  await call('quartet + stale UA 1.16.0', { tools: quartet(), over: { 'User-Agent': 'opencode/1.16.0' } }); await new Promise((r) => setTimeout(r, 500));
  await call('quartet + UUID session', { tools: quartet(), over: { 'x-opencode-session': 'ses_' + crypto.randomUUID().replace(/-/g, '') } });

  console.log('\n### C. all free models with the full fingerprint');
  for (const m of MODELS) {
    await call(`quartet + stream, ${m}`, { tools: quartet(), model: m });
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\n### D. /responses endpoint');
  {
    const body = {
      model: 'muse-spark-1.3-contributor-free',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'say OK' }] }],
      stream: true,
      tools: quartet().map((t) => ({ type: 'function', name: t.function.name, description: 'noop', parameters: t.function.parameters })),
    };
    let r;
    try { r = await fetch('https://opencode.ai/zen/v1/responses', { method: 'POST', headers: headers(), body: JSON.stringify(body) }); }
    catch (e) { r = null; console.log('  NET  /responses: ' + e.message); }
    if (r) {
      const t = await r.text();
      let type = '';
      try { const j = JSON.parse(t); type = j?.error ? (j.error.type || (j.error.message || '').slice(0, 45)) : 'OK'; }
      catch { type = /^data:/.test(t) ? 'OK(stream)' : t.replace(/\s+/g, ' ').slice(0, 45); }
      const v = r.status === 200 ? 'OK  ' : (type === 'FreeTierError' ? 'GATE' : 'ERR ');
      console.log(`  ${v} ${String(r.status).padEnd(3)} ${'quartet + stream'.padEnd(48)} ${type}`);
    }
  }
  console.log('');
})();
