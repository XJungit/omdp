# OMDP 插件兼容性评估

> ⚠️ **本文档为演进记录**：`@omdp/dsh-gitbash-win` 与 `@omdp/dsh-resume-stream`
> 已于 2026-08-25 归档（源码移至 `archive/`，不再维护或发布）。下方对 gitbash
> 的评估保留作为历史架构参考；当前活跃插件版本见各节标题（connector `0.3.2` /
> vision-bridge `0.1.10` / key-fallback `3.1.6` / archived-sessions `0.3.1`）。
>
> 评估内容：各插件对 DSH（DeepSeek Harness）更新的抗崩溃能力。
> 核心问题：DSH 更新后，插件会不会导致 DSH 崩溃？

**结论先行**：活跃插件都采用**抗崩溃架构**——DSH 更新时**不会因插件而崩溃**（硬保证），
最坏情况只是单个插件功能需要适配更新。插件之间互不影响。

**DSH `v0.1.5-rc.1`（`next` dist-tag）适配结论（2026-09-10）**：三个插件**源码零改动即兼容**，唯一动作是给 `@omdp/dsh-key-fallback` 的 peer 枚举**追加** `0.1.5-rc.1`（升 `3.1.6`）。逐项核查（releases + npm 双查：GitHub `dsh-v0.1.5-rc.1` Pre-release 2026-09-10、npm `dist-tags`：`latest=0.1.2-rc.1`、`next=0.1.5-rc.1`、`alpha=0.1.5-alpha.2`）：
- `@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-base` 相对 `0.1.2-rc.1` **只有 `package.json` 版本号变化**（`lib` 逐文件 SHA256 一致）→ 服务面零变化；
- `@deepseek-ai/dsh-llm` 变化**全为附加式**（新增 `lib/types/assistant-stream.js`、`FileBlock`/`fileHandleText`/`projectFilesToText`、可选 `systemPromptUpdate`），本生态调用的 `registerAdapter`/`stream`/`listProviders`/`listConfigurableProviders`/`listModels`/`resolveModelInfo`/`inputModalities` 全部保留（`types.d.ts` diff 无删除项）；
- `@deepseek-ai/dsh-tools`（`register`/`guard` 保留）、`@deepseek-ai/dsh-attachment`（`readImage`/`fileHostPath` 保留，新增文件存储半边）、`@deepseek-ai/dsh-system-prompt`（`system-prompt/assemble` 事件保留）、`@deepseek-ai/dsh-agent-loop`（`agent/pre-step`/`agent/request`/`agent/request-error` 保留，`preStep` 的 dispatch 语句**逐字相同**）、`@deepseek-ai/dsh-web-app`（`webServer.register` 未变；仅 `launchedThroughSsh` 改从 `dsh-launch-environment` 导入）、`@deepseek-ai/dsh-mcp-client`（仅新增重复 cursor 防护）；
- client 侧：`settings.section` slot 保留（`dsh-client-ui-settings-general`/`-plugins` 仍声明）、composer 仍是 Lexical contenteditable（`data-composer-input` + `__lexicalEditor` 标记俱在）→ §3 的 0.1.10 修复继续有效。
- ⚠️ **本版破坏性变更均不在本插件使用面内**：移除 `ctx.agent`、Inbox API 调整、Session 格式升级 V3 / `SessionHandle` 生命周期、`conversation` slot 迁移为 `main` 的 key、`tool/code-dispatch` 改名 `tool/ptc-dispatch`、persona 前缀/后缀拆分——三插件均未触及。
- ⚠️ **但 0.1.5-rc.1 的 Session 契约变更破坏了第三方插件**：`sessionPersistence.list()` 由裸 `SessionHeader[]` 改为 `SessionPersistenceSnapshot[]`，且抽象服务移除 `locate(meta)`——`@muwinds/dsh-archived-sessions` 0.2.0 因此全部列表显示「文件缺失」、删除退化为释放。omdp 已 fork 修复为 §5 `@omdp/dsh-archived-sessions` 0.3.1。
- ⚠️ **仍需单独做的验证**：本结论是**源码级**核查（逐包逐文件哈希 + 类型声明 diff），未在真实 `0.1.5-rc.1` 运行时上跑回归；client 浏览器层（composer/slot 实际行为）也应另做活体验证，理由见下方 caveat。

