/**
 * probe-injected-tool-usage.cjs
 * ------------------------------------------------------------------
 * Does the model ever CALL the tools we inject purely to satisfy the gate?
 *
 * Axis 3 forces us to DECLARE `read` and `bash` in body.tools. But the
 * declarations we add are hollow: empty parameter schemas, no real backing
 * implementation. The caller (9router's client, e.g. DSH) never declared those
 * names, so if the model emits a tool_call for one of them the caller receives a
 * call for a tool it does not have.
 *
 * This probe measures that risk directly, and measures whether the tool
 * DESCRIPTION can suppress it.
 *
 * NOTE: axis 4 makes `stream:true` mandatory, so every request here streams and
 * tool calls are read out of the SSE deltas. An ad-hoc version of this test that
 * forgot stream:true scored a flat 403 and briefly looked like "the gate changed
 * again" - it had not.
 *
 *   node probe-injected-tool-usage.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

function headers() {
  return {
    Authorization: 'Bearer public', 'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': 'opencode/1.18.31', 'x-opencode-client': 'cli',
    'x-opencode-session': ses(),
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
  };
}

/** Tool declaration shape used by the patch (chat lane). */
const injectTool = (name, description) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties: {}, additionalProperties: true } },
});

/** Stream the completion and collect every tool_call name the model emitted. */
async function run({ prompt, tools, model = 'mimo-v2.5-free' }) {
  let r;
  try {
    r = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 512, stream: true, tools }),
    });
  } catch (e) { return { status: 0, err: e.message, called: [], text: '' }; }
  if (r.status !== 200) {
    const t = await r.text();
    return { status: r.status, err: t.replace(/\s+/g, ' ').slice(0, 100), called: [], text: '' };
  }
  let buf = '';
  const called = new Map();
  let text = '';
  for await (const chunk of r.body) {
    buf += Buffer.from(chunk).toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      let ev; try { ev = JSON.parse(payload); } catch { continue; }
      const d = ev?.choices?.[0]?.delta;
      if (!d) continue;
      if (typeof d.content === 'string') text += d.content;
      for (const tc of d.tool_calls ?? []) {
        const n = tc?.function?.name;
        if (n) called.set(n, (called.get(n) ?? '') + String(tc?.function?.arguments ?? ''));
      }
    }
  }
  return { status: 200, called: [...called.entries()], text };
}

const PROMPTS = [
  'List the files in the current working directory.',
  'Read the file package.json and show me its "name" field.',
  'Run a shell command to print the current date.',
];

(async () => {
  const VARIANTS = [
    ['current patch wording', (n) => 'Declared by the OpenCode client.'],
    ['explicit no-op wording', (n) => `Placeholder declaration required by the upstream client contract. It has no implementation and MUST NOT be called; use your own tools instead.`],
    ['named as unavailable', (n) => `[unavailable] ${n} is not implemented in this deployment. Do not call it.`],
  ];

  for (const [label, desc] of VARIANTS) {
    console.log(`\n### description variant: ${label}`);
    let calls = 0;
    let total = 0;
    for (const prompt of PROMPTS) {
      const tools = [injectTool('read', desc('read')), injectTool('bash', desc('bash'))];
      const res = await run({ prompt, tools });
      total++;
      const names = res.called.map(([n]) => n);
      if (names.length) calls++;
      console.log(`  ${res.status} ${names.length ? 'CALLED ' + names.join(',') : 'no tool call'}`.padEnd(34) + ` <- ${prompt.slice(0, 46)}`);
      await new Promise((s) => setTimeout(s, 500));
    }
    console.log(`  => model invoked an injected tool in ${calls}/${total} prompts`);
  }

  console.log('\n### control: are the injected names even attractive? (real-ish schema)');
  const rich = ['read', 'bash'].map((n) => ({
    type: 'function',
    function: {
      name: n,
      description: n === 'bash' ? 'Execute a shell command and return its output.' : 'Read a file from disk.',
      parameters: n === 'bash'
        ? { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
        : { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  }));
  for (const prompt of PROMPTS) {
    const res = await run({ prompt, tools: rich });
    console.log(`  ${res.status} ${res.called.length ? 'CALLED ' + res.called.map(([n]) => n).join(',') : 'no tool call'}`.padEnd(34) + ` <- ${prompt.slice(0, 46)}`);
    await new Promise((s) => setTimeout(s, 500));
  }
  console.log('');
})();
