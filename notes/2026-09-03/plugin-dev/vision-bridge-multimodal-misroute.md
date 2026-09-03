# dsh-vision-bridge 多模态误判为文本模型（muse-spark 走 Agnes）

## 背景

muse-spark-1.2 已在 settings.yaml 声明 input: [text, image]，粘贴图片却仍被 vision-bridge 按纯文本处理，走 Agnes 代看，末尾出现
"[粘贴图片，已由 vision bridge 识别]" 证据文本。

## 根因

- agent/pre-step 载荷只有 {agent, messages, turn, step, signal}；旧代码取 payload.agent.requestHeader() 与
  decision.session.requestHeader() —— 前者在 Agent 上不存在，后者 decision 里没有 session，全为 undefined；
  provider/model 取空导致 resolveModelInfo 未执行，capable=false，文本分支误判。
- 同分支的 vision_bridge_read_image 工具也用 exec.agent.session.requestHeader 单一来源，同样全空；且写死
  ctx.get('llm')，漏 ctx.llm 直挂场景。

## 修复

- 统一三级回退：agent.options > agent.session.requestHeader().config > agent.session.requestContext()；
  ctx.get('llm') 或 ctx.llm 兼容两路注入。
- 两处入口（autoRead + read_image tool）均改用同一回退；兜底仍走 resolveMultimodalByLabel。

## 版本

dsh-vision-bridge 0.1.8 -> 0.1.9（纯 bugfix，无新增依赖/配置）。

## 排查要点

- 怀疑多模态判定异常：先读 runtime-types.d.ts 确认 pre-step 载荷形状，再确认 Session 上 requestHeader()/requestContext()
  的存在位置与返回值结构；不要猜 payload.session / agent.requestHeader。

## 相关文件

- dsh-vision-bridge/index.js — registerAutoRead / registerReadImageTool
- 对账：@deepseek-ai/dsh-agent / @deepseek-ai/dsh-session 类型定义
