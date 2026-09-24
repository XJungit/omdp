# 9router OpenCode 免费层热修

> ## ⚠️ 状态：已被上游吸收（2026-09-24）
>
> **9router ≥ v0.5.86 自己就满足这个门禁了，不需要再打补丁。**
> 实测 `0.5.86` 未打补丁：A 层四条判据逐条破坏仍 403/426（Zen 门禁没变），
> C 层 6/6 免费模型 200（含两条通道）→ **是 9router 修好了，不是 Zen 放宽了**。
>
> 上游实现（官方 descending 时间算法 + 工具集注入 + 按通道形状）见
> [`../../notes/2026-09-24/debug/9router-0.5.86-absorbed-hotpatch.md`](../../notes/2026-09-24/debug/9router-0.5.86-absorbed-hotpatch.md)。
>
> **本目录现在的主要价值**：
> 1. `verify-opencode-freetier.cjs` —— 三层验证（升级后仍应跑一次）；
> 2. 下面这份**门禁判据文档** —— 上游若再次轮换条件，这是对照基准；
> 3. `fix-opencode-freetier.cjs` —— 已改造为**自动判定**：检测到上游自修复即报
>    「nothing to patch」并 exit 0；仅对 ≤ v0.5.75 的老版本才真的打补丁。

修复 9router 走 OpenCode Zen 免费层（`oc/<model>`、`Authorization: Bearer public`）时报
`403 FreeTierError` 的问题。

```
HTTP 403: {"type":"error","error":{"type":"FreeTierError",
"message":"Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"}}
```

## 为什么需要它

OpenCode Zen 在 `https://opencode.ai/zen/v1/*` 上对**官方 agent 客户端做四维指纹校验**，
**四个条件必须同时满足**，缺任意一个即 403 `FreeTierError`（该门禁已两次加严）：

| # | 条件 | 反例 → 结果 |
|---|---|---|
| 1 | `User-Agent` = `opencode/<maj>.<min>.<patch>`，版本 **≥ 1.17.0** | 裸 `opencode`、`node`、`curl`、`opencode/<无版本>` → **403 FreeTierError**；`opencode/1.16.0`（有版本但过低）→ **426 UpgradeRequired** |
| 2 | `x-opencode-session` 匹配 `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$` | `ses_`+32hex、裸 UUID、`claude:...`、缺失 → **403** |
| 3 | 请求体 `tools` 同时含**名为 `read` 和名为 `bash`** 的工具 | 缺 `read` → 403；缺 `bash`（例如 Windows 上 shell 工具叫 `pwsh`）→ 403；两者齐全 → 200 |
| 4 | 请求体 `stream: true` | `stream:false`（`/chat/completions` 与 `/responses` 都是）→ **403** |

### 判据 3 的精确定义（来自官方源码，非猜测）

官方客户端（`anomalyco/opencode`）永远声明这两个名字：

```
packages/opencode/src/session/llm/request.ts        tools = resolveTools(input)   # 工具表按名下发
packages/opencode/src/tool/read.ts       L64         Tool.define("read", ...)
packages/opencode/src/tool/shell/id.ts               export const ToolID = "bash"
```

`tool/shell/id.ts` 的注释写明：shell 工具的 ID **在所有平台（含 Windows）都叫 `bash`**，
「为兼容已有插件/权限保留，等 opencode 2.0 再改名」。
所以官方客户端在 Windows 上**照样发 `bash`**，而 DSH 发的是 `pwsh` —— 这正是 DSH 类环境踩雷的原因。

顺序无关、schema 形状无关、工具数量无关、额外工具无关。
**`glob`/`grep` 不是判据**：早期「四件套 `{bash,glob,grep,read}`」的结论是对第一次二分的**过拟合**
（四件套恰好包含必需的 `read`+`bash`，所以能过；而 `{bash,glob,grep}` 失败是因为缺 `read`，不是因为缺第四个名字）。

9router **≤ v0.5.75** 曾四项全违反：UA 发裸 `"opencode"`、session 发 `ses_`+32 位 hex、
调用方工具集常常缺 `read`/`bash`、且经常非流式 —— 本脚本就地修正编译产物中的这四处。
**v0.5.86 起上游自己修好了**（见顶部状态说明与 `docs/9router-opencode-zen.md`）。

### 已排除的因素（2026-09-18 实测）

- `x-opencode-client` / `x-opencode-request` / `x-opencode-project` /
  `x-session-affinity` / `X-Session-Id`：**不参与**门禁；