**DSH `v0.1.2-rc.1`（`next` dist-tag）适配结论（2026-09-03）**：三个插件 host 侧**源码零改动即兼容** DSH next（仅 peer 枚举动作）。逐项核查（npm `dist-tags`：`latest=0.1.1-rc.2`、`next=0.1.2-rc.1`、`alpha=0.1.2-alpha.5`）：`@deepseek-ai/dsh-credentials`/`@deepseek-ai/dsh-llm`/`@deepseek-ai/dsh-settings` 从 `0.1.2-alpha.2`→`alpha.3`→`alpha.4`→`alpha.5`→`0.1.2-rc.1` **逐字节一致（`Compare-Object` NO DIFF）**；`ctx.credentials`（`resolve`/`set`/`unset`/`describe`→`{configured,source,writable}`）、`ctx.llm`（`registerAdapter`/`stream`/`listProviders`/`listConfigurableProviders`/`resolveModelInfo`/`inputModalities`）、`ctx.webServer`（`register({kind:'prefix'|'exact'})`、`ctx.get('webServer')?.port`）、`agent/request(-error)`、`tools.register`、`attachments.readImage`、`window.__ModuleLoader__.load` client 挂载——全部保留。node engines `^22.19.0 || >=24.0.0` 不变（DSH 主包依赖 `cordis^4.0.2`、`schemastery^3.18.2` 仍在枚举内）。**结论：三插件 host 源码零改动兼容 next；唯一动作是把 next 系列版本追加进 `@omdp/dsh-key-fallback` 的 peer 枚举（已实测一致才放行）**。

> ⚠️ **client UI 层 caveat（2026-09-09 补充）**：上述"零改动兼容"仅覆盖 **host/API 层**。
> `0.1.2-rc.1` 把 composer 换成 **Lexical contenteditable**（不再是 `<textarea>`），vision-bridge
> client 的粘贴插入逻辑因此回归（0.1.9 只认 TEXTAREA/INPUT → 文本模型粘贴路径插不进）。
> 该 client 行为差异在 0.1.10 修复（见 §3）。经验：**client 侧的宿主 UI 结构变化（composer/输入框
> 元素类型、slot 树）不会反映在 host API 兼容核查里，需单独做浏览器层验证**。

**DSH `v0.1.2-alpha.1` / `v0.1.2-alpha.2` 适配结论（2026-08-28 / 2026-08-31）**：三个插件**源码零改动即同时兼容**
当前版本 `0.1.1-rc.2` 与新版 `v0.1.2-alpha.1`、`v0.1.2-alpha.2`。逐项核查过的 API 面（版本间源码逐字对比）：
`ctx.webServer.register({kind:'prefix'})`（新增 gzip 压缩中间件，向后兼容）、
`agent/request(-error)` 载荷、`credentials` reference 半边（`resolve`/`describe`/`set`/`unset`/`credentialRef`）、
`settings.yaml` 文件、client `slots.inject('settings.section')`+`register`、`attachments.readImage`、
`tools.register`、`llm.resolveModelInfo`、`/plugins/<id>/client.js` 加载、`__ModuleLoader__`——全部一致。
alpha.1 → alpha.2 增量核查：webServer/attachments/client-modules src 零变化，agent `runtime-types.ts` 零变化，
credentials/llm/settings/tools 签名与服务面不变（内部重构），`settings.section` slot 契约零变化。
Node 要求三版本相同（`^22.19.0 || >=24.0.0`）。唯一改动：`@omdp/dsh-key-fallback` 的
`peerDependencies` **只精确枚举已实测兼容的版本**（2026-08-31 起，不用 `<0.2.0` 类开放范围）：
credentials `0.1.0-rc.6 || 0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2`、llm/settings
`0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2`、cordis `4.0.1 || 4.0.2`、schemastery `3.18.1 || 3.18.2`
（npm semver 只匹配同 `[major,minor,patch]` 三元组内的预发布，故须逐版本显式列出）。回归测试通过（smoke 33/33、集成 49/49）。

---

## 1. @omdp/dsh-gitbash-win（v0.1.6）【已归档，仅作历史参考】

### 架构

| 层 | 做法 | 效果 |
|---|---|---|
| 顶层零依赖 | 模块顶层只 `import node:*`（内置），不静态引用 `@deepseek-ai/*` | DSH 加载阶段永不失败 |
| 动态加载依赖 | 所有 `@deepseek-ai/*` 在 `apply()` 内 `await import()` | 解析失败→干净报错，插件不加载，DSH 照常 |
| 失败隔离 | 每个依赖加载 try/catch | 单个 API 变化只影响 gitbash 工具 |

