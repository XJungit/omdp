// @omdp/dsh-key-fallback — Host half (ESM, v3)
//
// API key 池插件 v3：LLM provider 请求失败（可重试错误）时，把该 provider 的
// 下一个未冷却 key 写入其 env credential ref，并返回 {kind:'retry'} 让 agent
// loop 用新 key 重开一轮。UI 在「设置 → API Key 回退」独立页：选择 provider、
// 手动输入多个 key（只写）、增删、冷却状态。
//
// 凭据：settings 命名空间只存元数据（provider/env/cooldownMs/rotateOn/keys[id,ref,label]），
// 明文值一律 ctx.credentials.set('key_fallback_<provider>_<keyId>', value) 存到
// ~/.dsh/.credentials.yaml。轮换时写 provider 的 env ref（如 NINEROUTER_API_KEY）。
//
// 设计参考 m1khal3v/dsh-llm-key-rotation（agent/request-error 驱动、窗口走链、
// 并发串行、配置只存引用）+ v2 的 UI 需求（provider 下拉、多 key 只写输入）。
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { randomUUID } from 'node:crypto'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

// 当前版本 @deepseek-ai/dsh-credentials 只导出 credentialRef，不再导出
// isCredentialRefName。按官方 REF_PATTERN（POSIX 标识符）在本地板实现，保持兼容。
function isCredentialRefName(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}
import z from '@deepseek-ai/schemastery'

export const name = 'key-fallback'
export const inject = ['llm', 'settings', 'webServer', 'credentials']

const API_BASE = '/dsh-key-fallback'
// 避开 v1 host 已注册的 'key-fallback'（v1 仍装在 web profile），v3 用独立 NS
  const NS = 'key-fallback-pools'
const CHAIN_WINDOW_MS = 300_000
const DEFAULT_ROTATE_ON = ['QUOTA_EXCEEDED', 'AUTH', 'RATE_LIMIT']

const keyEntrySchema = z.object({
  id: z.string(),
  ref: z.string().role('credential-ref'),
  label: z.string().default(''),
  createdAt: z.number(),
  source: z.union(['user', 'env']).default('user'),
})

const profileSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.string(),
  displayName: z.string().default(''),
  env: z.string().role('credential-ref'),
  cooldownMs: z.number().step(1).min(0).default(30000),
  rotateOn: z.array(z.string()).default([...DEFAULT_ROTATE_ON]),
  keys: z.array(keyEntrySchema).default([]),
  useKeyId: z.string().default(''),
})

const ConfigSchema = z.object({
  providers: z.dict(profileSchema).default({}),
  keyFallbackMigratedToV3: z.boolean().default(false),
})

