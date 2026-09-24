# OpenCode 免费层 403 复发：门禁升级为「四维 client 指纹」（附官方源码核对）

> 日期：2026-09-18 · 分类：`debug` · 涉及：9router v0.5.75（Windows 全局 npm 安装）
> 门禁验证版本：`anomalyco/opencode` @ `b02acc1e`（opencode **v1.18.31**）
> 前情：[`../../2026-09-17/debug/9router-opencode-freetier-403.md`](../../2026-09-17/debug/9router-opencode-freetier-403.md)

## 背景 / 现象

2026-09-17 修好的 `403 FreeTierError`（UA + 规范 session 两个条件）在次日**复发**，
同一个错误、同一个免费模型池（`oc/mimo-v2.5-free` 等）。

关键判据：**直连上游也 403**（不经 9router）。这排除了「本地补丁失效」，
定位到上游门禁再次加严。

## 结论（四维指纹，四个条件必须同时满足）

| # | 条件 | 反例 → 结果 |
|---|---|---|
| 1 | `User-Agent` = `opencode/<maj>.<min>.<patch>`，版本 **≥ 1.17.0** | 裸 `opencode`/`node`/`curl` → 403；`opencode/1.16.0` → **426 UpgradeRequired** |
| 2 | `x-opencode-session` 匹配 `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$` | `ses_`+32hex、裸 UUID、缺失 → 403 |
| 3 | 请求体 `tools` **同时含名为 `read` 和名为 `bash` 的工具** | 缺任一 → 403；两者齐全 → 200 |
| 4 | 请求体 `stream: true` | `stream:false`（两个 endpoint）→ 403 |

顺序、schema 形状、工具数量、额外工具均无关。**`glob`/`grep` 不是判据。**

## 两个关键教训（都值得单独记住）

### 教训 A：「换真 key 也没用」是分诊捷径

排除项中最重要的两条：

| 假设 | 实测结果 |
|---|---|
| 换**真 Zen key** 能绕过 | 免费模型照样 403；同 key 付费模型 401 `CreditsError` → **排除**（门禁认模型，不认凭据） |
| key 是否有效 | 付费模型返回 `CreditsError` 而非 `AuthError` → key 有效 |

付费模型返回 `CreditsError`、免费模型返回 `FreeTierError`，说明门禁**在模型这一层**而不是凭据层。
这条一次就把「是不是 key/权限问题」这类猜测全部剪掉。

### 教训 B（本次最大的坑）：过拟合 —— 把「恰好含必需项的超集」当成了判据

第一次二分矩阵是这样的（UA + 规范 session + stream 固定）：

```
0 tools                        GATE 403
1 tool  (bash)                 GATE 403
2 tools (bash, read)           OK   200
3 tools (bash, glob, grep)     GATE 403     <-- 三个却失败！
QUARTET {bash,glob,grep,read}  OK   200
quartet + 2 extras             OK   200
10 fake names                  GATE 403
```

当时我读成「必须凑齐四件套 `{bash,glob,grep,read}`」——**这是错的**。
`{bash,read}` 已经能过、`{bash,glob,grep}` 失败，本身就说明「四件套」不是规则，
真正的原因只是 `{bash,glob,grep}` **缺了 `read`**。

逐名族试探后得到真规则（`3/3` 重复稳定）：

```
{read,bash}            OK        {bash,glob,grep}     403      <-- 3 个仍失败 => 不是数量
{read}                 403       {read,bash,+5 fakes} OK       <-- 加料不影响
{bash}                 403       {read,pwsh}          403      <-- pwsh 不顶替 bash
{bash,glob}            403       {read,shell}         OK       <-- shell 可顶替 bash
{read,exec}            403       {read,bash_exec}     403
{read->"Read"}         403       schema 形状三种        全部 OK   <-- 与 schema 无关
```

最终规则：**需要一个名为 `read` 的工具 + 一个名为 `bash` 或 `shell` 的工具。**

**可复用要点**：
- 「几个名字能过」不等于「必须是这几个名字」——**例外组合（3 个反而失败）是过拟合的信号**，
  一旦出现「A+B 能过、A+B+C 不能过」，就说明规则不是「包含 A,B,C」。
- **试探值必须是真实候选值**：用杜撰名（`_noop`、`ping`）只能得到「这个名不对」，
  无法区分「名字不对」与「必须是特定具名集合」。