### 依赖的 DSH 接口（动态，版本 `^0.1.0-rc.8`）

| 包 | API | 变更风险 |
|---|---|---|
| `@deepseek-ai/dsh-tools` | `defineTool` / `TOOL_ABORTED` | 中 |
| `@deepseek-ai/dsh-sandbox` | `confine` / `approveEscalation` / `ESCALATION_TARGETS` | 高（沙箱在演进） |
| `@deepseek-ai/dsh-llm` | `HarnessError` | 低 |
| `@deepseek-ai/dsh-shell` | `parseExitStatus` | 低 |
| `@deepseek-ai/dsh-timeout` | `clampTimeout` / `deadline` / `timeoutOf` | 低 |

ctx 使用：`ctx.tools.register`、`ctx.subprocess.spawn`、`ctx.shellEnv.collect`、
`ctx.systemPrompt.section`、`ctx.get('sandbox')` / `ctx.get('sandboxPolicy')` / `ctx.get('jobs')`。

### 风险点

- **`dsh-sandbox` 是最大变数**：Windows ACL 沙箱（koffi）当前有上游 bug（`windows-acl-run` 临时目录失败）。
  这是 DSH 上游问题，与本插件无关；插件动态跟随 `ctx.sandbox`，上游修复后自动受益。
- **peerDependencies 声明了 6 个 `@deepseek-ai/*`**（`^0.1.0-rc.8`），但**不实际安装**（动态加载），
  所以不会因版本不匹配而启动失败。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本 | ✅ DSH 不崩；gitbash 工具可能需适配（更新插件） |
| 依赖解析失败 | ✅ 干净失败，插件不加载 |

---

## 2. @omdp/dsh-connector（v0.3.0）【活跃插件】

### 架构

