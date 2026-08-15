// dsh-vision-bridge — host 插件
// ============================================================
// 自动区分多模态/文本模型：
//   - 多模态模型（inputModalities 含 image）→ 不拦截，原图直接进上下文。
//   - 文本模型 → 通过可配置的多模态端点（baseUrl + apiKey + model）代看，
//                 返回文字证据；支持粘贴图片、read_image 工具、请求时改写。
//
// 设计参照 @liustack/modlens 的 dsh/index.js（零依赖、raw JSON-Schema 工具、
// 包装 provider + 请求时图片→证据改写、paste 路由），但多模态后端换成
// 可配置的 OpenAI 兼容端点（默认 https://api.agnes-ai.cn/v1 + agnes-2.5-flash）。
// 零依赖：只用 node builtins + 宿主 ctx 服务，不做 out-of-tree 的
// @deepseek-ai/dsh-tools 解析，绝对路径加载即可运行。
// ============================================================

export const name = 'dsh-vision-bridge'

import { appendFileSync as __logFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Registration log lives in the OS temp dir so the bundle is portable
// (the original hardcoded C:\Users\xj\... path broke on other machines).
const __LOG = join(tmpdir(), 'dsh-vision-bridge-register.log')
function __log(msg) {
  try { __logFs(__LOG, new Date().toISOString() + ' ' + msg + '\n') } catch {}
}
// Hard dependencies only: tools (register), attachments (read paste images),
// llm (resolveModelInfo), credentials (resolve api key). `agents` was an
// over-injection (never read) — Cordis would make the plugin wait for the
// agents service to appear even though nothing here consumes it.
export const inject = ['tools', 'attachments', 'llm', 'credentials']

const MEDIA_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
}

