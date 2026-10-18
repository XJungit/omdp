// 回归测试：vision-bridge 的路由解析优先级（node dsh-vision-bridge/test/route-resolution.test.mjs）
//
// 复现 2026-09-10 的线上故障：会话中途从 chain888/gpt-5.6-luna（多模态）切到
// agentrouter/deepseek-v4-flash（纯文本）后，插件优先读 agent.options（Agent 构造
// 时的快照，切换模型不更新），仍判为「支持图片输入」→ read_image 工具回
// "无需调用本桥"、pre-step 又跳过图片转写 → 纯文本模型两条路都读不到图。
//
// 修复后必须以 session.requestHeader().config（本次请求真实路由）为准。
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __internals } from '../index.js'

const { toRoute, resolveLiveRoute, routeSupportsImage } = __internals

// 1x1 透明 PNG：测试里现写一个真实图片文件，避免仓库里塞二进制 fixture
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

assert.ok(toRoute && resolveLiveRoute && routeSupportsImage, 'index.js 必须导出 __internals 供测试使用')

// 1) toRoute：只有 provider + model 同时是非空字符串才算一条路由
assert.equal(toRoute(null), null)
assert.equal(toRoute(undefined), null)
assert.equal(toRoute({}), null)
assert.equal(toRoute({ provider: 'agentrouter' }), null)
assert.equal(toRoute({ provider: 'agentrouter', model: '' }), null)
assert.deepEqual(toRoute({ provider: ' agentrouter ', model: ' deepseek-v4-flash ' }), {
  provider: 'agentrouter',
  model: 'deepseek-v4-flash',
})

// 2) 核心回归：中途切换模型后，当次请求头必须压倒构造期 agent.options
const switchedAgent = {
  options: { provider: 'chain888', model: 'gpt-5.6-luna' }, // 多模态，构造时快照
  session: {
    requestHeader: () => ({ config: { provider: 'agentrouter', model: 'deepseek-v4-flash' } }),
    requestContext: () => ({ provider: 'agentrouter', model: 'deepseek-v4-flash' }),
  },
}
assert.deepEqual(resolveLiveRoute(switchedAgent), {
  provider: 'agentrouter',
  model: 'deepseek-v4-flash',
})

// 3) 逐级回退：requestHeader → requestContext → agent.options
assert.deepEqual(
  resolveLiveRoute({
    options: { provider: 'a', model: 'm1' },
    session: { requestHeader: () => null, requestContext: () => ({ provider: 'b', model: 'm2' }) },
  }),
  { provider: 'b', model: 'm2' },
)
assert.deepEqual(
  resolveLiveRoute({
    options: { provider: 'a', model: 'm1' },
    session: { requestHeader: () => null, requestContext: () => null },
  }),
  { provider: 'a', model: 'm1' },
)
assert.equal(resolveLiveRoute({}), null)
assert.equal(resolveLiveRoute(undefined), null)

// 4) 取头失败（抛错 / 无 session）不能带崩判定
assert.deepEqual(
  resolveLiveRoute({
    options: { provider: 'a', model: 'm1' },
    session: {
      requestHeader: () => {
        throw new Error('boom')
      },
      requestContext: () => null,
    },
  }),
  { provider: 'a', model: 'm1' },
)
assert.deepEqual(resolveLiveRoute({ options: { provider: 'a', model: 'm1' } }), { provider: 'a', model: 'm1' })

// 5) routeSupportsImage 的三态：true / false / null（未知不能塌成 false）
const fakeCtx = (modalities) => ({
  get: () => ({
    resolveModelInfo: async () => (modalities === undefined ? {} : { inputModalities: modalities }),
  }),
})
const route = { provider: 'agentrouter', model: 'deepseek-v4-flash' }
assert.equal(await routeSupportsImage(fakeCtx(['text', 'image']), route), true)
assert.equal(await routeSupportsImage(fakeCtx(['text']), route), false)
assert.equal(await routeSupportsImage(fakeCtx(undefined), route), null)
assert.equal(await routeSupportsImage(fakeCtx(['text']), null), null)
assert.equal(
  await routeSupportsImage(
    { get: () => ({ resolveModelInfo: async () => { throw new Error('resolve failed') } }) },
    route,
  ),
  null,
  'resolveModelInfo 抛错时必须返回 null（未知），不能断言为不支持',
)
assert.equal(await routeSupportsImage({ get: () => undefined }, route), null, 'llm 服务缺失时必须返回 null')

// 6) native-image 分支的结果渲染：图片块必须带 attachment，普通分支只出文本
//    （对应 0.1.12：多模态路由下不再回"无需调用本桥"，而是把图片直接递给模型）
const { renderReadImageResult, imageEnvelope } = __internals
assert.ok(renderReadImageResult && imageEnvelope, 'index.js 必须导出 renderReadImageResult / imageEnvelope')

const ref = { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 1234, width: 800, height: 600, name: 'a.png' }
const native = renderReadImageResult({
  branch: 'native-image',
  text: 'envelope',
  images: [{ path: 'D:\\pics\\a.png', image: ref }],
})
assert.equal(native.length, 2, 'native-image 分支必须产出 [文本信封, 图片块]')
assert.equal(native[0].type, 'text')
assert.equal(native[1].type, 'image')
assert.deepEqual(native[1].attachment, ref, '图片块必须携带 attachments 服务返回的 ImageAttachmentRef')

