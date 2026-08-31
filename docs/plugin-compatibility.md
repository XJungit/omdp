# OMDP 插件兼容性评估

> ⚠️ **本文档为演进记录**：`@omdp/dsh-gitbash-win` 与 `@omdp/dsh-resume-stream`
> 已于 2026-08-25 归档（源码移至 `archive/`，不再维护或发布）。下方对 gitbash
> 的评估保留作为历史架构参考；当前活跃插件为 `@omdp/dsh-connector`（`0.2.6`）、
> `@omdp/dsh-vision-bridge`（`0.1.8`）、`@omdp/dsh-key-fallback`（`3.1.3`）。
>
> 评估内容：各插件对 DSH（DeepSeek Harness）更新的抗崩溃能力。
> 核心问题：DSH 更新后，插件会不会导致 DSH 崩溃？

**结论先行**：活跃插件都采用**抗崩溃架构**——DSH 更新时**不会因插件而崩溃**（硬保证），
最坏情况只是单个插件功能需要适配更新。插件之间互不影响。

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

## 2. @omdp/dsh-connector（v0.2.6）【活跃插件】

### 架构

- **纯静态 import**：`node:*` + `yaml`（唯一第三方依赖，版本 `^2.9.0`）
- **零 `@deepseek-ai/*` 依赖**（最稳）
- **Client→Host 走 HTTP API**（`/connector/api/*`），不依赖动态 `host.call`

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.webServer`（硬依赖 `inject: ['webServer']`） | 注册 `/connector` 前缀 HTTP 路由 | 中 |
| `ctx.get('logger')` | 日志 | 低 |
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

## 3. @omdp/dsh-vision-bridge（v0.1.6）【活跃插件】

### 架构

- **ESM bundle**：`index.js` 在 `apply()` 内用动态 `import()` 解析 `@deepseek-ai/*` 工具与接口（同 dsh-key-fallback）
- **多模态包装 + 工具注册**：`ctx.llm.registerAdapter` / `ctx.tools.register` / `ctx.attachments`
- **Client 半支持粘贴/拖拽走 bridge（`vision_bridge_read_image`）或原生路径**

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

## 4. @omdp/dsh-key-fallback（v3.1.3）【活跃插件】

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

- **peer 声明严格枚举实测版本**（2026-08-31 起）：credentials `0.1.0-rc.6 || 0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2`、llm/settings `0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2`、cordis `4.0.1 || 4.0.2`、schemastery `3.18.1 || 3.18.2`——只声明已实际兼容测试过的版本，不用开放范围；profile 实际锁 `0.1.0-rc.6`（credentials）在枚举内，无 unmet-peer 警告。
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

## 汇总对比【gitbash 已归档】

| 插件 | 版本 | 第三方依赖 | DSH 硬依赖 | 抗崩溃设计 | 最大风险点 |
|---|---|---|---|---|---|
| dsh-gitbash-win（归档） | 0.1.6 | 无（动态加载 5 个 @deepseek-ai/*） | `tools`/`subprocess`/`systemPrompt`/`shellEnv` | 顶层零依赖 + 动态加载 + 失败隔离 | `dsh-sandbox`（Windows ACL 上游 bug） |
| dsh-connector | 0.2.6 | `yaml` | `webServer` | 纯静态 + 零 @deepseek-ai + try/catch | `ctx.webServer` API 变化 |
| dsh-vision-bridge | 0.1.8 | 无 | `tools`/`attachments`/`llm`/`credentials` | 纯静态 + 零 @deepseek-ai + 防御性编码 | `ctx.llm` API 变化 |
| dsh-key-fallback | 3.1.3 | 无（reference 半边 dsh-credentials） | `credentials`/`llm`/`settings`（`webServer`/`slots` 可选） | ESM import + `agent/*` 事件 + `process.env + credentials.set` 双写 + 防御性编码 | `agent/request-error` 载荷 / `webServer` API 变化 |

## 总体结论

1. **活跃插件都不会导致 DSH 崩溃**——这是共同的硬保证（架构设计使然）。
2. **最坏情况**：DSH 大版本更新后，某个插件功能不可用/降级，需适配更新插件版本（不是 DSH 的问题）。
3. **相互隔离**：任一插件失效，不影响其他插件和 DSH 本体。
4. **建议**：DSH 大版本升级后，逐个验证活跃插件（connector API、vision-bridge 识图、key-fallback），
   有问题就更新对应插件版本。
