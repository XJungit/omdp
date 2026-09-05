/**
 * dsh-connector — host half (installed-package plugin).
 *
 * Manages two deployment assets from one unified Web UI (see client.js):
 *
 *   1. MCP servers — the `mcp-*` entries inside the profile's cordis.patch.yml
 *   2. User skills   — the `<dshHome>/skills` directory (~/.dsh/skills)
 *
 * The client half calls this host half over a Package-private HTTP API mounted
 * on the DSH GUI webserver at /connector/api/*. (For an installed package
 * the Client→Host boundary is HTTP, not the dynamic-only host.call.)
 *
 * MCP rewrite safety: cordis.patch.yml contains `!!js` expressions, env blocks
 * and hand-written comments. A strict YAML parser would reject or mangle them.
 * So we locate the INSERT BLOCK that contains `mcp-` ids and replace ONLY the
 * `    - id: mcp-*` server entries inside it, preserving every other line
 * (header comments, the trailing connector row, and each server's env /
 * header / arbitrary nested keys) verbatim through a `preserve` bucket.
 *
 * @module dsh-connector
 */

import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { JSDOM, VirtualConsole } from 'jsdom'
import z from '@deepseek-ai/schemastery'

const API_PREFIX = '/connector/api'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// Server ids are keys for the mcp-* block (and dsh-mcp-client instances):
// kebab-case under a fixed `mcp-` prefix, which parseMcpServers also requires.
const MCP_ID_RE = /^mcp-[a-z0-9]+(?:-[a-z0-9]+)*$/
// dsh-mcp-client's own serverName contract (lib/types/index.js SERVER_NAME_PATTERN).
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
const TRANSPORTS = new Set(['stdio', 'streamable-http'])
// Anything that would break YAML/JSON transport, a cmd command line, or the
// patch file itself (NUL, control chars). Tab/newline are already rejected by
// the single-token rules; this catches the rest defensively.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/
export const inject = ['webServer']

// ── MCP 工具过滤（tool-filter, 0.3.0 新增）────────────────────────────
// dsh-mcp-client 的 Config schema 是封闭的：未知键会拒收并导致下次启动失败，
// 所以过滤规则不能写进 mcp-* 行的 config，只能放在 connector 自己的 settings
// namespace（settings.yaml `connector:` 节）里：
//   connector:
//     toolFilters:
//       <serverName>:
//         allow: [<rawToolName>, ...]   # 只放行这些工具；空/缺失 = 全量放行
//
// 生效三件套（抄 hyqhyq3/dsh-mcp-manager 的做法）：
//   1. systemPrompt.tools(provider) —— 提示词里的 schema 列表先过滤，模型看不到被滤掉的工具；
//   2. ctx.tools.guard —— 执行期硬拦截（guard 返回 reason 即拒收），补 provider 漏网；
//   3. UI 多选框 —— 见 client.js ServerForm 的工具过滤区 + GET /api/mcp/tools/:serverName。
// 无配置 = 全量放行（零回归）；guard 是同步函数，读的是 apply 时缓存 + watch 刷新的快照。
const CONNECTOR_SETTINGS_NS = 'connector'
const ToolFilterSchema = z.object({
  toolFilters: z.dict(z.object({ allow: z.array(String).default([]) })).default({}),
})
function readToolFilters(ctx) {
  try {
    const settings = ctx.get('settings')
    const value = settings ? settings.get(CONNECTOR_SETTINGS_NS) : undefined
    const filters = value && typeof value === 'object' ? value.toolFilters : undefined
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return {}
    const out = {}
    for (const [server, rule] of Object.entries(filters)) {
      const allow = rule && Array.isArray(rule.allow) ? rule.allow.filter((t) => typeof t === 'string' && t.length > 0) : []
      out[server] = { allow }
    }
    return out
  } catch { return {} }
}
// 公开名 `mcp__<server>__<raw>` 反解回 (server, raw)：注意 serverName 本身可含
// 下划线，所以按 `mcp__` 前缀 + __ 分段取“第一段”为 server，余下 join 回 raw。
function splitPublicName(publicName) {
  if (typeof publicName !== 'string' || !publicName.startsWith('mcp__')) return null
  const parts = publicName.slice(5).split('__')
  if (parts.length < 2 || !parts[0]) return null
  return { server: parts[0], raw: parts.slice(1).join('__') }
}
function isToolAllowed(filters, publicName) {
  const split = splitPublicName(publicName)
  if (!split) return true // 非 MCP 工具：不过滤
  const rule = filters[split.server]
  if (!rule || !rule.allow.length) return true // 该 server 无配置 = 全量放行
  return rule.allow.includes(split.raw)
}
export { validateServer, commandResolvable }

function resolveHome() {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv.trim().length > 0
    ? fromEnv.trim()
    : join(homedir(), '.dsh')
}

function patchPath() {
  return join(resolveHome(), 'profiles', 'web', 'cordis.patch.yml')
}

function skillsRoot() {
  return join(resolveHome(), 'skills')
}

/* ───────────────────────── MCP block handling ────────────────────────────
 * The MCP servers live inside one top-level `- insert:` list. We find the
 * insert block that actually contains `mcp-` ids (the first such one), split
 * the file into [head, mcpBlock, tail], and only rewrite server entries inside
 * mcpBlock. head keeps the header comments; tail keeps every later insert
 * (including our own connector row).
 * ────────────────────────────────────────────────────────────────────────── */

function findMcpBlock(text) {
  const re = /\n- insert:/g
  let m
  const starts = []
  while ((m = re.exec(text)) !== null) starts.push(m.index)
  for (const start of starts) {
    const blockStart = start + 1 // after the leading \n
    // locate the next insert (or EOF) as block end
    let end = text.length
    re.lastIndex = blockStart
    const next = re.exec(text)
    if (next) end = next.index + 1
    re.lastIndex = 0
    const blockText = text.slice(blockStart, end)
    if (/\n\s*- id:\s*["']?mcp-/.test(blockText)) {
      return { head: text.slice(0, blockStart), blockText, tail: text.slice(end) }
    }
  }
  return null
}

function stripQuotes(v) {
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1)
  }
  return v
}

