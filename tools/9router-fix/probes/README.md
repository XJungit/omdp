# probes/ — 复现「四维指纹」门禁的原始探针

这些是一次性诊断脚本，2026-09-18 用来从「403 全拒」定位出 Zen 免费层的**四维判据**。
保留它们是为了**证据可复现**（判据可与上游变化做对比），不是日常工具。

日常只需要上一层的两个脚本：

```bash
node fix-opencode-freetier.cjs   # 打补丁 / 体检 / 回滚
node verify-opencode-freetier.cjs # A 上游 / B 静态 / C 端到端 三层验证
```

| 脚本 | 用途 | 结论 |
|---|---|---|
| `probe-official-contract.cjs` | **权威校验**：按官方源码契约渲染请求，断言四维（含 `/responses` 通道） | 四维全部与官方源码一致 |
| `probe-gate-families.cjs` | 逐个试探工具名族（shell 族 / read 族） | `read` + `bash`/`shell`；即「必需工具对」 |
| `probe-gate-truth.cjs` | 判别 order / 精确名 / schema 形状 / 计数 四类候选规则 | 顺序、schema、数量均无关 |
| `probe-quartet-refine.cjs` | **纠错探针**：重复验证 `{read,bash}` 能过而 `{bash,glob,grep}` 不能 | 推翻「四件套」过拟合 |
| `probe-quartet.cjs` | 最初的工具集 + stream 二分，跑通矩阵 | 发现工具轴存在（但结论当时过拟合） |
| `probe-opencode-gate.cjs` | 扫 UA 版本、session 格式、单头增删 | 门禁已不止 UA/session（全 403） |
| `probe-opencode-gate2.cjs` | 打印完整响应头与响应体 | `/v1/models` 仍 200，只有 chat 被门禁 |
| `probe-opencode-gate3.cjs` | 换请求体（stream / tools）组合 | 单独改 body 仍 403（需四维齐备） |
| `probe-opencode-gate4.cjs` | 逐条破坏条件 + endpoint 对照 | 四维独立必需 |
| `probe-session-algo.cjs` | 时间序（官方 identifier 算法）vs 随机 session | 判据是**格式**，不是时间序 |
| `probe-ua-platform.cjs` | UA 平台括号段 / 4 段形式 / 关联头 | 均**排除** |
| `probe-project-id.cjs` | `x-opencode-project` = `prj_<sha>` vs `global` | **排除** |
| `probe-tool-names.cjs` | 逐名字试探（含杜撰名 `_noop`、`ping`） | 杜撰名无法区分规则，教训见笔记 |
| `probe-http2.cjs` | undici(HTTP/1.1) vs node:http2 | 传输层无关 |
| `probe-with-real-key.cjs` | 用 9router 存的真 Zen key 打免费模型 | 真 key 也 403 |
| `probe-paid-vs-free.cjs` | 真 key 下付费 vs 免费模型 | 付费 401 CreditsError、免费 403 → 门禁认模型不认凭据 |
| `probe-injected-tool-vs-real.cjs` | **空壳注入工具的风险**：真实 DSH 工具集在场时，模型会不会去调注入的 `bash` | **0/4**，一致选有真实 schema 的 `pwsh`/`glob`；并暴露「重名 → 400」失败模式 |
| `probe-injected-tool-usage.cjs` | **反例**：只给空壳 `read`/`bash`（调用方不带工具） | 3/3 调用空壳 → 「空壳安全」只在真实工具集在场时成立 |

辅助（读本地 9router 状态，均只读、密钥脱敏）：

| 脚本 | 用途 |
|---|---|
| `dump-oc-requests.cjs` | 看 9router 记录的 `providerRequest`（实际发上游的请求体） |
| `dump-9router-requests.cjs` | `requestDetails` 表最近请求 |
| `dump-9router-connections.cjs` | provider 连接与 baseUrl（apiKey 脱敏） |
| `test-patched-body.cjs` | 加载**已打补丁的真实 chunk**、桩掉依赖，跑 `buildHeaders()`/`transformRequest()` |
| `fetch-issue-comments.cjs` | 抓 GitHub issue 评论（本机 PowerShell TLS 不通，用 Node fetch 兜底） |
| `fetch-pr.cjs` | 抓 PR 元信息 + diff |

> 环境备注：本机 `%APPDATA%` 下的 9router 安装目录在会话工作区之外，
> 改它需要 `danger-full-access`；`curl.exe` 在此沙箱因 schannel 凭据问题不可用，
> 一律用 Node 的 `fetch` / `node:http2`。

判据与结论的完整记录见
[`../../notes/2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md`](../../notes/2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md)。
