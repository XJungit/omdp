# OpenCode 免费层 403 FreeTierError：9router 上游改造与本地热修

> 日期：2026-09-17 · 分类：`debug` · 涉及：9router v0.5.75（本地全局 npm 安装）

## 背景 / 现象

9router 走 `oc/<model>`（即 OpenCode Zen 免费层，`Authorization: Bearer public`）时全部报：

```
HTTP 403: {"type":"error","error":{"type":"FreeTierError",
"message":"Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"}}
```

受影响模型：`mimo-v2.5-free`、`nemotron-3-ultra-free`、`ling-3.0-flash-fin-free`、
`nemotron-3.5-lightning-free`、`muse-spark-1.2/1.3-contributor-free` 等。
2026-09-17 07:00Z 前一直正常，属上游服务端**静默加严**。

## 根因（实测确认，非推测）

OpenCode 在 `https://opencode.ai/zen/v1/*` 上加了**客户端门禁**，两个条件**必须同时满足**，
否则一律 403 `FreeTierError`：

| # | 条件 | 反例 → 结果 |
|---|---|---|
| 1 | `User-Agent` 必须是 `opencode/<major>.<minor>.<patch>` 且 **版本 ≥ 1.17.0** | 裸 `opencode`、`node`、`curl` → **403 FreeTierError**；`opencode/1.0.0`（有版本但过低）→ **426 UpgradeRequired** |
| 2 | `x-opencode-session` 必须匹配 `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$`（4+12+14=30 字符） | `ses_` + 32 位 hex、裸 UUID、`claude:...`、缺失 → **403 FreeTierError** |

而 9router v0.5.75 的 `OpenCodeExecutor.buildHeaders()` **两个条件都违反**：

```js
"User-Agent": f.toLowerCase().includes("opencode") ? f : "opencode",   // ← 裸 "opencode"，无版本号
"x-opencode-session": d["x-opencode-session"] || this._currentSessionId || m(),
//                                                              ↑ m() = `ses_${randomUUID 去横线}` = ses_+32hex，格式不符
```

两点补充结论（实测）：

- **`x-opencode-client` 取值不影响**（`cli`/`desktop`/`vscode`/缺失均可），不是门禁因素。
- **`x-opencode-request`、`x-opencode-project` 也不校验**，仅 session + UA 是关键。
- `x-opencode-session` 语义是**粘性会话**：同一 session 重复同前缀请求会命中上游
  prompt cache（实测 `cached_tokens` 命中；换 session 后仍命中，说明缓存主要按前缀而非 session 键），
  所以修复必须**保 deterministic**，不能每次随机。

## 修复

热修 `app/.next-cli-build/server/chunks/318.js`（webpack chunk，模块 4493 = `OpenCodeExecutor`），
只改 `buildHeaders()` 里那两个表达式，均为**纯函数**，不触碰请求体/路由：

1. **UA**：下游 UA 若已是 `opencode/` 且版本 ≥ 1.17.0 → 原样透传；否则回退
   `process.env.NINEROUTER_OPENCODE_UA || "opencode/1.18.31"`。
2. **session**：若已是规范格式 → 原样透传；否则用 `sha256(原值)` 派生
   `ses_` + 前 12 位 hex + 14 位 base62（用 digest 字节取模，确保字符集合规且确定性）。

确定性映射保证粘性会话与上游缓存不失效。

### 工具

`tools/9router-fix/fix-opencode-freetier.cjs`：

```bash
node tools/9router-fix/fix-opencode-freetier.cjs --check     # 体检，退出码 1 = 有漏洞
node tools/9router-fix/fix-opencode-freetier.cjs --apply     # 打补丁（幂等，自动备份）
node tools/9router-fix/fix-opencode-freetier.cjs --restore   # 回滚最近备份
```

打补丁后**必须重启 9router**：Next 构建产物在启动时载入内存。

## 验证

- 直连上游矩阵测试：仅「UA 有版本 ≥1.17.0 + 规范 session」组合返回 200；
  25/25 次新 session 全 200，`opencode` / `opencode/1.0.0` 分别稳定复现 403 / 426。
- 加载**已打补丁的真实 chunk**、桩掉依赖后跑 `buildHeaders()`，300/300 输出均合规。
- 端到端：同一批 header 手工发往上游，修复前 4/4 = 403，修复后 4/4 = 200。
- 重启 9router 后经其 API 实测 `oc/*` 四个免费模型 **4/4 = HTTP 200**；
  重启后 11 条请求中 `FreeTierError` 计数为 **0**（最后一次 403 在 07:00Z，修复前）。

## 可复用要点

- **上游门禁类 403 的排查套路**：先枚举「单个 header 变量 × 全取值」矩阵，
  再叠加两因素矩阵定位组合条件；本例单看 UA 会误判（UA 与 session 需同时满足）。
- **不要把「有版本号」当充分条件**：`opencode/1.0.0` 是 426 而非 403，两种错误码对应门禁的不同分支。
- **热修构建产物必须可回滚 + 幂等**：`--apply` 需能重复执行，并保留带时间戳的 `.bak-*`。
- **升级即失效**：上游 master 的 `open-sse/executors/opencode.js` 仍是
  `const OPENCODE_UA = "opencode"` + `ses_${randomUUID}`，**未修**。
  任何 `npm i -g 9router` 都会覆盖补丁，升级后需重跑 `--apply`。
- 相关文件：
  - 补丁目标 `%APPDATA%\npm\node_modules\9router\app\.next-cli-build\server\chunks\318.js`
  - 运行数据 `%APPDATA%\9router\db\data.sqlite`（表 `requestDetails` 可查逐条请求与错误）
- 同 chunk 的 `opencode-go`（模块 13120）用 `ses_${hash32hex}`，**格式同样不合规**，
  但该 provider 需鉴权、无法离线复现，本次未改动；若报相同 403 可套用同一会话规范化逻辑。