// Extract the bare scalar from a YAML block-sequence item line like
// `  - '--transport'` -> `--transport`. Handles quoted and unquoted values.
function stripListScalar(line) {
  const m = line.match(/^\s*-\s*(.*)$/)
  if (!m) return line.trim()
  return stripQuotes(m[1].trim())
}

const KNOWN_KEYS = new Set(['transport', 'serverName', 'command', 'header'])
// `args` is modeled as a string: it appears both as a single-line array
// (`args: ['/c', ...]`) and as a block sequence. The inline form is stored in
// `cur.args` and re-emitted as a REAL YAML flow array on render — writing it
// back as a quoted string would violate dsh-mcp-client's schema (args:
// string[]) and crash the next boot. The block form is kept verbatim
// (argsLines) and re-emitted unchanged.
// `url` is preserved verbatim: it may be a `!!js` expression
// (`url: !!js (process.env.X || '') && ('https://...')`), and re-emitting it
// through a quoted scalar would turn the `!!js` tag into literal text, breaking
// the server on the next boot. Keeping it raw preserves the expression.
const PRESERVE_KEYS = new Set(['args', 'url'])
// Keys that `renderServer` emits itself (fixed `name`, the `config:` container
// opener). They must be dropped on parse so the rewrite doesn't duplicate them.
const SKIP_KEYS = new Set(['name', 'config'])

/**
 * Parse server entries (4-space-indented `- id: mcp-*`) inside the MCP block.
 * Each server keeps a `preserve` string of the config lines we don't model
 * (env blocks, `!!js` lines, any other keys) so a rewrite never drops them.
 */
function parseMcpServers(blockText) {
  const lines = blockText.split('\n')
  const servers = []
  let cur = null
  let curIndent = 0
  // When we hit `args:` with no inline value, the following deeper-indented
  // `- ` list items are a block sequence we must keep verbatim and re-emit
  // under `args:`. `argsSeqIndent` is that sequence's indent (-1 = not collecting).
  let argsSeqIndent = -1
  for (const line of lines) {
    const idm = line.match(/^(\s*)- id:\s*["']?(mcp-[^\s"']+)["']?\s*$/)
    if (idm) {
      if (cur) servers.push(cur)
      cur = {
        id: idm[2],
        name: idm[2].replace(/^mcp-/, ''),
        transport: '',
        serverName: '',
        url: '',
        command: '',
        args: '',
        argsLines: [],
        header: '',
        preserve: '',
      }
      curIndent = idm[1].length
      argsSeqIndent = -1
      continue
    }
    if (!cur) continue
    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1].length : 0
    if (line.trim().length === 0) continue
    // A sibling server at the same indent ends this entry.
    if (indent === curIndent && /^- id:/.test(line)) continue
    if (indent <= curIndent) {
      // Left the config entirely (or a sibling): stop collecting args.
      argsSeqIndent = -1
      if (cur) { servers.push(cur); cur = null }
      continue
    }
    // While collecting an args block sequence, every deeper list item is kept.
    // Store the BARE value (strip the leading "- " and any quotes) so the
    // frontend can join it into a space-separated args string and renderServer
    // can re-emit it with safeScalar — keeping "- " prefixes out of the value.
    if (argsSeqIndent >= 0 && indent >= argsSeqIndent && /^\s*- /.test(line)) {
      cur.argsLines.push(stripListScalar(line))
      continue
    }
    const kv = line.match(/^\s+(\w+):\s*(.*)$/)
    if (kv) {
      const key = kv[1]
      const val = stripQuotes(kv[2].trim())
      if (SKIP_KEYS.has(key)) continue
      if (key === 'args') {
        // Inline array: `args: [...]` -> string. Block sequence: start collecting.
        if (val.length) cur.args = val
        else argsSeqIndent = indent + 2
        continue
      }
      if (key === 'url') {
        cur.url = val
        // Plain http(s) urls are re-emitted from `cur.url` on render, so they
        // must NOT also land in `preserve` (that would duplicate the line and,
        // worse, make a `url` edit get clobbered by the stale preserve line).
        // A `!!js`/process.env expression cannot be re-emitted through
        // safeScalar (the tag would become literal text), so it falls through
        // to `preserve` and is kept verbatim.
        if (!looksLikeExpression(val)) continue
      }
      if (KNOWN_KEYS.has(key)) {
        if (key === 'serverName') cur.serverName = val
        else if (key === 'transport') cur.transport = val
        else if (key === 'command') cur.command = val
        else if (key === 'header') cur.header = val
        continue
      }
    }
    // Anything else (env:, !!js, nested keys) is preserved verbatim.
    cur.preserve += (cur.preserve ? '\n' : '') + line
  }
  if (cur) servers.push(cur)
  return servers
}

// Emit a YAML scalar safely for arbitrary user input. We always use double
// quotes with JSON-style escaping: it is a single line, so it can never
// disturb the surrounding block indentation (a block scalar like `|-` would
// swallow the following lines). Double quotes in YAML accept the same
// \n \t \" \\ escapes as JSON.
function safeScalar(value) {
  const v = value === undefined || value === null ? '' : String(value)
  if (v === '') return "''"
  const escaped = v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
  return '"' + escaped + '"'
}

