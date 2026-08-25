# @omdp/dsh-resume-stream

> **已归档：** 本插件仅保留用于历史参考，仓库不再维护或发布新版本。npm 上已有版本仍可使用，但新开发不再基于此插件继续。

在模型流式输出发生传输层断流时，**保持同一个 Agent turn + step 自动重试**，避免思维链或正文只显示半截后把任务错误地判定为完成。

## 这版修复了什么

旧实现把 `finish{kind:'error', failure:{code:'TRANSPORT'}}` 改成了 `finish{kind:'stop'}`。这样 DSH 会把已经收到的半截 reasoning/body 正式写成 `assistant/message`，随后结束 step/turn；再发送“继续”已经无法把同一个任务恢复回来。

从 v1.0.14 开始：

1. 保留原始 TRANSPORT/TIMEOUT 错误 finish，不再改写为 stop；
2. 在 `agent/request-error` 处返回 `{ kind: 'retry' }`；
3. AgentLoop 在**同一个 turn + step** 中丢弃失败的 BlockAssembler，重新发起模型请求；
4. 只有成功的完整响应才会产生最终 `assistant/message`；不会插入合成的“继续”用户消息；
5. 优先让 DSH 内置 `llm-retry` 执行 provider 配置的重试次数、退避和 `providerRetryAfterMs`；只有它不接管时，本插件才提供最多 5 次的兜底同一步重试。

因此思维中断和正文中断走的是同一条恢复路径：失败尝试不会被当作完成结果提交。

## UI

只有一次重试最终成功、完整 `assistant/message` 提交之后，才在会话流中显示一条轻量状态行：

- `本轮断流已自动恢复`
- 附带轮次、重试次数、累计次数（有数据时才显示）

它不在“检测到断流”时就宣称成功，也不渲染失败/进行中的中间态。UI 使用会话 Definition + `conversation.chat.node` keyed Slot，匹配为 O(1)，无轮询、无 timer、无 DOM 测量，也不扫描会话历史。状态行使用已知惰性 `hook/invoked` 事件承载，刷新和历史加载可恢复显示。

## 验证

自带一个不依赖 DSH 运行时的宿主逻辑测试：

```bash
node test/resume-stream.test.mjs
```

覆盖：原生 `{ kind: 'retry' }` 放行且不合成兜底标记；原生不接管时触发有限兜底 `llm/retry` + `retry`；非可重试错误原样放行；以及“完整 `assistant/message` 之后才产生恢复标记”。安装前建议先通过该测试，再实跑验证思维中断与正文中断两条路径。

## 安全范围

仅处理 `TRANSPORT` 和 `TIMEOUT`。AUTH、QUOTA、RATE_LIMIT、SERVER、CONTEXT_WINDOW_EXCEEDED、PI_AI_ERROR 等错误原样交给 DSH。

若同一步连续断流超过兜底上限，插件停止接管，让 DSH 的原生错误/重试策略收尾，不会无限循环。

## 持久化与诊断

- 计数：`.dsh/resume-stream/count.json`；旧版 `.dsh/resume-stream-count.json` 只读迁移。
- 日志：`~/.dsh/resume-stream/resume-stream.log`，异步写入并在 256 KiB 后轮转一代；普通模型请求不写日志。
- 所有自定义信号都使用已知 `hook/invoked` 类型，避免自定义事件导致历史无法加载。

## 安装

```bash
dsh plugin --profile web add <tgz-url>
```

web profile 需要重启 DSH 才会加载新的 Host half；当前插件已卸载，修正版安装前不会自行重新启用。
