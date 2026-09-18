/**
 * probe-official-contract.cjs
 * ------------------------------------------------------------------
 * Validate the gate against the OFFICIAL OpenCode client contract, taken from
 * anomalyco/opencode @ b02acc1e (opencode v1.18.31) - not from guesswork.
 *
 * Source of truth, file by file:
 *
 *  packages/opencode/src/session/llm/request.ts
 *      const USER_AGENT = `opencode/${InstallationVersion}`        // L18
 *      ... providerID.startsWith("opencode") ? {
 *            "x-opencode-project":   project.id,
 *            "x-opencode-session":   input.sessionID,              // L191
 *            "x-opencode-request":   input.user.id,
 *            "x-opencode-client":    input.flags.client,
 *            "User-Agent":           USER_AGENT,                   // L194
 *          } : ...
 *      tools = resolveTools(input) -> Record<string, Tool>          // L148
 *      tools sorted by name; `tools: Record` is passed to the model  // L184
 *
 *  packages/schema/src/session-id.ts
 *      "ses_" + descending()                                        // session shape
 *  packages/schema/src/identifier.ts
 *      26 chars total: 6 bytes of hex time (12 chars) + 14 base62   // => /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/
 *
 *  packages/opencode/src/tool/read.ts       -> Tool.define("read")     // L64-69
 *  packages/opencode/src/tool/shell/id.ts   -> export const ToolID = "bash"
 *      ("bash" is the shell tool's id on EVERY platform, including Windows -
 *       the comment says so explicitly: rename with opencode 2.0)
 *
 * So the official client ALWAYS declares a tool literally named `read` and a
 * tool literally named `bash`, and reports UA opencode/1.18.31. That is the
 * contract this probe asserts, and it is why the earlier "quartet" reading was
 * wrong and why a Windows shell named `pwsh` fails.
 *
 *   node probe-official-contract.cjs
 */
'use strict';

const crypto = require('crypto');

const UF = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Verbatim port of packages/schema/src/identifier.ts (descending variant). */
let lastTimestamp = 0;
let counter = 0;
function canonicalSession() {
  const timestamp = Date.now();
  if (timestamp !== lastTimestamp) { lastTimestamp = timestamp; counter = 0; }
  counter++;
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter);
  const value = ~current; // descending()
  const time = Array.from({ length: 6 }, (_, i) =>
    Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')).join('');
  const bytes = crypto.randomBytes(14);
  return 'ses_' + time + Array.from(bytes, (b) => UF[b % 62]).join('');
}

/** The official client's tool set on a Windows host, per the sources above. */
const OFFICIAL_TOOLS = ['bash', 'read', 'glob', 'grep', 'edit', 'write', 'task', 'fetch', 'todo', 'search', 'skill', 'patch'];

const mkTool = (name) => ({
  type: 'function',
  function: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } },
});

function headers(session, over = {}) {
  return {
    Authorization: 'Bearer public',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    // request.ts L18 + L194 - official is exactly `opencode/<version>`
    'User-Agent': 'opencode/1.18.31',
    // request.ts L193 - flags.client, "cli" for the CLI entrypoint
    'x-opencode-client': 'cli',
    // request.ts L191 - a SessionID created by session-id.ts
    'x-opencode-session': session,
    // request.ts L192 - a message id
    'x-opencode-request': 'msg_' + crypto.randomBytes(6).toString('hex') + Array.from(crypto.randomBytes(14), (b) => UF[b % 62]).join(''),
    // request.ts L190 - InstanceState project id
    'x-opencode-project': 'proj_' + crypto.randomBytes(12).toString('hex'),
    ...over,
  };
}

async function call({ session, tools, stream = true, model = 'mimo-v2.5-free', headersOver = {}, endpoint = 'chat/completions' }) {
  const body = { model, messages: [{ role: 'user', content: 'say hi' }], max_tokens: 16, stream };
  if (tools) body.tools = tools.map(mkTool);
  let r;
  try {
    r = await fetch(`https://opencode.ai/zen/v1/${endpoint}`, {
      method: 'POST', headers: headers(session, headersOver), body: JSON.stringify(body),
    });
  } catch (e) { return { s: 0, t: 'NET:' + e.message }; }
  const t = await r.text();
  let type = '';
  try { const j = JSON.parse(t); type = j?.error?.type || ''; } catch { /* stream */ }
  return { s: r.status, t: type || (r.status === 200 ? 'ok' : t.slice(0, 40)) };
}

