/**
 * probe-quartet-refine.cjs
 * ------------------------------------------------------------------
 * Nail down the TOOL-SET gate exactly.
 *
 * The first matrix produced a contradiction worth resolving: with
 * UA + canonical session + stream:true held constant,
 *
 *   {bash, read}          -> 200     <-- passes with only TWO tools
 *   {bash, glob, grep}    -> 403     <-- three tools, but refused
 *   quartet              -> 200
 *   quartet + 2 extras    -> 200
 *   10 unrelated names    -> 403
 *
 * "must contain all of {bash, glob, grep, read}" does NOT explain that.
 * This probe isolates which names are actually load-bearing, and repeats the
 * surprising cases so a transient upstream blip cannot masquerade as a rule.
 *
 *   node probe-quartet-refine.cjs
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
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': ses(),
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
  };
}

async function call(names, model = 'mimo-v2.5-free') {
  const body = {
    model,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 8,
    stream: true,
    tools: names.map(mkTool),
  };
  let r;
  try {
    r = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
  } catch (e) { return 'NET:' + e.message; }
  const t = await r.text();
  if (r.status === 200) return 'OK';
  try { const j = JSON.parse(t); return `${r.status} ${j?.error?.type || (j?.error?.message || '').slice(0, 40)}`; }
  catch { return `${r.status} ${t.replace(/\s+/g, ' ').slice(0, 40)}`; }
}

// DSH's own harness tool names, as seen in this session's tool catalog.
const DSH_TOOLS = ['read', 'glob', 'grep', 'edit', 'write', 'pwsh', 'todo_write', 'web_search'];

(async () => {
  console.log('\n### isolated pairs (which two names are load-bearing?)');
  const pairs = [
    ['read, bash', ['read', 'bash']],
    ['read, glob', ['read', 'glob']],
    ['read, grep', ['read', 'grep']],
    ['read, pwsh', ['read', 'pwsh']],
    ['read alone', ['read']],
    ['bash alone', ['bash']],
    ['bash, glob', ['bash', 'glob']],
    ['read, edit', ['read', 'edit']],
  ];
  for (const [label, names] of pairs) {
    console.log(`  {${label.padEnd(14)}} -> ${await call(names)}`);
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\n### repeats of the surprising cases (transient-check)');
  for (const [label, names] of [['{read, bash}', ['read', 'bash']], ['{bash, glob, grep}', ['bash', 'glob', 'grep']]]) {
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await call(names));
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log(`  ${label.padEnd(18)} x3 -> ${results.join(' | ')}`);
  }

  console.log('\n### does read+bash alone still hold when extras present?');
  for (const [label, names] of [
    ['read, bash, glob', ['read', 'bash', 'glob']],
    ['read, bash, grep', ['read', 'bash', 'grep']],
    ['read, bash + 5 fakes', ['read', 'bash', 'f1', 'f2', 'f3', 'f4', 'f5']],
  ]) {
    console.log(`  {${label.padEnd(20)}} -> ${await call(names)}`);
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\n### DSH harness tool set as-is (what opencode2dsh adapter would send)');
  console.log(`  {DSH_TOOLS} -> ${await call(DSH_TOOLS)}`);
  await new Promise((r) => setTimeout(r, 400));
  console.log(`  {DSH_TOOLS + bash} -> ${await call([...DSH_TOOLS, 'bash'])}`);
  await new Promise((r) => setTimeout(r, 400));
  console.log(`  quartet -> ${await call(['bash', 'glob', 'grep', 'read'])}`);

  console.log('\n### control: same body shape, no tools');
  console.log(`  {} -> ${await call([])}`);
  console.log('');
})();
