// @omdp/dsh-key-fallback — Host half (ESM)
// 极简 API Key 回退：请求报错 → 静默换下一个 key 重试同一请求。
//
// 注意：必须 ESM + 静态 import（与 dshmarket / vision-bridge 一致）。
// DSH 的 bundle loader 对 CommonJS 的 require() 是受限的（先前实测
// dshSettings=false zs=false），只有 ESM import 能解析 DSH 内部包
// （@deepseek-ai/dsh-settings / @deepseek-ai/schemastery）。
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import * as zs from '@deepseek-ai/schemastery'

export const name = 'key-fallback'
export const inject = ['llm', 'settings', 'webServer']
const API_BASE = '/dsh-key-fallback'
const SETTINGS_FILE = join(homedir(), '.dsh', 'settings.yaml')
// 与客户端 slots.register key 保持一致的命名空间名。
const SETTINGS_NS = 'key-fallback'

function mask(key) {
  if (!key) return ''
  if (key.length <= 8) return key.slice(0, 2) + '****'
  return key.slice(0, 6) + '****' + key.slice(-4)
}
function sendJson(res, code, data) {
  const payload = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

// 从 settings.yaml 读配置块（keyFallback 或 key-fallback 均可）
function readConfig() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {}
    const raw = readFileSync(SETTINGS_FILE, 'utf8')
    const doc = (loadYaml && typeof loadYaml === 'function') ? loadYaml(raw) : {}
    const blk = (doc && (doc['keyFallback'] || doc['key-fallback'])) || {}
    return blk
  } catch (e) { return {} }
}

