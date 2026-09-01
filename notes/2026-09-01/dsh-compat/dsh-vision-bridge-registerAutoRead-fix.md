# dsh-vision-bridge registerAutoRead 多模态判定修复

> 日期：2026-09-01　分类：dsh-compat
> 涉及文件：`dsh-vision-bridge/index.js`（registerAutoRead ≈659–693、resolveMultimodalByLabel ≈514）
> 修复提交：`19fd762`（已推送 origin/master）

## 背景 / 问题

用户模型 `B_DSV4FV`（别名，provider `b-ai`，模型 `deepseek-v4-flash-vision-exp`，settings 显式声明
`input: [text, image]`）粘贴图片时，报
`[粘贴图片识别失败: 无效的令牌 (request id:...（API key 无效或缺失）]`——即走了 Agnes 识别（401，
AGNES_API_KEY 为占位 `"123"`）。按插件设计，多模态模型应当**原生上传**、不拦截，说明宿主侧
`registerAutoRead` 把多模态模型误判成了纯文本。

## 根因

`registerAutoRead`（`agent/pre-step` 处理器）拿当前路由 provider/model 的代码写成了：

```js
const sessionCfg = payload.agent?.session?.requestHeader?.()?.config ?? decision.session?.requestHeader?.()?.config
```

- rc.7+ 的 pre-step 载荷**在 `payload.agent` 上直接有 `requestHeader()`**（`docs/core.md:891` 的
  `{ agent, messages, turn, step, signal }` 签名；`docs/subsystems/session.md:485` 的
  `Agent.requestHeader(): EpochHeader | undefined`）。多写了 `.session` 导致第一次取值失败；
- `decision.session` **从来不存在**（注释里写了"保留为兜底"，实为死路）；
- 于是 `provider`/`model` 恒为 `undefined` → `capable` 恒为 `false` → 所有图片一律转 Agnes。

注意：README（第 70–72 行）声称 autoRead "改用 rc.8 pre-step 载荷的 payload.agent 获取当前路由模型"，
与文档意图一致，但**代码实际写成 payload.agent.session** —— 是文档与代码不一致、代码笔误，
不是 API 变了。

## 修复

1. 导航修正（按正确优先级）：

   ```js
   const sessionCfg =
     payload.agent?.requestHeader?.()?.config ??
     payload.agent?.session?.requestHeader?.()?.config ??
     decision.session?.requestHeader?.()?.config
   ```

2. 新增兜底：主路径取不到 provider/model 或 `resolveModelInfo` 未暴露 image 模态时，
   用插件自身的 `resolveMultimodalByLabel(ctx, model)`（与 `/vision-bridge/capabilities` 同款逻辑：
   按 **model id 跨所有 provider 匹配**，命中后 `resolveModelInfo` 判 `inputModalities`），
   避免多模态模型被误判去走 Agnes：

   ```js
   if (!capable && model && typeof resolveMultimodalByLabel === 'function') {
     try {
       const r = await resolveMultimodalByLabel(ctx, model)
       capable = !!r?.multimodal
     } catch {}
   }
   ```

## 验证

Mock ctx 加载**真实 index.js**、抓取 `agent/pre-step` 处理器跑三场景（
`ALL_TESTS_PASS`）：

| 场景 | 会话配置 | 结果 |
|---|---|---|
| A 主路径 | `b-ai` + `deepseek-v4-flash-vision-exp` | resolveModelInfo 命中 image → 原生（不转换） |
| B 兜底 | provider 故意配错 `ninerouter`，model id 正确 | 主路径失败 → 兜底跨 provider 找回 `b-ai` 多模态 → 原生 |
| C 文本 | `ninerouter` + `oc-hy3-free` | 无 image 模态 → 走 Agnes 转换（mock 返回文字） |

修复前（旧导航）三场景全部误转；修复后 A/B 原生、C 才转换。

## 可复用要点

- **rc.7+ pre-step 载荷**：`payload.agent.requestHeader().config` 是取当前路由
  `provider`/`model` 的正确途径；`payload.agent.session` 没有 `requestHeader`；
  `decision.session` 不存在。
- **DSH `llm` 服务契约**：
  - `resolveModelInfo(provider, model)` → `{ inputModalities: [...] }`；判别式
    `inputModalities.includes('image')`。
  - `listProviders()` 返回**对象数组**（元素带 `.id`），且是**同步**遍历
    （`for..of llm.listProviders()` 不加 await）——mock 时若写成 `async` 返回 Promise，
    `for..of` 会同步抛错被兜底 try/catch 吞掉，静默失败。
  - `listModels(pid)` 是 async（源码里 `await llm.listModels(pid)`）。
- **零依赖插件可独立测试**：index.js 只 import `node:*` 内置模块，直接用 `import()` +
  mock ctx（`on`/`get`/`inject`）即可在 Node 里跑真实 `apply` 与处理器；
  转换路径用 mock `global.fetch` 返回 `{choices:[{message:{content}}]}` 验证。
- **排查信号**：`/vision-bridge/capabilities?label=B_DSV4FV` 返回 `known:true` 只证明
  `resolveMultimodalByLabel`/`resolveModelInfo` 正常，**不能**证明 `registerAutoRead`
  的会话取参路径正常（旧代码正是"capabilities 正常但实际仍 401"）。
