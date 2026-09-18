/**
 * fetch-issue-comments.cjs — dump GitHub issue comments to a text file.
 * Because fetching raw GitHub issue comments via PowerShell hits TLS issues on
 * this box, we use Node's fetch instead.
 *
 *   node fetch-issue-comments.cjs <owner/repo> <number> <outfile>
 */
'use strict';

const fs = require('fs');

const [slug, num, out] = process.argv.slice(2);
const [owner, repo] = slug.split('/');

(async () => {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${num}/comments?per_page=100`;
  const r = await fetch(url, { headers: { 'User-Agent': 'probe', Accept: 'application/vnd.github+json' } });
  if (!r.ok) { console.error('HTTP ' + r.status); process.exit(1); }
  const list = await r.json();
  const lines = [`# ${slug} #${num} — ${list.length} comments`, ''];
  for (const c of list) {
    lines.push(`--- @${c.user.login}  ${c.created_at}  (${c.body.length}b)`);
    lines.push(c.body.replace(/\r/g, ''));
    lines.push('');
  }
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`${list.length} comments -> ${out}`);
})();