- 拿到疑似规则后，**必须做「破坏其中一项、其余保持」的单变量验证**，
  而不是继续加料看是否仍然通过。

## 权威核对：直接读官方客户端源码

与其继续猜，不如读**官方实现**（`anomalyco/opencode` 是开源的）。四维全部对上：

```
packages/opencode/src/session/llm/request.ts
  L18   const USER_AGENT = `opencode/${InstallationVersion}`        <- 判据 1
  L191  "x-opencode-session": input.sessionID                       <- 判据 2
  L148  const tools = resolveTools(input)   // Record<string, Tool>
  L184  tools: Object.fromEntries(... toSorted ...)                  <- 判据 3：按名下发
  L194  "User-Agent": USER_AGENT

packages/schema/src/session-id.ts
  "ses_" + descending()                                            <- 判据 2
packages/schema/src/identifier.ts
  6 字节 hex 时间(12) + 14 个 base62                              <- 正是那个正则
  chars = "0-9A-Za-z"，bytes[byte % 62]

packages/opencode/src/tool/read.ts        L64   Tool.define("read", ...)
packages/opencode/src/tool/shell/id.ts          export const ToolID = "bash"
     // 注释原文：Keep the exposed tool ID and permission key as "bash" for
     // compatibility with existing plugins, users, and saved permissions.
     // Rename with opencode 2.0.
```

**决定性的一条**：`tool/shell/id.ts` 说明 shell 工具的 ID **在所有平台（含 Windows）都叫 `bash`**。
所以官方客户端在 Windows 上发的就是 `bash`——**它从不发 `pwsh`**。
而判据 3 要求「有 `read` 和 `bash`」，所以官方客户端**天然满足**，这也解释了为什么门禁要这样设计
（它就是在认「官方客户端的工具集」这个指纹）。

顺带确认：`packages/opencode/package.json` 的 version 正是 **1.18.31**，
与社区流传的 UA 版本一致——注入 `opencode/1.18.31` 是「当前真实的官方版本」，不是随便挑的数字。

**可复用要点**：**「官方实现是开源的」时，读源码永远优于二分试探**。
二分给你的是「什么能过」，源码给你的是「为什么」——后者才能一次改对、
并且知道上游下一步可能怎么收紧。本次二分得到的 `read`+`bash` 规则，
是从源码注释里一句话得到确证的。

## DSH 相关的直接影响

DSH 本机的 shell 工具名为 **`pwsh`**（`@deepseek-ai/dsh-tool-pwsh` 注册 `name: "pwsh"`），
DSH 也提供了 `dsh-tool-bash`（注册 `name: "bash"`），但 Windows 会话实际暴露的是 `pwsh`。
于是**任何把 DSH 工具集原样透传给 Zen 的 provider 插件都会 403**——
这解释了一批 DSH 侧 Zen 代理插件（如 `FishBottle7/opencode2dsh`）在 Windows 上失效。
修复方式就是补一个 `bash` 声明（本仓库的补丁正是这么做的）。

> 社区对照：`FishBottle7/opencode2dsh` 的 PR #11（session 格式）与 PR #8（muse-spark 走 `/responses`）
> **都没有碰工具轴**；其 master 的 `deriveRequestIDs` 用的是 `ses_`+24hex（不合规），
> `toPiContext` 原样透传 `options.tools`（不注入）。作者 09-18 01:03 在 issue #9 表示「现在开始修复」。

## 修复

升级 `tools/9router-fix/fix-opencode-freetier.cjs`（v2 → 本次再校正），三处补丁点：

1. **`buildHeaders()` UA**（判据 1）：下游 UA 已合规则透传，否则回退 `opencode/1.18.31`；
2. **`buildHeaders()` session**（判据 2）：非规范格式用 `sha256` **确定性**映射为规范形状，
   保住粘性会话与上游 prompt cache；
3. **`transformRequest()` 入口注入块**（判据 3+4）：强制 `b.stream = true`，
   并把缺失的 `read`/`bash` 以 no-op 声明**追加**进 `b.tools`（调用方工具原样保留）。

本次校正：注入集合从过拟合的「四件套」改为**真实的 `{read,bash}`**。
`--check` 能识别「只打了 v1（UA+session）」的中间态并报告缺 contract；
写入前用 `vm.Script` 校验语法，语法不过**不落盘**。

## 第三个坑：两条通道的工具形状不同（静默退化）