export function apply(ctx) {
  // 注册 settings 命名空间（官方助手 installSettingsSection，与 dshmarket 同款）：
  // 让客户端 Settings → 插件的 keyed slot（settings.plugin.item, key='key-fallback'）
  // 被 serve 并渲染状态卡。状态卡只读；轮换逻辑仍直接读 settings.yaml（原设计）。
  try {
    const ns = dshSettings.settingsNamespace(SETTINGS_NS)
    const schema = zs.object({
      providers: zs.dict(zs.object({
        env: zs.string(),
        keys: zs.array(zs.string()),
        cooldownMs: zs.natural(),
      })),
    })
    dshSettings.installSettingsSection(ctx, ns, schema, {}, {
      setSource: () => {},
      onChange: () => {},
    })
  } catch (e) {
    // 命名空间注册失败不影响核心轮换逻辑
  }

  const pools = new Map()
  const attempts = new Map() // `${turn}:${step}` -> 已尝试次数（防止死循环）
  const lifetime = new AbortController()

  function buildPools() {
    const cfg = readConfig()
    const providers = (cfg && cfg.providers) || {}
    for (const [provider, pcfg] of Object.entries(providers)) {
      const env = (pcfg && pcfg.env) || `${provider.toUpperCase()}_API_KEY`
      const keys = Array.isArray(pcfg && pcfg.keys) ? pcfg.keys.filter(Boolean) : []
      const cooldown = (pcfg && pcfg.cooldownMs) || 30000
      if (!pools.has(provider)) {
        pools.set(provider, {
          env, keys, cooldown, idx: 0,
          states: new Map(keys.map((k) => [k, { failCount: 0, cooldownUntil: 0 }])),
        })
      } else {
        const p = pools.get(provider)
        const added = keys.filter((k) => !p.keys.includes(k))
        for (const k of added) p.states.set(k, { failCount: 0, cooldownUntil: 0 })
        p.keys = keys
        p.env = env
        p.cooldown = cooldown
      }
    }
  }
  buildPools()

  function pickKey(provider) {
    const pool = pools.get(provider)
    if (!pool || pool.keys.length === 0) return undefined
    const now = Date.now()
    const live = pool.keys.filter((k) => ((pool.states.get(k) && pool.states.get(k).cooldownUntil) || 0) <= now)
    if (live.length === 0) return pool.keys[pool.idx % pool.keys.length]
    for (let i = 0; i < live.length; i++) {
      const key = live[(pool.idx + i) % live.length]
      const realIdx = pool.keys.indexOf(key)
      if (realIdx >= 0) { pool.idx = (realIdx + 1) % pool.keys.length; return key }
    }
    return pool.keys[0]
  }

  function markFailed(provider, key) {
    const pool = pools.get(provider)
    if (!pool || !key) return
    const st = pool.states.get(key)
    if (!st) return
    st.failCount += 1
    st.cooldownUntil = Date.now() + pool.cooldown * Math.min(st.failCount, 5)
  }

  // ── agent/request：先拿 provider，再选 key 注入 env ──
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const provider = config && config.provider
    if (!provider) return config
    buildPools()
    const pool = pools.get(provider)
    if (!pool || pool.keys.length === 0) return config
    const key = pickKey(provider)
    if (!key) return config
    process.env[pool.env] = key
    return config
  })

  // 是否还有「别的、未冷却」的 key 可用（单 key / 全冷却 / 未配置时返回 false）
  function hasOtherLiveKey(provider, excludeKey) {
    const pool = pools.get(provider)
    if (!pool) return false
    const now = Date.now()
    return pool.keys.some((k) => k !== excludeKey && ((pool.states.get(k) && pool.states.get(k).cooldownUntil) || 0) <= now)
  }

  // ── agent/request-error：命中可重试错误 → 标当前 key 失效 + 重试 ──
  ctx.on('agent/request-error', async (payload, next) => {
    const code = String((payload && ((payload.failure && payload.failure.code) || payload.code)) || '')
    const rawMsg = String((payload && ((payload.failure && payload.failure.message) || payload.message)) || '')
    const provider = (payload && payload.provider) || ''
    const RETRYABLE = ['RATE_LIMIT', 'AUTH', 'QUOTA_EXCEEDED', 'TIMEOUT', 'TRANSPORT']
    const isRetryable = RETRYABLE.includes(code) ||
      /^[45]\d\d$/.test(code) ||
      /rate|limit|quota|exhaust|throttl|429|timeout|timed?out|auth|credential|denied|forbidden|unavailable|busy|key/i.test(rawMsg)
    if (provider && isRetryable) {
      const pool = pools.get(provider)
      if (!pool || pool.keys.length === 0) return next() // 未配置：不接管，原样委托
      const cur = process.env[pool.env]
      if (cur && pool.keys.includes(cur)) markFailed(provider, cur)
      // 只有还有别的未冷却 key 才重试；单 key 或全冷却时直接放弃（不无意义重试，也不崩溃）
      if (hasOtherLiveKey(provider, cur)) {
        // 安全上限：同一 step 内每个 key 至多试一次，全试完仍失败则放弃（终态）
        const ak = `${payload.turn}:${payload.step}`
        const n = (attempts.get(ak) || 0) + 1
        attempts.set(ak, n)
        if (n <= pool.keys.length) return { kind: 'retry' }
        attempts.delete(ak)
      }
    }
    return next()
  })

  // ── 只读状态接口（给卡片用）──
  const webServer = ctx.get('webServer')
  if (webServer) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: `${API_BASE}/pools`,
      handler: (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return }
        const now = Date.now()
        const out = {}
        for (const [provider, p] of pools) {
          out[provider] = {
            env: p.env,
            keyCount: p.keys.length,
            currentIndex: p.idx,
            cooling: p.keys.filter((k) => ((p.states.get(k) && p.states.get(k).cooldownUntil) || 0) > now).map(mask),
            healthy: p.keys.filter((k) => ((p.states.get(k) && p.states.get(k).cooldownUntil) || 0) <= now).map(mask),
          }
        }
        sendJson(res, 200, { pools: out })
      },
    }), 'key-fallback: pools route')
  }

  ctx.effect(() => () => { lifetime.abort() })
}
