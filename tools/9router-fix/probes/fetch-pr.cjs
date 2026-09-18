/**
 * fetch-pr.cjs — dump a GitHub PR's metadata, body and diff to files.
 *
 *   node fetch-pr.cjs <owner/repo> <number> <outPrefix>
 */
'use strict';

const fs = require('fs');

const [slug, num, prefix] = process.argv.slice(2);
const [owner, repo] = slug.split('/');
const H = { 'User-Agent': 'probe', Accept: 'application/vnd.github+json' };

(async () => {
  const meta = await (await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, { headers: H })).json();
  let metaText = `state=${meta.state} merged=${meta.merged} created=${meta.created_at} updated=${meta.updated_at}\n`;
  metaText += `title: ${meta.title}\nhead: ${meta.head?.label}\nbase: ${meta.base?.label}\n`;
  metaText += `\n-----BODY-----\n${meta.body || ''}\n`;
  fs.writeFileSync(`${prefix}.txt`, metaText, 'utf8');

  const d = await fetch(`https://patch-diff.githubusercontent.com/raw/${owner}/${repo}/pull/${num}.diff`, { headers: H });
  const diff = d.ok ? await d.text() : `(diff HTTP ${d.status})`;
  fs.writeFileSync(`${prefix}.diff`, diff, 'utf8');
  console.log(`${prefix}: meta ok, diff ${diff.length}b`);
})();
