/**
 * probe-gate-truth.cjs
 * ------------------------------------------------------------------
 * Settle the TOOL axis with discriminating cases, because the earlier
 * "quartet {bash,glob,grep,read}" claim was OVERFIT and the community
 * reference fix (jasonxu114514/opencode2api@8185202) injects no tools at all.
 *
 * Established so far (3 models, 3x repeats, UA+canonical session+stream held):
 *   {read,bash}            -> 200
 *   {read}                 -> 403
 *   {bash}                 -> 403
 *   {bash,glob}            -> 403
 *   {bash,glob,grep}       -> 403   <-- 3 tools, so "count" is not the rule
 *   {read,bash,+5 fakes}   -> 200
 *   {read,pwsh}            -> 403   <-- pwsh is NOT a substitute for bash
 *   {}                     -> 403
 *
 * Candidate rules still alive:
 *   R1  names must include BOTH exactly "read" and exactly "bash"
 *   R2  order-sensitive (some inspected position)
 *   R3  schema-shape dependent
 *   R4  count of *recognized* names (needs >= 2 of a recognised family)
 *
 * These cases separate them.
 *
 *   node probe-gate-truth.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

const FULL = (name) => ({
  type: 'function',
  function: { name, description: 'x', parameters: { type: 'object', properties: {}, required: [] } },
});

function headers() {
  return {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'cli',
    'x-opencode-session': ses(),
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
  };
}

async function call(tools, { stream = true, model = 'mimo-v2.5-free' } = {}) {
  const body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream };
  if (tools) body.tools = tools;
  let r;
  try {
    r = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
  } catch (e) { return 'NET:' + e.message; }
  const t = await r.text();
  if (r.status === 200) return 'OK';
  try { const j = JSON.parse(t); return `${r.status} ${j?.error?.type || ''}`.trim(); }
  catch { return String(r.status); }
}

const names = (t) => (t || []).map((x) => (x.function ? x.function.name : x.name));

(async () => {
  const show = async (label, tools, opts) => {
    const r = await call(tools, opts);
    console.log(`  ${label.padEnd(46)} -> ${r}`);
    await new Promise((s) => setTimeout(s, 380));
    return r;
  };

  console.log('\n### R2: is ORDER load-bearing?');
  await show('[{read,bash}] (read first)', [FULL('read'), FULL('bash')]);
  await show('[{bash,read}] (bash first)', [FULL('bash'), FULL('read')]);
  await show('[{read,bash,glob,grep}]', [FULL('read'), FULL('bash'), FULL('glob'), FULL('grep')]);
  await show('[{glob,grep,read,bash}] reversed quartet', [FULL('glob'), FULL('grep'), FULL('read'), FULL('bash')]);

  console.log('\n### R1: exact names vs alternatives');
  await show('[{"Read","Bash"}] (capitalised)', [FULL('Read'), FULL('Bash')]);
  await show('[{read,bash_exec}]', [FULL('read'), FULL('bash_exec')]);
  await show('[{read,shell}]', [FULL('read'), FULL('shell')]);
  await show('[{read,exec}]', [FULL('read'), FULL('exec')]);
  await show('[{read,bashTool}]', [FULL('read'), FULL('bashTool')]);

  console.log('\n### R3: does schema SHAPE matter? (same names, degenerate schemas)');
  await show('[{read,bash}] no-parameters field', [
    { type: 'function', function: { name: 'read' } },
    { type: 'function', function: { name: 'bash' } },
  ]);
  await show('[{read,bash}] empty function objects', [
    { type: 'function', function: { name: 'read', parameters: {} } },
    { type: 'function', function: { name: 'bash', parameters: {} } },
  ]);
  await show('[{read,bash}] rich real-ish schemas', [
    { type: 'function', function: { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] } } },
    { type: 'function', function: { name: 'bash', description: 'Run a shell command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  ]);

  console.log('\n### R4: is it a COUNT of recognised names?');
  await show('[{read,glob,grep,write,edit,pwsh}] 6 recognised, no bash', ['read', 'glob', 'grep', 'write', 'edit', 'pwsh'].map(FULL));
  await show('[{bash,glob,grep,write,edit,pwsh}] 6 recognised, no read', ['bash', 'glob', 'grep', 'write', 'edit', 'pwsh'].map(FULL));
  await show('[{read,bash}] but tools as plain strings', [{ type: 'function', function: { name: 'read', description: '' } }, { type: 'function', function: { name: 'bash', description: '' } }]);

  console.log('\n### control: the minimal pair must still fail the OTHER axes');
  await show('[{read,bash}] + stream:false', [FULL('read'), FULL('bash')], { stream: false });
  await show('[{read,bash}] on another model', [FULL('read'), FULL('bash')], { model: 'nemotron-3.5-lightning-free' });
  await show('[{read,bash}] repeat #1', [FULL('read'), FULL('bash')]);
  await show('[{read,bash}] repeat #2', [FULL('read'), FULL('bash')]);

  console.log('\n### DSH harness reality check (read yes, bash NO -> pwsh)');
  const DSH = ['read', 'glob', 'grep', 'edit', 'write', 'pwsh', 'todo_write', 'web_search'].map(FULL);
  await show('DSH tools as-is', DSH);
  await show('DSH tools + bash', [...DSH, FULL('bash')]);
  console.log('');
})();