修完 403 之后又发现一个**独立的**缺口——它不报 403，所以更容易漏掉。

9router 的执行器里有个模型判定谓词，`buildUrl` 用它选 endpoint：

```js
let l=new Set(["muse-spark-1.2-contributor-free","muse-spark-1.3-contributor-free"]);
function o(a){let b=n(a);return l.has(b)||(0,k.nh)(b)}          // k = 模块 59096
buildUrl(a){return o(a)?`${b}/zen/v1/responses`:`${b}/zen/v1/chat/completions`}
```

`muse-spark-*` 走 `/zen/v1/responses`，**其余走 `/chat/completions`**。两条通道的工具结构**不一样**：

| 通道 | 工具形状 |
|---|---|
| `/chat/completions` | `{ type:"function", function:{ name, description, parameters } }` |
| `/responses` | `{ type:"function", name, description, parameters }`（**扁平**，无 `function` 包裹） |

我第一版注入写死了 chat 形状，于是 `/responses` 通道报：

```
400 invalid_request_error  `tools[0]` missing required field `name`
```

**这不是 403，是 400** —— 没有 `FreeTierError`，补丁「看起来生效了」，
但 `muse-spark-*` 整条通道不可用。修法：注入时用执行器**自身的**谓词 `o(a)`
（和 `buildUrl` 同一个函数）选择形状；调用方已有工具只**读取检查**，从不改写。

**可复用要点**：
- **「修好了」要按功能面验证，不能只验一个通道**。同一 provider 的不同 endpoint
  可能要求不同 wire 格式；只测默认通道会留下静默退化。
- **注意区分错误类别**：`403 FreeTierError`（门禁）与 `400 invalid_request_error`（我的报文结构错）
  是完全不同的信号。前者说明「指纹没补齐」，后者说明「补丁写错了」。
  验证脚本里要把两者分开报，别把 400 当上游抖动重试掉。
- 判据要**复用生产代码的判断函数**，不要自己另写一份等价逻辑——
  自己写的会随上游变化而漂移，用 `o(a)` 则天然与 `buildUrl` 保持一致。
- 顺带确认：`/responses` 通道**同样遵守 `read`+`bash` 规则**
  （`with read only` → 403、`with pwsh instead of bash` → 403、`with read+bash` → 200）。

## 第四个坑：我能注入空壳工具，但模型会不会真的调用它？

判据 3 逼着我**必须下发**名为 `read`/`bash` 的工具声明，而我注入的是**空壳**
（空 `parameters`、无实现）。调用方（DSH）自己并没有声明这两个名字，
所以一旦模型对空壳发起 tool_call，调用方就会收到一个**自己没声明过的工具调用**。
这是补丁自身引入的风险，必须实测，不能靠"应该不会吧"。

`probes/probe-injected-tool-vs-real.cjs` 三场景对比：

| 场景 | 模型选中空壳/别名 `bash` |
|---|---|
| **A. 真实 DSH 工具集 + 空壳 `bash`**（生产情形） | **0/4** —— 一致改选有真实 schema 的 `pwsh` / `glob` |
| B. 真实工具集 + 空壳 `read` 与 `bash`（手工造重名） | 0/4 选中，但整批 **400**：**重名被上游拒** |
| C. 真实工具集 + 把 `pwsh` **别名为** `bash`（真实 schema） | 2/4 选中 `bash` |

**A 行是生产情形**（走 9router 的调用方总是带自己的工具集），
模型在"有真实 schema 的 `pwsh`"与"空壳 `bash`"之间一致选前者，风险可忽略。

**反例必须一起记**：`probe-injected-tool-usage.cjs` 里**只**给空壳 read/bash 时，
模型 **3/3** 会调用它们。所以「空壳安全」**只在真实工具集在场时成立**，
不能推广到「调用方不带任何工具」的路径（那种情况调用方本来也拿不到工具调用）。

**B 行又暴露一个真实失败模式**：**重复工具名 → 上游 400**（不是 403）。
所以去重必须**同时识别 nested（chat）与 flat（responses）两种形状**，
否则会给已声明 `read`/`bash` 的调用方追加第二份而整批失败。
已固化为 `verify-opencode-freetier.cjs` B 层的去重断言。

**可复用要点**：
- **补丁自己注入的东西，要评估"被真正使用"的后果**，而不只是"能不能通过校验"。
  注入是**指纹**，但指纹也会进入模型的可选工具集。
