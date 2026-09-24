// @omdp/dsh-key-fallback — Host half (ESM, v6)
//
// v6 = v5 全量功能 + 用户要求的修复与增强：
//   - 轮转触发码真正生效：agent/request-error 按池的 rotateOn 判断（可配置、chips 可点选），
//     数字 status 与消息关键字按所选触发码映射；默认集=旧行为超集（无回归）。
//   - 「当前使用」显示修复：GET /pools 返回 activeRef（= 最近一次预写进 process.env 的 key），
//     POST/PATCH 改 useKeyRef 后同步刷新内存池 + env，UI 立刻显示真正在用的 key。
//   - key 短命名：新增 key 自动命名为 key_fallback_<provider>_key<N>；
//     旧的长 ref 在首次加载时一次性迁移（refsCompacted 标记，幂等，先 set 新 ref 再 unset 旧 ref）。
//   - 明文揭示：GET /keys/plain?provider=&ref= 返回真实值（走 rawResolve，绕过池 wrap）。
//   - 环境密钥可编辑：PATCH /keys 的 ref 等于池 env 时改写 .credentials.yaml（describe 可写才允许）。
//   - 隐藏 bug 修复：PATCH /keys 解构 useKeyRef（此前「设为当前」静默失效）；
//     warmPools 不再二次调用 pickKey；GET /pools 返回真实 label；POST /diag 接受；
//     resolve wrap 尊重 pool.enabled。
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
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
// provider id 可能是 b-ai / B.AI 这类含非法字符的名字，自动派生 env 时消毒
// （- . 等 → _），保证派生名始终是合法 POSIX 标识符。
function deriveEnvName(name) {
  return String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'
}

export const name = 'key-fallback'
export const inject = ['llm', 'settings', 'webServer', 'credentials']
const API_BASE = '/dsh-key-fallback'
// 遵循 DSH_HOME（未设置时回落 ~/.dsh）：与 dsh-connector / dsh-archived-sessions 的
// 路径推导保持一致，也让隔离冒烟环境可以直接切换整个 home。
const DSH_HOME = (() => {
  const h = process.env.DSH_HOME
  return (typeof h === 'string' && h) ? h : join(homedir(), '.dsh')
})()
const SETTINGS_FILE = join(DSH_HOME, 'settings.yaml')
const SETTINGS_FILE_IMPORTED = SETTINGS_FILE + '.imported'
const CRED_FILE = join(DSH_HOME, '.credentials.yaml')
const BACKUP_DIR = join(DSH_HOME, 'backups')
// 一次性 legacy→profile 迁移的标记（见 apply() 里的迁移块）。
const MIGRATED_MARKER = join(DSH_HOME, '.key-fallback-migrated')
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
  rotateOn: z.array(z.string()).default(['QUOTA', 'AUTH', 'RATE_LIMIT', 'TIMEOUT', 'TRANSPORT', 'SERVER']),
  keyRefs: z.array(z.object({
    ref: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
    label: z.string().default(''),
    createdAt: z.number().default(0),
    nextRef: z.string().default(''),
  })).default([]),
  displayName: z.string().default(''),
  useKeyRef: z.string().default(''),
  refsCompacted: z.boolean().default(false),
})

// ── 配置后端（双版本兼容）─────────────────────────────────────────────
// 0.1.5-rc.3：配置在 <home>/settings.yaml 的 `key-fallback:` 段，插件自己读写该文件。
// 0.1.7+   ：DSH 启动时把 settings.yaml 改名为 settings.yaml.imported，段内容成为该 entry 的
//            config override（写进 profiles/<p>/cordis.patch.yml），由 ctx.settings 服务托管；
//            插件通过「volatile Config + describe/replace」读写，不再碰 settings.yaml。
//
// 关键前提：0.1.7 的迁移走 settings.update(ns, values) → write()，要求该 entry 存在且其
// Config 含 volatile 字段，否则抛错并打印「section ... was not imported」——配置静默丢失。
// 因此必须声明 Config（下面），且只在本版本 schemastery 支持 .volatile() 时声明，
// 使 rc.3 行为与改造前逐字节一致。
const _providersField = z.dict(z.any()).default({})
export const Config = (typeof _providersField.volatile === 'function')
  ? z.object({ providers: _providersField.volatile() })
  : undefined