- 传输层无关：HTTP/1.1 与 HTTP/2（ALPN h2）行为一致；
- **换个真 Zen key 不能绕过免费层门禁**：同样 403 `FreeTierError`；
  而同一 key 请求**付费模型**返回 401 `CreditsError` ——
  说明门禁认的是「免费模型」而非凭据本身。

## 用法

```bash
node fix-opencode-freetier.cjs --check     # 只体检
node fix-opencode-freetier.cjs --apply     # 打补丁（幂等；自动带时间戳备份）
node fix-opencode-freetier.cjs --restore   # 回滚到最近的备份
```

`--check` 的**退出码语义**（升级后先跑这个）：

| 退出码 | 含义 | 动作 |
|---|---|---|
| `0` + `All patched.` | 老版本且补丁已就位 | 无需动作 |
| `0` + `already satisfies ... nothing to patch` | **≥ v0.5.86 上游自带修复** | **无需动作**（不要重打） |
| `1` | ≤ v0.5.75 且仍是脆弱状态 | 跑 `--apply` 并重启 9router |
| `1` + `no upstream gate fix either` | 找不到 9router 或构建布局未知 | 用 `--dir` 指定安装目录 |

`--apply` 在检测到上游自修复时会**直接跳过**（exit 0），不会误改构建产物。

自定义安装位置（默认自动探测 Windows `%APPDATA%\npm` 与 Unix 全局 npm 路径）：

```bash
node fix-opencode-freetier.cjs --apply --dir "C:\path\to\node_modules\9router"
# 或设置环境变量 NINEROUTER_DIR
```

打补丁时可覆盖注入值（写入产物，改动后需重新 `--apply`）：

```bash
NINEROUTER_OPENCODE_UA_VERSION=1.19.0     node fix-opencode-freetier.cjs --apply
NINEROUTER_OPENCODE_QUARTET=read,bash     node fix-opencode-freetier.cjs --apply
```

运行时仍可覆盖（无需重新打补丁）：

```bash
NINEROUTER_OPENCODE_UA=opencode/1.19.0       # 覆盖 UA
NINEROUTER_OPENCODE_FREE_TIER_CONTRACT=off  # 关掉 stream/tools 注入
```

**打完补丁必须重启 9router**——Next.js 构建产物在进程启动时载入内存：

```powershell
# Windows：结束 server 进程，父级 CLI 会自动重启它
Stop-Process -Id (Get-NetTCPConnection -State Listen -LocalPort 20128).OwningProcess -Force
```

重启后务必跑一次验证（A 上游 / B 静态 / C 端到端，三层独立）：

```bash
node verify-opencode-freetier.cjs            # 三层全跑（含两条通道）
node verify-opencode-freetier.cjs --no-e2e   # 只跑 A+B（9router 未启动时）
```

C 层覆盖**两条通道**：4 个 chat 模型 + 2 个 `muse-spark-*`（走 `/responses`）。
只测 chat 会漏掉工具形状类回归。

## 行为

- **UA**：下游已是 `opencode/` 且版本 ≥ 1.17.0 → 原样透传（保留真实客户端标识）；
  否则回退 `process.env.NINEROUTER_OPENCODE_UA || "opencode/1.18.31"`。
- **session**：已是规范格式 → 原样透传；其他值通过 `sha256` **确定性地**映射为
  规范格式，保证粘性会话与上游 prompt cache 不失效。
- **tools**：调用方工具**原样保留**，仅把缺失的必需工具（`read`、`bash`）
  以 no-op 声明追加。`bash` 是官方 shell 工具在**所有平台**的 ID，
  所以即使调用方（如 Windows 上的 DSH）用自己的 `pwsh`，注入 `bash` 后也能通过。
- **stream**：强制 `stream: true` 发往上游。
- **注入的工具形状随通道变化**（重要）：执行器把 `muse-spark-*` 送到
  `/zen/v1/responses`，其余送 `/zen/v1/chat/completions`，两条通道的工具结构不同：

  | 通道 | 工具形状 |
  |---|---|
  | `/chat/completions` | `{ type: "function", function: { name, description, parameters } }` |
  | `/responses` | `{ type: "function", name, description, parameters }`（**扁平**） |

  注入时用执行器自身的判定谓词 `o(a)`（`buildUrl` 用的同一个）来选择形状。
  形状错了不会 403，而是上游 **400 `tools[0]` missing required field `name`** ——
  这是个**静默退化**：补丁看着「生效了」，但 `/responses` 通道整体不可用。
  调用方已有的工具只被**读取检查**，从不改写。

### 注入的 `read`/`bash` 会被模型调用吗？