// Turn a connector args field into a real argument list: a JS/JSON array
// literal string ("['/c', 'npx', ...]") is parsed, anything else is split on
// whitespace. Keeps dsh-mcp-client's schema (args: string[]) satisfied.
function parseArgsValue(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ['']
  if (/^\[.*\]$/s.test(text)) {
    try {
      const arr = JSON.parse(text.replace(/'/g, '"'))
      if (Array.isArray(arr)) return arr.map((x) => String(x))
    } catch {}
  }
  // Quote-aware tokenizer (learned from dsh-mcp-manager's parseArgs): arguments
  // wrapped in "..." or '...' stay intact even when they contain spaces, so
  // e.g. `--header "Authorization: Bearer x"` becomes two argv tokens instead
  // of being split on every whitespace.
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

// dsh-mcp-client only accepts `headers` (an object) on streamable-http. A
// bare `header: "k: v"` line on stdio violates the schema and crashes the next
// boot, so we only render it for http, and only in the map form.
function renderHeader(s) {
  if (!s.header || (s.transport || 'stdio') !== 'streamable-http') return []
  const hm = /^([^:]+):\s*(.*)$/.exec(s.header)
  if (!hm) return []
  const key = hm[1].trim().replace(/"/g, '\\"')
  return [`        headers: { "${key}": ${safeScalar(hm[2].trim())} }`]
}

function renderServer(s) {
  const out = []
  out.push(`    - id: ${safeScalar(s.id)}`)
  out.push(`      name: '@deepseek-ai/dsh-mcp-client'`)
  out.push(`      config:`)
  out.push(`        transport: ${safeScalar(s.transport || 'stdio')}`)
  if (s.serverName) out.push(`        serverName: ${safeScalar(s.serverName)}`)
  // Plain http(s) urls are emitted here; `!!js`/process.env expressions stay
  // in `preserve` and come back verbatim (safeScalar would break the tag).
  if (s.url && !looksLikeExpression(s.url)) out.push(`        url: ${safeScalar(s.url)}`)
  if (s.command) out.push(`        command: ${safeScalar(s.command)}`)
  out.push(...renderHeader(s))
  // args: either a real flow array, or a verbatim block sequence.
  if (s.argsLines && s.argsLines.length) {
    out.push(`        args:`)
    for (const item of s.argsLines) out.push(`          - ${safeScalar(item)}`)
  } else if (s.args) {
    out.push(`        args: [${parseArgsValue(s.args).map(safeScalar).join(', ')}]`)
  }
  if (s.preserve) {
    const trimmed = s.preserve.trimEnd()
    if (trimmed.length) out.push(trimmed)
  }
  return out.join('\n')
}

/**
 * Rebuild the full patch text. `servers` is the desired server list (each may
 * carry a `preserve` string from the original file; callers pass it through so
 * env / !!js lines survive). When no MCP servers remain, the block is dropped.
 */
function buildPatch(text, servers) {
  const found = findMcpBlock(text)
  if (!found) {
    if (!servers.length) return text
    const block =
      `\n# MCP servers managed by @omdp/dsh-connector\n` +
      `- insert:\n` +
      servers.map(renderServer).join('\n') +
      '\n'
    return text.replace(/\n*$/, '\n') + block
  }
  // When every MCP server is removed, drop the whole insert block instead of
  // leaving a bare `- insert:` (that would render as `insert: null` and could
  // break the loader on the next boot).
  if (!servers.length) return found.head + found.tail
  const body = servers.map(renderServer).join('\n') + '\n'
  return found.head + `- insert:\n` + body + found.tail
}

/* ───────────────────────────── Skills ──────────────────────────────────── */

function isAbsent(error) {
  return typeof error === 'object' && error !== null && error.code === 'ENOENT'
}

function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      const yamlText = raw.slice(start, lineStart)
      let data
      try {
        data = parseYaml(yamlText)
      } catch {
        return undefined
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
      const body = raw.slice(lineEnd + 1).replace(/^\r?\n/, '')
      return { data, body }
    }
    lineStart = nextNewline < 0 ? raw.length + 1 : nextNewline + 1
  }
  return undefined
}

function serializeSkill(skill) {
  const fm = { name: skill.name }
  if (skill.description !== undefined) fm.description = skill.description
  if (skill.whenToUse !== undefined) fm.whenToUse = skill.whenToUse
  if (skill.modelInvocable !== undefined) fm.modelInvocable = skill.modelInvocable
  if (skill.userInvocable !== undefined) fm.userInvocable = skill.userInvocable
  // Marketplace provenance: set by "record source" in the UI, consumed by the
  // update check (compares market file_last_modified against sourceUpdated).
  if (skill.source !== undefined) fm.source = skill.source
  if (skill.sourceUpdated !== undefined) fm.sourceUpdated = skill.sourceUpdated
  const head = '---\n' + stringifyYaml(fm) + '---\n'
  return head + (skill.content || '')
}

async function readUserSkill(home, name) {
  const path = join(skillsRoot(), name, 'SKILL.md')
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isAbsent(error)) return undefined
    throw error
  }
  const fm = parseFrontmatter(raw)
  if (!fm) return { name, description: '', content: raw }
  return {
    name: fm.data.name ?? name,
    description: fm.data.description ?? '',
    whenToUse: fm.data.whenToUse,
    modelInvocable: fm.data.modelInvocable,
    userInvocable: fm.data.userInvocable,
    // Marketplace provenance survives read so edits keep it unless replaced.
    source: fm.data.source,
    sourceUpdated: fm.data.sourceUpdated,
    content: fm.body,
  }
}

async function listUserSkills() {
  const root = skillsRoot()
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isAbsent(error)) return []
    throw error
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skill = await readUserSkill(resolveHome(), entry.name)
    if (skill) out.push({ name: skill.name, description: skill.description || '', source: skill.source, sourceUpdated: skill.sourceUpdated })
  }
  return out
}

async function saveUserSkill(home, skill) {
  if (!SKILL_NAME.test(skill.name)) {
    throw new Error(`invalid skill name "${skill.name}" (kebab-case only)`)
  }
  // A bare `---` line inside the body would be mistaken for the frontmatter
  // terminator on read and truncate the skill. Reject it up front.
  if (skill.content && /(^|\n)\s*---\s*(\n|$)/.test(skill.content)) {
    throw new Error('skill content must not contain a standalone "---" line')
  }
  // Keep marketplace provenance when an edit does not carry it: the editor
  // round-trips content only, so dropping source here would silently sever
  // the update-check link on every save.
  const existing = await readUserSkill(home, skill.name).catch(() => undefined)
  const merged = {
    ...skill,
    source: skill.source !== undefined ? skill.source : existing?.source,
    sourceUpdated: skill.sourceUpdated !== undefined ? skill.sourceUpdated : existing?.sourceUpdated,
  }
  const dir = join(skillsRoot(), skill.name)
  const file = join(dir, 'SKILL.md')
  const serialized = serializeSkill(merged)
  // Round-trip check: the file we are about to write must parse back into a
  // valid skill (name + at least one closing delimiter). If not, refuse.
  if (!parseFrontmatter(serialized)) {
    throw new Error('generated SKILL.md is not valid (frontmatter missing or unterminated)')
  }
  await mkdir(dir, { recursive: true })
  await writeFile(file, serialized, 'utf8')
  return { path: file }
}