// 文本分支 / json 分支 / 无 images 时不能误产图片块
assert.deepEqual(renderReadImageResult({ branch: 'text', text: 'hello' }), [{ type: 'text', text: 'hello' }])
assert.deepEqual(
  renderReadImageResult({ branch: 'native-image', text: 'no images' }),
  [{ type: 'text', text: 'no images' }],
  'native-image 但没有可用附件时必须退回纯文本，不能产出空图片块',
)
assert.deepEqual(
  renderReadImageResult({ branch: 'native-image', text: 'bad', images: [{ path: 'p', image: {} }] }),
  [{ type: 'text', text: 'bad' }],
  '缺失 attachmentId 的条目不能当图片块渲染',
)
assert.equal(renderReadImageResult(undefined)[0].text, 'undefined', 'value 缺失时不能抛错')

// 信封里必须写明路径、媒体类型与像素，并禁止模型再重复调用
const envelope = imageEnvelope(
  { provider: 'chain888', model: 'gpt-5.6-luna' },
  [{ path: 'D:\\pics\\a.png', image: { ...ref, originalDimensions: { width: 1600, height: 1200 } } }],
)
assert.match(envelope, /chain888\/gpt-5\.6-luna/)
assert.match(envelope, /<path>D:\\pics\\a\.png<\/path>/)
assert.match(envelope, /image\/png image, 800x600 px, 1234 bytes/)
assert.match(envelope, /downscaled from 1600x1200 px/)
assert.match(envelope, /force=true/)

// 7) tryNativeImageDelivery 的降级契约：绝不抛错、绝不见死不救
//    （拿不到附件服务/文件读不了 → 返回 {ok:false, reason}，由调用方回退到代读端点）
const { tryNativeImageDelivery } = __internals
assert.ok(tryNativeImageDelivery, 'index.js 必须导出 tryNativeImageDelivery')

const ctxWith = (attachments) => ({ get: (name) => (name === 'attachments' ? attachments : undefined) })
assert.deepEqual(await tryNativeImageDelivery(ctxWith(undefined), ['x.png']), {
  ok: false,
  reason: '附件服务不可用',
})
assert.match(
  (await tryNativeImageDelivery(ctxWith({}), ['x.png'])).reason,
  /saveImage/,
  '服务存在但没有保存方法时必须给出可读原因，而不是抛错',
)
assert.match(
  (await tryNativeImageDelivery(ctxWith({ saveImage() {}, imageLimits: { maxImagesPerMessage: 1 } }), ['a.png', 'b.png'])).reason,
  /超过单条消息图片数上限/,
)
assert.match(
  (await tryNativeImageDelivery(ctxWith({ saveImage() {} }), ['D:\\definitely-missing\\nope.png'])).reason,
  /file not found/,
  '文件不存在时必须降级成 ok:false，而不是把异常抛给工具层',
)
assert.match(
  (await tryNativeImageDelivery(ctxWith({ saveImage() {} }), ['https://example.com/a.png'])).reason,
  /URL/,
  'URL 不能直接入上下文 → 交给代读端点',
)

// 8) 单张 saveImage 回退路径：saveImages 缺失时（或老版本服务）仍能提交图片，
//    走的就是 DSH 核心 read_image 用的那个抽象方法。
const tmpDir = mkdtempSync(join(tmpdir(), 'vb-test-'))
const pngPath = join(tmpDir, 'tiny.png')
writeFileSync(pngPath, Buffer.from(TINY_PNG_BASE64, 'base64'))
const notImagePath = join(tmpDir, 'notes.txt')
writeFileSync(notImagePath, 'plain text')

const savedInputs = []
const singleRef = { attachmentId: 'sha256:deadbeef', mediaType: 'image/png', bytes: 70, width: 1, height: 1, name: 'tiny.png' }
const singleResult = await tryNativeImageDelivery(
  ctxWith({
    async saveImage(input) {
      savedInputs.push({ mediaType: input.mediaType, bytes: input.data?.length, name: input.name })
      return singleRef
    },
  }),
  [pngPath],
)
assert.equal(singleResult.ok, true, '仅提供 saveImage 时也必须能提交图片')
assert.deepEqual(savedInputs, [{ mediaType: 'image/png', bytes: 70, name: 'tiny.png' }])
assert.deepEqual(singleResult.images[0].image, singleRef, '必须只搬运 ImageAttachmentRef 的标量字段')
assert.equal(singleResult.images[0].path, pngPath)

// 非图片文件 → 降级（不要试图把文本当图提交）
assert.match((await tryNativeImageDelivery(ctxWith({ async saveImage() { return singleRef } }), [notImagePath])).reason, /attachments 支持的/)

// 批量 API 优先：两个都在时只调 saveImages
let batchCalls = 0
let singleCalls = 0
const batchResult = await tryNativeImageDelivery(
  ctxWith({
    async saveImages(inputs) {
      batchCalls += 1
      return inputs.map((input, index) => ({ ...singleRef, name: input.name, bytes: input.data.length + index }))
    },
    async saveImage() {
      singleCalls += 1
      return singleRef
    },
  }),
  [pngPath],
)
assert.equal(batchCalls, 1)
assert.equal(singleCalls, 0, '批量方法可用时不应逐张调用')
assert.equal(batchResult.ok, true)
assert.equal(batchResult.images.length, 1)

console.log('route-resolution.test.mjs: 全部断言通过')
