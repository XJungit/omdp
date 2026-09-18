/**
 * probe-gate-families.cjs
 * ------------------------------------------------------------------
 * The rule is now clear: the body must declare a READ tool and a SHELL tool.
 *   {read,shell} -> 200 ; {read,bash} -> 200 ; {read,exec} -> 403 ;
 *   {read,bash_exec} -> 403 ; {read,pwsh} -> 403 ; {read} alone -> 403
 * So it is a NAME-FAMILY check, not a count and not a fixed quartet.
 *
 * This probe maps both families exactly, so the injected names are chosen from
 * evidence rather than guessed (the earlier "quartet" fix injected glob/grep
 * that were never required, and would have missed a client that says "shell").
 *
 *   node probe-gate-families.cjs
 */
'use strict';

const crypto = require('crypto');

const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += A[crypto.randomInt(62)]; return s; };
const ses = () => 'ses_' + crypto.randomBytes(6).toString('hex') + rnd(14);
const tool = (name) => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } });

function headers() {
  return {
    Authorization: 'Bearer public', 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'opencode/1.18.31', 'x-opencode-client': 'cli',
    'x-opencode-session': ses(),
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + rnd(14),
    'x-opencode-project': 'global',
  };
}

async function call(names) {
  const body = {
    model: 'mimo-v2.5-free',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 8, stream: true, tools: names.map(tool),
  };
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

(async () => {
  const run = async (candidates, anchor, anchorLabel) => {
    console.log(`\n### shell-family candidates, anchored with ${anchorLabel}`);
    for (const c of candidates) {
      const names = c === anchor ? [anchor] : [anchor, c];
      const label = c === anchor ? `[${c}] alone` : `[${anchor}, ${c}]`;
      console.log(`  ${label.padEnd(34)} -> ${await call(names)}`);
      await new Promise((s) => setTimeout(s, 360));
    }
  };

  await run(
    ['bash', 'shell', 'sh', 'zsh', 'exec', 'execute', 'run', 'terminal', 'command', 'bash_exec', 'run_command', 'Bash', 'bashTool'],
    'read', 'read',
  );

  console.log('\n### read-family candidates, anchored with bash');
  for (const c of ['read', 'file_read', 'read_file', 'cat', 'view', 'Read', 'readFile', 'read_file_range']) {
    const names = c === 'read' ? ['read', 'bash'] : ['bash', c];
    const label = c === 'read' ? '[read, bash] (baseline)' : `[bash, ${c}]`;
    console.log(`  ${label.padEnd(34)} -> ${await call(names)}`);
    await new Promise((s) => setTimeout(s, 360));
  }

  console.log('\n### the two-name minimum, both discovered families');
  console.log(`  [read, bash]  -> ${await call(['read', 'bash'])}`);
  await new Promise((s) => setTimeout(s, 360));
  console.log(`  [read, shell] -> ${await call(['read', 'shell'])}`);
  await new Promise((s) => setTimeout(s, 360));
  console.log(`  [shell, read] -> ${await call(['shell', 'read'])}`);
  console.log('');
})();