const ENTRY_ID = 'key-fallback'
const diagLog = []
const diag = (kind, msg) => {
  try {
    diagLog.push({ kind, msg: String(msg).slice(0, 300), at: Date.now() })
    if (diagLog.length > 200) diagLog.splice(0, diagLog.length - 200)
  } catch (e) {}
}
let _settingsSvc = null   // ctx.settings（0.1.7+）
let _liveRef = null       // 0.1.7+: config.providers 的 volatile Ref（原地热更新）
let _cache = null         // 0.1.7+: 内存权威副本（乐观写，避免异步落盘窗口内读到旧值）
let _writing = 0          // 未确认写入计数

function readSettingsFromFile() {
  // settings.yaml 优先；0.1.7 迁移后已改名，回退读 .imported（只读引导，避免配置真空）
  for (const file of [SETTINGS_FILE, SETTINGS_FILE_IMPORTED]) {
    if (!existsSync(file)) continue
    try {
      const doc = loadYaml(readFileSync(file, 'utf8')) || {}
      const block = (doc && (doc[ENTRY_ID] || doc.keyFallback)) || {}
      if (block && block.providers) return block
    } catch (e) {}
  }
  return { providers: {} }
}

function cloneJson(v) {
  try { return v === undefined ? {} : JSON.parse(JSON.stringify(v)) } catch (e) { return v }
}

function readSettings() {
  if (_liveRef) {
    // _liveRef 就是 config.providers 这个 Ref：.get() 直接返回 providers 字典。
    // 它由 DSH deepFreeze，调用方却要就地改（新增/删除 provider、compactRefs 改 keyRefs），
    // 所以这里始终返回「可变深拷贝」。未决写入期间以内存副本为源（replace 是异步的，
    // 否则会读到落盘前的旧树，UI 立刻刷新会闪回旧值）。
    let src = _cache
    if (_writing === 0) { try { src = { providers: _liveRef.get() || {} } ; _cache = src } catch (e) {} }
    if (!src) { try { src = { providers: _liveRef.get() || {} }; _cache = src } catch (e) { src = { providers: {} } } }
    return { providers: cloneJson(src.providers) || {} }
  }
  return readSettingsFromFile()
}