不会（在真实场景下）。这一点是**实测**的，不是推断——
`probes/probe-injected-tool-vs-real.cjs`：

| 场景 | 模型选中空壳 `bash` |
|---|---|
| **真实 DSH 工具集 + 空壳 `bash`**（生产情形） | **0/4**，一致改选有真实 schema 的 `pwsh`/`glob` |
| 真实工具集 + 空壳 `read` 与 `bash`（手工造重名） | 0/4 选中，但整批 **400**：**重名被上游拒** |
| 只给空壳 `read`/`bash`（调用方不带工具） | 3/3 调用空壳 ← **反例** |

结论与边界：

- 注入的声明是**纯指纹**（空 `parameters`、无实现），**不需要本机真有 bash**，
  在真实工具集在场时也不会被优先选中，风险可忽略（走 9router 调用方总是带工具）。
- 「空壳安全」**不能推广**到「调用方不带任何工具」的路径：那种情况下模型会调用它们。
  此时调用方本来也没声明过工具、拿不到工具调用，影响面小。
- **重名返回 400**，所以去重必须同时识别 nested 与 flat 两种形状——
  否则会给已声明 `read`/`bash` 的调用方追加第二份而整批失败。
  已固化为 `verify-opencode-freetier.cjs` 的 B 层断言。
- 只改 `buildHeaders()` 与 `transformRequest()` 开头的注入块，均为纯函数，
  不触碰路由与其他请求语义。
- 备份文件与目标同目录，命名 `318.js.bak-<ISO 时间戳>`；
  写入前用 `vm.Script` 校验语法，语法不过则**不落盘**。

## 注意

这是对**已发布构建产物**的本地热补丁，**对 ≥ v0.5.86 已不再需要**
（上游自己实现了同样的修复，见顶部状态说明）。任何 `npm i -g 9router`
都会覆盖构建产物——升级后跑 `--check` 即可，脚本会告诉你到底要不要补。

上游若**再次轮换**可接受的条件，会以同样方式复发；
`NINEROUTER_OPENCODE_QUARTET` 是「必需工具名」的单点改动位置。

> **判据文档仍然有效**：A 层（直连上游的四维校验）与 9router 版本无关，
> 用来判断「是 Zen 变了还是 9router 变了」——这次正是靠它把
> 「上游修复」（A 层不变、C 层转变）与「门禁放宽」（A 层会变）区分开。

## 给「将来若还要自研 provider」的参考清单

> **当前方向已定：直接用 9router，不自研 DSH provider 插件**（决策依据见
> [`../../docs/9router-opencode-zen.md`](../../docs/9router-opencode-zen.md) 第 2 节）。
> 本节保留为**参考**：万一 9router 停止跟门禁，或要接其它受限端点时用得上。

同一门禁也约束**任何**代理 Zen 免费层的 DSH provider 插件。自查清单：

1. UA 必须是 `opencode/<版本>` 且版本 ≥ 1.17.0；
2. `x-opencode-session` 必须是 `ses_` + 12 hex + 14 base62
   （官方算法见 `packages/schema/src/identifier.ts`，**不是** `ses_`+32hex）；
3. 下发的 `tools` 必须同时含名为 `read` 和名为 `bash` 的工具 ——
   **Windows 上尤其注意**：DSH 本机 shell 工具叫 `pwsh`，
   若原样透传工具集就会 403，必须补一个 `bash` 声明；
   补的声明是**纯指纹**（空 schema、无实现），实测在真实工具集在场时不会被模型选中；
   同时**去重**要识别 nested/flat 两种形状，**重名会被上游 400 拒绝**；
4. 必须 `stream: true`；
5. **按通道给对形状**（responses 扁平 / chat nested），否则是 400 而非 403 ——
   静默挂掉整条通道。

> 上游 9router 的做法值得抄：注入时把别名映射成必需名、**响应里再映射回原名**，
> 比空壳注入更完备（不会出现「模型调用了假工具」）。

> 相关：DSH 为何在 Windows 上只给 `pwsh`（且不是"缺 bash"）见
> [`../../notes/2026-09-18/dsh-internals/windows-shell-tool-pwsh-not-bash.md`](../../notes/2026-09-18/dsh-internals/windows-shell-tool-pwsh-not-bash.md)

排查细节、完整判据矩阵与实测数据见
[`../../notes/2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md`](../../notes/2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md)
（第一波修复见 [`../../notes/2026-09-17/debug/9router-opencode-freetier-403.md`](../../notes/2026-09-17/debug/9router-opencode-freetier-403.md)）。
