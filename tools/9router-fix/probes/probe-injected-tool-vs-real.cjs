/**
 * probe-injected-tool-vs-real.cjs
 * ------------------------------------------------------------------
 * The patch must DECLARE `bash` (axes 3) even when the caller's own shell tool
 * is called `pwsh`. So it appends a hollow `bash`. The previous probe showed the
 * model happily calls hollow tools when they are the ONLY tools offered - which
 * is not the real situation. Here the caller also offers its REAL tools, which
 * is what actually decides whether the hollow one gets picked.
 *
 * Question: with a realistic DSH-on-Windows tool set present, does the model
 * still reach for the hollow injected `bash`, or does it prefer a real tool?
 *
 * That risk cannot be removed by "not injecting" (the gate would 403), so it can
 * only be (a) shown to be negligible, or (b) mitigated by giving `bash` a real
 * schema - which then needs response-side name mapping back to `pwsh`.
 *
 *   node probe-injected-tool-vs-real.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);

const headers = () => ({
  Authorization: 'Bearer public', 'Content-Type': 'application/json',
  Accept: 'text/event-stream',
  'User-Agent': 'opencode/1.18.31', 'x-opencode-client': 'cli',
  'x-opencode-session': ses(),
  'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
  'x-opencode-project': 'global',
});

const tool = (name, description, props) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties: props ?? {}, ...(props ? { required: Object.keys(props) } : {}), additionalProperties: true } },
});

/** Hollow declaration exactly as the patch injects it. */
const hollow = (name) => tool(name, 'Declared by the OpenCode client.');

/** A realistic subset of what DSH exposes on Windows. */
function dshToolset() {
  return [
    tool('read', 'Read a file from disk. Returns the file contents with line numbers.', { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }),
    tool('write', 'Create or fully replace a UTF-8 text file.', { file_path: { type: 'string' }, content: { type: 'string' } }),
    tool('edit', 'Edit an existing UTF-8 text file by replacing literal text.', { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }),
    tool('read_image', 'Read a PNG/JPEG/WebP/GIF file and return the image itself.', { file_path: { type: 'string' } }),
    tool('glob', 'Find files whose paths match a glob pattern.', { pattern: { type: 'string' }, path: { type: 'string' } }),
    tool('grep', 'Search file contents with a ripgrep regular expression.', { pattern: { type: 'string' }, path: { type: 'string' } }),
    tool('pwsh', 'Execute a PowerShell command and return its stdout/stderr.', { command: { type: 'string' }, description: { type: 'string' }, timeoutMs: { type: 'number' } }),
    tool('todo_write', 'Record and update a structured task list for the current work.', { todos: { type: 'array', items: { type: 'object' } } }),
    tool('web_search', 'Search the web for current information.', { queries: { type: 'array', items: { type: 'string' } } }),
  ];
}

async function run({ prompt, tools, model = 'mimo-v2.5-free' }) {
  let r;
  try {
    r = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 512, stream: true, tools }),
    });
  } catch (e) { return { status: 0, called: [], err: e.message }; }
  if (r.status !== 200) { const t = await r.text(); return { status: r.status, called: [], err: t.replace(/\s+/g, ' ').slice(0, 90) }; }
  let buf = ''; const called = new Map();
  for await (const chunk of r.body) {
    buf += Buffer.from(chunk).toString('utf8');
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const p = line.slice(6).trim();
      if (p === '[DONE]') continue;
      let ev; try { ev = JSON.parse(p); } catch { continue; }
      for (const tc of ev?.choices?.[0]?.delta?.tool_calls ?? []) {
        const n = tc?.function?.name;
        if (n) called.set(n, (called.get(n) ?? 0) + 1);
      }
    }
  }
  return { status: 200, called: [...called.keys()] };
}

const PROMPTS = [
  'List the files in the current working directory.',
  'Read the file package.json and show me its "name" field.',
  'Run a shell command to print the current date.',
  'Find every .cjs file under tools/.',
];

const SCENARIOS = [
  ['A. DSH set + hollow bash (current patch)', () => [...dshToolset(), hollow('bash')]],
  ['B. DSH set + hollow read AND bash (caller sent no tools)', () => [...dshToolset(), hollow('read'), hollow('bash')]],
  ['C. DSH set, pwsh ALIASED as bash (real schema, no hollow)', () => {
    const set = dshToolset().filter((t) => t.function.name !== 'pwsh');
    const bash = tool('bash', 'Execute a shell command and return its stdout/stderr.', { command: { type: 'string' }, description: { type: 'string' }, timeoutMs: { type: 'number' } });
    return [...set, bash];
  }],
];

(async () => {
  for (const [label, mk] of SCENARIOS) {
    console.log(`\n### ${label}`);
    let hollowPicked = 0; let realPicked = 0; let none = 0;
    for (const prompt of PROMPTS) {
      const res = await run({ prompt, tools: mk() });
      const names = res.called;
      if (!names.length) none++;
      if (names.includes('bash') || (names.includes('read') && label.startsWith('B'))) hollowPicked++;
      else if (names.length) realPicked++;
      console.log(`  ${String(res.status).padEnd(4)} picked=[${names.join(',') || '-'}]`.padEnd(40) + ` <- ${prompt.slice(0, 44)}`);
      await new Promise((s) => setTimeout(s, 500));
    }
    console.log(`  => hollow/aliased name picked ${hollowPicked}x, real tool ${realPicked}x, no call ${none}x  (of ${PROMPTS.length})`);
  }
  console.log('');
})();