const PASTE_SNIFFS = [
  { ext: '.png', test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: '.jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif', test: (b) => b.length >= 6 && b.toString('ascii', 0, 3) === 'GIF' },
  { ext: '.webp', test: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { ext: '.heic', test: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' },
]
const PASTE_MAX_BYTES = 25 * 1024 * 1024
// Local files bigger than this are rejected before being base64-encoded, to
// avoid loading a huge image into memory (data URL inflates ~33%).
const FILE_MAX_BYTES = 25 * 1024 * 1024
const EVIDENCE_CACHE_LIMIT = 64

// ---------- 配置 ----------
// Config 不强制（cordis 插件可无 schema）；apply 直接收 plain config。
// provider.baseUrl / provider.apiKey / provider.model / provider.credential
// defaultPrompt / families / discover / toolName / timeoutMs /
// autoRead / pasteToPath / upstream / providerId

// ---------- 工具函数 ----------

function normalizeBase(base) {
  return String(base || 'https://api.agnes-ai.cn/v1').trim().replace(/\/+$/, '')
}

async function resolveApiKey(ctx, config) {
  if (config?.provider?.apiKey) return String(config.provider.apiKey)
  const ref = config?.provider?.credential || 'AGNES_API_KEY'
  try {
    const cred = await ctx.credentials?.resolve?.(ref)
    if (cred && cred.value) return cred.value
    console.warn(`[dsh-vision-bridge] credential "${ref}" not found in credentials store; falling back to process.env`)
  } catch (error) {
    console.error(`[dsh-vision-bridge] credential resolve for "${ref}" failed:`, error && error.message)
  }
  const fromEnv = process.env[ref] || ''
  if (!fromEnv) {
    console.warn(`[dsh-vision-bridge] "${ref}" is neither in credentials nor process.env — multimodal calls will fail with 401`)
  }
  return fromEnv
}

// Map common HTTP status codes to a short, actionable Chinese hint so the
// model/agent sees WHY the multimodal call failed, not just the raw status.
function statusHint(status) {
  switch (status) {
    case 401: return 'API key 无效或缺失，请检查 credential/env'
    case 403: return '没有权限访问该多模态端点'
    case 404: return '端点或模型不存在，请检查 baseUrl/model'
    case 429: return '请求过于频繁（限流），请稍后重试'
    case 500: case 502: case 503: return '多模态服务端异常，请稍后重试'
    default: return ''
  }
}

// 调多模态端点（OpenAI 兼容 chat/completions，图片用 image_url）
async function askMultimodal(ctx, config, imageUrl, prompt, signal, timeoutMs) {
  const base = normalizeBase(config?.provider?.baseUrl)
  const model = config?.provider?.model || 'agnes-2.5-flash'
  const apiKey = await resolveApiKey(ctx, config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs || 120000)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || ('HTTP ' + res.status)
      const hint = statusHint(res.status)
      throw new Error(msg + (hint ? `（${hint}）` : ''))
    }
    const text = data?.choices?.[0]?.message?.content
    if (!text || typeof text !== 'string') throw new Error('多模态端点未返回文本内容')
    return { ok: true, text, model, baseUrl: base }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

// 本地路径 → data URL；http(s) URL 原样返回
async function pathToImageUrl(path) {
  if (/^https?:\/\//i.test(path)) return path
  const { readFile, stat } = await import('node:fs/promises')
  try {
    const info = await stat(path)
    if (info.size > FILE_MAX_BYTES) {
      throw new Error(`file too large (${Math.round(info.size / 1024 / 1024)}MB > ${Math.round(FILE_MAX_BYTES / 1024 / 1024)}MB limit)`)
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`file not found: ${path}`)
    throw error
  }
  const buf = await readFile(path)
  const ext = String(path.split('.').pop() || '').toLowerCase()
  const mime = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  }[ext] || 'application/octet-stream'
  return 'data:' + mime + ';base64,' + buf.toString('base64')
}

// ---------- 图片块 → 证据文本（文本分支核心） ----------

async function readImageBlock(ctx, config, block, signal) {
  try {
    const stored = await ctx.attachments.readImage(block.attachment, signal)
    if (!stored?.data) throw new Error("attachments.readImage 未返回字节（attachment 形状可能变了）")
    const mediaType = stored.ref?.mediaType ?? block.attachment?.mediaType
    if (!MEDIA_EXT[mediaType]) throw new Error('不支持粘贴的媒体类型 ' + (mediaType || '(无)'))
    const dataUrl = 'data:' + mediaType + ';base64,' + Buffer.from(stored.data).toString('base64')
    const result = await askMultimodal(
      ctx, config, dataUrl,
      config?.defaultPrompt || '请完整描述这张图片的内容，包括所有文字、布局、元素和细节。',
      signal, config?.timeoutMs,
    )
    return { ok: true, block: { type: 'text', text: '[粘贴图片，已由 vision bridge 识别]\n' + result.text } }
  } catch (error) {
    return {
      ok: false,
      block: {
        type: 'text',
        text: '[粘贴图片识别失败: ' + (error && error.message ? String(error.message).slice(0, 300) : String(error)) + ']',
      },
    }
  }
}

function contentHasImage(blocks) {
  return Array.isArray(blocks) && blocks.some(
    (b) => b?.type === 'image' || (b?.type === 'tool-result' && contentHasImage(b.content)),
  )
}

async function convertBlocks(blocks, convertOne) {
  const out = []
  for (const block of blocks) {
    if (block?.type === 'image') out.push(await convertOne(block))
    else if (block?.type === 'tool-result' && contentHasImage(block.content)) {
      out.push({ ...block, content: await convertBlocks(block.content, convertOne) })
    } else out.push(block)
  }
  return out
}

async function convertImagesToEvidence(ctx, config, messages, signal, adapter) {
  const out = []
  for (const message of messages) {
    if (!contentHasImage(message.content)) { out.push(message); continue }
    const content = await convertBlocks(message.content, (block) =>
      abortableWait(cachedEvidence(ctx, config, adapter, block), signal))
    out.push({ ...message, content })
  }
  return out
}

function cachedEvidence(ctx, config, adapter, block) {
  // Cache key from leaf fields only — never JSON.stringify the whole internal
  // attachment object (it may be non-serializable or circular, and Cordis live
  // data must not be copied wholesale). Extract the stable scalars that
  // actually identify the image.
  const a = block.attachment
  const leaf = a && typeof a === 'object'
    ? [a.id, a.path, a.mediaType, a.url].map((x) => (x === undefined || x === null ? '' : String(x))).join('|')
    : JSON.stringify(block)
  const key = leaf || 'empty'
  const hit = adapter.evidenceCache?.get?.(key)
  if (hit !== undefined) {
    adapter.evidenceCache.delete(key)
    adapter.evidenceCache.set(key, hit)
    return hit
  }
  const pending = readImageBlock(ctx, config, block, undefined).then(
    (evidence) => {
      if (!evidence.ok && adapter.evidenceCache?.get?.(key) === pending) {
        adapter.evidenceCache.delete(key)
      }
      return evidence.block
    },
    (error) => {
      if (adapter.evidenceCache?.get?.(key) === pending) adapter.evidenceCache.delete(key)
      return { type: 'text', text: '[图片识别失败: ' + (error?.message || String(error)).slice(0, 300) + ']' }
    },
  )
  adapter.evidenceCache.set(key, pending)
  while (adapter.evidenceCache.size > EVIDENCE_CACHE_LIMIT) {
    adapter.evidenceCache.delete(adapter.evidenceCache.keys().next().value)
  }
  return pending
}

function abortableWait(promise, signal) {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new Error('aborted')); return }
    const onAbort = () => reject(signal.reason ?? new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

// ---------- 工具注册：read_image / vision_bridge_read_image ----------

function registerReadImageTool(ctx, config) {
  const toolName = config?.toolName || 'vision_bridge_read_image'
  const tool = {
    name: toolName,
    description:
      '通过 vision bridge 识别图片：支持本地文件路径、http(s) 图片 URL、聊天中粘贴的图片路径。' +
      '若当前模型支持图片输入则直接阅读；否则由插件调用配置的多模态模型（baseUrl+apiKey+model）代看并返回文字描述。' +
      '可传单张 path 或多张 paths；prompt 参数由你（文本模型）决定对图片的具体意图；json=true 返回结构化结果。',
    // NOTE: registered via ctx.tools.register (installed-bundle path), which
    // forwards `parameters` verbatim to the OpenAI-compatible provider. A
    // per-property map (no top-level `type`) arrives as `type: null` and the
    // provider rejects it ("schema must be a JSON Schema of type object, got
    // type null"). So we must supply a complete JSON Schema object here.
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '图片的绝对本地路径或 http(s) URL（与 paths 二选一）',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '多张图片的路径/URL 列表（与 path 二选一；多图按序识别后拼接）',
        },
        prompt: {
          type: 'string',
          description: '可选：针对图片的具体问题/意图，例如"提取所有文字"、"描述布局"、"比较这两张图的区别"',
        },
        json: {
          type: 'boolean',
          description: '可选：true 时返回结构化 JSON（含原始文字），否则返回纯文本描述',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          branch: { type: 'string' },
          model: { type: 'string' },
          results: { type: 'array' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{ type: 'text', text: value?.text ?? String(value) }],
    },
    timeoutMs: (config?.timeoutMs || 120000) + 20000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: toolName,
      kind: 'read',
      rawInput: args,
      ...(typeof args?.path === 'string' && !/^https?:\/\//i.test(args.path)
        ? { locations: [{ path: args.path }] } : {}),
    }),
    async execute(args, exec) {
      const images = args?.path ? [args.path] : (Array.isArray(args?.paths) ? args.paths : [])
      if (images.length === 0) throw new Error(toolName + ' 需要 path 或 paths')
      // 1) 判断当前路由模型是否支持图片输入
      const routed = exec.agent?.session?.requestHeader?.()?.config
      const provider = routed?.provider ?? exec.agent?.options?.provider
      const model = routed?.model ?? exec.agent?.options?.model
      let capable = false
      if (provider && model && ctx.get('llm')?.resolveModelInfo) {
        try {
          const info = await ctx.get('llm').resolveModelInfo(provider, model, exec.signal)
          capable = Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
        } catch (error) {
          console.error('[dsh-vision-bridge] resolveModelInfo failed:', error && error.message)
        }
      }
      if (capable) {
        return { ok: true, branch: 'multimodal', text: '当前模型支持图片输入，请直接阅读图片附件或图片内容，无需调用本桥。' }
      }
      // 2) 文本分支：逐图调多模态端点
      const prompt = args?.prompt || config?.defaultPrompt || '请完整描述这张图片的内容，包括所有文字、布局、元素和细节。'
      const results = []
      for (const imgPath of images) {
        const imageUrl = await pathToImageUrl(imgPath)
        const result = await askMultimodal(ctx, config, imageUrl, prompt, exec.signal, config?.timeoutMs)
        results.push({ image: imgPath, text: result.text, model: result.model })
      }
      if (args?.json) return { ok: true, branch: 'text', results }
      const text = results.map((r, i) => (results.length > 1 ? '【图' + (i + 1) + '】' + r.text : r.text)).join('\n')
      return { ok: true, branch: 'text', model: results[0]?.model, text }
    },
  }
  try {
    ctx.tools.register(tool)
    __log('read_image registered as "' + toolName + '"')
  } catch (error) {
    __log('read_image register threw: ' + error.message)
    const fallback = 'vision_bridge_read_image'
    if (toolName !== fallback && /already|duplicate/i.test(String(error))) {
      try {
        ctx.tools.register({ ...tool, name: fallback })
        __log('duplicate -> registered fallback "' + fallback + '"')
        console.error('[dsh-vision-bridge] 工具名 "' + toolName + '" 被占用，注册为 "' + fallback + '"')
      } catch (retryError) {
        __log('fallback register threw: ' + retryError.message)
        console.error('[dsh-vision-bridge] read_image 注册失败: ' + retryError)
      }
    } else {
      __log('read_image register final error: ' + error.message)
      console.error('[dsh-vision-bridge] read_image 注册失败: ' + error)
    }
  }
}

