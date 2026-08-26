// @omdp/dsh-key-fallback — Host half (ESM, v5)
//
// v5 = v1 核心功能全量恢复（预写 + 失败标记 + 顺序配置）+ v4 的 CRUD 与极简配置：
//   - 配置来源 = ~/.dsh/settings.yaml 的 key-fallback.providers[*]
//   - agent/request 预写：每次请求把池当前 key 写入 env + credentials（v1 行为）
//   - agent/request-error：标记失败的 key（failCount/cooldown/status/lastError）并按 nextRef 顺序切下一个
//   - 每个 key 可配置 nextRef（失败后跳转到指定 key），UI 可直接配置轮换顺序
//   - GET /pools 返回每个 key 的实时状态（status/failCount/cooldownRemaining/lastError），UI 展示
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { load as loadYaml, dump as dumpYaml } from 'js-yaml'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
// 当前版本 @deepseek-ai/dsh-credentials 只导出 credentialRef，不再导出
// isCredentialRefName。按官方 REF_PATTERN（POSIX 标识符）在本地板实现，保持兼容。
function isCredentialRefName(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

export const name = 'key-fallback'
export const inject = ['llm', 'settings', 'webServer', 'credentials']
const API_BASE = '/dsh-key-fallback'
const SETTINGS_FILE = join(homedir(), '.dsh', 'settings.yaml')
const CRED_FILE = join(homedir(), '.dsh', '.credentials.yaml')
const BACKUP_DIR = join(homedir(), '.dsh', 'backups')
if (!existsSync(BACKUP_DIR)) try { mkdirSync(BACKUP_DIR, { recursive: true }) } catch (e) {}
let _backupCounter = 0
function tsName(prefix) {
  const d = new Date()
  const ts = d.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return prefix + '_' + ts + '_' + (++_backupCounter)
}
function backupFile(file, prefix) {
  try {
    if (!existsSync(file)) return
    const dest = BACKUP_DIR + '/' + tsName(prefix)
    copyFileSync(file, dest)
  } catch (e) {}
}

const profileSchema = z.object({
  env: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('NINEROUTER_API_KEY'),
  cooldownMs: z.number().min(0).default(30000),
  enabled: z.boolean().default(true),
  rotateOn: z.array(z.string()).default(['QUOTA_EXCEEDED', 'AUTH', 'RATE_LIMIT']),
  keyRefs: z.array(z.object({
    ref: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
    label: z.string().default(''),
    createdAt: z.number().default(0),
    nextRef: z.string().default(''),
  })).default([]),
  displayName: z.string().default(''),
  useKeyRef: z.string().default(''),
})

function readSettings() {
  if (!existsSync(SETTINGS_FILE)) return { providers: {} }
  try {
    const raw = readFileSync(SETTINGS_FILE, 'utf8')
    const doc = loadYaml(raw) || {}
    const block = (doc && (doc['key-fallback'] || doc.keyFallback)) || {}
    return block && block.providers ? block : { providers: {} }
  } catch (e) { return { providers: {} } }
}

function writeSettings(data) {
  backupFile(SETTINGS_FILE, 'settings')
  let root = {}
  try { if (existsSync(SETTINGS_FILE)) root = loadYaml(readFileSync(SETTINGS_FILE, 'utf8')) || {} } catch (e) {}
  root['key-fallback'] = data
  writeFileSync(SETTINGS_FILE, dumpYaml(root, { lineWidth: 120 }), 'utf8')
}

function mask(v) {
  if (!v) return ''
  const s = String(v)
  if (s.length <= 8) return s.slice(0, 2) + '****'
  return s.slice(0, 6) + '****' + s.slice(-4)
}

function sendJson(res, code, data) {
  const payload = JSON.stringify(data)
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' })
    res.end(payload)
  } catch (e) { try { res.end() } catch {} }
}

const RETRYABLE_CODES = ['RATE_LIMIT', 'AUTH', 'QUOTA_EXCEEDED', 'TIMEOUT', 'TRANSPORT']