async function removeUserSkill(home, name) {
  if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`)
  await rm(join(skillsRoot(), name), { recursive: true, force: true })
}

/* ──────────────────── ModelScope marketplace proxy ───────────────────────
 * Read-only browsing of the ModelScope Skills Center and MCP Plaza. All
 * market data lives in a 30-minute in-process cache — nothing is written to
 * disk, no files ever accumulate, and a restart clears it. Install / deploy
 * are NOT performed: the UI only lists entries and copies install commands /
 * server config for the user to run themselves. Browsing uses anonymous
 * endpoints; no MODELSCOPE_API_KEY is required.
 * ───────────────────────────────────────────────────────────────────────── */

const MARKET_BASE = process.env.DSH_CONNECTOR_MARKET ?? 'https://modelscope.cn/openapi/v1'
const MARKET_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
const MARKET_TTL = 30 * 60 * 1000 // 30 minutes in-process cache
const marketCache = new Map()

async function marketFetch(key, path, init) {
  const hit = marketCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < MARKET_TTL) return hit.value
  const res = await fetch(MARKET_BASE + path, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`market returned HTTP ${res.status}`)
  const data = await res.json()
  marketCache.set(key, { at: Date.now(), value: data })
  return data
}

function marketError(res, error) {
  return json(res, 502, { error: `market unavailable: ${String(error?.message ?? error)}` })
}

/* ── ModelScope dolphin MCP API (the engine behind modelscope.cn/mcp) ──────
 *
 * The official plaza is a SPA whose data endpoint is
 *   PUT https://www.modelscope.cn/api/v1/dolphin/mcpServers
 * with body { PageSize, PageNumber, Query, Criterion } where category
 * filtering is  Criterion: [{ Category:'Category', Predicate:'contains',
 * StringValues:[categoryId] }]. The response carries
 *   Data.McpServer.{McpServers[], TotalCount}   — paged list + exact total
 *   Data.FiledAgg.Category                      — every category + exact count
 * (this is what the sidebar numbers on the official site are).
 *
 * The endpoint sits behind an Alibaba WAF JS challenge (acw_sc__v2). A plain
 * server request gets a challenge page back; the cookie is produced by
 * executing that page. We run it in jsdom (deterministic, no browser needed)
 * and cache the cookie for 30 minutes (the WAF's own max-age is 3600s).
 */
const DOLPHIN_URL = 'https://www.modelscope.cn/api/v1/dolphin/mcpServers'
const WAF_TTL = 30 * 60 * 1000
const dolphinCache = new Map()
let wafCookie = null // { value, at }

// Solve the acw_sc__v2 cookie by executing the challenge page in jsdom. The
// challenge HTML arrives as the body of the WAF-blocked request itself (the
// SPA shell on /mcp is NOT a challenge page and yields no cookie).
async function solveWafFromChallenge(html) {
  if (wafCookie && Date.now() - wafCookie.at < WAF_TTL) return wafCookie.value
  const vc = new VirtualConsole()
  vc.on('jsdomError', () => {}) // jsdom navigation is not implemented — that is expected here
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'https://www.modelscope.cn/',
    beforeParse(window) {
      for (const k of ['reload', 'replace', 'assign']) {
        try { Object.defineProperty(window.location, k, { configurable: true, writable: true, value: () => {} }) } catch { /* noop */ }
      }
      window.open = () => null
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const cookie = dom.window.document.cookie.match(/acw_sc__v2=([^;]+)/)
  dom.window.close()
  if (!cookie) throw new Error('WAF challenge did not yield a cookie')
  wafCookie = { value: cookie[1], at: Date.now() }
  return wafCookie.value
}

async function dolphinPut(body) {
  const key = 'dolphin?' + JSON.stringify(body)
  const hit = dolphinCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < MARKET_TTL) return hit.value
  const attempt = async (cookie) => {
    const res = await fetch(DOLPHIN_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'user-agent': MARKET_UA, ...(cookie ? { cookie: `acw_sc__v2=${cookie}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (text.includes('acw_sc__v2') || text.includes('aliyunwaf')) return { challenge: text }
    if (!res.ok) throw new Error(`dolphin returned HTTP ${res.status}`)
    return JSON.parse(text)
  }
  // First try with the cached cookie; on a challenge page, solve from its HTML
  // and retry exactly once with the fresh cookie.
  let data = await attempt(wafCookie && Date.now() - wafCookie.at < WAF_TTL ? wafCookie.value : undefined)
  if (data && data.challenge) {
    wafCookie = null
    const fresh = await solveWafFromChallenge(data.challenge)
    data = await attempt(fresh)
    if (data && data.challenge) throw new Error('WAF challenge loop (every attempt blocked)')
  }
  if (!data) throw new Error('dolphin request failed')
  dolphinCache.set(key, { at: Date.now(), value: data })
  return data
}

