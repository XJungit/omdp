# DSH 里「当前模型」该怎么读：`agent.options` 是构造快照，实时路由在 `session.requestHeader().config`

> 2026-09-10 ｜ 分类：dsh-internals ｜ 相关插件：`@omdp/dsh-vision-bridge`（0.1.11 修复）

## 背景 / 现象

用户报：「agentrouter 下的 deepseek-v4-flash 无法调用视觉插件」。

实地取证（会话 `session-73ef40e7`，`D:\WorkSpace\杂七杂八`，preset `standard`）：

- 该会话**开头是 `chain888/gpt-5.6-luna`（多模态）**，中途被切到 **`agentrouter/deepseek-v4-flash`（纯文本）**
  （会话日志里的 `[model changed: ...]` 通知 + `request/header` 行的 `config` 变化可证）。
- 此后每次 `vision_bridge_read_image` 的返回都是：
  `当前模型支持图片输入，请直接阅读图片附件或图片内容，无需调用本桥。`
- 而同一路由下 DSH 内置 `read_image` 的报错是：
  `Error: cannot read "..." as an image: model "deepseek-v4-flash" does not declare image input`
- 结果：**两条路互相打脸** —— 桥说"你自己看"，原生读图说"你看不了"，模型只能跑去自己写脚本调
  本地中转（401）→ 用户「逆天了」「不能调用就暂停」。

## 根因

vision-bridge 0.1.10 判定"当前路由是否支持图片输入"时的取值顺序是：

```
agent.options  →  session.requestHeader().config  →  session.requestContext()
```

**`agent.options` 是 Agent 构造时的快照，会话中途切换模型不会更新**：

- `dsh-agent-loop/lib/index.js` 构造函数里 `this.options = options`（全文件仅此一处赋值）；
- 模型切换由 `dsh-agent/lib/types/model-selection.js` 的 `installModelSelection` 实现：它挂
  `agent/request` 瀑布，把 `selection.current` 的 `provider/model` 写进**每次请求**，
  并由会话持久化为 `request/header` 行（`session.requestHeader().config`）。

所以初始是多模态模型、后来切到纯文本模型时，旧的判定读到的仍是"多模态"→
`vision_bridge_read_image` 回"无需调用本桥"、`agent/pre-step`（autoRead）也跳过图片转写。

## 结论 / 可复用要点

1. **读当前路由一律用 `agent.session.requestHeader()?.config`**，其次 `session.requestContext()`，
   `agent.options` 只作最后兜底（或用于"Agent 创建时的初始路由"这种语义）。
   两者在**从未切换过模型的会话**里完全一致 —— 这正是本地复现不出来的原因。
2. 能力判定要区分**三态**：`true`（支持）/ `false`（明确不支持）/ `null`（路由缺失或
   `resolveModelInfo` 没给 `inputModalities`）。把 `null` 塌成 `false` 会让"未知"被当成结论；
   把 `null` 塌成 `true` 则会造成上面这种"桥放弃干活"的死路。
3. **凡"你已经能自己看"这类提前返回，都要留逃生口**：vision-bridge 0.1.11 起工具支持
   `force=true` 强制走多模态端点代读，且提示语里写明这个开关，避免模型被错误判定卡死。
4. 排查这类"插件说不用我，DSH 说不能用"的矛盾时，**最有力的证据是会话原文**：
   `~/.dsh/sessions/<workspace>/<session-id>/session.v3.jsonl.zstd`。它是**多帧 zstd**
   （每帧一段 JSONL），`zstdDecompressSync` / `createZstdDecompress` 只会解出第一帧（约 259 字节），
   必须**按帧魔数 `28 B5 2F FD` 切分后逐帧解压**（DSH 自己的实现见
   `dsh-session-persistence-jsonl/lib/index.js` 的 `NodePrivateZstdFrameDecoder` / `PublicZstdFrameDecoder`）：

   ```js
   const MAGIC = Buffer.from([0x28,0xb5,0x2f,0xfd])
   // 逐帧 zstdDecompressSync(buf.subarray(start, end)) 后拼接
   ```

## 相关文件

- 修复：`dsh-vision-bridge/index.js` → `resolveLiveRoute()` / `routeSupportsImage()`（工具 + autoRead 共用）
- 回归测试：`dsh-vision-bridge/test/route-resolution.test.mjs`（含"切换模型后 header 必须压倒 options"用例）
- DSH 源码：`dsh-agent-loop/lib/index.js`（构造函数）、`dsh-agent/lib/types/model-selection.js`（`installModelSelection`）