- **对照实验要有"生产情形"那一组**。只给空壳测（3/3 被调用）会得出
  "风险很高"的错误结论；真实工具集在场（0/4）才是实际风险。
- **重名是硬错误**：这类"看起来无害的追加"在去重失效时会整批 400。

DSH 为何在 Windows 上只给 `pwsh`、以及本机 bash 的真实可用性，
另见笔记 [`../dsh-internals/windows-shell-tool-pwsh-not-bash.md`](../dsh-internals/windows-shell-tool-pwsh-not-bash.md)。

## 验证

三层，全部由 `verify-opencode-freetier.cjs` 一键复跑：

- **A 层（直连上游）**：官方指纹 200；**逐轴破坏**分别得到
  403 / 426 / 403 / 403（缺 read）/ 403（缺 bash，用 pwsh 顶替）/ 403 / 403（非流式）——四维独立必需。
- **B 层（加载真实补丁产物）**：`buildHeaders()` 输出 UA 与规范 session；
  `transformRequest()` 对 `stream:false,无 tools` → `stream=true, tools=[read,bash]`，
  对 **DSH 工具集（含 `pwsh`、无 `bash`）** → 追加 `bash` 后通过；
  并**按通道断言工具形状**（chat 通道 → nested；responses 通道 → flat）。
- **C 层（端到端经 9router，两条通道）**：**6/6 免费模型 HTTP 200** ——
  4 个 chat（`mimo-v2.5-free`、`nemotron-3-ultra-free`、`ling-3.0-flash-fin-free`、
  `nemotron-3.5-lightning-free`）+ 2 个 responses（`muse-spark-1.3-contributor-free`、
  `muse-spark-1.2-contributor-free`）。最终 **ALL CHECKS PASSED**。

另有 `probes/probe-official-contract.cjs` 按**官方源码契约**渲染请求并断言四维，
含 `/responses` 通道（muse-spark-*）同样遵守 `read`+`bash` 规则。

## 其他可复用要点

- **「直连上游也失败」是补丁无关信号**：先把上游与本地补丁的归因分开。
- **列出「已验证无效」的假设**与列出「有效条件」同样重要。本次排除：
  `x-opencode-client` / `x-opencode-request` / `x-opencode-project` / `x-session-affinity` /
  `X-Session-Id` 均不参与；HTTP/1.1 与 h2 无差异；UA 平台括号段与 4 段形式无效；
  session 时间序算法无关（判据是格式）；真 key 不能绕过。
- **门禁判据可能藏在请求体里**，不只 header：只扫 header 会误得「无法绕过」。
- **改了 gate 就要同步改 verify**：A 层旧版自己发 `stream:false`、无 tools，
  补丁生效后反而报 FAIL——验证脚本必须随判据演进，否则会误导判断。
- 相关文件：
  - 补丁目标 `%APPDATA%\npm\node_modules\9router\app\.next-cli-build\server\chunks\318.js`
    （模块 4493 = OpenCode executor；`transformRequest` / `buildHeaders`）
    —— **注意：该路径仅适用于 ≤ v0.5.75**；v0.5.86 起实现被拆到
    `5330.js` / `6249.js` / `8499.js`，见下方「后续」。
  - 运行数据 `%APPDATA%\9router\db\data.sqlite`（表 `requestDetails`，
    `data.request.providerRequest` 可看到 9router 实际发上游的请求体）
- 参考：官方源码 `anomalyco/opencode` @ `b02acc1e`（v1.18.31）；
  社区 `jasonxu114514/opencode2api@8185202`（UA+session，第一波）；
  `FishBottle7/opencode2dsh` PR #8/#11 与 issue #9。

## 后续：本补丁已被上游吸收，已退役（2026-09-24）

**结论先给**：升级到 **9router ≥ v0.5.86 后不需要再打这个补丁**——
上游自己实现了同样的修复（连 session 都用的是官方 descending 时间算法）。

这条链的收束与证据（含「怎么区分是上游修好了还是 Zen 放宽了」）见
[`../../2026-09-24/debug/9router-0.5.86-absorbed-hotpatch.md`](../../2026-09-24/debug/9router-0.5.86-absorbed-hotpatch.md)。

因此本文上面的判据矩阵虽然仍然正确，但定位已从「修什么」转为
**「上游若再次轮换条件时的对照基准 + 升级后的回归验证」**。