function writeSettings(data) {
  if (_liveRef) {
    _cache = { providers: cloneJson((data && data.providers) || {}) }
    if (!_settingsSvc || typeof _settingsSvc.replace !== 'function') return
    _writing++
    Promise.resolve()
      .then(() => _settingsSvc.replace(ENTRY_ID, { providers: cloneJson(_cache.providers) }))
      .catch((e) => diag('settings-write', 'replace failed: ' + ((e && e.message) || e)))
      .finally(() => { _writing-- })
    return
  }
  backupFile(SETTINGS_FILE, 'settings')
  let root = {}
  try { if (existsSync(SETTINGS_FILE)) root = loadYaml(readFileSync(SETTINGS_FILE, 'utf8')) || {} } catch (e) {}
  root[ENTRY_ID] = data
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

// ── 轮转触发语义（v6：rotateOn 真正生效）──
// 注意：rotateOn 决定「失败后是否换下一把 key」，与 DSH 的重试机制（dsh-llm-retry 按
// provider 的 retryPolicy.retryableCodes 决定是否用同一把 key 重发、重试几次）相互独立、互补：
// 同一 failure.code，重试插件决定重发，本插件决定换 key。所以这是两套开关，不存在谁覆盖谁。
// 预设 = LlmError 标准码（换 key 有意义的全集）：QUOTA/AUTH/RATE_LIMIT/TIMEOUT/TRANSPORT/SERVER
// + EMPTY_RESPONSE/INVALID_CREDENTIAL。ABORTED（用户取消）永远不轮换。
const DEFAULT_ROTATE_ON = ['QUOTA', 'AUTH', 'RATE_LIMIT', 'TIMEOUT', 'TRANSPORT', 'SERVER', 'EMPTY_RESPONSE', 'INVALID_CREDENTIAL']
function canonicalCode(c) {
  const s = String(c || '').toUpperCase()
  if (s === 'QUOTA_EXCEEDED' || s === 'QUOTA') return 'QUOTA'
  return s
}
// 读取池配置时规范化 rotateOn；空数组/未配置 → 返回默认超集。
function effectiveRotateOn(stored) {
  const norm = (Array.isArray(stored) ? stored : []).map(canonicalCode).filter(Boolean)
  if (norm.length === 0) return [...DEFAULT_ROTATE_ON]
  return norm
}
const CODE_KEYWORDS = {
  QUOTA: /quota|insufficient|balance|credit|budget|exhaust|billing|limit exceeded/i,
  AUTH: /401|403|auth|credential|denied|forbidden|invalid key|api key|unauthor|token/i,
  RATE_LIMIT: /429|rate|limit|throttl|too many|try again later|concurr|busy/i,
  TIMEOUT: /timeout|timed ?out|deadline|gateway timeout/i,
  TRANSPORT: /transport|network|econn|socket|eai|dns|fetch failed|connection|closed|reset|unreachable/i,
  SERVER: /5\d\d|server error|internal|unavailable|502|503|504|bad gateway|overload/i,
  EMPTY_RESPONSE: /empty response|no content|empty reply/i,
  INVALID_CREDENTIAL: /invalid credential|malformed|bad credential|invalid api key/i,
}
function shouldRotate(pool, code, rawMsg, status) {
  const triggers = effectiveRotateOn(pool.cfg.rotateOn)
  if (triggers.includes(code)) return true
  const s = Number(status)
  if (Number.isFinite(s) && s >= 400 && s <= 599) {
    const mapped = s === 429 ? 'RATE_LIMIT' : (s === 401 || s === 403 ? 'AUTH' : (s === 402 ? 'QUOTA' : (s >= 500 ? 'SERVER' : 'AUTH')))
    if (triggers.includes(mapped)) return true
  }
  for (const t of triggers) {
    const rx = CODE_KEYWORDS[t]
    if (rx && rx.test(rawMsg)) return true
  }
  return false
}

// ── key 短命名 ──
function safeProvider(provider) {
  return String(provider || '').replace(/[^A-Za-z0-9_]/g, '_')
}
function isShortRef(ref) {
  return /^key_fallback_[A-Za-z0-9_]+_key\d+$/.test(ref)
}
function shortRefOf(provider, n) {
  return 'key_fallback_' + safeProvider(provider) + '_key' + n
}
// 为新增 key 分配下一个空闲短 ref（key1、key2…）
function nextKeyRef(provider, keyRefs) {
  const used = new Set((Array.isArray(keyRefs) ? keyRefs : []).map((e) => e && e.ref).filter(Boolean))
  let n = 1
  while (used.has(shortRefOf(provider, n))) n++
  return shortRefOf(provider, n)
}
// 从 ref 派生显示名（label 优先，否则 key_fallback_x_keyN → keyN）
function displayNameOf(entry) {
  if (entry && entry.label) return entry.label
  const ref = (entry && entry.ref) || ''
  const m = /_key(\d+)$/.exec(ref)
  if (m) return 'key' + m[1]
  return ref
}

export function apply(ctx, config) {
  try { ctx.logger.info('key-fallback: v7 host apply() starting') } catch (e) {}
  diag('apply', 'host loaded')

  // ── 0.1.7+：把配置接到 settings 服务托管的那份树 ──
  // config.providers 平时是 volatile Ref（.get() 随编辑热更新）；无 config 或非 Ref 时
  // 保持文件后端。两者都在这里判定一次，之后 readSettings/writeSettings 自动分流。
  try {
    const svc = ctx.get('settings')
    const prov = config && config.providers
    if (svc && typeof svc.replace === 'function' && prov && typeof prov.get === 'function') {
      _settingsSvc = svc
      _liveRef = prov   // = config.providers，Ref.get() 直接给 providers 字典
      _cache = { providers: prov.get() || {} }
      diag('settings', 'backend = profile entry (0.1.7+), providers=' + Object.keys(_cache.providers).join(','))
      // 无需额外订阅：readSettings() 每次（无未决写入时）都从 Ref 重取，外部编辑自动生效
    } else {
      diag('settings', 'backend = settings.yaml file (rc.x)')
    }
  } catch (e) { diag('settings', 'probe failed: ' + ((e && e.message) || e)) }

  // ── 一次性迁移：老 settings.yaml(.imported) 里的池 → settings 托管的 entry config ──
  // 0.1.7 的 importLegacyDocument() 在首次写入前就把 settings.yaml 改名成
  // settings.yaml.imported，而本机的池恰好躺在 .imported 里 —— 迁移入口已永久失活，
  // 池不会自己回到 UI（表现为徽标「尚未启用」+「还没有任何池」）。
  //
  // 必须在首个 HTTP 请求时做，不能在这里（apply 期间）做：settings.replace() 走
  // configEditor.edit()，要求本 entry 的 fiber 已 ACTIVE（describe() 会跳过
  // state !== 2 的 entry），apply() 执行时 fiber 尚在创建中，必然抛
  // "No configurable plugin entry"。UI 打开设置页就会请求 /pools，时机正好。
  // 标记文件保证「真正只做一次」：否则用户有意清空所有池后，下次启动又会灌回来。
  let _migrationAttempted = false
  async function ensureLegacyMigration() {
    if (_migrationAttempted) return
    _migrationAttempted = true
    try {
      if (!_liveRef || existsSync(MIGRATED_MARKER)) return
      if (Object.keys((_cache && _cache.providers) || {}).length > 0) return
      const migrated = (readSettingsFromFile() || {}).providers || {}
      const names = Object.keys(migrated)
      if (names.length === 0) {
        // 无可搬运内容：也落标记（空文件算「已处理过」），避免每次启动重复探测。
        try { writeFileSync(MIGRATED_MARKER, new Date().toISOString() + '\n', 'utf8') } catch (e) {}
        return
      }
      // 直接 await 真正的 replace：只有落盘成功才写标记，否则下次启动还能重试。
      if (!_settingsSvc || typeof _settingsSvc.replace !== 'function') return
      _cache = { providers: cloneJson(migrated) }
      await _settingsSvc.replace(ENTRY_ID, { providers: cloneJson(migrated) })
      try { writeFileSync(MIGRATED_MARKER, new Date().toISOString() + '\n', 'utf8') } catch (e) {}
      diag('migrate', 'imported ' + names.length + ' provider(s) from settings.yaml(.imported): ' + names.join(','))
    } catch (e) { diag('migrate', 'failed: ' + ((e && e.message) || e)) }
  }
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
      if (pool && pool.cfg && pool.cfg.enabled !== false && pool.currentRef) {
        const cur = pool.keyValues.find((k) => k.ref === pool.currentRef)
        if (cur) { diag('resolve', 'pool-hit ' + refName + ' -> ' + cur.ref); return { value: cur.value, source: 'pool' } }
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
    // 每次全量重建 env 索引：删除池/改 env 后不得残留旧映射（否则 wrap 会命中已删池）
    poolsByEnv.clear()
    for (const name in providers) {
      if (!pools.has(name)) pools.set(name, { cfg: providers[name], keyValues: [], cursor: 0, currentRef: '' })
      else pools.get(name).cfg = providers[name]
      const envName = (providers[name] && providers[name].env) || deriveEnvName(name)
      poolsByEnv.set(envName, pools.get(name))
    }
    for (const name of [...pools.keys()]) if (!providers[name]) pools.delete(name)
  }

  // 一次性迁移旧长 ref → 短 ref（key_fallback_x_keyN）。幂等：迁移后长 ref 不存在即自然短路。
  // 顺序：先 set 新 ref（从旧 ref 读值）→ 改 settings → 再 unset 旧 ref；任一步失败即中止，保留旧状态可重试。
  // 注意：不依赖 refsCompacted 短路——空池创建会先置标记，若之后外部导入旧格式长 ref 仍必须迁移。
  async function compactRefs(provider, prof) {
    const entries = (prof.keyRefs || []).map((e) => {
      if (typeof e === 'string') return { ref: e, label: '', createdAt: 0, nextRef: '' }
      return { ref: e.ref || '', label: e.label || '', createdAt: e.createdAt || 0, nextRef: e.nextRef || '' }
    })
    const longOnes = entries.filter((e) => e.ref && e.ref.startsWith('key_fallback_') && !isShortRef(e.ref))
    if (longOnes.length === 0) return false
    const oldToNew = new Map()
    const used = new Set(entries.map((e) => e.ref).filter(isShortRef))
    let n = 1
    for (const e of longOnes) {
      while (used.has(shortRefOf(provider, n))) n++
      oldToNew.set(e.ref, shortRefOf(provider, n))
      used.add(shortRefOf(provider, n))
      n++
    }
    // 1) 写新 ref（读旧值）
    for (const [oldRef, newRef] of oldToNew) {
      let hit
      try { hit = rawResolve ? await rawResolve(credentialRef(oldRef)) : await ctx.credentials.resolve(credentialRef(oldRef)) } catch (e) { hit = undefined }
      if (!hit || !hit.value) return false
      try { backupFile(CRED_FILE, 'credentials'); await ctx.credentials.set(credentialRef(newRef), hit.value) } catch (e) { return false }
    }
    // 2) 更新 settings 引用
    for (const e of entries) {
      if (e.ref && oldToNew.has(e.ref)) e.ref = oldToNew.get(e.ref)
      if (e.nextRef && oldToNew.has(e.nextRef)) e.nextRef = oldToNew.get(e.nextRef)
    }
    if (prof.useKeyRef && oldToNew.has(prof.useKeyRef)) prof.useKeyRef = oldToNew.get(prof.useKeyRef)
    prof.keyRefs = entries
    prof.refsCompacted = true
    // 3) unset 旧 ref（best-effort）
    for (const oldRef of oldToNew.keys()) { try { await ctx.credentials.unset(credentialRef(oldRef)) } catch (e) {} }
    return true
  }

  async function resolvePoolKeys(pool, providerName) {
    // 迁移旧 ref（一次），成功后持久化 settings —— 用与 pool.cfg 同一对象的 settings 块
    const cfg = readSettings()
    const providers = cfg.providers || {}
    // 让 pool.cfg 指向本次解析的树（之前 readPools 解析的是旧树，改它无法写回）
    if (providers[providerName]) pool.cfg = providers[providerName]
    let compacted = false
    if (pool.cfg) { try { compacted = await compactRefs(providerName, pool.cfg) } catch (e) { compacted = false } }
    if (compacted) writeSettings(cfg)
    // 保留已有状态（failCount/cooldown/lastError），避免重建时丢状态
    const prev = new Map(pool.keyValues.map((k) => [k.ref, k]))
    pool.keyValues = []
    const entries = (pool.cfg.keyRefs || []).map((e) => typeof e === 'string' ? { ref: e, label: '', createdAt: 0, nextRef: '' } : e)
    for (const entry of entries) {
      const ref = (entry && typeof entry === 'object') ? entry.ref : entry
      const nextRef = (entry && typeof entry === 'object' && entry.nextRef) ? entry.nextRef : ''
      if (!ref) continue
      try {
        const hit = rawResolve ? await rawResolve(credentialRef(ref)) : await ctx.credentials.resolve(credentialRef(ref))
        if (hit && hit.value) {
          const old = prev.get(ref) || {}
          pool.keyValues.push({
            ref, value: hit.value, source: 'user', label: (entry && entry.label) || '',
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
              ref: envRef, value: hit.value, source: 'env', label: '',
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
    await resolvePoolKeys(pool, provider)
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

  // 把 useKeyRef 选择立即落到内存池 + process.env，让「当前使用」立刻真实
  function applySelection(pool, ref) {
    if (!pool || !ref) return
    const kv = pool.keyValues.find((k) => k.ref === ref)
    if (!kv) return
    pool.currentRef = ref
    try { process.env[pool.cfg.env] = kv.value } catch (e) {}
  }

  // ── 预写：v1 同款 —— 全局 agent/request（DSH 全局收得到这个 waterfall），
  //    每次请求同步 buildPools() 重读 settings，选 key，同步写 process.env，
  //    credentials.set fire-and-forget（不 await 阻塞 waterfall）。
  async function warmPools() {
    readPools()
    for (const name of pools.keys()) {
      const pool = pools.get(name)
      if (pool) {
        try { await resolvePoolKeys(pool, name) } catch (e) {}
        // 预热时确定初始 currentRef：useKeyRef 锁定优先，否则 pickKey（只调一次）
        if (pool.keyValues.length > 0 && !pool.currentRef) {
          const locked = pool.cfg.useKeyRef && pool.keyValues.find((k) => k.ref === pool.cfg.useKeyRef)
          let picked = null
          if (!(locked && locked.ref)) picked = pickKey(pool)
          pool.currentRef = (locked && locked.ref) || (picked && picked.ref) || pool.keyValues[0].ref
        }
      }
    }
  }

  // 启动时预热 pools（resolve keyValues，供同步预写 pickKey 用）
  try { warmPools().catch(() => {}) } catch (e) {}

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
        try { backupFile(CRED_FILE, 'credentials') } catch (e) {}
      } catch (e) {}
      return config
    }).catch((e) => {})
    return p
  })

  // ── 失败处理：标记当前 key + 切下一个（prepend 注册：先于 dsh-llm-retry 看到错误，切完 key 再放行）──
  ctx.on('agent/request-error', async (payload, next) => {
    const code = String((payload && payload.failure && payload.failure.code) || (payload && payload.code) || '')
    const rawMsg = String((payload && payload.failure && payload.failure.message) || (payload && payload.message) || '')
    const status = (payload && payload.failure && payload.failure.status) || (payload && payload.status)
    const provider = (payload && payload.provider) || ''
    if (!provider) return next()
    diag('request-error', 'provider=' + provider + ' code=' + code + ' status=' + status)
    const pool = await getPool(provider)
    if (!pool || pool.keyValues.length === 0 || pool.cfg.enabled === false) return next()
    if (!shouldRotate(pool, canonicalCode(code), rawMsg, status)) return next()
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
      try { await backupFile(CRED_FILE, 'credentials'); process.env[pool.cfg.env] = nextKey.value } catch (e) {}
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
        // 首次请求时补做 legacy 池迁移（此时 fiber 已 ACTIVE，settings.replace 可用）。
        // 放在所有分支之前，保证无论 UI 先请求哪个端点，池都已被搬进 live 配置。
        // 首次请求时补做 legacy 池迁移（此时 fiber 已 ACTIVE，settings.replace 可用）。
        // 放在所有分支之前，保证无论 UI 先请求哪个端点，池都已被搬进 live 配置。
        await ensureLegacyMigration()
        const url = new URL(req.url, 'http://127.0.0.1')
        const path = url.pathname.replace(new RegExp('^' + API_BASE + '/?'), '').replace(/\/$/, '')
        const readBody = () => new Promise((resolve, reject) => {
          let raw = '', size = 0
          req.on('data', (c) => { size += c.length; if (size > (1 << 20)) { reject(new Error('body too large')); req.destroy(); return } raw += c.toString('utf8') })
          req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)) } catch (e) { reject(e) } })
          req.on('error', reject)
        })

        if (path === 'diag' && (req.method === 'GET' || req.method === 'POST')) {
          if (req.method === 'POST') {
            try { const b = await readBody(); diag(b.kind || 'client', b.message || b.msg || '') } catch (e) {}
            return sendJson(res, 200, { ok: true })
          }
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
              await resolvePoolKeys(pool, name)
              const now = Date.now()
              // 真正当前使用的 key：最近一次预写进 process.env 的值
              let activeRef = ''
              if (pool.cfg.enabled !== false) {
                const envCur = process.env[pool.cfg.env]
                if (envCur) { const m = pool.keyValues.find((k) => k.value === envCur); if (m) activeRef = m.ref }
                if (!activeRef && pool.currentRef) activeRef = pool.currentRef
              }
              // 环境密钥可写性（描述：文件=可写，启动环境=只读）
              let envWritable = null
              let envSource = ''
              try {
                if (ctx.credentials.describe) {
                  const d = await ctx.credentials.describe(credentialRef(pool.cfg.env))
                  envWritable = d ? d.writable !== false : null
                  envSource = d ? (d.source || '') : ''
                }
              } catch (e) {}
              const keys = pool.keyValues.map((k) => {
                const cooling = (k.cooldownUntil || 0) > now
                const entry = (pool.cfg.keyRefs || []).find((x) => (x && x.ref) === k.ref) || {}
                return {
                  ref: k.ref,
                  name: displayNameOf({ label: k.label || entry.label, ref: k.ref }),
                  label: k.label || entry.label || '',
                  source: k.source,
                  nextRef: k.nextRef || '',
                  status: cooling ? 'cooling' : (k.failCount ? 'recovered' : 'live'),
                  failCount: k.failCount || 0,
                  cooldownUntil: k.cooldownUntil || 0,
                  cooldownRemainingMs: cooling ? (k.cooldownUntil - now) : 0,
                  lastErrorAt: k.lastErrorAt || 0,
                  lastErrorMsg: k.lastErrorMsg || '',
                  active: k.ref === activeRef,
                }
              })
              out.push({
                provider: name,
                displayName: pool.cfg.displayName || name,
                env: pool.cfg.env,
                cooldownMs: pool.cfg.cooldownMs,
                enabled: pool.cfg.enabled,
                rotateOn: effectiveRotateOn(pool.cfg.rotateOn),
                useKeyRef: pool.cfg.useKeyRef || '',
                currentRef: pool.currentRef || '',
                activeRef: activeRef,
                activeName: activeRef ? (keys.find((k) => k.ref === activeRef) || {}).name || activeRef : '',
                envKeyValue: pool.envKeyValue ? mask(pool.envKeyValue) : '',
                envWritable: envWritable,
                envSource: envSource,
                keys: keys,
              })
            }
            return sendJson(res, 200, { pools: out })
          }
          if (req.method === 'POST') {
            const body = await readBody()
            const { provider, enabled, env, cooldownMs, rotateOn, displayName, useKeyRef } = body || {}
            if (typeof provider !== 'string' || !provider) return sendJson(res, 400, { error: 'provider required' })
            const envName = (typeof env === 'string' && env) ? env : deriveEnvName(provider)
            if (!isCredentialRefName(envName)) return sendJson(res, 400, { error: 'env must be POSIX identifier' })
            const cfg = readSettings()
            cfg.providers = cfg.providers || {}
            const cur = cfg.providers[provider] || {}
            const upd = {
              env: envName,
              enabled: enabled !== false,
              cooldownMs: Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : (cur.cooldownMs ?? 30000),
              rotateOn: Array.isArray(rotateOn) && rotateOn.length > 0 ? rotateOn.map(canonicalCode).filter(Boolean) : effectiveRotateOn(cur.rotateOn),
              keyRefs: (cur.keyRefs || []).map((x) => {
                if (typeof x === 'string') return { ref: x, label: '', createdAt: 0, nextRef: '' }
                return { ref: x.ref, label: x.label || '', createdAt: x.createdAt || 0, nextRef: x.nextRef || '' }
              }),
              displayName: (typeof displayName === 'string' && displayName) ? displayName : (cur.displayName || provider),
              useKeyRef: (typeof useKeyRef === 'string') ? useKeyRef : (cur.useKeyRef || ''),
              refsCompacted: cur.refsCompacted === true,
            }
            let validated
            try { validated = profileSchema(upd) } catch (e) { return sendJson(res, 400, { error: 'invalid profile: ' + (e && e.message || e) }) }
            cfg.providers[provider] = validated
            writeSettings(cfg)
            // 同步内存池 + env，让「当前使用」立刻真实
            try {
              const pool = await getPool(provider)
              if (pool) {
                if (validated.useKeyRef) applySelection(pool, validated.useKeyRef)
                else if (pool.currentRef && !pool.keyValues.find((k) => k.ref === pool.currentRef && isLive(k))) {
                  const pk = pickKey(pool); if (pk) { pool.currentRef = pk.ref; try { process.env[pool.cfg.env] = pk.value } catch (e) {} }
                }
              }
            } catch (e) {}
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
            pools.delete(provider)
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
            const newRef = nextKeyRef(provider, prof.keyRefs || [])
            try { backupFile(CRED_FILE, 'credentials'); await ctx.credentials.set(credentialRef(newRef), value) } catch (e) { return sendJson(res, 500, { error: 'credentials write failed' }) }
            const newEntry = { ref: newRef, label: (typeof label === 'string' && label) ? label : '', createdAt: Date.now(), nextRef: '' }
            prof.keyRefs = [...(prof.keyRefs || []), newEntry]
            writeSettings(cfg)
            // 刷新内存池，让新 key 立即可参与轮换（幂等；已 compacted 则快速返回）
            try { await getPool(provider) } catch (e) {}
            return sendJson(res, 200, { ok: true, key: newEntry, valueMask: mask(value) })
          }
          if (req.method === 'PATCH') {
            const body = await readBody()
            const { provider, ref, value, label, nextRef, useKeyRef } = body || {}
            if (typeof provider !== 'string' || !provider || typeof ref !== 'string' || !ref) return sendJson(res, 400, { error: 'provider & ref required' })
            const cfg = readSettings()
            const prof = cfg.providers && cfg.providers[provider]
            if (!prof) return sendJson(res, 404, { error: 'pool not found' })
            const entry = (prof.keyRefs || []).find((k) => k.ref === ref)
            const isEnvKey = ref === prof.env
            if (!entry && !isEnvKey) return sendJson(res, 404, { error: 'key not found' })
            if (typeof value === 'string' && value) {
              // 环境密钥：允许改写 .credentials.yaml（describe 可写才允许；启动环境提供=只读）
              if (isEnvKey) {
                let writable = null
                try { if (ctx.credentials.describe) { const d = await ctx.credentials.describe(credentialRef(ref)); writable = d ? d.writable !== false : null } } catch (e) {}
                if (writable === false) return sendJson(res, 400, { error: '该环境密钥由启动环境提供（只读）；请改启动 DSH 的终端环境变量' })
              }
              try { backupFile(CRED_FILE, 'credentials'); await ctx.credentials.set(credentialRef(ref), value) } catch (e) { return sendJson(res, 500, { error: 'credentials write failed: ' + ((e && e.message) || e) }) }
              // 同步内存池 + env
              try {
                const pool = pools.get(provider)
                if (pool) {
                  const kv = pool.keyValues.find((k) => k.ref === ref)
                  if (kv) kv.value = value
                  if (isEnvKey) pool.envKeyValue = value
                }
              } catch (e) {}
            }
            if (typeof label === 'string') { if (entry) entry.label = label }
            if (typeof nextRef === 'string') { if (entry) entry.nextRef = nextRef }
            if (typeof useKeyRef === 'string') {
              prof.useKeyRef = useKeyRef
              try { const pool = await getPool(provider); if (pool) applySelection(pool, useKeyRef) } catch (e) {}
            }
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
            if (ref === prof.env) return sendJson(res, 400, { error: '环境密钥不可删除' })
            const idx = (prof.keyRefs || []).findIndex((k) => k.ref === ref)
            if (idx < 0) return sendJson(res, 404, { error: 'key not found' })
            try { backupFile(CRED_FILE, 'credentials'); await ctx.credentials.unset(credentialRef(ref)) } catch (e) {}
            prof.keyRefs.splice(idx, 1)
            if (prof.useKeyRef === ref) prof.useKeyRef = ''
            // 清理指向已删 key 的 nextRef
            for (const k of (prof.keyRefs || [])) if (k.nextRef === ref) k.nextRef = ''
            writeSettings(cfg)
            // 同步内存池
            try {
              const pool = pools.get(provider)
              if (pool) {
                pool.keyValues = pool.keyValues.filter((k) => k.ref !== ref)
                if (pool.currentRef === ref) { pool.currentRef = ''; try { const pk = pickKey(pool); if (pk) { pool.currentRef = pk.ref; try { process.env[pool.cfg.env] = pk.value } catch (e) {} } } catch (e) {} }
              }
            } catch (e) {}
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }

        // 明文揭示：仅限本池拥有的 user key 或环境密钥
        if (path === 'keys/plain' && req.method === 'GET') {
          const provider = url.searchParams.get('provider')
          const ref = url.searchParams.get('ref')
          if (!provider || !ref) return sendJson(res, 400, { error: 'provider & ref required' })
          const pool = await getPool(provider)
          if (!pool) return sendJson(res, 404, { error: 'pool not found' })
          const isUserKey = (pool.cfg.keyRefs || []).some((k) => k.ref === ref)
          const isEnvKey = ref === pool.cfg.env
          if (!isUserKey && !isEnvKey) return sendJson(res, 404, { error: 'key not found' })
          let hit
          try { hit = rawResolve ? await rawResolve(credentialRef(ref)) : await ctx.credentials.resolve(credentialRef(ref)) } catch (e) { hit = undefined }
          if (!hit || !hit.value) return sendJson(res, 404, { error: 'no value' })
          return sendJson(res, 200, { ok: true, ref: ref, value: hit.value })
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
