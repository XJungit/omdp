import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'file:///C:/Users/xj/.dsh/profiles/web/node_modules/yaml/dist/index.js'

const text = readFileSync('C:/Users/xj/.dsh/profiles/web/cordis.patch.yml', 'utf8')

function findMcpBlock(text) {
  const re = /\n- insert:/g
  let m
  const starts = []
  while ((m = re.exec(text)) !== null) starts.push(m.index)
  for (const start of starts) {
    const bs = start + 1
    let end = text.length
    re.lastIndex = bs
    const next = re.exec(text)
    if (next) end = next.index + 1
    re.lastIndex = 0
    const bt = text.slice(bs, end)
    if (/\n\s*- id:\s*["']?mcp-/.test(bt)) return { head: text.slice(0, bs), blockText: bt, tail: text.slice(end) }
  }
  return null
}

function stripQuotes(v) {
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1)
  return v
}
const KNOWN = new Set(['transport', 'serverName', 'command', 'header'])
const SKIP = new Set(['name', 'config'])

function parseMcpServers(blockText) {
  const lines = blockText.split('\n')
  const servers = []
  let cur = null, curIndent = 0, argsSeqIndent = -1
  for (const line of lines) {
    const idm = line.match(/^(\s*)- id:\s*["']?(mcp-[^\s"']+)["']?\s*$/)
    if (idm) {
      if (cur) servers.push(cur)
      cur = { id: idm[2], name: idm[2].replace(/^mcp-/, ''), transport: '', serverName: '', command: '', args: '', argsLines: [], header: '', preserve: '' }
      curIndent = idm[1].length
      argsSeqIndent = -1
      continue
    }
    if (!cur) continue
    const indent = (line.match(/^(\s*)/) || [''])[1].length
    if (line.trim().length === 0) continue
    if (indent === curIndent && /^- id:/.test(line)) continue
    if (indent <= curIndent) { argsSeqIndent = -1; if (cur) { servers.push(cur); cur = null } continue }
    if (argsSeqIndent >= 0 && indent >= argsSeqIndent && /^\s*- /.test(line)) { cur.argsLines.push(line.trim()); continue }
    const kv = line.match(/^\s+(\w+):\s*(.*)$/)
    if (kv) {
      const k = kv[1], val = stripQuotes(kv[2].trim())
      if (SKIP.has(k)) continue
      if (k === 'args') { if (val.length) cur.args = val; else argsSeqIndent = indent + 2; continue }
      if (KNOWN.has(k)) {
        if (k === 'serverName') cur.serverName = val
        else if (k === 'transport') cur.transport = val
        else if (k === 'command') cur.command = val
        else if (k === 'header') cur.header = val
        continue
      }
    }
    cur.preserve += (cur.preserve ? '\n' : '') + line
  }
  if (cur) servers.push(cur)
  return servers
}

const found = findMcpBlock(text)
console.log('block found:', !!found)
if (found) {
  const servers = parseMcpServers(found.blockText)
  console.log('parsed servers:', servers.length)
  servers.forEach(s => console.log(`  ${s.id} | name=${s.name} | transport=${s.transport} | serverName=${s.serverName} | command=${s.command}`))
  // verify preserve contains url !!js and env
  const t = servers.find(s => s.id === 'mcp-tavily')
  console.log('tavily preserve:', JSON.stringify(t?.preserve))
  const gh = servers.find(s => s.id === 'mcp-github')
  console.log('github preserve:', JSON.stringify(gh?.preserve))
}