// ---------- 包装 provider（粘贴放行关键） ----------

function registerVisionProvider(ctx, config) {
  if (config?.visionProvider === false) return
  const families = config?.families || ['deepseek', 'glm']
  const VISION_ID = /(deepseek-(vl|ocr)|janus|glm-[\d.]*v(\b|-))/i
  const shouldWrap = (info) => {
    const id = String(info?.id ?? '').toLowerCase()
    if (!families.some((family) => id.startsWith(family))) return false
    if (VISION_ID.test(id)) return false
    if (Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')) return false
    return true
  }
  if (typeof ctx.llm?.registerAdapter !== 'function' || typeof ctx.llm?.stream !== 'function') return

  const registerWrapper = (upstream, providerId, displayName) => {
    const withVision = (info) => ({
      ...info,
      provider: providerId,
      inputModalities: ['text', 'image'],
    })
    try {
      ctx.llm.registerAdapter([providerId], {
        providerInfo(provider) { return { id: provider, name: displayName } },
        providerRetryPolicy() { return undefined },
        async listModels(_provider, signal) {
          try {
            const models = await ctx.llm.listModels(upstream, signal)
            return models.filter(shouldWrap).map((model) => ({
              ...withVision(model),
              name: (model.name ?? model.id) + ' (vision bridge)',
            }))
          } catch { return [] }
        },
        async resolveModel(_provider, model, signal) {
          const info = await ctx.llm.resolveModelInfo(upstream, model, signal)
          if (!shouldWrap(info)) throw new Error('model "' + model + '" 不在 vision bridge 包装范围内')
          return { ...withVision(info), id: model }
        },
        stream(options) {
          const self = this
          return (async function* () {
            const messages = await convertImagesToEvidence(ctx, config, options.messages, options.signal, self)
            yield* ctx.llm.stream({ ...options, provider: upstream, messages })
          })()
        },
        evidenceCache: new Map(),
      })
      return true
    } catch (error) {
      if (/already|duplicate/i.test(String(error))) {
        console.error('[dsh-vision-bridge] vision provider ' + providerId + ' 已注册，保留现有')
        return true
      }
      console.error('[dsh-vision-bridge] vision provider 注册失败 (' + providerId + '): ' + error)
      return false
    }
  }

  if (config?.upstream) {
    registerWrapper(config.upstream, config.providerId || 'dsh-vision-bridge', 'Vision Bridge')
    return
  }

  const discover = Array.isArray(config?.discover) ? new Set(config.discover) : null
  const wrapped = new Set(['dsh-vision-bridge'])
  const sweepBody = async () => {
    if (typeof ctx.llm.listProviders !== 'function') {
      if (!wrapped.has('__legacy_fallback__')) {
        wrapped.add('__legacy_fallback__')
        registerWrapper('deepseek-official', 'dsh-vision-bridge', 'DeepSeek (vision bridge)')
      }
      return
    }
    for (const info of ctx.llm.listProviders()) {
      const id = info?.id
      if (!id || wrapped.has(id) || String(id).startsWith('dsh-vision-bridge')) continue
      if (discover && !discover.has(id)) continue
      wrapped.add(id)
      let models = []
      try { models = await ctx.llm.listModels(id) } catch {
        wrapped.delete(id); continue
      }
      if (!models.some(shouldWrap)) { wrapped.delete(id); continue }
      const providerId = 'dsh-vision-bridge-' + id
      const base = info.name ?? id
      if (!registerWrapper(id, providerId, base + ' (vision bridge)')) wrapped.delete(id)
    }
  }
  const sweepOnce = async () => {
    try { await sweepBody() } catch (error) {
      console.error('[dsh-vision-bridge] 包装发现 sweep 失败: ' + error)
    }
  }
  let sweeping = sweepOnce()
  const sweep = () => { sweeping = sweeping.then(sweepOnce, sweepOnce); return sweeping }
  if (typeof ctx.on === 'function') {
    ctx.on('llm/adapters-updated', () => { void sweep() })
  }
}

// ---------- 粘贴路由（paste-to-path） ----------

function registerPasteRoute(ctx, config) {
  if (config?.pasteToPath === false) return
  // 临时粘贴文件清理：每次上传记录目录，超时后自动整目录删除，避免垃圾堆积。
  const pasteDirs = new Set()
  const PASTE_TTL_MS = config?.pasteTtlMs ?? 10 * 60 * 1000
  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const rec of [...pasteDirs]) {
      if (now - rec.time > PASTE_TTL_MS) {
        pasteDirs.delete(rec)
        import('node:fs/promises').then(({ rm }) => rm(rec.dir, { recursive: true, force: true }).catch(() => {}))
      }
    }
  }, 60 * 1000)
  cleanupTimer.unref?.()
  ctx.effect(() => () => {
    clearInterval(cleanupTimer)
    for (const rec of [...pasteDirs]) {
      import('node:fs/promises').then(({ rm }) => rm(rec.dir, { recursive: true, force: true }).catch(() => {}))
    }
    pasteDirs.clear()
  }, 'vision-bridge: paste temp cleanup')

  ctx.inject(['webServer'], (scope) => {
    try {
      scope.webServer.register({
        name: 'vision-bridge-paste',
        kind: 'exact',
        path: '/vision-bridge/paste',
        handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405).end(); return }
          // Cheap early rejection: if a Content-Type is present it must look
          // like an image (magic-byte sniffing below is the real gate, but this
          // avoids buffering large non-image uploads). Absent header is allowed
          // (some paste clients omit it) and still sniffed.
          const ctype = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
          if (ctype && !ctype.startsWith('image/')) {
            res.writeHead(415, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'Content-Type 必须是 image/*（收到 ' + ctype + '）' }))
            return
          }
          try {
            const chunks = []
            let total = 0
            for await (const chunk of req) {
              total += chunk.length
              if (total > PASTE_MAX_BYTES) {
                res.writeHead(413, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ error: '图片超过 ' + PASTE_MAX_BYTES + ' 字节上限' }))
                req.destroy()
                return
              }
              chunks.push(chunk)
            }
            const buffer = Buffer.concat(chunks)
            const sniff = PASTE_SNIFFS.find((s) => s.test(buffer))
            if (!sniff) {
              res.writeHead(400, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ error: '不是可识别的图片（png/jpeg/gif/webp/heic）' }))
              return
            }
            const { mkdtemp, writeFile } = await import('node:fs/promises')
            const { tmpdir } = await import('node:os')
            const { join } = await import('node:path')
            const dir = await mkdtemp(join(tmpdir(), 'vision-bridge-paste-'))
            const file = join(dir, 'paste' + sniff.ext)
            await writeFile(file, buffer, { mode: 0o600 })
            pasteDirs.add({ dir, time: Date.now() })
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ path: file }))
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }))
          }
        },
      })
    } catch (error) {
      console.error('[dsh-vision-bridge] paste 路由注册失败: ' + error)
    }
  })
}

