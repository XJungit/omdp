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
    if (argsSeqIndent >= 0 && indent >= argsSeqIndent && /^\s*- /.test(line)) {
      cur.argsLines.push(line.trim())
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
  return text.split(/\s+/).filter(Boolean)
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
    for (const item of s.argsLines) out.push(`          ${item}`)
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
    if (skill) out.push({ name: skill.name, description: skill.description || '' })
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
  const dir = join(skillsRoot(), skill.name)
  const file = join(dir, 'SKILL.md')
  const serialized = serializeSkill(skill)
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
        return json(res, 200, { servers, exists: true })
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