- **纯静态 import**：`node:*` + `yaml`（唯一第三方依赖，版本 `^2.9.0`）
- **零 `@deepseek-ai/*` 硬依赖**（`@deepseek-ai/schemastery` 仅 peer 声明，供工具过滤的 settings schema 用）
- **Client→Host 走 HTTP API**（`/connector/api/*`），不依赖动态 `host.call`

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.webServer`（硬依赖 `inject: ['webServer']`） | 注册 `/connector` 前缀 HTTP 路由 | 中 |
| `ctx.get('logger')` | 日志 | 低 |
| `ctx.get('settings')`（可选） | 工具过滤规则（`connector.toolFilters`），无则全放行 | 低 |
| `ctx.get('tools')` 的 `guard`（可选） | 工具过滤执行期硬拦截，无则跳过 | 低 |
| `ctx.get('systemPrompt')` 的 `tools(provider)`（可选） | 工具过滤 prompt 层隐藏，无则跳过 | 低 |
| `yaml`（npm） | YAML 解析 | 低（独立 npm 包，版本锁定） |

### 风险点

- **`ctx.webServer.register` 是唯一的 DSH 硬依赖**：`inject: ['webServer']` 是硬注入，
  若 DSH 大版本改名/改签名（如 `webServer` → `httpServer`），connector 会**加载失败**。
  但失败是**干净失败**（插件不加载），DSH 不崩。
- **逻辑内有多个 try/catch**（yaml 解析、MCP 配置读写），防御性处理。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本 | ✅ DSH 不崩；若 `webServer` API 变化，connector 需适配 |
| yaml 版本 | ✅ 独立 npm 包，不受 DSH 更新影响 |

---

## 3. @omdp/dsh-vision-bridge（v0.1.10）【活跃插件】

### 架构

- **ESM bundle**：`index.js` 在 `apply()` 内用动态 `import()` 解析 `@deepseek-ai/*` 工具与接口（同 dsh-key-fallback）
- **多模态包装 + 工具注册**：`ctx.llm.registerAdapter` / `ctx.tools.register` / `ctx.attachments`
- **Client 半支持粘贴/拖拽走 bridge（`vision_bridge_read_image`）或原生路径**
- **client 插入目标兼容 Lexical composer（v0.1.10）**：DSH `0.1.2-rc.1` 起 composer 从 `<textarea>`
  换成 Lexical contenteditable（`<div contenteditable role="textbox" data-composer-input>`）。
  0.1.9 的 `insertText` 只认 `TEXTAREA/INPUT` → 文本模型粘贴路径插不进 = "没反应"（图片已被截获上传，
  但路径未入输入框）。0.1.10 改为向上解析可编辑宿主（textarea/input/contenteditable），
  contenteditable 走 `execCommand('insertText')` 触发 Lexical 的 beforeinput/input 同步
  （失败兜底派发合成 `beforeinput`）；焦点不在可编辑宿主时放行原生事件不再吞图。

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.credentials`（硬依赖 `inject`） | 凭据解析（`?.resolve?.()` 可选调用） | 中 |
| `ctx.attachments`（硬依赖 `inject`） | 读图片（`readImage`） | 中 |
| `ctx.llm`（硬依赖 `inject`） | LLM 适配器/流式（多处 `typeof` 检查 + 可选降级） | 中 |
| `ctx.tools`（硬依赖 `inject`） | 注册 `vision_bridge_read_image` 工具 | 低 |

### 风险点

- **大量防御性编码**：`ctx.credentials?.resolve?.()`、`ctx.get('llm')?.resolveModelInfo`、
  `typeof ctx.llm?.registerAdapter !== 'function'` → 提前 return——**API 缺失时优雅降级**。
- **`ctx.llm` 是最大变数**：注册适配器（`registerAdapter`）、流式（`stream`）、
  模型信息（`resolveModelInfo`/`listModels`）——DSH 大版本可能调整 LLM 服务 API。
  但所有调用都有 `typeof`/`?.` 防御，**最坏是功能降级，不崩溃**。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本 | ✅ DSH 不崩；LLM 相关功能可能降级（适配器/流式），需适配 |
| API 缺失 | ✅ 优雅降级（防御性编码） |

---

## 4. @omdp/dsh-key-fallback（v3.1.6）【活跃插件】

### 架构

- **ESM bundle**：`lib/index.js` 为 `type: module`（`main`/`exports` → `./lib/index.js`），静态 import `@deepseek-ai/dsh-credentials`（只用 reference 半边 `credentialRef`/`resolve`/`describe`/`set`/`unset`；`isCredentialRefName` 本地实现兜底）与 `node:*` 内置。
- **Host**: `inject: ['llm','settings','webServer','credentials']`。`agent/request` 预写 key（`credentials.set` **和** `process.env` 双写）；`agent/request-error` 注册 `prepend: true` 先于 `dsh-llm-retry` 看到错误，按池 `rotateOn` 判定后切 key，**重发交还 llm-retry**。`webServer` 用 `ctx.get('webServer')` 可选获取（不硬 inject 缺失不崩）。
- **Client**: 独立设置页 `Settings → API Key 回退`，经 `slots.inject('settings.section')` + `slots.register` 注册（`id: 'key-fallback'`, `order: 62`），不再依赖 `installSettingsSection`/`settings.plugin.item` 双路渲染。
- **能力**：多 key 池按 `rotateOn`（失败码/状态/关键字）判定轮换；固定 `cooldownMs` 冷却；`useKeyRef` 锁定/`nextRef` 链；短 ref 自动命名 + 旧长 ref 一次性幂等迁移；`GET /keys/plain` 明文揭示（仅池内 key/env）；env key 可编辑（describe 只读拒绝）。

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.credentials`（`inject` 硬依赖） | `set`/`unset`/`describe`/`resolve` + `credentialRef`（reference 半边，rc.6 起稳定） | 低–中（record 半边 rc.8 新增，插件未用） |
| `ctx.llm`（`inject` 硬依赖） | `agent/request` + `agent/request-error` waterfall 换 key 链 | 中（事件名/载荷若变需适配） |
| `ctx.settings`（`inject` 硬依赖） | 池配置持久化到 `settings.yaml` 的 `keyFallback.providers` | 低 |
| `ctx.webServer`（`ctx.get` 可选） | `GET/POST /dsh-key-fallback/*` HTTP API（客户端设置页 fetch 用） | 中（缺失时设置页不可用，插件本体仍工作） |
| client `slots`（`ctx.get` 可选） | `settings.section` 槽位注册设置页 | 低（缺失则 UI 不显示，聊天轮换不受影响） |

### 风险点

- **peer 声明严格枚举实测版本**（2026-08-31 起）：credentials `0.1.0-rc.6 || 0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1 || 0.1.5-rc.1`、llm/settings `0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1 || 0.1.5-rc.1`、cordis `4.0.1 || 4.0.2`、schemastery `3.18.1 || 3.18.2`——只声明已实际兼容测试过的版本，不用开放范围；`0.1.2-alpha.2`→`alpha.5`→`0.1.2-rc.1` 配套包逐字节一致（2026-09-03 复核），`0.1.5-rc.1` 于 2026-09-10 核查通过后**追加**（credentials/settings 仅版本号变化、llm 变化全为附加式），旧版本继续保留在枚举内。
- **`ctx.llm` 事件**是主要变数：`agent/request`/`agent/request-error` 的载荷结构若在 DSH 大版本调整，轮换判定需适配；但所有 handler 都走 `next()` 链，异常不会让 DSH 崩溃。
- **`webServer` 可选**：用 `ctx.get('webServer')` 而非硬 inject，缺失时插件其余功能（轮换）照常。
- **防御性编码**：凭证读写、`describe`、状态计算均有 try/catch；`ctx.credentials.describe` 存在性检查。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本 | ✅ DSH 不崩；`agent/*` 事件载荷或 `webServer` 若变，轮换/设置页需适配 |
| `dsh-credentials` 版本漂移 | ✅ reference 半边自 rc.6 稳定，低风险 |
| 服务缺失 | ✅ 设置页不显示/轮换降级，不崩溃 |

---

## 5. @omdp/dsh-archived-sessions（v0.3.1）【活跃插件】

> fork 自 `@muwinds/dsh-archived-sessions` 0.2.0。上游在 DSH 0.1.5-rc.1 下损坏（见下方风险点），作者已一个月未维护，2026-09-10 决定 fork 并入 omdp。

### 架构

- **ESM bundle**：`lib/index.js` 为 `type: module`（`main`/`exports` → `./lib/index.js`），`inject: ['webServer']` 注册 `/dsh-archived/*` 前缀 HTTP 路由。
- **Host 依赖**：`workspaceRegistry`（读/写 `archivedSessionIds`）、`sessionPersistence`（`list()` 快照）、`sessionQuery`（标题/详情）、`fs`（目录体积）、`shell`（删目录，danger-full-access 策略）、`sessions`/`agents`（活动/运行态）、`storageDomain`（注册表写入兜底）。
- **Client**: 设置页 `Settings → 归档会话`，经 `slots.inject('settings.section')` + `slots.register` 注册（`id: 'archived-sessions'`, `order: 30`）。
- **能力**：列表/释放/删除（两步确认）/详情；**按树删除**（`parentSession` 子树一并删，修 issue #2）；**孤儿清理**（`/orphans` 列表 + `/sweep` 清理父会话已不在盘的子会话）。

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.sessionPersistence`（`ctx.get` 可选） | `list()` 返回 `SessionPersistenceSnapshot[]`（`{header, revision, eventCount?, sizeBytes?}`） | **高**——0.1.5-rc.1 移除抽象 `locate()`，本 fork 已改用 JSONL 后端同款路径编码自解析 |
| `ctx.workspaceRegistry`（`ctx.get` 可选） | `archivedSessionIds` + `setState`（归档集合读写） | 中（字段/方法若变需适配） |
| `ctx.sessionQuery`（`ctx.get` 可选） | `readTitleSnapshots` / `readSession`（标题与详情） | 低–中 |
| `ctx.webServer`（`inject` 硬依赖） | `/dsh-archived/*` HTTP API | 中（缺失则设置页不可用） |
| `ctx.fs` / `ctx.shell`（`ctx.get` 可选） | 目录体积计算 / 删目录（danger-full-access） | 低（缺失则体积显示 0 / 删除降级） |
| client `slots`（`ctx.get` 可选） | `settings.section` 槽位注册设置页 | 低（缺失则 UI 不显示） |

### 风险点

- **路径解析是最大变数**：0.1.5-rc.1 抽象服务移除 `locate()`，本 fork 按 DSH JSONL 后端同款编码（`encodeSegment`：保留 `[A-Za-z0-9._-]`，其余 `~XXXX`；`projectKey`：`/\:` → `-`）自行拼 `session-<uuid>` 目录；已用真实磁盘核对（67 条归档 → 1 条存在 66 条缺失，与盘一致）。若 DSH 改目录布局（如文件名/代际），列表可能再出现「文件缺失」——但**删除安全护栏**（目录名必须是会话目录才允许删）保证不会误删。
- **上游 0.2.0 损坏根因**（本 fork 已修）：`list()` 返回快照数组后按裸 header 取 `header.id` → undefined；`locate(header)` 返回 undefined → `.path` 抛 TypeError 被 catch 吞 → `no-artifact` 分支 → 全列表「文件缺失」+ 删除退化为仅移除归档标记。
- **删除是危险操作**：有 `assertSessionDirName` 校验（只删 `session-<uuid>` 或裸 UUID 目录）+ 运行中会话拒绝删除 + 两步确认；孤儿清理单独确认。
- **peer 声明**：仅 `@deepseek-ai/cordis` `^4.0.1`。`@deepseek-ai/dsh-session-persistence-jsonl` **不声明为 peer**——它只随 DSH 自带（profile 未直装，profile 是 `autoInstallPeers:false`），硬声明会引入 pnpm 解析摩擦，改用可选 `import()` + 内置路径编码 fallback。
- **发布事故教训（0.3.0 → 0.3.1）**：0.3.0 的 npm tarball **只有 4 个文件、没有 `lib/`**（仓库 `.gitignore` 的 `**/lib/` 规则把 fork 的源码目录整个忽略了，`git add -A` 静默跳过 → CI checkout 里就没有源码 → 打包自然没有），安装后插件加载失败会拖垮 DSH。修复：`.gitignore` 加例外（`!dsh-archived-sessions/lib/` + `!dsh-archived-sessions/lib/**`，两行缺一不可——git 无法重新包含仍被忽略的目录下的文件）。**发布前必须验证 tarball 内容**（`npm pack` 后 `tar -tzf` 核对文件清单）。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本 | ✅ DSH 不崩；`sessionPersistence`/`workspaceRegistry` 若变，需适配路径解析/归档集合 |
| `sessionPersistence` 版本漂移 | ✅ 列表/删除优雅降级（无路径则只清归档标记），不会误删 |
| 服务缺失 | ✅ 设置页不显示/操作降级，不崩溃 |

---

## 汇总对比【gitbash 已归档】

| 插件 | 版本 | 第三方依赖 | DSH 硬依赖 | 抗崩溃设计 | 最大风险点 |
|---|---|---|---|---|---|
| dsh-gitbash-win（归档） | 0.1.6 | 无（动态加载 5 个 @deepseek-ai/*） | `tools`/`subprocess`/`systemPrompt`/`shellEnv` | 顶层零依赖 + 动态加载 + 失败隔离 | `dsh-sandbox`（Windows ACL 上游 bug） |
| dsh-connector | 0.3.2 | `yaml`（+ peer `schemastery` 仅过滤用） | `webServer`（`settings`/`tools.guard`/`systemPrompt` 可选） | 纯静态 + try/catch + 可选服务失败隔离 | `ctx.webServer` API 变化 |
| dsh-vision-bridge | 0.1.10 | 无 | `tools`/`attachments`/`llm`/`credentials` | 纯静态 + 零 @deepseek-ai + 防御性编码 | `ctx.llm` API 变化 / composer 输入层变化 |
| dsh-key-fallback | 3.1.6 | 无（reference 半边 dsh-credentials） | `credentials`/`llm`/`settings`（`webServer`/`slots` 可选） | ESM import + `agent/*` 事件 + `process.env + credentials.set` 双写 + 防御性编码 | `agent/request-error` 载荷 / `webServer` API 变化 |
| dsh-archived-sessions | 0.3.1 | 无（jsonl 后端可选 import + 内置编码 fallback） | `webServer`（`sessionPersistence`/`workspaceRegistry`/`sessionQuery`/`fs`/`shell` 可选） | 路径自解析 + 删除目录名校验 + try/catch + 可选服务失败隔离 | `sessionPersistence` 路径布局 / `workspaceRegistry` 字段变化 |

## 总体结论

1. **活跃插件都不会导致 DSH 崩溃**——这是共同的硬保证（架构设计使然）。
2. **最坏情况**：DSH 大版本更新后，某个插件功能不可用/降级，需适配更新插件版本（不是 DSH 的问题）。
3. **相互隔离**：任一插件失效，不影响其他插件和 DSH 本体。
4. **建议**：DSH 大版本升级后，逐个验证活跃插件（connector API、vision-bridge 识图、key-fallback），
   有问题就更新对应插件版本。