// ---------- 可选：autoRead（agent/pre-step 把图片块转证据） ----------

function registerAutoRead(ctx, appConfig) {
  const configured = appConfig?.autoRead  // true=强制开启, false=强制关闭, undefined=自动
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if (!decision.messages.some((message) => contentHasImage(message.content))) return decision
    // 检测当前路由模型是否支持图片输入
    const sessionCfg = decision.session?.requestHeader?.()?.config
    const provider = sessionCfg?.provider
    const model = sessionCfg?.model
    let capable = false
    if (provider && model && ctx.get('llm')?.resolveModelInfo) {
      try {
        const info = await ctx.get('llm').resolveModelInfo(provider, model, payload.signal)
        capable = Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
      } catch {}
    }
    // 未显式配置时：多模态跳过转换，纯文本自动转换
    if (configured === undefined && capable) return decision
    if (configured === false) return decision
    // 自动转换（纯文本模型或强制开启）
    const messages = []
    for (const message of decision.messages) {
      if (!contentHasImage(message.content)) { messages.push(message); continue }
      const content = await convertBlocks(
        message.content,
        async (block) => (await readImageBlock(ctx, appConfig, block, payload.signal)).block,
      )
      messages.push({ ...message, content })
    }
    return { kind: 'enter', messages }
  })
}

// ---------- apply ----------

export function apply(ctx, config = {}) {
  registerReadImageTool(ctx, config)
  registerVisionProvider(ctx, config)
  registerPasteRoute(ctx, config)
  registerAutoRead(ctx, config)
  console.log('[dsh-vision-bridge] 已加载。baseUrl=' + normalizeBase(config?.provider?.baseUrl) +
    ' model=' + (config?.provider?.model || 'agnes-2.5-flash'))
}