(async () => {
  const line = (label, r) => console.log(`  ${label.padEnd(52)} -> ${r.s} ${r.t}`);

  console.log('\n### A. the official contract, as the real client emits it');
  line('official tools (incl. bash+read), UA/session official', await call({ session: canonicalSession(), tools: OFFICIAL_TOOLS }));
  await new Promise((s) => setTimeout(s, 400));
  line('official tools + stream:false (axis 4 must still bite)', await call({ session: canonicalSession(), tools: OFFICIAL_TOOLS, stream: false }));
  await new Promise((s) => setTimeout(s, 400));

  console.log('\n### B. show each axis is required, holding the rest official');
  line('UA -> opencode (bare, no version)', await call({ session: canonicalSession(), tools: OFFICIAL_TOOLS, headersOver: { 'User-Agent': 'opencode' } }));
  await new Promise((s) => setTimeout(s, 400));
  line('UA -> opencode/1.16.0 (versioned but stale)', await call({ session: canonicalSession(), tools: OFFICIAL_TOOLS, headersOver: { 'User-Agent': 'opencode/1.16.0' } }));
  await new Promise((s) => setTimeout(s, 400));
  line('session -> ses_+32hex (9router/opencode2dsh style)', await call({ session: 'ses_' + crypto.randomBytes(16).toString('hex'), tools: OFFICIAL_TOOLS }));
  await new Promise((s) => setTimeout(s, 400));
  line('tools -> official minus bash (the DSH/pwsh case)', await call({ session: canonicalSession(), tools: OFFICIAL_TOOLS.filter((n) => n !== 'bash') }));
  await new Promise((s) => setTimeout(s, 400));
  line('tools -> official minus read', await call({ session: canonicalSession(), tools: OFFICIAL_TOOLS.filter((n) => n !== 'read') }));
  await new Promise((s) => setTimeout(s, 400));
  line('tools -> "pwsh" instead of "bash" (DSH on Windows)', await call({ session: canonicalSession(), tools: [...OFFICIAL_TOOLS.filter((n) => n !== 'bash'), 'pwsh'] }));
  await new Promise((s) => setTimeout(s, 400));

  console.log('\n### C. the fix that follows from the contract');
  line('official tools but bash renamed pwsh + injected bash', await call({ session: canonicalSession(), tools: [...OFFICIAL_TOOLS, 'pwsh'] }));
  await new Promise((s) => setTimeout(s, 400));
  line('minimal compliant pair {read,bash}', await call({ session: canonicalSession(), tools: ['read', 'bash'] }));
  await new Promise((s) => setTimeout(s, 400));
  line('DSH tool set (read,glob,grep,edit,write,pwsh,..) + bash', await call({ session: canonicalSession(), tools: ['read', 'glob', 'grep', 'edit', 'write', 'pwsh', 'todo_write', 'web_search', 'bash'] }));
  await new Promise((s) => setTimeout(s, 400));

  console.log('\n### D. /responses lane (muse-spark-*) obeys the same contract');
  const respBody = (tools) => JSON.stringify({
    model: 'muse-spark-1.3-contributor-free',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'say hi' }] }],
    stream: true, max_output_tokens: 16,
    tools: tools.map((n) => ({ type: 'function', name: n, description: `${n} tool`, parameters: { type: 'object', properties: {} } })),
  });
  for (const [label, tools] of [['with read+bash', ['read', 'bash']], ['with read only', ['read']], ['with pwsh instead of bash', ['read', 'pwsh']]]) {
    const r = await fetch('https://opencode.ai/zen/v1/responses', {
      method: 'POST', headers: headers(canonicalSession()), body: respBody(tools),
    });
    const t = await r.text();
    let ty = ''; try { ty = JSON.parse(t)?.error?.type || ''; } catch { /* stream */ }
    console.log(`  ${label.padEnd(52)} -> ${r.status} ${ty || (r.status === 200 ? 'ok' : t.slice(0, 40))}`);
    await new Promise((s) => setTimeout(s, 400));
  }
  console.log('');
})();
