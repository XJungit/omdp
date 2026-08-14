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

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const API_PREFIX = '/connector/api'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const inject = ['webServer']

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
    if (/\n\s*- id:\s*mcp-/.test(blockText)) {
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

const KNOWN_KEYS = new Set(['transport', 'serverName', 'url', 'command', 'args', 'header'])

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
  for (const line of lines) {
    const idm = line.match(/^(\s*)- id:\s*(mcp-\S+)\s*$/)
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
        header: '',
        preserve: '',
      }
      curIndent = idm[1].length
      continue
    }
    if (!cur) continue
    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1].length : 0
    if (line.trim().length === 0) continue
    // A sibling server at the same indent ends this entry.
    if (indent === curIndent && /^- id:/.test(line)) continue
    if (indent <= curIndent) {
      // Left the config entirely: flush the current entry before dropping it.
      if (cur) { servers.push(cur); cur = null }
      continue
    }
    const kv = line.match(/^\s+(\w+):\s*(.*)$/)
    if (kv) {
      const key = kv[1]
      const val = stripQuotes(kv[2].trim())
      if (KNOWN_KEYS.has(key)) {
        if (key === 'serverName') cur.serverName = val
        else if (key === 'transport') cur.transport = val
        else if (key === 'url') cur.url = val
        else if (key === 'command') cur.command = val
        else if (key === 'args') cur.args = val
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

function renderServer(s) {
  const out = []
  out.push(`    - id: ${s.id}`)
  out.push(`      name: '@deepseek-ai/dsh-mcp-client'`)
  out.push(`      config:`)
  out.push(`        transport: ${s.transport || 'stdio'}`)
  if (s.serverName) out.push(`        serverName: ${s.serverName}`)
  if (s.url) out.push(`        url: ${s.url}`)
  if (s.command) out.push(`        command: ${s.command}`)
  if (s.args) out.push(`        args: ${s.args}`)
  if (s.header) out.push(`        header: ${s.header}`)
  if (s.preserve) {
    const trimmed = s.preserve.trimEnd()
    if (trimmed.length) out.push(trimmed)
  }
  out.push(`        toolCallTimeoutMs: 60000`)
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
      `\n# MCP servers managed by dsh-connector\n` +
      `- insert:\n` +
      servers.map(renderServer).join('\n') +
      '\n'
    return text.replace(/\n*$/, '\n') + block
  }
  const blockHead = `- insert:\n`
  const body = servers.length ? servers.map(renderServer).join('\n') + '\n' : ''
  return found.head + blockHead + body + found.tail
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
  const dir = join(skillsRoot(), skill.name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), serializeSkill(skill), 'utf8')
  return { path: join(dir, 'SKILL.md') }
}

async function removeUserSkill(home, name) {
  if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`)
  await rm(join(skillsRoot(), name), { recursive: true, force: true })
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
        const incoming = Array.isArray(body.servers) ? body.servers : []
        let text
        try {
          text = await readFile(patchPath(), 'utf8')
        } catch (error) {
          if (isAbsent(error)) text = '# Managed by dsh-connector\n[]\n'
          else throw error
        }
        const existing = new Map()
        const found = findMcpBlock(text)
        if (found) for (const s of parseMcpServers(found.blockText)) existing.set(s.id, s)
        const servers = incoming.map((s) => {
          const prev = existing.get(s.id)
          return prev ? { ...s, preserve: s.preserve || prev.preserve } : s
        })
        const next = buildPatch(text, servers)
        await mkdir(dirname(patchPath()), { recursive: true })
        await writeFile(patchPath(), next, 'utf8')
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
        const written = await saveUserSkill(resolveHome(), body)
        return json(res, 200, { ok: true, path: written.path })
      }

      const skMatch = path.match(new RegExp('^' + API_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/skills/([^/]+)$'))

      // GET /api/skills/:name — get one
      if (req.method === 'GET' && skMatch) {
        const name = decodeURIComponent(skMatch[1])
        const skill = await readUserSkill(resolveHome(), name)
        if (!skill) return json(res, 404, { error: 'skill not found' })
        return json(res, 200, skill)
      }

      // DELETE /api/skills/:name — remove
      if (req.method === 'DELETE' && skMatch) {
        const name = decodeURIComponent(skMatch[1])
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
