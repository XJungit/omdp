# OMDP 插件兼容性评估

> ⚠️ **本文档为历史记录**：`@omdp/dsh-gitbash-win` 与 `@omdp/dsh-resume-stream`
> 已于 2026-08-25 归档（源码移至 `archive/`，不再维护或发布）。下方对 gitbash
> 的评估保留作为历史架构参考；当前活跃插件为 `@omdp/dsh-connector`、
> `@omdp/dsh-vision-bridge`、`@omdp/dsh-key-fallback`。
>
> 评估内容：各插件对 DSH（DeepSeek Harness）更新的抗崩溃能力。
> 核心问题：DSH 更新后，插件会不会导致 DSH 崩溃？

**结论先行**：活跃插件都采用**抗崩溃架构**——DSH 更新时**不会因插件而崩溃**（硬保证），
最坏情况只是单个插件功能需要适配更新。插件之间互不影响。

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

## 2. @omdp/dsh-connector（v0.2.5）【活跃插件】

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

## 4. @omdp/dsh-key-fallback（v1.0.7）【活跃插件】

### 架构

- **ESM bundle**：`lib/index.js` 为 `type: module`，静态 import `@deepseek-ai/dsh-settings` + `@deepseek-ai/schemastery`（与 `dsh-market`/`dsh-vision-bridge` 同构；DSH 只经 ESM import 图解析 DSH 内部包，CommonJS `require()` 无法到达它们——根因见下）
- **Host**: `inject: ['llm','settings','webServer','credentials']`（`credentials.set` 供 `llm-pi-ai` 的 `apiKeyEnv` 路径使用）
- **Client**: `dsh.client` 声明 + lazy-CJS `__ModuleLoader__` bundle；`key-fallback` 命名空间走 `installSettingsSection`，UI 通过 `settings.section`（`API Key 回退`，永远可见）与 `settings.plugin.item`（插件配置标签下）双路渲染
- **能力**：`keyFallback.providers.*` 池按 `turn:step` 有界重试（≤ `keys.length`）+ 30s 递增冷却（`cooldownUntil = now + cooldown*min(failCount,5)`）

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.settings`（通过 `installSettingsSection` 注册命名空间 `key-fallback`） | 让 `settings.plugin.item` 的 served 集合包含本插件（`schemastery` schema 的 `settingsNamespace` + `installSettingsSection`） | 中 |
| `ctx.credentials`（`credentials.set(pool.env, key)`） | `llm-pi-ai` 的 `apiKeyEnv` 经过 credentials 域（`@deepseek-ai/dsh-settings`）而非环境变量，`process.env` 单独写对 `ninerouter` 无效 | 中 |
| `ctx.llm`（`llm/stream` 侧的 `agent/request` + `agent/request-error` 换 key 链） | 在同一步内返回 `kind:'retry'` 后由框架重入下一次 `agent/request`，`pickKey` 选下一把；client 通过 `settings.plugin.item` 的 occupant 分发的 `key` 进入渲染 | 低 |
| `ctx.webServer`（`GET /dsh-key-fallback/pools` 的 `register`） | 仅用于 `settings.section` 卡片的可见时轮询，健康/冷却状态由 host 端 `pools` 计算 | 中 |

### 风险点

- **`require` 隔离**：早期 host 为 `type: commonjs`，`require('@deepseek-ai/dsh-settings')` 在 DSH 的 bundle 图中解析为 `false`（诊断见 `apply CALLED. dshSettings=false zs=false`），`settings.register` 从未执行 → 卡片占位已注册（`occupants: key-fallback, active`）但 `served` 无它，永远不显示。ESM 静态 import 方可。
- **`process.env` vs `credentials`**：`ninerouter` 经 `llm-pi-ai` 凭据走 `ctx.credentials.resolve(apiKeyEnv)` 优先于环境变量，只写 `process.env[NINEROUTER_API_KEY]` 无效；401 仍报 `API key is invalid / AUTH` → `agent/request-error` 的 `RATE_LIMIT/AUTH/4xx + auth/key` 正则无法切下一把。
- **监听链上**：`keyFallback` 读 `settings.yaml` 的 `keyFallback.providers`（文件轮询与 `agent/request` 重建池），与 `installSettingsSection` 的命名空间 base `{}` 是两条道（为 served 写的拉链，非落盘），与 `dsh-market` 同姿势。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH 大版本 | ✅ DSH 不崩；`dsh-settings` 的 `installSettingsSection` 签名若变，需适配 |
| API 缺失 | ✅ 优雅降级（`process.env` 回退） |

---

## 汇总对比【gitbash 已归档】

| 插件 | 版本 | 第三方依赖 | DSH 硬依赖 | 抗崩溃设计 | 最大风险点 |
|---|---|---|---|---|---|
| dsh-gitbash-win（归档） | 0.1.6 | 无（动态加载 5 个 @deepseek-ai/*） | `tools`/`subprocess`/`systemPrompt`/`shellEnv` | 顶层零依赖 + 动态加载 + 失败隔离 | `dsh-sandbox`（Windows ACL 上游 bug） |
| dsh-connector | 0.2.5 | `yaml` | `webServer` | 纯静态 + 零 @deepseek-ai + try/catch | `ctx.webServer` API 变化 |
| dsh-vision-bridge | 0.1.6 | 无 | `tools`/`attachments`/`llm`/`credentials` | 纯静态 + 零 @deepseek-ai + 防御性编码 | `ctx.llm` API 变化 |
| dsh-key-fallback | 1.0.7 | 无（静态 ESM import，同 dsh-market） | `settings`/`credentials`/`webServer` | ESM import + `installSettingsSection` + `process.env + credentials.set` 双写 | `dsh-settings` 的 `installSettingsSection` / `credentials.set` |

## 总体结论

1. **活跃插件都不会导致 DSH 崩溃**——这是共同的硬保证（架构设计使然）。
2. **最坏情况**：DSH 大版本更新后，某个插件功能不可用/降级，需适配更新插件版本（不是 DSH 的问题）。
3. **相互隔离**：任一插件失效，不影响其他插件和 DSH 本体。
4. **建议**：DSH 大版本升级后，逐个验证活跃插件（connector API、vision-bridge 识图、key-fallback），
   有问题就更新对应插件版本。