export function apply(ctx) {
  try { ctx.logger.info('key-fallback: v5 host apply() starting (config = settings.yaml)') } catch (e) {}
  const diagLog = []
  const diag = (kind, msg) => { try { diagLog.push({ kind, msg: String(msg).slice(0, 300), at: Date.now() }); if (diagLog.length > 200) diagLog.splice(0, diagLog.length - 200) } catch (e) {} }
  diag('apply', 'host loaded')
  // ── 包装 credentials.resolve：ref 命中池 env 时返回池当前 key（llm-pi-ai 唯一读取入口）──
  const poolsByEnv = new Map()
  const credSvc = ctx.credentials
  // 原始 resolve（未 wrap 版本）：池重建/读 env 真实值必须走它，否则 wrap 会短路成 currentRef 的值（污染）
  const rawResolve = (credSvc && typeof credSvc.resolve === 'function') ? credSvc.resolve.bind(credSvc) : null
  if (credSvc && typeof credSvc.resolve === 'function') {
    credSvc.resolve = async (ref) => {
      let result
      try { result = await rawResolve(ref) } catch (e) { result = undefined }
      const refName = String(ref || '')
      const pool = poolsByEnv.get(refName)
      if (pool && pool.currentRef) {
        const cur = pool.keyValues.find((k) => k.ref === pool.currentRef)
        if (cur) { diag('resolve', 'pool-hit ' + refName + ' -> ' + cur.ref.slice(-12)); return { value: cur.value, source: 'pool' } }
      }
      return result
    }
    diag('apply', 'credentials.resolve wrapped')
  }

  const pools = new Map()          // provider -> { cfg, keyValues, cursor, currentRef }
  const lifetime = new AbortController()

  function readPools() {
    const cfg = readSettings()
    const providers = (cfg && cfg.providers) || {}
    for (const name in providers) {
      if (!pools.has(name)) pools.set(name, { cfg: providers[name], keyValues: [], cursor: 0, currentRef: '' })
      else pools.get(name).cfg = providers[name]
      const envName = (providers[name] && providers[name].env) || (name.toUpperCase() + '_API_KEY')
      poolsByEnv.set(envName, pools.get(name))
    }
    for (const name of [...pools.keys()]) if (!providers[name]) pools.delete(name)
  }

  async function resolvePoolKeys(pool) {
    // 保留已有状态（failCount/cooldown/lastError），避免重建时丢状态
    const prev = new Map(pool.keyValues.map((k) => [k.ref, k]))
    pool.keyValues = []
    for (const entry of (pool.cfg.keyRefs || [])) {
      const ref = (entry && typeof entry === 'object') ? entry.ref : entry
      const nextRef = (entry && typeof entry === 'object' && entry.nextRef) ? entry.nextRef : ''
      if (!ref) continue
      try {
        const hit = rawResolve ? await rawResolve(credentialRef(ref)) : await ctx.credentials.resolve(credentialRef(ref))
        if (hit && hit.value) {
          const old = prev.get(ref) || {}
          pool.keyValues.push({
            ref, value: hit.value, source: 'user',
            nextRef,
            failCount: old.failCount || 0,
            cooldownUntil: old.cooldownUntil || 0,
            lastErrorAt: old.lastErrorAt || 0,
            lastErrorMsg: old.lastErrorMsg || '',
          })
        }
      } catch (e) {}
    }
    // env key 加入轮换池（source:'env'）—— keyValues 里的普通一员，可选中/失败/冷却/轮换
    pool.envKeyValue = ''
    const envRef = pool.cfg.env
    if (envRef) {
      try {
        const hit = rawResolve ? await rawResolve(credentialRef(envRef)) : await ctx.credentials.resolve(credentialRef(envRef))
        if (hit && hit.value) {
          pool.envKeyValue = hit.value
          const old = prev.get(envRef) || {}
          const found = pool.keyValues.find((k) => k.ref === envRef)
          if (!found) {
            pool.keyValues.push({
              ref: envRef, value: hit.value, source: 'env',
              nextRef: '',
              failCount: old.failCount || 0,
              cooldownUntil: old.cooldownUntil || 0,
              lastErrorAt: old.lastErrorAt || 0,
              lastErrorMsg: old.lastErrorMsg || '',
            })
          }
        }
      } catch (e) {}
    }
    if (pool.cfg.useKeyRef && !pool.keyValues.find((k) => k.ref === pool.cfg.useKeyRef)) pool.cfg.useKeyRef = ''
  }

  async function getPool(provider) {
    readPools()
    const pool = pools.get(provider)
    if (!pool) return undefined
    await resolvePoolKeys(pool)
    return pool
  }

  function isLive(k) {
    const now = Date.now()
    return ((k.failCount || 0) === 0) || ((k.cooldownUntil || 0) <= now)
  }

  function pickKey(pool) {
    // useKeyRef 锁定优先 —— 但冷却中的锁定 key 不能选（否则永远重试坏 key）
    if (pool.cfg.useKeyRef) {
      const locked = pool.keyValues.find((k) => k.ref === pool.cfg.useKeyRef && isLive(k))
      if (locked) return locked
    }
    const live = pool.keyValues.filter(isLive)
    const list = live.length > 0 ? live : pool.keyValues
    if (list.length === 0) return undefined
    // 优先 non-locked live key，避免锁死
    const nonLocked = list.filter((k) => k.ref !== pool.cfg.useKeyRef)
    const pickFrom = nonLocked.length > 0 ? nonLocked : list
    const start = pool.cursor % pickFrom.length
    pool.cursor = (start + 1) % pickFrom.length
    return pickFrom[start]
  }

  function markFailed(pool, ref, code, msg) {
    const kv = pool.keyValues.find((k) => k.ref === ref)
    if (!kv) return
    kv.failCount = (kv.failCount || 0) + 1
    // 固定冷却时长（用户配置 cooldownMs），不做指数退避 —— 避免冷却越来越长
    kv.cooldownUntil = Date.now() + (pool.cfg.cooldownMs || 30000)
    kv.lastErrorAt = Date.now()
    kv.lastErrorMsg = (code ? code + ': ' : '') + String(msg || '').slice(0, 200)
  }

  // 按配置的顺序选下一个 key：
  //   1) 当前失败 key 的 nextRef（显式指定下一个）
  //   2) 否则 cursor 顺序下一个 live key
  function nextKeyFor(pool, curRef) {
    // 失败轮换：纯按 nextRef 顺序（useKeyRef 锁定只在初始选择时生效，不锁死轮换）
    const cur = pool.keyValues.find((k) => k.ref === curRef)
    if (cur && cur.nextRef) {
      const nk = pool.keyValues.find((k) => k.ref === cur.nextRef && isLive(k))
      if (nk) return nk
    }
    // 无 nextRef 或指向冷却 key：顺序选下一个 live key（跳过自己）
    const live = pool.keyValues.filter((k) => isLive(k) && k.ref !== curRef)
    if (live.length > 0) return live[0]
    // 无可轮换的 live key → 返回 undefined（停止重试，不再死循环）
    return undefined
  }

  // ── 预写：v1 同款 —— 全局 agent/request（DSH 全局收得到这个 waterfall），
  //    每次请求同步 buildPools() 重读 settings，选 key，同步写 process.env，
  //    credentials.set fire-and-forget（不 await 阻塞 waterfall）。
  async function warmPools() {
    readPools()
    for (const name of pools.keys()) {
      const pool = pools.get(name)
      if (pool) {
        try { await resolvePoolKeys(pool) } catch (e) {}
        // 预热时确定初始 currentRef：useKeyRef 锁定优先，否则 pickKey
        if (pool.keyValues.length > 0 && !pool.currentRef) {
          const locked = pool.cfg.useKeyRef && pool.keyValues.find((k) => k.ref === pool.cfg.useKeyRef)
          pool.currentRef = (locked && locked.ref) || (pickKey(pool) && pickKey(pool).ref) || pool.keyValues[0].ref
        }
      }
    }
  }

  // 启动时预热 pools（resolve keyValues，供同步预写 pickKey 用）
  try { warmPools().catch(() => {}) } catch (e) {}
  // 每次 settings 变化也刷新 —— webServer 路由里已有调用，这里兜底周期不设

  ctx.on('agent/request', (payload, next) => {
    // next() 是 async，但我们要同步写 env —— 用 then 链，立即返回 p 不阻塞 waterfall
    const p = next()
    Promise.resolve(p).then((config) => {
      try {
        const provider = config && config.provider
        if (!provider) return config
        // 同步重建 pools（v1 同款：每次请求重读 settings.yaml）
        readPools()
        const pool = pools.get(provider)
        if (!pool || pool.cfg.enabled === false) return config
        // 当前 key：已有 currentRef 且 live 则用（尊重锁定/轮换结果），否则 pickKey
        let key = pool.currentRef && pool.keyValues.find((k) => k.ref === pool.currentRef && isLive(k))
        if (!key) key = pickKey(pool)
        if (!key) return config
        pool.currentRef = key.ref
        diag('agent/request', 'PICK ' + key.ref + ' env=' + pool.cfg.env)
        try { process.env[pool.cfg.env] = key.value } catch (e) {}
        try { backupFile(CRED_FILE, 'credentials'); ctx.credentials.set(credentialRef(pool.cfg.env), key.value).catch(() => {}) } catch (e) {}
      } catch (e) {}
      return config
    }).catch((e) => {})
    return p
  })

  // ── 失败处理：标记当前 key + 切下一个（prepend 注册：先于 dsh-llm-retry 看到错误，切完 key 再放行）──
  ctx.on('agent/request-error', async (payload, next) => {
    const code = String((payload && payload.failure && payload.failure.code) || (payload && payload.code) || '')
    const rawMsg = String((payload && payload.failure && payload.failure.message) || (payload && payload.message) || '')
    const provider = (payload && payload.provider) || ''
    const isRetryable = RETRYABLE_CODES.includes(code) || /^[45]\d\d$/.test(code) || /rate|limit|quota|exhaust|throttl|429|timeout|timed?out|auth|credential|denied|forbidden|unavailable|busy|key/i.test(rawMsg)
    if (!provider || !isRetryable) return next()
    diag('request-error', 'provider=' + provider + ' code=' + code)
    const pool = await getPool(provider)
    if (!pool || pool.keyValues.length === 0) return next()
    let curRef = pool.currentRef
    if (!curRef) {
      const envCur = process.env[pool.cfg.env]
      if (envCur) curRef = pool.keyValues.find((k) => k.value === envCur)?.ref
    }
    markFailed(pool, curRef || pool.keyValues[0]?.ref, code, rawMsg)
    diag('request-error', 'marked ' + (curRef || '?'))
    // 失败后优先按 nextRef 轮换（用户配置的顺序）；useKeyRef 只决定初始选择
    const nextKey = nextKeyFor(pool, curRef)
    if (nextKey) {
      try { await backupFile(CRED_FILE, 'credentials'); ctx.credentials.set(credentialRef(pool.cfg.env), nextKey.value); process.env[pool.cfg.env] = nextKey.value } catch (e) {}
      pool.currentRef = nextKey.ref
    } else {
      // 无 nextRef 可选时：若 useKeyRef 锁定 key 仍 live 则退回它，否则放弃
      const locked = pool.cfg.useKeyRef && pool.keyValues.find((k) => k.ref === pool.cfg.useKeyRef)
      if (locked && isLive(locked)) pool.currentRef = locked.ref
      return next()
    }
    // v13：插件只切换 key 并写入配置/env，不自己决定重发——重发权完全交给 DSH 自带 llm-retry
    // （按用户自己的 retryPolicy）：AUTH 类（未配置重发）→ 本轮失败，下次发送自动用新 key；
    // RATE_LIMIT 等（配置了重发）→ llm-retry backoff 后重发，重发时 prewrite 已用新 key。
    return next()
  }, { prepend: true })

  const webServer = ctx.get('webServer')
  if (webServer) {
    const route = async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const path = url.pathname.replace(new RegExp('^' + API_BASE + '/?'), '').replace(/\/$/, '')
        const readBody = () => new Promise((resolve, reject) => {
          let raw = '', size = 0
          req.on('data', (c) => { size += c.length; if (size > (1 << 20)) { reject(new Error('body too large')); req.destroy(); return } raw += c.toString('utf8') })
          req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)) } catch (e) { reject(e) } })
          req.on('error', reject)
        })

        if (path === 'diag' && req.method === 'GET') {
          return sendJson(res, 200, { diag: diagLog })
        }

        if (path === 'providers' && req.method === 'GET') {
          const live = []
          try {
            for (const p of (ctx.llm.listProviders ? ctx.llm.listProviders() : [])) {
              if (p && p.id) live.push({ id: p.id, name: p.name || p.id, state: 'live' })
            }
          } catch (e) {}
          const dormant = []
          try {
            for (const c of (ctx.llm.listConfigurableProviders ? ctx.llm.listConfigurableProviders() : [])) {
              if (c && c.provider && !live.some((l) => l.id === c.provider)) dormant.push({ id: c.provider, name: c.displayName || c.provider, state: 'dormant' })
            }
          } catch (e) {}
          return sendJson(res, 200, { live, dormant, currentPools: Object.keys(readSettings().providers || {}) })
        }

        if (path === 'pools') {
          if (req.method === 'GET') {
            // 返回含实时状态的池列表
            const out = []
            readPools()
            for (const [name, pool] of pools) {
              await resolvePoolKeys(pool)
              const now = Date.now()
              const keys = pool.keyValues.map((k) => {
                const cooling = (k.cooldownUntil || 0) > now
                return {
                  ref: k.ref,
                  label: '',
                  source: k.source,
                  nextRef: k.nextRef || '',
                  status: cooling ? 'cooling' : (k.failCount ? 'recovered' : 'live'),
                  failCount: k.failCount || 0,
                  cooldownUntil: k.cooldownUntil || 0,
                  cooldownRemainingMs: cooling ? (k.cooldownUntil - now) : 0,
                  lastErrorAt: k.lastErrorAt || 0,
                  lastErrorMsg: k.lastErrorMsg || '',
                }
              })
              out.push({
                provider: name,
                displayName: pool.cfg.displayName || name,
                env: pool.cfg.env,
                cooldownMs: pool.cfg.cooldownMs,
                enabled: pool.cfg.enabled,
                rotateOn: pool.cfg.rotateOn || [],
                useKeyRef: pool.cfg.useKeyRef || '',
                currentRef: pool.currentRef || '',
                envKeyValue: pool.envKeyValue ? mask(pool.envKeyValue) : '',
                keys: keys,
              })
            }
            return sendJson(res, 200, { pools: out })
          }
          if (req.method === 'POST') {
            const body = await readBody()
            const { provider, enabled, env, cooldownMs, rotateOn, displayName, useKeyRef } = body || {}
            if (typeof provider !== 'string' || !provider) return sendJson(res, 400, { error: 'provider required' })
            const envName = (typeof env === 'string' && env) ? env : (provider.toUpperCase() + '_API_KEY')
            if (!isCredentialRefName(envName)) return sendJson(res, 400, { error: 'env must be POSIX identifier' })
            const cfg = readSettings()
            cfg.providers = cfg.providers || {}
            const cur = cfg.providers[provider] || {}
            const upd = {
              env: envName,
              enabled: enabled !== false,
              cooldownMs: Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : (cur.cooldownMs ?? 30000),
              rotateOn: Array.isArray(rotateOn) && rotateOn.length > 0 ? rotateOn : (cur.rotateOn || ['QUOTA_EXCEEDED', 'AUTH', 'RATE_LIMIT']),
              keyRefs: (cur.keyRefs || []).map((x) => {
                if (typeof x === 'string') return { ref: x, label: '', createdAt: 0, nextRef: '' }
                return { ref: x.ref, label: x.label || '', createdAt: x.createdAt || 0, nextRef: x.nextRef || '' }
              }),
              displayName: (typeof displayName === 'string' && displayName) ? displayName : (cur.displayName || provider),
              useKeyRef: (typeof useKeyRef === 'string') ? useKeyRef : (cur.useKeyRef || ''),
            }
            let validated
            try { validated = profileSchema(upd) } catch (e) { return sendJson(res, 400, { error: 'invalid profile: ' + (e && e.message || e) }) }
            cfg.providers[provider] = validated
            writeSettings(cfg)
            return sendJson(res, 200, { ok: true, pool: validated })
          }
          if (req.method === 'DELETE') {
            const provider = url.searchParams.get('provider')
            if (!provider) return sendJson(res, 400, { error: 'provider required' })
            const cfg = readSettings()
            if (!cfg.providers || !cfg.providers[provider]) return sendJson(res, 404, { error: 'not found' })
            const prof = cfg.providers[provider]
            for (const k of (prof.keyRefs || [])) { try { backupFile(CRED_FILE, 'credentials'); await ctx.credentials.unset(credentialRef(k.ref || k)) } catch (e) {} }
            delete cfg.providers[provider]
            writeSettings(cfg)
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }

        if (path === 'keys') {
          if (req.method === 'POST') {
            const body = await readBody()
            const { provider, value, label } = body || {}
            if (typeof provider !== 'string' || !provider) return sendJson(res, 400, { error: 'provider required' })
            if (typeof value !== 'string' || !value) return sendJson(res, 400, { error: 'value required' })
            const cfg = readSettings()
            if (!cfg.providers || !cfg.providers[provider]) return sendJson(res, 404, { error: 'pool not found' })
            const prof = cfg.providers[provider]
            const newRef = 'key_fallback_' + provider + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 0xffffffff).toString(36)
            try { backupFile(CRED_FILE, 'credentials'); await ctx.credentials.set(credentialRef(newRef), value) } catch (e) { return sendJson(res, 500, { error: 'credentials write failed' }) }
            const newEntry = { ref: newRef, label: (typeof label === 'string' && label) ? label : '', createdAt: Date.now(), nextRef: '' }
            prof.keyRefs = [...(prof.keyRefs || []), newEntry]
            writeSettings(cfg)
            return sendJson(res, 200, { ok: true, key: newEntry, valueMask: mask(value) })
          }
          if (req.method === 'PATCH') {
            const body = await readBody()
            const { provider, ref, value, label, nextRef } = body || {}
            if (typeof provider !== 'string' || !provider || typeof ref !== 'string' || !ref) return sendJson(res, 400, { error: 'provider & ref required' })
            const cfg = readSettings()
            const prof = cfg.providers && cfg.providers[provider]
            if (!prof) return sendJson(res, 404, { error: 'pool not found' })
            const entry = (prof.keyRefs || []).find((k) => k.ref === ref)
            if (!entry) return sendJson(res, 404, { error: 'key not found' })
            if (typeof value === 'string' && value) {
              try { backupFile(CRED_FILE, 'credentials'); await ctx.credentials.set(credentialRef(ref), value) } catch (e) { return sendJson(res, 500, { error: 'credentials write failed' }) }
            }
            if (typeof label === 'string') entry.label = label
            if (typeof nextRef === 'string') entry.nextRef = nextRef
            if (typeof useKeyRef === 'string') prof.useKeyRef = useKeyRef
            writeSettings(cfg)
            return sendJson(res, 200, { ok: true })
          }
          if (req.method === 'DELETE') {
            const provider = url.searchParams.get('provider')
            const ref = url.searchParams.get('ref')
            if (!provider || !ref) return sendJson(res, 400, { error: 'provider & ref required' })
            const cfg = readSettings()
            const prof = cfg.providers && cfg.providers[provider]
            if (!prof) return sendJson(res, 404, { error: 'pool not found' })
            const idx = (prof.keyRefs || []).findIndex((k) => k.ref === ref)
            if (idx < 0) return sendJson(res, 404, { error: 'key not found' })
            try { backupFile(CRED_FILE, 'credentials'); await ctx.credentials.unset(credentialRef(ref)) } catch (e) {}
            prof.keyRefs.splice(idx, 1)
            if (prof.useKeyRef === ref) prof.useKeyRef = ''
            // 清理指向已删 key 的 nextRef
            for (const k of (prof.keyRefs || [])) if (k.nextRef === ref) k.nextRef = ''
            writeSettings(cfg)
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }

        if (path === 'reset') {
          if (req.method === 'POST') {
            const body = await readBody()
            const provider = body && body.provider
            if (!provider) return sendJson(res, 400, { error: 'provider required' })
            const pool = pools.get(provider)
            if (pool) { pool.cursor = 0; for (const k of pool.keyValues) { k.failCount = 0; k.cooldownUntil = 0; k.lastErrorAt = 0; k.lastErrorMsg = '' } }
            return sendJson(res, 200, { ok: true })
          }
        }

        return sendJson(res, 404, { error: 'not found' })
      } catch (e) {
        try { sendJson(res, 500, { error: (e && e.message) || String(e) }) } catch {}
      }
    }
    const handle = webServer.register({ kind: 'prefix', path: API_BASE, handler: route })
    ctx.effect(() => handle)
  }

  ctx.effect(() => () => { lifetime.abort() })
}