function envRefOf(provider) {
  return String(provider || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY'
}

// 运行时合成池 keys：profile.keys + 环境 key（source:'env'，不可删，始终第一位）
// 环境 key = 通过 env ref（如 AGNES_API_KEY）从 credentials/环境 resolve 到的值。
// 用户环境里已配置的 key 也纳入池，UI 显示 [环境] 徽章，可手动选中、参与轮换。
function envKeyEntry(profile) {
  return {
    id: '__env__',
    ref: profile.env || '',
    label: '[环境] ' + (profile.env || ''),
    createdAt: 0,
    source: 'env',
  }
}
function effectiveKeys(profile) {
  const keys = (profile.keys || []).slice()
  // 环境 key 前置（如果有 env ref 且 resolve 有值，运行时判断；先结构上占位）
  const env = envKeyEntry(profile)
  if (env.ref) keys.unshift(env)
  return keys
}

function maskKey(v) {
  if (!v) return ''
  const s = String(v)
  if (s.length <= 8) return s.slice(0, 2) + '****'
  return s.slice(0, 6) + '****' + s.slice(-4)
}

// 每个 key 的 ref：key_fallback_<provider>_<keyId>（POSIX identifier：仅字母数字下划线）
function keyRefOf(provider, keyId) {
  return 'key_fallback_' + provider + '_' + keyId
}

export function apply(ctx, entryConfig) {
  // settings 命名空间 scope（host 自己读写；UI 写盘也走它）
  let scope
  try {
    const ns = dshSettings.settingsNamespace(NS)
    scope = ctx.settings.register(ns, ConfigSchema, { base: entryConfig })
  } catch (e) {
    ctx.logger.warn('key-fallback: settings namespace registration failed: %s', (e && e.message) || e)
    // 注册失败则本轮插件不再工作，但不让 DSH 崩溃（退化：不做轮换）
    return
  }

  // ── v1 → v3 配置迁移 ──
  // v1 把 key 明文存在 ~/.dsh/settings.yaml 的 keyFallback.providers 块。
  // v3 不读那个块；这里在启动时检测老块，把每个 provider 的池元数据迁入
  // key-fallback 命名空间、key 明文写入 credentials（ref 保持 v3 格式），
  // 然后标记已迁移，避免重复。
  const SETTINGS_FILE = join(homedir(), '.dsh', 'settings.yaml')
  const MIGRATED_KEY = 'keyFallbackMigratedToV3'
  async function migrateV1() {
    try {
      const cur = scope.get()
      const providers = cur.providers || {}
      if (Object.keys(providers).length > 0) return        // v3 已有池，不动
      if (cur[MIGRATED_KEY]) return                         // 已迁移过，不动
      if (!existsSync(SETTINGS_FILE)) return
      const raw = readFileSync(SETTINGS_FILE, 'utf8')
      const doc = (loadYaml && typeof loadYaml === 'function') ? loadYaml(raw) : {}
      const v1 = doc && doc.keyFallback && doc.keyFallback.providers
      if (!v1 || typeof v1 !== 'object') return
      const migrated = { }
      for (const [pname, pcfg] of Object.entries(v1)) {
        if (!pcfg || typeof pcfg !== 'object') continue
        const env = (pcfg.env && isCredentialRefName(pcfg.env)) ? pcfg.env : envRefOf(pname)
        const keys = Array.isArray(pcfg.keys) ? pcfg.keys.filter(k => typeof k === 'string' && k.length > 0) : []
        if (keys.length === 0) continue
        const keyEntries = []
        for (const kv of keys) {
          const keyId = randomUUID().replace(/-/g, '')
          const ref = keyRefOf(pname, keyId)
          try { await ctx.credentials.set(credentialRef(ref), kv) } catch (e) { ctx.logger.warn('key-fallback: v1 migration credential write failed for %s: %s', ref, (e && e.message) || e) }
          keyEntries.push({ id: keyId, ref, label: '', createdAt: Date.now() })
        }
        migrated[pname] = {
          enabled: true,
          provider: pname,
          displayName: pname,
          env,
          cooldownMs: pcfg.cooldownMs || 30000,
          rotateOn: [...DEFAULT_ROTATE_ON],
          keys: keyEntries,
        }
        ctx.logger.info('key-fallback: migrated v1 pool %s (%d keys)', pname, keyEntries.length)
      }
      if (Object.keys(migrated).length > 0) {
        await safeUpdate({ providers: migrated, [MIGRATED_KEY]: true })
        ctx.logger.info('key-fallback: v1 config migrated to key-fallback namespace')
      }
    } catch (e) {
      ctx.logger.warn('key-fallback: v1 migration failed: %s', (e && e.message) || e)
    }
  }
  void migrateV1()

  async function safeUpdate(patch) { try { if (!scope || typeof scope.update !== 'function') { ctx.logger.warn('key-fallback: scope not initialized, skip update'); return } return await scope.update(patch) } catch (e) { ctx.logger.warn('key-fallback: scope.update failed: %s', (e && e.message) || e) } }
  const profiles = () => { try { return (scope && scope.get && scope.get().providers) || {} } catch (e) { return {} } }

  const resolveRef = async (ref) => {
    try {
      const hit = await ctx.credentials.resolve(credentialRef(ref))
      return hit && hit.value
    } catch (e) { return undefined }
  }
  // 一次轮换：写下一个 key 到 provider env ref；成功返回 {kind:'retry'}
  const states = new Map() // provider -> { cursor, lastWriteAt, keyStates }
  const chains = new Map() // provider -> Promise（并发串行）

  async function rotate(provider, failure) {
    const profile = profiles()[provider]
    if (!profile || !profile.enabled) return undefined
    if (!(profile.rotateOn || []).includes(failure.code)) return undefined
    const keyValues = []
    for (const k of effectiveKeys(profile)) {
      const v = await resolveRef(k.ref)
      if (v) keyValues.push({ k, v })
    }
    if (keyValues.length === 0) return undefined
    // 记录当前 cursor 指向的 key（最近一次预写/轮换用的）失败：标冷却
    let state = states.get(provider)
    if (!state) { state = { cursor: 0, lastWriteAt: 0, keyStates: new Map() }; states.set(provider, state) }
    const prevIdx = state.cursor % keyValues.length
    const prevKey = keyValues[prevIdx]
    const nowMs = Date.now()
    let ks = state.keyStates.get(prevKey.k.id)
    if (!ks) { ks = { failCount: 0, cooldownUntil: 0, lastErrorAt: 0, lastErrorMsg: '' }; state.keyStates.set(prevKey.k.id, ks) }
    ks.failCount += 1
    ks.cooldownUntil = nowMs + (profile.cooldownMs || 30000) * Math.min(ks.failCount, 5)
    ks.lastErrorAt = nowMs
    ks.lastErrorMsg = String(failure.message || '').slice(0, 200)
    // 手动锁定（useKeyId 非空）：固定用指定 key，失败不自动换（用户已选），但仍标冷却与重试
    if (profile.useKeyId) {
      const target = keyValues.find(x => x.k.id === profile.useKeyId)
      if (!target) return undefined
      const toRef = profile.env || envRefOf(provider)
      try { await ctx.credentials.set(credentialRef(toRef), target.v) } catch (e) { return undefined }
      ctx.logger.info('key-fallback: used locked key [%s] for %s', profile.useKeyId, provider)
      return { kind: 'retry' }
    }
    // 失败后写到下一个【未冷却】key（cursor 前进跳过冷却中的）；全冷却则前进一个
    const now = Date.now()
    const fresh = state.lastWriteAt !== 0 && (now - state.lastWriteAt) < CHAIN_WINDOW_MS
    let nextIdx = (state.cursor + 1) % keyValues.length
    // 找第一个未冷却的（从 nextIdx 开始）
    for (let i = 0; i < keyValues.length; i++) {
      const idx = (nextIdx + i) % keyValues.length
      const kst = state.keyStates.get(keyValues[idx].k.id)
      if (!kst || (kst.cooldownUntil || 0) <= now) { nextIdx = idx; break }
    }
    state.cursor = nextIdx
    const toRef = profile.env || envRefOf(provider)
    const value = keyValues[state.cursor].v
    try {
      await ctx.credentials.set(credentialRef(toRef), value)
    } catch (e) {
      ctx.logger.warn('key-fallback: could not write rotated key to %s for %s', toRef, provider)
      return undefined
    }
    state.lastWriteAt = now
    ctx.logger.info('key-fallback: rotated provider=%s cursor[%d] -> %s (%s)', provider, state.cursor, toRef, failure.code)
    return { kind: 'retry' }
  }

    // provider -> { cursor, lastWriteAt, keyStates: Map<keyId, { failCount, cooldownUntil, lastErrorAt, lastErrorMsg }> }

  ctx.on('agent/request-error', (payload, next) => {
    const { provider, failure } = payload || {}
    if (!provider || !failure) return next()
    const profile = profiles()[provider]
    if (!profile || !profile.enabled) return next()
    const prev = chains.get(provider) || Promise.resolve()
    const run = prev
      .then(() => rotate(provider, failure))
      .then((action) => action || next())
      .catch((e) => {
        ctx.logger.warn('key-fallback: rotation for %s failed: %s', provider, (e && e.message) || e)
        return next()
      })
    chains.set(provider, run.then(() => undefined, () => undefined))
    return run
  })

  // ── agent/request：请求前把池里 cursor 指向的 key 写入 provider env ref ──
  // 让正常消息用池里的 key（而非环境原 key）；失败后 error hook 换下一个并重试。
  ctx.on('agent/request', (payload, next) => {
    return Promise.resolve().then(async () => {
      const resolved = await next()
      const provider = resolved && resolved.provider
      if (!provider) return resolved
      const profile = profiles()[provider]
      if (!profile || !profile.enabled) return resolved
      // effectiveKeys = 用户 keys + 环境 key（source:'env'，始终第一位）
      const keyValues = []
      for (const k of effectiveKeys(profile)) {
        const v = await resolveRef(k.ref)
        if (v) keyValues.push({ k, v })
      }
      if (keyValues.length === 0) return resolved
      // 手动锁定（useKeyId 非空）：固定写指定 key；否则 cursor 轮换
      let chosen
      if (profile.useKeyId) {
        chosen = keyValues.find(x => x.k.id === profile.useKeyId) || keyValues[0]
      } else {
        let state = states.get(provider)
        if (!state) { state = { cursor: 0, lastWriteAt: 0 }; states.set(provider, state) }
        chosen = keyValues[state.cursor % keyValues.length]
      }
      const toRef = profile.env || envRefOf(provider)
      try {
        await ctx.credentials.set(credentialRef(toRef), chosen.v)
      } catch (e) {
        ctx.logger.warn('key-fallback: agent/request could not write key to %s for %s', toRef, provider)
      }
      return resolved
    })
  })

  // ── HTTP API（client 用）──
  const diagLog = []
  const webServer = ctx.get('webServer')
  if (webServer) {
    const sendJson = (res, code, data) => {
      const payload = JSON.stringify(data)
      try {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' })
        res.end(payload)
      } catch (e) { try { res.end() } catch {} }
    }
    const readBody = (req) => new Promise((resolve, reject) => {
      let raw = '', size = 0
      req.on('data', (c) => { size += c.length; if (size > (1 << 20)) { reject(new Error('body too large')); req.destroy(); return } raw += c.toString('utf8') })
      req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)) } catch (e) { reject(e) } })
      req.on('error', reject)
    })
    const route = async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const m = url.pathname.match(/^\/dsh-key-fallback\/(providers|pools|keys|keys\/reset|diag)?\/?$/)
        if (!m) return sendJson(res, 404, { error: 'not found' })
        const leaf = m[1]
        if (leaf === 'providers' && req.method === 'GET') {
          const live = []
          try { for (const p of ctx.llm.listProviders()) live.push({ id: p.id, name: p.name || p.id, state: 'live' }) } catch (e) {}
          const dormant = []
          try { for (const c of ctx.llm.listConfigurableProviders()) if (!live.some((l) => l.id === c.provider)) dormant.push({ id: c.provider, name: c.displayName || c.provider, state: 'dormant' }) } catch (e) {}
          return sendJson(res, 200, { live, dormant, currentPools: Object.keys(profiles()) })
        }
        if (leaf === 'pools') {
          if (req.method === 'GET') {
            const out = Object.entries(profiles()).map(([provider, p]) => {
              const st = states.get(provider)
              const now = Date.now()
              return {
                provider, displayName: p.displayName || provider, env: p.env || envRefOf(provider),
                cooldownMs: p.cooldownMs, enabled: p.enabled, rotateOn: p.rotateOn || [],
                useKeyId: p.useKeyId || '',
                cursor: st ? st.cursor : 0,
                keys: effectiveKeys(p).map((k) => {
                  const ks = st && st.keyStates.get(k.id)
                  const cooling = ks && (ks.cooldownUntil || 0) > now
                  return {
                    id: k.id, ref: k.ref, label: k.label || '', createdAt: k.createdAt, source: k.source || 'user',
                    failCount: ks ? ks.failCount : 0,
                    cooldownUntil: ks ? ks.cooldownUntil : 0,
                    cooldownRemainingMs: cooling ? (ks.cooldownUntil - now) : 0,
                    lastErrorAt: ks ? ks.lastErrorAt : 0,
                    lastErrorMsg: ks ? ks.lastErrorMsg : '',
                    status: cooling ? 'cooling' : 'healthy',
                  }
                }),
              }
            })
            return sendJson(res, 200, { pools: out })
          }
          if (req.method === 'POST') {
            const body = await readBody(req)
            const { provider, enabled, env, cooldownMs, rotateOn, displayName } = body || {}
            if (typeof provider !== 'string' || !provider) return sendJson(res, 400, { error: 'provider required' })
            const envName = (typeof env === 'string' && env) ? env : envRefOf(provider)
            if (!isCredentialRefName(envName)) return sendJson(res, 400, { error: 'env must be POSIX identifier' })
            const cur = profiles()[provider] || {}
            const next = {
              ...cur, provider,
              displayName: (typeof displayName === 'string' && displayName) ? displayName : (cur.displayName || provider),
              env: envName,
              cooldownMs: Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : (cur.cooldownMs ?? 30000),
              enabled: enabled !== false,
              rotateOn: Array.isArray(rotateOn) ? rotateOn : (cur.rotateOn || [...DEFAULT_ROTATE_ON]),
              keys: cur.keys || [],
              useKeyId: (typeof body.useKeyId === 'string') ? body.useKeyId : (cur.useKeyId || ''),
            }
            const providers = { ...profiles(), [provider]: next }
            await safeUpdate({ providers })
            return sendJson(res, 200, { ok: true, pool: next })
          }
          if (req.method === 'DELETE') {
            const provider = url.searchParams.get('provider')
            if (!provider) return sendJson(res, 400, { error: 'provider required' })
            const providers = { ...profiles() }
            const cur = providers[provider]
            if (!cur) return sendJson(res, 404, { error: 'not found' })
            for (const k of (cur.keys || [])) { try { await ctx.credentials.unset(credentialRef(k.ref)) } catch (e) {} }
            delete providers[provider]
            await safeUpdate({ providers })
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }
        if (leaf === 'keys') {
          if (req.method === 'POST') {
            const body = await readBody(req)
            const { provider, label, value } = body || {}
            if (typeof provider !== 'string' || !provider) return sendJson(res, 400, { error: 'provider required' })
            if (typeof value !== 'string' || !value) return sendJson(res, 400, { error: 'value required' })
            const providers = { ...profiles() }
            const cur = providers[provider]
            if (!cur) return sendJson(res, 404, { error: 'pool not found' })
            const keyId = randomUUID().replace(/-/g, '')
            const ref = keyRefOf(provider, keyId)
            await ctx.credentials.set(credentialRef(ref), value)
            const keyEntry = { id: keyId, ref, label: (typeof label === 'string' && label) ? label : '', createdAt: Date.now() }
            providers[provider] = { ...cur, keys: [...(cur.keys || []), keyEntry] }
            await safeUpdate({ providers })
            return sendJson(res, 200, { ok: true, key: { ...keyEntry, valueMask: maskKey(value) } })
          }
          if (req.method === 'PATCH') {
            const body = await readBody(req)
            const { provider, keyId, value } = body || {}
            if (typeof provider !== 'string' || !provider || typeof keyId !== 'string' || !keyId || typeof value !== 'string' || !value) return sendJson(res, 400, { error: 'provider/keyId/value required' })
            const providers = { ...profiles() }
            const cur = providers[provider]
            if (!cur) return sendJson(res, 404, { error: 'pool not found' })
            const target = (cur.keys || []).find((k) => k.id === keyId)
            if (!target) return sendJson(res, 404, { error: 'key not found' })
            diagLog.push({ at: Date.now(), kind: 'patch', step: 'set', ref: target.ref })
            try {
              await ctx.credentials.set(credentialRef(target.ref), value)
              diagLog.push({ at: Date.now(), kind: 'patch', step: 'set-done', ref: target.ref })
            } catch (e) {
              diagLog.push({ at: Date.now(), kind: 'patch', step: 'set-error', ref: target.ref, error: String(e && e.message || e) })
              return sendJson(res, 500, { error: 'credentials write failed: ' + String(e && e.message || e) })
            }
            return sendJson(res, 200, { ok: true })
          }
          if (req.method === 'DELETE') {
            const provider = url.searchParams.get('provider')
            const keyId = url.searchParams.get('keyId')
            if (!provider || !keyId) return sendJson(res, 400, { error: 'provider & keyId required' })
            const providers = { ...profiles() }
            const cur = providers[provider]
            if (!cur) return sendJson(res, 404, { error: 'pool not found' })
            const target = (cur.keys || []).find((k) => k.id === keyId)
            if (!target) return sendJson(res, 404, { error: 'key not found' })
            try { await ctx.credentials.unset(credentialRef(target.ref)) } catch (e) {}
            providers[provider] = { ...cur, keys: (cur.keys || []).filter((k) => k.id !== keyId) }
            await safeUpdate({ providers })
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }
        if (leaf === 'keys/reset' && req.method === 'POST') {
          const body = await readBody(req)
          const provider = body && body.provider
          if (provider) {
            const s = states.get(provider)
            if (s) { s.nextIndex = 0; s.lastWriteAt = 0 }
          }
          return sendJson(res, 200, { ok: true })
        }
        if (leaf === 'diag' && req.method === 'POST') {
          try {
            const body = await readBody(req)
            diagLog.push({ at: Date.now(), ...body })
            if (diagLog.length > 50) diagLog.shift()
            return sendJson(res, 200, { ok: true })
          } catch (e) { return sendJson(res, 500, { error: String(e) }) }
        }
        return sendJson(res, 404, { error: 'not found' })
      } catch (e) {
        sendJson(res, 500, { error: (e && e.message) || String(e) })
      }
    }
    const handle = webServer.register({ kind: 'prefix', path: API_BASE, handler: route })
    ctx.effect(() => handle)
  }
}