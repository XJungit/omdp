// 回归测试：vision-bridge 的路由解析优先级（node dsh-vision-bridge/test/route-resolution.test.mjs）
//
// 复现 2026-09-10 的线上故障：会话中途从 chain888/gpt-5.6-luna（多模态）切到
// agentrouter/deepseek-v4-flash（纯文本）后，插件优先读 agent.options（Agent 构造
// 时的快照，切换模型不更新），仍判为「支持图片输入」→ read_image 工具回
// "无需调用本桥"、pre-step 又跳过图片转写 → 纯文本模型两条路都读不到图。
//
// 修复后必须以 session.requestHeader().config（本次请求真实路由）为准。
import assert from 'node:assert/strict'
import { __internals } from '../index.js'

const { toRoute, resolveLiveRoute, routeSupportsImage } = __internals

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

console.log('route-resolution.test.mjs: 全部断言通过')