// Skill ids come back as `@author/name` and appear in URLs verbatim. Only
// accept the safe alphabet so a crafted id can never escape the path.
const MARKET_ID = /^@?[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/

// GET /api/market/skills?search=&category=&page=
async function marketSkillsList(req, res, params) {
  const search = params.get('search')?.trim()
  const category = params.get('category')?.trim()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const qs = new URLSearchParams({ page_number: String(page), page_size: '50' })
  if (search) qs.set('search', search)
  if (category) qs.set('filter.category', category)
  let data
  try {
    data = await marketFetch(`skills?${qs}`, `/skills?${qs}`)
  } catch (error) {
    return marketError(res, error)
  }
  const local = await listUserSkills().catch(() => [])
  const items = (data?.data?.skills ?? []).map((s) => ({
    id: s.id,
    name: s.display_name,
    description: s.description,
    developer: s.developer,
    category: s.category,
    license: s.license,
    views: s.view_count,
    downloads: s.downloads,
    source: s.source_url,
    logo: s.logo_url,
    installed: local.some((l) => l.source === s.id),
  }))
  const total = Number(data?.data?.total) || items.length
  return json(res, 200, { ok: true, items, total, page, hasMore: page * 50 < total })
}

// GET /api/market/skills/:id  (id is `@author/name`, may contain a slash)
async function marketSkillDetail(res, id) {
  let data
  try {
    data = await marketFetch(`skills/${id}`, `/skills/${id}`)
  } catch (error) {
    return marketError(res, error)
  }
  const d = data?.data ?? {}
  const local = (await listUserSkills().catch(() => [])).find((l) => l.source === id)
  let updateAvailable = false
  if (local && d.file_last_modified && local.sourceUpdated) {
    updateAvailable = new Date(d.file_last_modified).getTime() > new Date(local.sourceUpdated).getTime()
  }
  return json(res, 200, {
    ok: true,
    item: {
      id: d.id,
      name: d.display_name,
      description: d.description,
      owner: d.owner || d.developer,
      developer: d.developer,
      category: d.category,
      license: d.license,
      tags: Array.isArray(d.tags) ? d.tags.filter((t) => !t.startsWith('category:') && !t.startsWith('developer:') && !t.startsWith('custom_tag:')) : [],
      views: d.view_count,
      downloads: d.downloads,
      source: d.source_url,
      logo: d.logo_url,
      private: d.private === true,
      installCommand: Array.isArray(d.install_command) ? d.install_command : [],
      fileModified: d.file_last_modified ?? null,
      lastModified: d.last_modified ?? null,
      updateAvailable,
      localSkill: local ? { name: local.name, sourceUpdated: local.sourceUpdated ?? null } : null,
    },
  })
}

// GET /api/market/mcp?search=&category=&page=
async function marketMcpList(req, res, params) {
  const search = params.get('search')?.trim() ?? ''
  const category = params.get('category')?.trim()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const body = {
    PageSize: 30,
    PageNumber: page,
    Query: search,
    Criterion: category ? [{ Category: 'Category', Predicate: 'contains', StringValues: [category] }] : [],
  }
  let data
  try {
    data = await dolphinPut(body)
  } catch (error) {
    return marketError(res, error)
  }
  // "configured" = already present in the local patch's mcp-* block (matched
  // by the server's own id/args/url text appearing in a local entry).
  let localMatches = []
  try {
    const text = await readFile(patchPath(), 'utf8')
    const found = findMcpBlock(text)
    if (found) {
      const configured = parseMcpServers(found.blockText).map((s) => (s.command + ' ' + (Array.isArray(s.args) ? s.args.join(' ') : s.args || '') + ' ' + (s.url || '')).toLowerCase())
      localMatches = configured.filter(Boolean)
    }
  } catch {
    // patch missing/unreadable: no configured markers, market still works
  }
  const servers = data?.Data?.McpServer?.McpServers ?? []
  const items = servers.map((s) => ({
    id: s.Publisher, // `@author/name` — same shape the detail endpoint expects
    name: s.ChineseName || s.Name || s.Publisher,
    description: s.AbstractCN || s.Abstract || '',
    publisher: s.Publisher,
    tags: Array.isArray(s.Tags) ? s.Tags : [],
    logo: s.FromSiteIcon || '',
    views: s.ViewCount,
    stars: s.Stars,
    license: s.License || '',
    hosted: !!s.Hosted,
    verified: !!s.Verifed,
    categories: Array.isArray(s.Category) ? s.Category : [],
    configured: localMatches.some((local) => typeof s.Publisher === 'string' && local.includes(s.Publisher.toLowerCase())),
  }))
  const total = Number(data?.Data?.McpServer?.TotalCount) || items.length
  const categories = (data?.Data?.FiledAgg?.Category ?? [])
    .map((c) => ({ id: String(c.Value), count: Number(c.Count) || 0 }))
    .filter((c) => c.id)
  return json(res, 200, { ok: true, items, total, page, pageSize: 30, hasMore: page * 30 < total, categories })
}

// Reduce a JSONSchema env block to its variable list (never ship the raw
// schema wholesale — it can be large and contains no browsing value).
function envSchemaSummary(schema) {
  if (!schema || typeof schema !== 'object' || !schema.properties || typeof schema.properties !== 'object') return undefined
  const required = Array.isArray(schema.required) ? schema.required : []
  return Object.entries(schema.properties).map(([key, v]) => ({
    key,
    required: required.includes(key),
    hint: typeof v === 'object' && v ? (v.title || v.description || '') : '',
  }))
}

// GET /api/market/mcp/:id
async function marketMcpDetail(res, id) {
  let data
  try {
    data = await marketFetch(`mcp/${id}`, `/mcp/servers/${id}`)
  } catch (error) {
    return marketError(res, error)
  }
  const d = data?.data ?? {}
  return json(res, 200, {
    ok: true,
    item: {
      id: d.id,
      name: d.chinese_name || d.name,
      description: d.description,
      author: d.author,
      publisher: d.publisher,
      owner: d.owner,
      hosted: d.is_hosted === true, // "Hosted" tick on the plaza page
      verified: d.is_verified === true, // certification tick
      stars: d.github_stars,
      source: d.source_url,
      logo: d.logo_url,
      categories: d.categories,
      tags: d.tags,
      envSchema: envSchemaSummary(d.env_schema),
      // server_config holds ready-to-paste { mcpServers: {...} } variants.
      serverConfig: Array.isArray(d.server_config) ? d.server_config : undefined,
      readme: typeof d.readme === 'string' ? d.readme.slice(0, 2000) : '',
    },
  })
}

// GET /api/skills/check-updates
// For every installed skill that carries a `source`, pull the market detail
// (cache-backed) and compare its file_last_modified against the locally
// recorded sourceUpdated. No files are touched.
async function checkSkillUpdates(res) {
  const local = (await listUserSkills().catch(() => [])).filter((s) => s.source)
  const out = []
  for (const skill of local) {
    const id = skill.source
    let marketModified = null
    let updateAvailable = false
    try {
      const data = await marketFetch(`skills/${id}`, `/skills/${id}`)
      marketModified = data?.data?.file_last_modified ?? null
      if (marketModified && skill.sourceUpdated) {
        updateAvailable = new Date(marketModified).getTime() > new Date(skill.sourceUpdated).getTime()
      }
    } catch {
      // market unreachable: report the entry without an update verdict
    }
    out.push({
      name: skill.name,
      source: id,
      sourceUpdated: skill.sourceUpdated ?? null,
      marketModified,
      updateAvailable,
    })
  }
  return json(res, 200, { ok: true, items: out })
}

// POST /api/skills/:name/source  { marketId, modified }
// Links an installed skill to its marketplace entry by writing `source` and
// `sourceUpdated` into that skill's own frontmatter — the only disk write in
// the whole market feature, and it happens only on an explicit user action.
async function recordSkillSource(res, name, body) {
  if (!SKILL_NAME.test(name)) return json(res, 400, { error: 'invalid skill name' })
  const marketId = typeof body?.marketId === 'string' && MARKET_ID.test(body.marketId) ? body.marketId : null
  if (!marketId) return json(res, 400, { error: 'invalid marketId (expect @author/name)' })
  const skill = await readUserSkill(resolveHome(), name)
  if (!skill) return json(res, 404, { error: 'skill not found' })
  skill.source = marketId
  skill.sourceUpdated = typeof body.modified === 'string' && body.modified ? body.modified : new Date().toISOString().slice(0, 19) + 'Z'
  await saveUserSkill(resolveHome(), skill)
  return json(res, 200, { ok: true, source: marketId })
}

/* ─────────────────────── MCP server validation ─────────────────────────
 * The authoritative gate between the UI and the patch file: every field the
 * user can type is checked against the exact contract dsh-mcp-client enforces
 * at boot (transport enum, serverName pattern) plus the OS-level constraints
 * that make a stdio spawn actually work (command must resolve to something
 * executable; no spaces/quotes that would break the cmd command line) and the
 * streamable-http contract (url must parse as an http(s) URL). A value that
 * fails here would either crash the next boot (schema reject) or spam cmd
 * errors ('a' is not recognized...) — both are rejected before writing.
 * ────────────────────────────────────────────────────────────────────────── */

// A `!!js` url expression (e.g. `!!js (process.env.X || '') && ('https://...')`)
// is evaluated by the harness at activation, so its raw text cannot be URL
// checked. Anything that looks like an expression is exempted.
function looksLikeExpression(value) {
  const text = String(value ?? '').trim()
  return text.startsWith('!!js') || text.includes('process.env') || text.includes('&&') || text.startsWith('(')
}

// Windows has no `which`; PATH lookup mirrors cmd's own resolution. A
// path-like command (contains a separator or a known script/exec extension)
// must exist on disk instead — `where` would not resolve a bare `.js`.
function commandResolvable(command) {
  if (/[\\/]/.test(command) || /\.(js|mjs|cjs|cmd|bat|exe|ps1|py)$/i.test(command)) {
    return existsSync(command)
  }
  if (process.platform === 'win32') {
    const r = spawnSync('where', [command], { stdio: 'ignore' })
    return r.status === 0
  }
  const r = spawnSync('which', [command], { stdio: 'ignore' })
  return r.status === 0
}

// One string field shared by every server entry; returns the first problem.
function checkScalar(label, value) {
  if (typeof value !== 'string') return `${label} must be a string`
  if (CONTROL_CHARS.test(value)) return `${label} must not contain control characters`
  return null
}

// Full validation for one server object (raw from the request body). Returns
// an array of human-readable problems; empty means it is safe to write.
function validateServer(s) {
  const problems = []
  const id = String(s.id ?? '')
  if (!MCP_ID_RE.test(id)) {
    problems.push(`invalid server id ${JSON.stringify(id)} (must be mcp-<kebab-case>, e.g. mcp-github)`)
  }
  const transport = String(s.transport ?? 'stdio')
  if (!TRANSPORTS.has(transport)) {
    problems.push(`server ${JSON.stringify(id)}: transport ${JSON.stringify(transport)} is not supported (use stdio or streamable-http)`)
  }
  const name = String(s.serverName ?? '')
  if (!SERVER_NAME_RE.test(name)) {
    problems.push(`server ${JSON.stringify(id)}: serverName ${JSON.stringify(name)} must match ${String(SERVER_NAME_RE)} (harness contract)`)
  }
  for (const [label, key] of [['command', 'command'], ['url', 'url'], ['header', 'header'], ['args', 'args']]) {
    if (typeof s[key] === 'string') {
      const problem = checkScalar(`${JSON.stringify(id)}.${label}`, s[key])
      if (problem) problems.push(problem)
    }
  }
  if (transport === 'stdio') {
    const command = String(s.command ?? '')
    if (!command.trim()) {
      problems.push(`server ${JSON.stringify(id)}: command is required for stdio transport`)
    } else if (/\s|['"]/.test(command)) {
      problems.push(`server ${JSON.stringify(id)}: command must be a single token (no spaces or quotes), e.g. node or npx`)
    } else if (!commandResolvable(command)) {
      problems.push(`server ${JSON.stringify(id)}: command ${JSON.stringify(command)} not found — check the name or the full path`)
    }
  }
  if (transport === 'streamable-http') {
    const url = String(s.url ?? '')
    if (!url.trim()) {
      problems.push(`server ${JSON.stringify(id)}: url is required for streamable-http transport`)
    } else if (!looksLikeExpression(url)) {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          problems.push(`server ${JSON.stringify(id)}: url must be http(s)`)
        }
      } catch {
        problems.push(`server ${JSON.stringify(id)}: url ${JSON.stringify(url)} is not a valid URL`)
      }
    }
  }
  return problems
}

/* ─────────────────────────── HTTP API ──────────────────────────────────── */

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return {}
  }
}

export function apply(ctx) {
  // ── 工具过滤三件套之 (0)：settings namespace 注册 + 快照缓存 ──
  // settings 服务可选（无 provider 时 ctx.inject 回调不跑，过滤保持全放行）。
  let toolFilters = {}
  const refreshFilters = () => { toolFilters = readToolFilters(ctx) }
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(CONNECTOR_SETTINGS_NS, ToolFilterSchema, { base: { toolFilters: {} } })
    refreshFilters()
    settingsCtx.effect(() => settingsCtx.settings.watch(() => refreshFilters()), 'connector: watch tool filters')
  })

  // ── 三件套之 (1)：prompt 层过滤 —— 被滤掉的工具不进模型 schema ──
  // tools provider 在每次 assembly 时求值，读最新快照；无 tools/systemPrompt
  // 服务时跳过（ctx.get 可选读，失败隔离：connector 照常提供设置页）。
  try {
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt && typeof systemPrompt.tools === 'function') {
      ctx.effect(() => systemPrompt.tools(() => {
        let schemas = []
        try {
          const tools = ctx.get('tools')
          schemas = tools ? tools.schemas() : []
        } catch { return { schemas: [] } }
        const kept = schemas.filter((s) => isToolAllowed(toolFilters, s && s.name))
        return { schemas: kept, knownNames: schemas.map((s) => s && s.name).filter(Boolean) }
      }), 'connector: mcp tool filter provider')
    }
  } catch {}
  // ── 三件套之 (2)：执行期硬拦截 —— 补 provider 漏网（如 guard 注册时序）──
  try {
    const tools = ctx.get('tools')
    if (tools && typeof tools.guard === 'function') {
      ctx.effect(() => tools.guard((exec) => {
        if (!exec || typeof exec.name !== 'string') return undefined
        if (isToolAllowed(toolFilters, exec.name)) return undefined
        const split = splitPublicName(exec.name)
        return `connector: 工具 ${exec.name} 已被过滤（server "${split ? split.server : '?'}” 的 allow 列表未包含它）`
      }), 'connector: mcp tool filter guard')
    }
  } catch {}

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    try {
      if (!path.startsWith(API_PREFIX)) { res.writeHead(404); res.end(); return }

      // GET /api/mcp — list server entries (with preserve buckets)
      if (req.method === 'GET' && path === API_PREFIX + '/mcp') {
        let text
        try {
          text = await readFile(patchPath(), 'utf8')
        } catch (error) {
          if (isAbsent(error)) return json(res, 200, { servers: [], exists: false })
          throw error
        }
        const found = findMcpBlock(text)
        const servers = found ? parseMcpServers(found.blockText) : []
        return json(res, 200, { servers, exists: true, version: '0.1.1' })
      }

      // POST /api/mcp — replace server entries. Preserve env/!!js from the
      // existing entry with the same id so edits never drop credentials.
      if (req.method === 'POST' && path === API_PREFIX + '/mcp') {
        const body = await readBody(req)
        if (!Array.isArray(body.servers)) {
          return json(res, 400, { error: 'malformed request body: servers must be an array' })
        }
        // Authoritative validation gate: any problem (bad transport, invalid
        // serverName, unresolvable command, invalid url, control characters)
        // rejects the whole save with a specific message BEFORE it reaches the
        // patch — a bad entry would crash the next boot, so it must never be
        // written.
        for (const s of body.servers) {
          const problems = validateServer(s)
          if (problems.length) {
            return json(res, 400, { error: problems.join('; ') })
          }
        }
        let text
        try {
          text = await readFile(patchPath(), 'utf8')
        } catch (error) {
          if (isAbsent(error)) text = '# Managed by @omdp/dsh-connector\n[]\n'
          else throw error
        }
        const existing = new Map()
        const found = findMcpBlock(text)
        if (found) for (const s of parseMcpServers(found.blockText)) existing.set(s.id, s)
        const servers = body.servers.map((s) => {
          const prev = existing.get(s.id)
          return prev ? { ...s, preserve: s.preserve || prev.preserve } : s
        })
        const next = buildPatch(text, servers)
        // Validate the entire resulting patch parses as YAML before writing.
        // cordis.patch.yml uses `!!js` tags; the parser tolerates them via
        // silent log level (values stay raw, nothing printed), so a successful
        // parse here means DSH can load it too. If it does NOT parse, refuse
        // to write — better to reject the edit than crash dsh on next boot.
        try {
          parseYaml(next, { logLevel: 'silent' })
        } catch (err) {
          return json(res, 422, { ok: false, error: 'generated patch is not valid YAML: ' + (err && err.message ? err.message : String(err)) })
        }
        await mkdir(dirname(patchPath()), { recursive: true })
        // Atomic replace: write to a temp file, then rename over the original
        // so a crash mid-write cannot leave a half-written patch behind.
        const target = patchPath()
        const tmp = target + '.tmp'
        await writeFile(tmp, next, 'utf8')
        await rename(tmp, target)
        return json(res, 200, { ok: true })
      }

      // GET /api/mcp/tools/:serverName — 该 server 当前注册的工具公开名
      // （供 UI 渲染 allow 多选框；server 未连接/无工具时返回空列表）。
      const toolsMatch = path.match(new RegExp('^' + API_PREFIX + '/mcp/tools/([^/]+)$'))
      if (req.method === 'GET' && toolsMatch) {
        const serverName = decodeURIComponent(toolsMatch[1])
        if (!SERVER_NAME_RE.test(serverName)) return json(res, 400, { error: 'invalid server name' })
        let names = []
        try {
          const tools = ctx.get('tools')
          const schemas = tools ? tools.schemas() : []
          names = schemas.map((s) => s && s.name).filter((n) => {
            const split = splitPublicName(n)
            return split && split.server === serverName
          })
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error).slice(0, 200) })
        }
        const filters = readToolFilters(ctx)
        const rule = filters[serverName]
        return json(res, 200, { server: serverName, tools: names.sort(), allow: rule ? rule.allow : [] })
      }

      // GET /api/mcp/filters — 全部 server 的过滤规则（UI 批量展示用）
      if (req.method === 'GET' && path === API_PREFIX + '/mcp/filters') {
        return json(res, 200, { filters: readToolFilters(ctx) })
      }

      // PUT /api/mcp/filters — 保存过滤规则 → settings.yaml `connector:` 节
      // body: { filters: { <serverName>: { allow: [rawTool,...] } } }。
      // 空 allow = 全量放行（删除该 server 规则与显式空列表等价）。
      if (req.method === 'PUT' && path === API_PREFIX + '/mcp/filters') {
        const body = await readBody(req)
        const incoming = body && typeof body === 'object' && !Array.isArray(body) ? body.filters : undefined
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          return json(res, 400, { error: 'malformed request body: filters must be an object' })
        }
        const clean = {}
        for (const [server, rule] of Object.entries(incoming)) {
          if (!SERVER_NAME_RE.test(server)) {
            return json(res, 400, { error: `invalid server name ${JSON.stringify(server)}` })
          }
          const allow = rule && Array.isArray(rule.allow) ? rule.allow : []
          for (const t of allow) {
            if (typeof t !== 'string' || !t.length || CONTROL_CHARS.test(t) || /\s/.test(t)) {
              return json(res, 400, { error: `invalid tool name ${JSON.stringify(t)} for server ${JSON.stringify(server)}` })
            }
          }
          if (allow.length) clean[server] = { allow: [...new Set(allow)].sort() }
        }
        try {
          const settings = ctx.get('settings')
          if (!settings) return json(res, 503, { error: 'settings service unavailable' })
          await settings.update(CONNECTOR_SETTINGS_NS, { toolFilters: clean })
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error).slice(0, 300) })
        }
        refreshFilters()
        return json(res, 200, { ok: true, filters: readToolFilters(ctx) })
      }

      // GET /api/skills — list
      if (req.method === 'GET' && path === API_PREFIX + '/skills') {
        const skills = await listUserSkills()
        return json(res, 200, { skills })
      }

      // PUT /api/skills — save
      if (req.method === 'PUT' && path === API_PREFIX + '/skills') {
        const body = await readBody(req)
        // Guard against malformed bodies (readBody falls back to {} on bad
        // JSON): without this, `name` could be undefined and, matching the
        // kebab-case regex as the string "undefined", create a junk skill.
        if (typeof body !== 'object' || body === null || Array.isArray(body) || typeof body.name !== 'string') {
          return json(res, 400, { error: 'malformed request body: skill name (string) is required' })
        }
        const written = await saveUserSkill(resolveHome(), body)
        return json(res, 200, { ok: true, path: written.path })
      }

      // GET /api/skills/check-updates — update hints for sourced skills
      if (req.method === 'GET' && path === API_PREFIX + '/skills/check-updates') {
        return checkSkillUpdates(res)
      }

      // POST /api/skills/:name/source — link an installed skill to a market id
      const srcMatch = path.match(new RegExp('^' + API_PREFIX + '/skills/([^/]+)/source$'))
      if (req.method === 'POST' && srcMatch) {
        const body = await readBody(req)
        return recordSkillSource(res, decodeURIComponent(srcMatch[1]), body)
      }

      /* ── marketplace (read-only ModelScope proxy) ── */

      // GET /api/market/skills?search=&category=&page=
      if (req.method === 'GET' && path === API_PREFIX + '/market/skills') {
        return marketSkillsList(req, res, new URL(req.url, 'http://localhost').searchParams)
      }

      // GET /api/market/skills/:id  (id `@author/name` contains a slash)
      const mktSkill = path.match(new RegExp('^' + API_PREFIX + '/market/skills/(.+)$'))
      if (req.method === 'GET' && mktSkill) {
        const id = decodeURIComponent(mktSkill[1])
        if (!MARKET_ID.test(id)) return json(res, 400, { error: 'invalid market id' })
        return marketSkillDetail(res, id)
      }

      // GET /api/market/mcp?search=&page=
      if (req.method === 'GET' && path === API_PREFIX + '/market/mcp') {
        return marketMcpList(req, res, new URL(req.url, 'http://localhost').searchParams)
      }

      // GET /api/market/mcp/:id
      const mktMcp = path.match(new RegExp('^' + API_PREFIX + '/market/mcp/(.+)$'))
      if (req.method === 'GET' && mktMcp) {
        const id = decodeURIComponent(mktMcp[1])
        if (!MARKET_ID.test(id)) return json(res, 400, { error: 'invalid market id' })
        return marketMcpDetail(res, id)
      }

      const skMatch = path.match(new RegExp('^' + API_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/skills/([^/]+)$'))

      // GET /api/skills/:name — get one
      if (req.method === 'GET' && skMatch) {
        const name = decodeURIComponent(skMatch[1])
        // Validate before touching the filesystem: a crafted `..%2F..%2F`
        // name could otherwise escape ~/.dsh/skills and read arbitrary files.
        if (!SKILL_NAME.test(name)) return json(res, 400, { error: 'invalid skill name' })
        const skill = await readUserSkill(resolveHome(), name)
        if (!skill) return json(res, 404, { error: 'skill not found' })
        return json(res, 200, skill)
      }

      // DELETE /api/skills/:name — remove
      if (req.method === 'DELETE' && skMatch) {
        const name = decodeURIComponent(skMatch[1])
        if (!SKILL_NAME.test(name)) return json(res, 400, { error: 'invalid skill name' })
        await removeUserSkill(resolveHome(), name)
        return json(res, 200, { ok: true })
      }

      res.writeHead(404)
      res.end()
    } catch (error) {
      const logger = ctx.get('logger')
      if (logger && typeof logger.error === 'function') logger.error(`connector api: ${error?.stack ?? error}`)
      json(res, 500, { error: String(error?.message ?? error).slice(0, 300) })
    }
  }

  const handle = ctx.webServer.register({ kind: 'prefix', path: '/connector', handler: route })
  ctx.effect(() => handle)
}
