# OMDP 插件兼容性评估

> ⚠️ **本文档为演进记录**：`@omdp/dsh-gitbash-win` 与 `@omdp/dsh-resume-stream`
> 已于 2026-08-25 归档（源码移至 `archive/`，不再维护或发布）。下方对 gitbash
> 的评估保留作为历史架构参考；当前活跃插件版本见各节标题（connector `0.3.8` /
> vision-bridge `0.1.12` / key-fallback `3.3.2` / archived-sessions `0.3.9`）。
>
> 评估内容：各插件对 DSH（DeepSeek Harness）更新的抗崩溃能力。
> 核心问题：DSH 更新后，插件会不会导致 DSH 崩溃？

**结论先行**：活跃插件都采用**抗崩溃架构**——DSH 更新时**不会因插件而崩溃**（硬保证），
最坏情况只是单个插件功能需要适配更新。插件之间互不影响。

**DSH `v0.2.0-rc.2`（桌面端，2026-09-30）适配结论（当前 `latest`/`next`）**：**API 面仍零变化**，
依然是「被门禁跳过」而非崩溃。相比上轮多一个新变量：**上轮给第三方插件打的 pnpm patch
本轮失效**——补丁内容写的是精确版本 `0.2.0-rc.1`，只能扛住那一版。
本机 desktop profile 实测**被拒活 6 个 / 幸存 4 个**（详见下方「DSH 0.2.0-rc.2 兼容性专项」）：

- **rc.1 ↔ rc.2 全量 diff（20 个包逐文件 SHA256）**：`dsh-credentials`/`dsh-settings`/
  `dsh-shell`/`dsh-session`/`dsh-host-webserver`/`dsh-web-app`/`dsh-attachment`/
  `dsh-tools`/`dsh-mcp-client`/`dsh-agent`/`dsh-session-persistence-jsonl`/`dsh-workspace`/
  `dsh-session-query`/`dsh-client-ui-settings`/`dsh-client-ui-slots`/`dsh-app-boot`/`dsh-base`
  **只有 `package.json` 版本号变化**；`dsh-llm` 唯一代码变化是 `typert.host.js` 内嵌
  `MessageSourceMap` **新增** `'user-question-reply'` 字段（附加式，插件不用）；
- **`dsh` 主包的全部变化是 `desktop` profile 支持**：新增 `requireDesktopProfile()` /
  `manageDesktopProfile` / `runProfilePnpm`。README 措辞由 rc.1 的「CLI rejects boot,
  config-dump, and plugin-management」改为 rc.2 的「CLI rejects boot and config-dump；
  plugin-management 也要走桌面应用内置命令」→ ⚠️ **插件安装入口变了**；
- **同三元组预发布的关键差异**：`0.2.0-rc.1` 与 `rc.2` 同 `[major,minor,patch]`，故
  `^0.2.0-rc.1` / `>=0.2.0-rc.1 <0.2.1-0` 这类**范围**在 rc.2 下**天然成立**（实测 true）；
  只有**逐版本精确枚举**的声明需再追加一项。这是本轮「谁炸谁幸存」的唯一分界线；
  ⚠️ 上界必须写 `<0.2.1-0`（写 `<0.2.1` 会漏放行 `0.2.1-rc.1`——实测
  `satisfies("0.2.1-rc.1", ">=0.2.0-rc.1 <0.2.1")` 为 **true**）——本仓库据此把三个插件
  统一改为三元组区间并发布 `0.3.8` / `3.3.2` / `0.3.9`（见「处理结果」）；
- **被拒活 6 个**（`--dump-config` stderr 实测）：`@omdp/dsh-connector@0.3.7`、
  `@omdp/dsh-key-fallback@3.3.1`（dsh/credentials/llm/settings 四条）、
  `@omdp/dsh-archived-sessions@0.3.8`、`dsh-client-auto-continue`、`dsh-watcher`、
  `@wxg-prc-cpg/browser-skill-dsh-plugin`；
- **幸存 4 个**：`@omdp/dsh-vision-bridge`（零 peer，门禁根本不看）、
  `dsh-preset-craft-bot`（零 peer）、`dsh-cost-meter`（`>=0.2.0-rc.1 <0.3.0-0` 范围）、
  `dshmarket`（`^0.2.0-rc.1` 范围）；
- ⚠️ **pnpm patch 不会自动跟进版本**：上轮给 `dsh-client-auto-continue` 与
  `browser-skill-dsh-plugin` 打的补丁把 peer 改成 `... || 0.2.0-rc.1`，
  补丁**仍然成功应用**（install 无错）却已无意义。**补丁生效 ≠ 补丁有效**——
  每次 DSH 升版必须复查补丁内容，而非只复查补丁是否还在。

**DSH `v0.2.0-rc.1`（桌面端，2026-09-28）适配结论**：connector / key-fallback /
archived-sessions 三个插件**源码零改动兼容**，唯一动作是把 `0.2.0-rc.1` 追加进
peer 枚举（分别升 `0.3.7` / `3.2.4` / `0.3.8`；vision-bridge 无 dsh peer，不动作）。
> ⚠️ **本节为历史记录**：这三个版本随后被 2026-09-30 的 rc.2 专项取代——
> connector `0.3.8` / key-fallback `3.3.2` / archived-sessions `0.3.9` 改用三元组区间，
> **rc.1 的枚举写法已不再使用**。
（`key-fallback` 于 2026-09-29 升 `3.3.0`——去掉冗余的 `process.env` 写入、修 `/pools` 的 `activeRef` 误报、
加卸载还原；随后 `3.3.1` 为**文档更正**：v3.3.0 曾误称「换 key 从未生效」，实为包装自 v3.0.0 起一直有效。
见第 4 节。）
⚠️ **本轮现象是「被门禁跳过」而非崩溃**——升级到 0.2.0 后设置页里三个插件整项消失、
路由 404/405，根因是 `0.1.7-rc.2 → 0.2.0-rc.1` 的**门禁第二次生效**（声明里不含新运行时版本）。
逐项核查（详见下方「DSH 0.2.0 兼容性专项」）：

- **API 面逐字节一致**：`dsh-credentials` / `dsh-llm` / `dsh-settings` / `dsh-shell` /
  `dsh-tools` / `dsh-mcp-client` / `dsh-web` / `dsh-agent` / `dsh-agent-preset` 的 `lib/`
  全部文件 SHA1 **零变化**（npm tarball 解包对比，两版均为 `0.2.0-rc.1` 官方发布件）；
- **仅两处附加式变化**：`dsh-session` `lib/` 5 个文件变化（**新增导出** `ToolCallRecovery` /
  `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN`，`SessionStore` 等既有导出全保留）、
  `dsh-tool-cordis` 的 `types/api-catalog.js`（目录数据，与插件无关）；
- **门禁放行实测**：用 0.2.0-rc.1 自带的 `evaluatePluginCompatibility()` 判定新声明 →
  `✅ 放行`（旧声明 → `❌ 拦截`，不满足项即 `@deepseek-ai/dsh`）；
- **真机装配实测**：沙箱安装官方 `@deepseek-ai/dsh@0.2.0-rc.1`（542 包）、
  独立 `DSH_HOME` + 改过声明的插件 profile，跑 `dsh --profile smoke --dump-config`
  → 四个插件全部入树、**零门禁拦截、零错误**；
- **发布件校验**：`npm pack` 实际 tarball 内 `package.json` 已含 `0.2.0-rc.1`，
  且同一门禁函数对 tarball 清单判定放行。

**DSH `v0.1.6-alpha.1`（`alpha` dist-tag）适配结论（2026-09-15）**：connector / vision-bridge / key-fallback **源码零改动兼容**（key-fallback 追加 peer 枚举升 `3.1.7`）；**archived-sessions `0.3.3` 与新版冲突**（slot id 撞名导致整页 Web UI 启动失败），已修复升 `0.3.4`。本轮除源码级核查（逐包逐文件 SHA256 + `.d.ts` 删除行比对，基线 = 本机在跑的 `0.1.5-rc.2`）外，**首次补做真实运行时冒烟**：在临时目录安装 `0.1.6-alpha.1`、以 `DSH_HOME` + 手工 profile（`dsh-base` + `dsh-web-app` + 发布版插件）启动 web，浏览器实测路由与设置页（releases + npm 双查：GitHub `dsh-v0.1.6-alpha.1` Pre-release 2026-09-15；npm `dist-tags`：`latest=0.1.5-rc.1`、`next=0.1.5-rc.2`、`alpha=0.1.6-alpha.1`）：
- **逐字节一致（服务面零变化）**：`dsh-host-webserver`（`webServer.register` 提供方，四插件共同硬依赖）、`dsh-credentials`、`dsh-settings`、`dsh-fs`——lib 全部文件哈希一致，仅版本号/README 变化；
- **附加式变化**：`dsh-tools`（guard 决策新增 `ask` 形态；`register`/`guard` 保留）、`dsh-attachment`（删 `readImageRequest`/`ImageRequestPolicy`，插件用的 `readImage`/`saveImage`/`saveImages`/`fileHostPath` 全保留）、`dsh-llm`（删 `priceImages` 与 `projectImagesForTextModel`/offload 系列——均不在插件调用面）、`dsh-mcp-client`（SDK v2 升级 + 新增 `server-context.d.ts`；connector 生成的配置键 `transport/serverName/command/args/env/url/headers/toolCallTimeoutMs` 全部保留，`.d.ts` 零删除行）、`dsh-workspace`/`dsh-storage-domain`/`dsh-session-query`/`dsh-session-persistence`（`.d.ts` 零删除行，`archivedSessionIds`/`setState`/`readTitleSnapshots`/`readSession`/`list()` 保留）；
- **`dsh-session`**：`request-header.d.ts`/`.js`（vision-bridge 的 `requestHeader().config` 路由判定）**逐字节一致**；删除项（`deriveEventMessage`/`foldSurface`/`Session.create`/`fromRestore`）不在插件调用面；`dsh-session-persistence-jsonl` 的路径相关字符串字面量集**零增删**（`encodeSegment`、`session-` 前缀布局不变，archived-sessions 自解析路径继续有效）；
- **`dsh-shell`**：破坏点在 `start()` 改可取消异步；archived-sessions 用的 `resolve`/`run` 抽象签名**一字未变**；`sandboxPolicy.resolve` 保留；
- **client 面**：`settings.section` slot 保留；`__ModuleLoader__`/`dsh.client` manifest（`platform`/`inject`/`immediately`）/`dsh.bundle.patch` 机制保留（`--dump-config` 实测四插件激活行入树）；`/plugins/??…&rev=` combo 协议与新代码逐字一致；composer 仍是 Lexical（`data-composer-input`/`__lexicalEditor`/`contenteditable` 俱在）；
- 🔴 **本轮唯一实际不兼容——archived-sessions slot id 撞名**：DSH 0.1.6 在 web-app 内置原生「已归档会话」设置页 `@deepseek-ai/dsh-client-ui-settings-unarchive-sessions`，注册 `settings.section` 的 id 恰为 `archived-sessions`（order 25），与插件 0.3.3 的 slot id **完全相同** → slot 冲突，**整个 Web UI 显示「Failed to load plugins」拦截页**。运行时二分定位（裸 profile 零错误 → 三插件零错误 → 单加 archived-sessions 复现）。修复：插件 slot id 改唯一 `omdp-archived-sessions` + 标签「归档会话管理」→ **0.3.4 修复实测**：四插件 + 原生项共存，浏览器控制台零错误、原生「已归档会话」与「归档会话管理」并列渲染、插件页数据加载正常（`/dsh-archived/*` 端到端）；
- **release notes「其他变更」逐条排除**：`agent/session-start`→`agent/created`（插件未用）、Session 同步历史读取 `snapshotEvents`/`eventAt`/`ownEvents` 弃用（未用）、PTC/workflow 包服务改名 `ptc-runtime`/`workflow-ptc`（未用）、E2B 后端移除（未用）、`ShellExecutor.start` 异步化（插件用 `run`）、request 图片缓存迁移（服务内部）、DeepSeek 默认切 Messages 协议（配置层提醒：曾手动配置旧官方根地址的用户需改 `https://api.deepseek.com/anthropic` 或删除——vision-bridge 走 Agnes 中转 baseUrl 不受影响）；
- ⚠️ **仍留的活体缺口**：vision-bridge client 的**粘贴/拖拽浏览器行为**未做人工实测（composer 加号菜单/附件按钮布局在 0.1.6 重排，但插入依赖的 Lexical 宿主标记俱在、源码级判定低风险）；key-fallback 的 `agent/request-error` **真实错误轮换**未注入坏 key 实测（事件与载荷源码级一致）。首次冒烟用的 tarball 是本地修复版（archived 0.3.4）与 npm 发布版 3.1.6→3.1.7（仅 peer 变化，无代码差异）。
- 动作：`@omdp/dsh-key-fallback` `3.1.6` → **`3.1.7`**（credentials/llm/settings peer 枚举**追加** `0.1.5-rc.2` 与 `0.1.6-alpha.1`，旧枚举全保留）；`@omdp/dsh-archived-sessions` `0.3.3` → **`0.3.4`**（slot id 重命名，唯一代码改动）；connector / vision-bridge 无 DSH 包 peer 枚举动作，兼容结论记录于此。发布（npm tag）另按 `docs/npm-publish.md` 流程执行。

**DSH `v0.1.5-rc.2`（本机在跑版本，npm `next` dist-tag）适配结论（2026-09-15 补声明）**：四插件（含修复版 archived-sessions `0.3.4`、key-fallback `3.1.7`）**全部实测兼容**。源码核查：`@deepseek-ai/dsh-credentials`/`dsh-llm`/`dsh-settings` 从 `0.1.5-rc.1`→`rc.2` **只有 `package.json` 变化**（lib/文档逐文件 SHA256 一致）→ key-fallback 调用面零变化，`0.1.5-rc.2` 追加进 `3.1.7` 枚举；且 rc.2 恰是 alpha.1 核查的基线（上文所有 rc.2↔alpha.1 结论天然覆盖"rc.2 相对已声明 rc.1 的差异"）。运行时核查（真实 `dsh@0.1.5-rc.2` + 手工 web profile）：**严格模式** `npm install`（不加 `--legacy-peer-deps`）peer 直接解析到主机自带 rc.2 包、零告警；启动零浏览器控制台错误；设置页渲染「归档会话管理 / Connector 连接器 / API Key 回退」三项（0.1.5 无原生归档页、亦无撞名）；路由实测 `/vision-bridge/capabilities` 200、`/connector/api/mcp` 200、`/dsh-key-fallback/providers` 200、`/dsh-archived/list` 200（端到端取数）。connector `0.3.2` / vision-bridge `0.1.12` / key-fallback `3.1.7` / archived-sessions `0.3.4` 在 rc.2 上均无需任何改动。

**DSH `v0.1.5-rc.1`（`next` dist-tag）适配结论（2026-09-10）**：三个插件**源码零改动即兼容**，唯一动作是给 `@omdp/dsh-key-fallback` 的 peer 枚举**追加** `0.1.5-rc.1`（升 `3.1.6`）。逐项核查（releases + npm 双查：GitHub `dsh-v0.1.5-rc.1` Pre-release 2026-09-10、npm `dist-tags`：`latest=0.1.2-rc.1`、`next=0.1.5-rc.1`、`alpha=0.1.5-alpha.2`）：
- `@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-base` 相对 `0.1.2-rc.1` **只有 `package.json` 版本号变化**（`lib` 逐文件 SHA256 一致）→ 服务面零变化；
- `@deepseek-ai/dsh-llm` 变化**全为附加式**（新增 `lib/types/assistant-stream.js`、`FileBlock`/`fileHandleText`/`projectFilesToText`、可选 `systemPromptUpdate`），本生态调用的 `registerAdapter`/`stream`/`listProviders`/`listConfigurableProviders`/`listModels`/`resolveModelInfo`/`inputModalities` 全部保留（`types.d.ts` diff 无删除项）；
- `@deepseek-ai/dsh-tools`（`register`/`guard` 保留）、`@deepseek-ai/dsh-attachment`（`readImage`/`fileHostPath` 保留，新增文件存储半边）、`@deepseek-ai/dsh-system-prompt`（`system-prompt/assemble` 事件保留）、`@deepseek-ai/dsh-agent-loop`（`agent/pre-step`/`agent/request`/`agent/request-error` 保留，`preStep` 的 dispatch 语句**逐字相同**）、`@deepseek-ai/dsh-web-app`（`webServer.register` 未变；仅 `launchedThroughSsh` 改从 `dsh-launch-environment` 导入）、`@deepseek-ai/dsh-mcp-client`（仅新增重复 cursor 防护）；
- client 侧：`settings.section` slot 保留（`dsh-client-ui-settings-general`/`-plugins` 仍声明）、composer 仍是 Lexical contenteditable（`data-composer-input` + `__lexicalEditor` 标记俱在）→ §3 的 0.1.10 修复继续有效。
- ⚠️ **本版破坏性变更均不在本插件使用面内**：移除 `ctx.agent`、Inbox API 调整、Session 格式升级 V3 / `SessionHandle` 生命周期、`conversation` slot 迁移为 `main` 的 key、`tool/code-dispatch` 改名 `tool/ptc-dispatch`、persona 前缀/后缀拆分——三插件均未触及。
- ⚠️ **但 0.1.5-rc.1 的 Session 契约变更破坏了第三方插件**：`sessionPersistence.list()` 由裸 `SessionHeader[]` 改为 `SessionPersistenceSnapshot[]`，且抽象服务移除 `locate(meta)`——`@muwinds/dsh-archived-sessions` 0.2.0 因此全部列表显示「文件缺失」、删除退化为释放。omdp 已 fork 修复为 §5 `@omdp/dsh-archived-sessions` 0.3.3。
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

## 2. @omdp/dsh-connector（v0.3.8）【活跃插件】

### 架构

- **顶层零第三方 import**：模块顶层只有 `node:*` + `yaml`（版本 `^2.9.0`）；`jsdom`（`^24.1.3`）**改为在 WAF 挑战求解处动态 `await import()`**（0.3.3 起，见下方 0.1.7 专项「变更 4」——顶层静态引入会在 0.1.7 上让整个插件 import 失败）
- **零 `@deepseek-ai/*` 硬依赖**（`@deepseek-ai/schemastery` 仅 peer 声明，供工具过滤的 `Config` 声明用；
  0.3.4 起另声明 `@deepseek-ai/dsh` peer；**0.3.8 起该 peer 为三元组区间 `>=0.2.0-rc.1 <0.2.1-0`**，
  此前为逐版本枚举——见 0.2.0-rc.2 专项与 `AGENTS.md` 规范 3）
- **profile 补丁路径取自 `ctx.get('profileContext').patchPath`**（0.3.6 起；0.1.7+ 由 dsh 启动器提供，见 0.1.7 专项「变更 6」），无该服务时回退历史硬编码路径
- **Client→Host 走 HTTP API**（`/connector/api/*`），不依赖动态 `host.call`

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.webServer`（硬依赖 `inject: ['webServer']`） | 注册 `/connector` 前缀 HTTP 路由 | 中 |
| `ctx.get('logger')` | 日志 | 低 |
| `ctx.get('settings')`（可选） | 工具过滤规则：**0.1.7+** 经 `settings.replace(entryId, …)` 写入本插件 profile 条目 `config.toolFilters`，读取用注入的活 volatile ref；**rc.x** 用 `register`/`get`/`update` 存 `settings.yaml` 的 `connector.toolFilters`（`typeof volatile === 'function'` 自动分流）；无 settings 则全放行 | 中 |
| `config.toolFilters`（`apply(ctx, config)` 第 2 参） | **0.1.7+**：volatile ref（`.get()` 热更新），`Config = z.object({ toolFilters: <dict>.volatile() })` | 中（新机制，0.3.3 已适配） |
| `ctx.get('tools')` 的 `guard`（可选） | 工具过滤执行期硬拦截，无则跳过 | 低 |
| `ctx.get('systemPrompt')` 的 `tools(provider)`（可选） | 工具过滤 prompt 层隐藏，无则跳过 | 低 |
| `yaml`（npm） | YAML 解析 | 低（独立 npm 包，版本锁定） |
| `jsdom`（npm，**动态**） | 仅魔搭市场 WAF 挑战求解时 `await import()` | 低（解耦 DSH 更新；但见 0.1.7 专项「变更 4」的残留风险） |

### 风险点

- **`ctx.webServer.register` 是唯一的 DSH 硬依赖**：`inject: ['webServer']` 是硬注入，
  若 DSH 大版本改名/改签名（如 `webServer` → `httpServer`），connector 会**加载失败**。
  但失败是**干净失败**（插件不加载），DSH 不崩。
- 🔴 **第三方依赖图的 import 期崩溃（0.3.3 修复）**：顶层静态 `import 'jsdom'` 会在插件 import
  期拉起 `jsdom → whatwg-url → tr46`，而 `tr46@5.1.1` 第 3 行是 `require("punycode/")`；
  DSH `0.1.7` 的解析路由对**带子路径的内置模块名**会切出裸名再用
  `createRequire(...).resolve.paths(name)` 求路径（内置模块返回 `null`），循环无兜底 → 抛
  `TypeError: createRequire.resolve.paths is not a function or its return value is not iterable`
  （`dsh-app-boot` `ResolutionRouter.routeScoped`）→ **整个插件 import 失败**，设置页永远停在
  「已安装，重启后生效」、`/connector/api/*` 全 404（重启无效，抛错确定）。修复：jsdom 改懒加载。
  ⚠️ **残留风险（诚实记录）**：DSH 的解析拦截（`PluginPackages`）在进程生命周期内常驻，
  懒加载只是把同一路径的崩溃**推迟到首次解 WAF 挑战时**，并非根治——只是把爆炸半径从
  「整个插件」收敛到「魔搭市场浏览」这一个功能（该分支失败会以 502 + 明确 message 返回，不挂起）。
  真正根治要上游在 `dsh-app-boot` 该循环补 `?? []`。
- **逻辑内有多个 try/catch**（yaml 解析、MCP 配置读写、WAF 求解），防御性处理。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH `0.1.7-rc.1` | ✅ 不崩：0.3.3 修掉 import 期崩溃（jsdom 懒加载）+ 工具过滤迁到 volatile `Config`/`settings.replace`，新旧两代后端自动分流；0.3.4 追加遗留 `toolFilters` 一次性救援（`.imported` 只读）并声明 `@deepseek-ai/dsh` peer `0.1.7-rc.1`（门禁实测通过） |
| DSH `0.1.7-rc.2` | ✅ 不崩：0.3.5 追加 peer 枚举 `0.1.7-rc.2`（代码零改动）。依据：rc.1→rc.2 tarball 逐文件 diff——`dsh-shell`/`dsh-settings`/`dsh-credentials` 的 `lib/` **逐字节零变化**、`dsh-llm` 仅新增内容类型/错误码、`dsh-app-boot` 变更与插件无关；rc.2 门禁执行新声明 → 放行；scratch profile（`dsh@0.1.7-rc.2` + 0.3.4 + 豁免）真机回归 `/connector/api/mcp/filters` → 200 |
| DSH 大版本 | ✅ DSH 不崩；若 `webServer` API 变化，connector 需适配 |
| DSH `0.2.0-rc.1` | ✅ 不崩：0.3.7 追加 peer 枚举 `0.2.0-rc.1`（代码零改动）。依据：本插件唯一的 DSH 硬依赖 `ctx.webServer.register` 提供方 `dsh-host-webserver`/`dsh-web-app` 在 `0.1.7-rc.2 → 0.2.0-rc.1` **`lib/` 逐字节零变化**；0.2.0-rc.1 门禁对旧声明判 **拦截**（`dsh@0.1.7-rc.1 \|\| 0.1.7-rc.2`）、对新声明判 **放行**；沙箱真机装配（官方 `dsh@0.2.0-rc.1` + 本插件 0.3.7）`--dump-config` 入树、零拦截；`npm pack` 产物校验含新枚举 |
| yaml 版本 | ✅ 独立 npm 包，不受 DSH 更新影响 |

**0.3.6 追加的两个真机 bug 修复**（均为插件自身 bug，与 DSH 版本无关）：

| # | 症状 | 根因 | 修复 |
|---|---|---|---|
| 1 | 设置页「工具过滤」区**整块消失**（`if (!props.serverName) return null`），transport 徽标一律显示 `stdio` | `cordis.patch.yml` 为 CRLF 时，`parseMcpServers()` 的 `^\s+(\w+):\s*(.*)$` 必然失配（JS 里 `.*` 不匹配 `\r`、`$` 不匹配 `\r` 之前），`transport`/`serverName`/`command`/`url` 全落进 `preserve`，接口回 `serverName:""` | 解析前 `toLf()` 归一化换行，写回统一 LF |
| 2 | 桌面端（`profiles/desktop`）在 MCP 面板里的编辑**改的是 `profiles/web` 的文件**，UI 提示也是 web 路径 | `patchPath()` 硬编码 `profiles/web/cordis.patch.yml`（历史遗留：桌面端早期确实跑 web profile） | 0.1.7+ 取 `ctx.get('profileContext').patchPath`；`GET /api/mcp` 回传真实路径供 UI 显示 |

---

## 3. @omdp/dsh-vision-bridge（v0.1.12）【活跃插件】

### 架构

- **ESM bundle**：`index.js` 在 `apply()` 内用动态 `import()` 解析 `@deepseek-ai/*` 工具与接口（同 dsh-key-fallback）
- **多模态包装 + 工具注册**：`ctx.llm.registerAdapter` / `ctx.tools.register` / `ctx.attachments`
- **Client 半支持粘贴/拖拽走 bridge（`vision_bridge_read_image`）或原生路径**
- **当前路由必须取 `session.requestHeader().config`（v0.1.11）**：`agent.options` 是 Agent
  构造时快照，会话中途切换模型不会更新（`dsh-agent-loop` 构造函数 `this.options = options`；
  实时路由由 `dsh-agent` 的 `installModelSelection` 经 `agent/request` 生效并持久化到会话头）。
  0.1.10 优先读 `agent.options` → 从多模态模型切到纯文本模型后仍判为"支持图片"，
  工具回"无需调用本桥"、`agent/pre-step` 跳过图片转写，纯文本模型两头读不到图。
  0.1.11 统一为 `requestHeader().config` → `requestContext()` → `agent.options`，
  并新增 `force=true` 逃生口（原生读图不可用时强制走多模态端点代读）。
- **多模态路由直接交付图片（v0.1.12）**：多模态模型调用本工具时不再回"无需调用本桥"
  （那会让这次调用白费、模型仍拿不到图），而是把本地图片提交成附件
  （`attachments.saveImages`，缺失时回退到 DSH 核心 `read_image` 用的 `saveImage`）→
  `ImageAttachmentRef`，并以 `[{type:'text'}, {type:'image', attachment}]` 随工具结果交回，
  与 DSH 原生 `read_image` 同契约。交付不了（URL / HEIC / 超配额 / 附件服务不可用）时
  自动落到代读端点并把原因写进结果，不再拒绝服务；`force=true` 仍可强制代读（只想拿文字时用）。
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

## 4. @omdp/dsh-key-fallback（v3.3.2）【活跃插件】

### 架构

- **ESM bundle**：`lib/index.js` 为 `type: module`（`main`/`exports` → `./lib/index.js`），静态 import `@deepseek-ai/dsh-credentials`（只用 reference 半边 `credentialRef`/`resolve`/`describe`/`set`/`unset`；`isCredentialRefName` 本地实现兜底）、`@deepseek-ai/schemastery`（仅用于 `Config`）与 `node:*` 内置。
- **Host**: `inject: ['llm','settings','webServer','credentials']`。**v3.0.0 起**：包装 `ctx.credentials.resolve` 作为 key 切换接缝（返回池的当前 key；`describe` 不动，仍报存储真值）；**v3.3.0 起**加 `ctx.effect` 卸载时按身份校验还原原始 `resolve`；`agent/request` 只预选（写内存池 `currentRef`）；`agent/request-error` 注册 `prepend: true` 先于 `dsh-llm-retry` 看到错误，按池 `rotateOn` 判定后只改 `currentRef` 并 `next()`，**重发交还 llm-retry**。`webServer` 用 `ctx.get('webServer')` 可选获取（不硬 inject 缺失不崩）。
- **client**: 独立设置页 `Settings → API Key 回退`，经 `slots.inject('settings.section')` + `slots.register` 注册（`id: 'key-fallback'`, `order: 62`），不再依赖 `installSettingsSection`/`settings.plugin.item` 双路渲染。
- **能力**：多 key 池按 `rotateOn`（失败码/状态/关键字）判定轮换；固定 `cooldownMs` 冷却；`useKeyRef` 锁定/`nextRef` 链；短 ref 自动命名 + 旧长 ref 一次性幂等迁移；`GET /keys/plain` 明文揭示（仅池内 key/env）；env key 可编辑（describe 只读拒绝）。
- **配置双后端（v3.2.0 新增，为兼容 DSH 0.1.7 而改造）**：启动时判别后端 ——
  - **rc.x（≤ `0.1.5-rc.3`）**：无 volatile schema 支持 ⇒ `Config` 导出为 `undefined`，插件直接读写 `<DSH_HOME>/settings.yaml` 的 `key-fallback:` 段（附时间戳备份），行为与 v3.1.x 逐字节一致。
  - **`0.1.7`+**：`.volatile()` 可用 ⇒ 导出 `Config = z.object({ providers: <dict>.volatile() })`；配置由 DSH 从 settings.yaml 迁移进 profile 补丁（`profiles/<p>/cordis.patch.yml`）中该条目的 `config`，插件经注入的 `config.providers`（活 volatile ref）读取、经 `ctx.settings.replace()` 写入。
  - 因 `config.providers` 被 DSH **深冻结**，`readSettings()` 返回可变深拷贝；写入先乐观更新内存副本再异步落盘（未决写入计数避免读到旧树）。
  - **关键前提**：不声明 volatile `Config` 会导致 `0.1.7` 的迁移调用 `settings.update()` 抛错、仅打印 `settings: section ... was not imported`，**配置静默丢失**（这正是 v3.1.7 在 `0.1.7` 上被 `dsh: skipping profile bundle` 跳过的原因之一）；而 `.volatile()` 在 schemastery `3.18.2`（rc.3）上不存在，故导出必须做 `typeof field.volatile === 'function'` 守卫。
- **key 切换接缝（v3.0.0 起生效；v3.3.0 去冗余；v3.3.1 更正叙述）**：真正供 key 的是包装
  `credentials.resolve`——**自 v3.0.0（`75ea76a`）就存在**，不是 v3.3.0 才加的。
  ⚠️ **更正**：本文档与 v3.3.0 发布说明曾断言「≤ v3.2.4 靠写 `process.env` 切换 key，因此换 key 从未生效」，
  **该断言错误**。从 registry 下载已发布 `3.2.4` tarball 核对：`lib/index.js:298` 即
  `credSvc.resolve = async (ref) => {…}`、`:305` 为其 `pool-hit` 诊断——包装与 `process.env` 写入
  **同时存在**，真正交付 key 的一直是包装。**轮换在 3.2.4 就已生效。**
  那几处 `process.env` 写入（3.2.4 的 `:489/:532/:561/:711/:808`）确为死代码，理由是：DSH 启动时把
  `{...process.env}` 冻结成「启动环境快照」
  （`dsh-app-boot` 的 `loadLayeredEnv()` → `dsh-launch-environment.createLaunchEnvironmentSnapshot()`
  拷进 `Map` → `profile-boot` `hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, …)`），而
  `dsh-credentials-local.inherited()` 只读这个快照——启动后写 `process.env` 对它**不可见**。
  实机旁证（0.2.0-rc.1）：同一 `/pools` 响应里 `envSource=file`（`inherited()` 走了文件分支）
  而 `activeRef=SENSENOVA_API_KEY`（写确实落在真实 `process.env` 上），两者并存即证明写不生效。
  ⇒ 结论：写入是**冗余**（删之有理，但不影响鉴权），而非「轮换的机制失效」。
  `credentials.resolve` 之所以够用：`dsh-llm-pi-ai:2563`、`dsh-llm-deepseek-api-key:44`、
  `dsh-web-search-deepseek:313`、`dsh-webhook-github:121` 以及 vision-bridge / cost-meter 的兜底路径
  **全部**经它取 key，且**每次请求调用一次**，故包一处覆盖全部 provider；`dsh-credentials-local`
  README 亦明示 `resolve`/`describe` 按调用实时读快照，无需重启。
  **实机轮换证据**（v3.3.0 在 0.2.0-rc.1 上，`/diag` 200 条）：池中两把 key 分别被用 26 次 / 25 次并逐次交替——
  `PICK key_fallback_sensenova_key1` → `RATE_LIMIT` → `marked key_fallback_sensenova_key1` →
  `PICK SENSENOVA_API_KEY` → `pool-hit SENSENOVA_API_KEY -> key_fallback_sensenova_key1`（57 条 `pool-hit`
  各自写明当时生效的那把）。
- **`currentRef` 是唯一权威（v3.3.0 真修的项）**：删除了 2 处「用 `process.env` 值反查 key」的逻辑
  （`agent/request-error` 与 `GET /pools` 的 `activeRef`）。**这是 v3.3.0 里唯一影响可见行为的修复**——
  `GET /pools` 原先先拿 `process.env[pool.cfg.env]` 的值去池里反查成员、只在没匹配到时才回退 `currentRef`，
  所以**可能高亮错误的那把**（实机测得 `activeRef=SENSENOVA_API_KEY` 而 `currentRef=key_fallback_sensenova_key1`）。
  `currentRef` 能跨 `readPools()`/`resolvePoolKeys()` 重建保留（`readPools` 只对新建
  provider 置空、`resolvePoolKeys` 全程不碰它）。可见变化：`/pools` 现在 `activeRef === currentRef`。
- **遗留池救援（v3.2.1 新增）**：0.1.7 的迁移是「改名 `settings.yaml` → 逐段导入」的**全有或全无**动作——
  v3.2.0 之前（或 `Config` 声明缺失时）导入失败只留日志，配置整体残留在 `<DSH_HOME>/settings.yaml.imported`，
  而插件的读路径只认 `settings.yaml` ⇒ 设置页显示「尚未启用」、池列表为空（**重启也不会恢复**）。
  v3.2.1 增加一次性救援：路由处理前调 `ensureLegacyMigration()`，仅当「volatile ref 可用 + 一次性标记
  `<DSH_HOME>/.key-fallback-migrated` 不存在 + 内存池为空」时，读 `.imported` 的 `key-fallback.providers`
  段并经 `settings.replace(entryId, …)` 写回 profile 条目，**成功后才写标记**（失败下次请求可重试）。
  ⚠️ `settings.replace()` 只能在 fiber **ACTIVE 之后**调用（`describe()` 会跳过非 ACTIVE 条目，
  apply 期内调用抛 `No configurable plugin entry`），故救援挂在路由 handler 里而非 `apply()`。

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.credentials`（`inject` 硬依赖） | **v3.0.0 起包装 `resolve`**（每次请求的 key 接缝；v3.3.0 加卸载还原）+ `set`/`unset`/`describe`/`credentialRef`（reference 半边，rc.6 起稳定） | 低–中（record 半边 rc.8 新增，插件未用；`resolve` 签名跨枚举版本未变） |
| DSH 启动环境快照（`launchEnvironment`，**不再依赖**） | 曾误以为写 `process.env` 即可切换 key；实测无效（快照启动时冻结）。注意：这只说明该**写入冗余**，不代表轮换失效——轮换一直由 `credentials.resolve` 包装承担 | —（已移除该冗余依赖） |
| `ctx.llm`（`inject` 硬依赖） | `agent/request` + `agent/request-error` waterfall 换 key 链 | 中（事件名/载荷若变需适配） |
| `ctx.settings`（`inject` 硬依赖） | **`0.1.7`+**：`describe`/`replace`（读写 profile entry config）。⚠️ rc.x 的 `get`/`register`/`installSection` 在 `0.1.7` 上**已移除**（实测 `get=undefined installSection=undefined`） | **高**（0.1.7 破坏性变更，v3.2.0 已适配） |
| `config.providers`（`apply(ctx, config)` 第 2 参） | **`0.1.7`+**：volatile ref（`.get()` 热更新）；首次 apply 时为 `{}`（迁移在 `loader.await()` 之后） | **高**（新机制，v3.2.0 已适配） |
| `ctx.webServer`（`ctx.get` 可选） | `GET/POST /dsh-key-fallback/*` HTTP API（客户端设置页 fetch 用） | 中（缺失时设置页不可用，插件本体仍工作） |
| client `slots`（`ctx.get` 可选） | `settings.section` 槽位注册设置页 | 低（缺失则 UI 不显示，聊天轮换不受影响） |

### 风险点

- **peer 声明用三元组区间**（**v3.3.2 起**；此前 2026-08-31 起为逐版本枚举、2026-09-24/25 两次扩充）：四条 dsh peer（`@deepseek-ai/dsh` / `dsh-credentials` / `dsh-llm` / `dsh-settings`）统一为 `>=0.2.0-rc.1 <0.2.1-0`；`cordis` `4.0.1 || 4.0.2 || 4.0.4`、schemastery `3.18.1 || 3.18.2 || 3.18.4` 仍精确枚举（两者不进版本门禁）。上界带 `-0` 是硬要求（写 `<0.2.1` 会漏放行 `0.2.1-rc.1`），见 `AGENTS.md` 规范 3。⚠️ **v3.3.2 同时收窄支持面**：`0.1.7` 线不再声明。
- **`0.1.7` 的配置迁移是"全有或全无"**：整个 settings.yaml 被一次性改名 + 逐段导入，任何一段导入失败都只留下日志、配置残留在 `settings.yaml.imported`。插件自身已通过声明 volatile `Config` 保证可导入；但其他未适配的插件仍可能触发该警告。
- **`.volatile()` API 版本漂移**：schemastery `3.18.2`（rc.3）无此方法、`3.18.4`（0.1.7）有。若未来 rc.x 分支也被回移该方法，需重新评估守卫写法。
- **`ctx.llm` 事件**是主要变数：`agent/request`/`agent/request-error` 的载荷结构若在 DSH 大版本调整，轮换判定需适配；但所有 handler 都走 `next()` 链，异常不会让 DSH 崩溃。
- **`webServer` 可选**：用 `ctx.get('webServer')` 而非硬 inject，缺失时插件其余功能（轮换）照常。
- **防御性编码**：凭证读写、`describe`、状态计算、后端判别均有 try/catch；`ctx.credentials.describe` 存在性检查。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH `0.1.5-rc.3` → `0.1.7-rc.1` | ✅ 不崩：v3.2.0 双后端自动判别（rc.3 文件后端 / 0.1.7 profile entry 后端）、v3.2.1 追加遗留池一次性救援，**两版均已实测读写通过**；v3.2.2 追加 `@deepseek-ai/dsh` peer `0.1.7-rc.1`（门禁实测通过） |
| DSH `0.1.7-rc.2` | ✅ 不崩：v3.2.3 追加 peer 枚举 rc.2（代码零改动）。依据：tarball diff——`dsh-credentials` 的 `lib/` **逐字节一致**、`dsh-llm` 仅新增内容类型/错误码（waterfall 与 credential-reference 签名未变）、`dsh-shell`/`dsh-settings` `lib/` 逐字节一致；rc.2 门禁放行；scratch profile 真机回归池页 200 |
| DSH 大版本 | ✅ DSH 不崩；`agent/*` 事件载荷或 `webServer` 若变，轮换/设置页需适配 |
| DSH `0.2.0-rc.1` | ✅ 不崩：v3.2.4 追加 peer 枚举 `0.2.0-rc.1`（dsh/credentials/llm/settings 四条同步，代码零改动）。依据：`dsh-credentials`/`dsh-llm`/`dsh-settings` 的 `lib/` 在 `0.1.7-rc.2 → 0.2.0-rc.1` **逐字节零变化**（`ctx.credentials` 的 `resolve`/`describe`/`set`/`unset`、`agent/request(-error)` 事件、`settings.describe/replace` 全保留）；门禁对旧声明判拦截、新声明判放行；沙箱真机装配入树 |
| `dsh-credentials` 版本漂移 | ✅ reference 半边自 rc.6 稳定，低风险 |
| key 轮换**实际生效**（DSH `0.2.0-rc.1`） | ✅ 生效（非 v3.3.0 新增——`credentials.resolve` 包装自 v3.0.0 即在；v3.3.0 只是去掉冗余 env 写入并修 `activeRef` 显示）。**两路证据**：① 实机 `/diag` 200 条，池中两把 key 各被用 26/25 次并逐次交替，57 条 `pool-hit` 写明当时生效的那把；② 端到端实测（进程内真实 `@deepseek-ai/dsh-llm-pi-ai` 适配器 + 真实 `LocalCredentialProvider` + 本地 mock 上游，从**出站 HTTP `Authorization` 头**取值）：未装插件 `Bearer STORED-ENV-KEY` → 预选 `Bearer KEY-ONE-111` → `RATE_LIMIT` 轮换 `Bearer KEY-TWO-222` → `dispose()` 回 `Bearer STORED-ENV-KEY`。另测边界 14/14 与 9/9 全绿（`enabled:false`、空池、env 解析不到、`useKeyRef` 锁定、`activeRef`/`currentRef` 一致、`dispose` 幂等、非 rotateOn 码不换 key、无关 provider 不干预） |
| 服务缺失 | ✅ 设置页不显示/轮换降级，不崩溃 |

---

## 5. @omdp/dsh-archived-sessions（v0.3.9）【活跃插件】

> fork 自 `@muwinds/dsh-archived-sessions` 0.2.0。上游在 DSH 0.1.5-rc.1 下损坏（见下方风险点），作者已一个月未维护，2026-09-10 决定 fork 并入 omdp。

### 架构

- **ESM bundle**：`lib/index.js` 为 `type: module`（`main`/`exports` → `./lib/index.js`），`inject: ['webServer']` 注册 `/dsh-archived/*` 前缀 HTTP 路由。
- **Host 依赖**：`workspaceRegistry`（读/写 `archivedSessionIds`）、`sessionPersistence`（`list()` 快照）、`sessionQuery`（标题/详情）、`fs`（目录体积）、`shell`（删目录，danger-full-access 策略）、`sessions`/`agents`（活动/运行态）、`storageDomain`（注册表写入兜底）。
- **Client**: 设置页 `Settings → 归档会话管理`，经 `slots.inject('settings.section')` + `slots.register` 注册（自 0.3.4 起 `id: 'omdp-archived-sessions'`（原名 `archived-sessions`，因与 DSH 0.1.6 内置项撞名而改）, `order: 30`）。
- **能力**：列表/释放/删除（两步确认）/详情；**按树删除**（`parentSession` 子树一并删，修 issue #2）；**孤儿清理**（`/orphans` 列表 + `/sweep` 清理父会话已不在盘的子会话）。

### 依赖的 DSH 接口

| 接口 | 说明 | 变更风险 |
|---|---|---|
| `ctx.sessionPersistence`（`ctx.get` 可选） | `list()` 返回 `SessionPersistenceSnapshot[]`（`{header, revision, eventCount?, sizeBytes?}`） | **高**——0.1.5-rc.1 移除抽象 `locate()`，本 fork 已改用 JSONL 后端同款路径编码自解析 |
| `ctx.workspaceRegistry`（`ctx.get` 可选） | `archivedSessionIds` + `setState`（归档集合读写） | 中（字段/方法若变需适配） |
| `ctx.sessionQuery`（`ctx.get` 可选） | `readTitleSnapshots` / `readSession`（标题与详情） | 低–中 |
| `ctx.webServer`（`inject` 硬依赖） | `/dsh-archived/*` HTTP API | 中（缺失则设置页不可用） |
| `ctx.fs` / `ctx.shell`（`ctx.get` 可选） | 目录体积计算 / 删目录（danger-full-access） | **中**——`ctx.shell` 的 `run()` 在 0.1.7 已移除（只剩 `resolve`/`execute`/`result()`）；0.3.6 起**运行期探测双时代**：`execute()` 优先（0.1.7+，需 `await execution.result()`），否则回退 `run()`（≤0.1.6） |
| client `slots`（`ctx.get` 可选） | `settings.section` 槽位注册设置页 | 低（缺失则 UI 不显示） |

### 风险点

- **路径解析是最大变数**：0.1.5-rc.1 抽象服务移除 `locate()`，本 fork 按 DSH JSONL 后端同款编码（`encodeSegment`：保留 `[A-Za-z0-9._-]`，其余 `~XXXX`；`projectKey`：`/\:` → `-`）自行拼 `session-<uuid>` 目录；已用真实磁盘核对（67 条归档 → 1 条存在 66 条缺失，与盘一致）。若 DSH 改目录布局（如文件名/代际），列表可能再出现「文件缺失」——但**删除安全护栏**（目录名必须是会话目录才允许删）保证不会误删。
- **上游 0.2.0 损坏根因**（本 fork 已修）：`list()` 返回快照数组后按裸 header 取 `header.id` → undefined；`locate(header)` 返回 undefined → `.path` 抛 TypeError 被 catch 吞 → `no-artifact` 分支 → 全列表「文件缺失」+ 删除退化为仅移除归档标记。
- **删除是危险操作**：有 `assertSessionDirName` 校验（只删 `session-<uuid>` 或裸 UUID 目录）+ 运行中会话拒绝删除 + 两步确认；孤儿清理单独确认。
- **peer 声明**：`@deepseek-ai/cordis` 精确枚举 `4.0.1 || 4.0.2 || 4.0.4`（0.3.5 起追加 `4.0.4`，即 0.1.7 自带版本）；0.3.6 起追加 `@deepseek-ai/dsh` peer（逐版本枚举，0.3.7 为 `0.1.7-rc.1 || 0.1.7-rc.2`，见 0.1.7 专项「变更 1」——注意这使本插件在 0.1.7+ 上**纳入门禁**）。`@deepseek-ai/dsh-session-persistence-jsonl` **不声明为 peer**——它只随 DSH 自带（profile 未直装，profile 是 `autoInstallPeers:false`），硬声明会引入 pnpm 解析摩擦，改用可选 `import()` + 内置路径编码 fallback。
- **发布事故教训（0.3.0 → 0.3.1）**：0.3.0 的 npm tarball **只有 4 个文件、没有 `lib/`**（仓库 `.gitignore` 的 `**/lib/` 规则把 fork 的源码目录整个忽略了，`git add -A` 静默跳过 → CI checkout 里就没有源码 → 打包自然没有），安装后插件加载失败会拖垮 DSH。修复：`.gitignore` 加例外（`!dsh-archived-sessions/lib/` + `!dsh-archived-sessions/lib/**`，两行缺一不可——git 无法重新包含仍被忽略的目录下的文件）。**发布前必须验证 tarball 内容**（`npm pack` 后 `tar -tzf` 核对文件清单）。
- **fork 遗留清理（0.3.2）**：client 半区的模块 id 漏改成新包名（`@muwinds/...` → `@omdp/...`），浏览器按包名找不到模块、设置页不渲染；会话根目录原先是硬编码本机路径，已改为由 `DSH_HOME` 推导（`<DSH_HOME>/sessions`，缺省 `~/.dsh/sessions`）。教训：fork 一个包后要**全量 grep 旧包名**（`muwinds` 等），模块 id、注释、文档、硬编码路径都要过一遍——`sessionPersistence` 服务公开面（create/open/flush/stat/list）**不含 root**，路径只能从环境推导。
- **混合分隔符路径回归（0.3.3）**：0.3.2 的 `DSH_HOME` 推导把 Windows 根拼成**混合分隔符**路径（`C:\Users\xj\.dsh/sessions/...`），而删除前校验 `assertSessionDirName` 的 basename 提取对混合分隔符失效（先按 `/` 切再按 `\` 切 → 名字被切成残缺片段），**所有删除被"拒绝删除非会话目录"拦截**。修复：basename 用分隔符感知切分（`split(/[\\/]/)` 取末段）+ root 统一 `/`。教训：**Windows 上拼接路径要统一分隔符**，basename 提取不要链式 `lastIndexOf` 两种分隔符，直接按分隔符整体切分。
- **`ctx.shell` 契约变更（0.3.5 修 0.1.7、0.3.6 修回 rc.x，详见 0.1.7 专项「变更 5」）**：0.1.7 的
  `ctx.shell` 只保留 `resolve(request)` / `execute(spec)`（返回 `ShellExecution`，需
  `await execution.result()` 取 `{exitCode, stdout, stderr, …}`），**`run()` 整个不存在**；
  而 `≤0.1.6` 只有 `run()`、没有 `execute()`。0.3.4 以 `typeof shell.run === 'function'` 为前置 ⇒
  在 0.1.7 上**所有删除 100% 失败**（UI 显示「删除失败 N 个会话: …」，磁盘未动）；0.3.5 改用
  `execute()` ⇒ 在 0.1.7 上修好、**却在 rc.x 上静默回归**（同样抛
  `shell executor unavailable; cannot delete from disk`）。0.3.6 改为**运行期能力探测**：
  `execute()` 存在则走 `resolve` → `execute` → `await result()`，否则回退 `run()`，两者皆无才报错
  ⇒ 一份构建覆盖 `0.1.5-rc.1 → 0.1.7-rc.1` 全线。
  教训：**抽象服务的「新增方法」是兼容的，「删除方法」不兼容**，而且**改名不是别名**——
  只做单个 `typeof x.fn === 'function'` 存在性探测的代码，在方法被移除后会静默走到拒绝分支，
  表现为「功能全废但插件不崩」；**只赌一代**（无论新旧）都会在另一代静默失效。正确姿势是探测
  多个候选名、按可用性分流。
- **slot id 撞名炸穿整页 Web UI（0.3.4 修复，DSH 0.1.6-alpha.1 实测）**：DSH 0.1.6 内置原生「已归档会话」设置页（`@deepseek-ai/dsh-client-ui-settings-unarchive-sessions`），注册的 `settings.section` id 恰为 `archived-sessions`——与本插件旧 id 相同 → slot 冲突让**整个 web boot 失败**（浏览器报 `web boot: 1 entry did not activate` 并整页「Failed to load plugins」拦截，不只是本插件或原生项各自失效）。修复：本插件 slot id 改唯一前缀 `omdp-archived-sessions`、导航标签改「归档会话管理」与原生「已归档会话」区分。教训：**第三方插件的全局 slot id 必须带自己的命名空间前缀**——宿主随时可能在同槽位注册同名条目，撞名的爆炸半径是整页 UI 而不是单插件（抗崩溃架构对 client slot 注册冲突**不成立**，因为失败发生在宿主 boot 聚合处）。运行时定位法：插件子集二分 + 浏览器 console。

### 结论

| 场景 | 崩溃？ |
|---|---|
| DSH 小更新/补丁 | ✅ 不会崩 |
| DSH `0.1.7-rc.1` | ✅ 不崩：0.3.6 双时代探测 `ctx.shell` 契约（`execute()` 优先、`run()` 回退），删除功能恢复；并声明 `@deepseek-ai/dsh` peer（门禁实测通过） |
| DSH `0.1.7-rc.2` | ✅ 不崩：0.3.7 追加 peer 枚举 rc.2（代码零改动）。依据：`dsh-shell` 的 `lib/` 在 rc.1→rc.2 **逐字节零变化**（本插件唯一 shell 依赖面）；rc.2 门禁放行；scratch profile（`dsh@0.1.7-rc.2` + 0.3.6 + 豁免）**真机删除实测通过**（`{"ok":true}` + 磁盘目录消失 + 归档集合清空） |
| DSH 大版本 | ✅ DSH 不崩；`sessionPersistence`/`workspaceRegistry` 若变，需适配路径解析/归档集合 |
| DSH `0.2.0-rc.1` | ✅ 不崩：0.3.8 追加 peer 枚举 `0.2.0-rc.1`（代码零改动）。依据：`dsh-shell`（本插件唯一 shell 依赖面，`execute`/`resolve`/`result` 三件套）与 `dsh-session` 既有导出在 `0.1.7-rc.2 → 0.2.0-rc.1` **全保留**——`dsh-session` 的 5 个变化文件为**附加式**（新增 `ToolCallRecovery`/`TOOL_NOT_STARTED`/`TOOL_OUTCOME_UNKNOWN`，`SessionStore`/`readTitleSnapshots`/`readSession` 未动）；门禁对旧声明判拦截、新声明判放行；沙箱真机装配入树 |
| `sessionPersistence` 版本漂移 | ✅ 列表/删除优雅降级（无路径则只清归档标记），不会误删 |
| 服务缺失 | ✅ 设置页不显示/操作降级，不崩溃 |

---

## 汇总对比【gitbash 已归档】

| 插件 | 版本 | 第三方依赖 | DSH 硬依赖 | 抗崩溃设计 | 最大风险点 |
|---|---|---|---|---|---|
| dsh-gitbash-win（归档） | 0.1.6 | 无（动态加载 5 个 @deepseek-ai/*） | `tools`/`subprocess`/`systemPrompt`/`shellEnv` | 顶层零依赖 + 动态加载 + 失败隔离 | `dsh-sandbox`（Windows ACL 上游 bug） |
| dsh-connector | 0.3.8 | `yaml`（+ `jsdom` 懒加载；peer `schemastery` 仅 Config 声明用、`@deepseek-ai/dsh` 供版本门禁，**v0.3.8 起为三元组区间 `>=0.2.0-rc.1 <0.2.1-0`**） | `webServer`（`settings`/`tools.guard`/`systemPrompt`/`profileContext` 可选） | 顶层零第三方 static import + try/catch + 可选服务失败隔离 + **遗留 `toolFilters` 一次性救援** + **CRLF 解析容错** | `ctx.webServer` API 变化 / 内置模块子路径解析崩溃（`punycode/`，0.3.3 懒加载缓解）/ 0.1.7 配置迁移漏段（0.3.4 救援）/ 补丁文件换行被外部工具改成 CRLF（0.3.6） |
| dsh-vision-bridge | 0.1.12 | 无 | `tools`/`attachments`/`llm`/`credentials` | 纯静态 + 零 @deepseek-ai + 防御性编码 | `ctx.llm` API 变化 / composer 输入层变化 / Agent 路由载荷变化（`requestHeader().config`） |
| dsh-key-fallback | 3.3.2 | `schemastery`（仅 `Config` 声明用） | `credentials`/`llm`/`settings`（`webServer`/`slots` 可选） | ESM import + `agent/*` 事件 + **包装 `credentials.resolve` 切换 key（v3.0.0 起）** + **配置双后端自动判别** + **遗留池一次性救援** + **DSH peer 版本门禁（v3.3.2 起为三元组区间）** + 防御性编码 | `agent/request-error` 载荷 / `credentials.resolve` 签名 / `0.1.7` 配置迁移机制 / `webServer` API 变化 |
| dsh-archived-sessions | 0.3.9 | 无（jsonl 后端可选 import + 内置编码 fallback） | `webServer`（`sessionPersistence`/`workspaceRegistry`/`sessionQuery`/`fs`/`shell` 可选） | 路径自解析（root 由 `DSH_HOME` 推导）+ 删除目录名校验 + **`ctx.shell` 双时代能力探测** + **DSH peer 版本门禁（v0.3.9 起为三元组区间）** + try/catch + 可选服务失败隔离 | `sessionPersistence` 路径布局 / `workspaceRegistry` 字段变化 / `ctx.shell` 抽象方法**改名**（0.3.6 双时代探测）/ 宿主同槽位撞 slot id（0.3.4 起用 `omdp-` 前缀免疫） |

## DSH 0.1.7 兼容性专项（2026-09-24）

DSH `0.1.7` 引入多处**破坏性变更**，本仓库插件已按"优先双版本兼容"的原则处理：

### 变更 1：profile bundle 版本门禁

`0.1.7` 新增 `evaluatePluginCompatibility`：只检查前缀为 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 peer，
用 `semver.satisfies(runtime, range, { includePrerelease: true })` 判定；不满足则**跳过整个 bundle**
（打印 `dsh: skipping profile bundle ...`，DSH 本体不崩、退出码仍为 `0`）。可用
`dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <ver> --accept-risk` 写
`profiles/<p>/compatibility.json` 豁免。

| 插件 | 门禁影响 | 处理 |
|---|---|---|
| dsh-key-fallback | **原 v3.1.7 被跳过**（3/3 peer 不含 `0.1.7-rc.1`） | v3.2.0 追加 `0.1.7-rc.1`（credentials/llm/settings）与 cordis `4.0.4`、schemastery `3.18.4`；v3.2.1 追加遗留池救援；v3.2.2 追加 `@deepseek-ai/dsh` peer `0.1.7-rc.1`；v3.2.3 追加 rc.2（dsh/credentials/llm/settings 四条枚举同步扩充）；v3.2.4 追加 `0.2.0-rc.1`（同四条）；v3.3.0 删冗余 `process.env` 写入 + 修 `activeRef` 显示 + 加卸载还原；v3.3.1 文档更正（v3.3.0 曾误称「换 key 从未生效」，实为 `credentials.resolve` 包装自 v3.0.0 起一直有效）；**v3.3.2 四条 peer 改用三元组区间 `>=0.2.0-rc.1 <0.2.1-0`（同时收窄：不再声明 0.1.7 线）** |
| dsh-connector | **原不受门禁**（peer 只有 schemastery，非 `dsh-*`） | import 期崩溃需修 ⇒ v0.3.3；v0.3.4 **主动纳入门禁**（新增 `@deepseek-ai/dsh` peer）；v0.3.5 追加 rc.2；v0.3.6 修 CRLF 解析 + `profileContext` 补丁路径；v0.3.7 追加 `0.2.0-rc.1`；**v0.3.8 改用三元组区间（同时收窄：不再声明 0.1.7 线）** |
| dsh-archived-sessions | **原不受门禁**（peer 只有 cordis） | `ctx.shell.run()` 移除导致删除失效 ⇒ v0.3.5（追加 cordis `4.0.4` 枚举）、v0.3.6 双时代自适应 + **主动纳入门禁**；v0.3.7 追加 rc.2；v0.3.8 追加 `0.2.0-rc.1`；**v0.3.9 改用三元组区间（同时收窄：不再声明 0.1.7 线）** |
| dsh-vision-bridge | **不受门禁**（无 dsh peer） | 无需改动 |

**门禁的两个易误读点（0.3.4/0.3.6 本轮实证）**：

1. **声明的 range 是拿「DSH 运行时版本」比，不是拿 peer 包自己的版本比。** 运行版本取自
   `getDshRuntimeVersion()` = `dsh-app-boot` 自身 `package.json` 的 version。所以
   `"@deepseek-ai/dsh": "0.1.7-rc.1"` 的含义是「我实测过运行版本为 `0.1.7-rc.1` 的 DSH」。
2. **门禁本身是版本相关的，0.1.7 才引入。** 逐版解包 `@deepseek-ai/dsh-app-boot` npm tarball 统计
   `evaluatePluginCompatibility` 出现次数：

   | `dsh-app-boot` | 命中次数 | 门禁 |
   |---|---|---|
   | `0.1.5-rc.2` / `0.1.5-rc.3` / `0.1.6-alpha.1` / `0.1.6-alpha.2` | 0 | ❌ 无 |
   | `0.1.7-alpha.1` / `0.1.7-alpha.2` | 0 | ❌ 无 |
   | `0.1.7-rc.1` | 4 | ✅ 有 |
   | `0.1.7-rc.2` | 有（导出仍在，逻辑与 rc.1 等价——diff 仅 `skippedBundles` 诊断重构等插件无关变更） | ✅ 有 |

   ⇒ **在 `≤0.1.6` 与 `0.1.7-alpha.x` 的运行时上，声明任何 `@deepseek-ai/dsh*` peer 都不产生约束**
   （只是「不认识的声明」，插件照常加载）；只有 `0.1.7-rc.1` 及更新版本才真正执行检查。
   这就是为什么「只声明 `0.1.7-rc.1`」不会伤害老用户：老运行时根本不看这条声明。

   > 这也是 `AGENTS.md` 规范 3 在此处的正确用法：老版本无法被这条声明约束，写进去纯装饰；
   > 而**未实测的新版本必须被拦下**（宁可 unmet peer 也不预先放行）。
   > 反过来说，**一旦某插件声明了 `@deepseek-ai/dsh` peer，就在 0.1.7+ 上纳入了门禁**：
   > 若日后 DSH 升到 `0.1.7-rc.2`/`0.1.8-*`，在把新版本追加进枚举之前，该插件会被**优雅跳过**
   > （设置页整项消失），这既是保护也是提醒。

验证方式（可复现）：直接用 DSH 自己导出的门禁函数跑真实 `package.json`，无需真启动——
`evaluatePluginCompatibility` / `pluginCompatibilityWarning` 都是 `dsh-app-boot` 的公开导出：

```js
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
const m = JSON.parse(readFileSync('D:/WorkSpace/omdp/dsh-connector/package.json', 'utf8'))
console.log(evaluatePluginCompatibility(m, {}, '0.1.7-rc.1'))   // undefined = 正常加载
console.log(evaluatePluginCompatibility(m, {}, '0.1.8-rc.1'))   // { peers: {...} } = 被门禁拦下
```

实测三插件（`@deepseek-ai/dsh: "0.1.7-rc.1"`）：运行时 `0.1.7-rc.1` → 全部 `LOAD`；
`0.1.7-alpha.2` / `0.1.6-alpha.1` / `0.1.5-rc.3` / `0.1.8-rc.1` → 全部 `SKIP`。
其中老版本 SKIP 只是**函数层面的判定**，真实老运行时里没有这个函数、不会调用它（见上表）。
2026-09-25 追加：**rc.2 实测**——用 rc.2 的 `dsh-app-boot` 执行 0.3.5/3.2.3/0.3.7 新声明
（`0.1.7-rc.1 || 0.1.7-rc.2`），在 `0.1.7-rc.1` 与 `0.1.7-rc.2` 上均 `undefined`（放行）；
另用 `dsh@0.1.7-rc.2` scratch profile（+ 精确版本豁免）真机启动验证三插件激活、
connector 过滤端点 200、**归档会话真实删除全链路成功**。

**rc.2 的「精确枚举一夜过时」教训（2026-09-25，桌面版踩坑实录）**：DSH 桌面版
（DeepSeek Harness desktop，`runtime.json` 的 `desktopVersion` = `0.1.7-rc.2`）发布当天，
所有只声明 `0.1.7-rc.1` 的插件即被门禁跳过——`.plugin-manager/logs/*/pnpm.log` 里连打
`incompatible with dsh 0.1.7-rc.2: peerDependencies {...}`（安装时）+
`profile startup denies it`（启动时），插件列表徽标显示「异常」（`dsh-client-ui-plugin-manager`
的 `rowPhaseFailed`/`statusProblem` 文案，含义 = **bundle 加载失败**）。核查后追加枚举即修复。
教训：**声明了 `@deepseek-ai/dsh` peer 的插件，每个新 rc 发布当天都要核查 + 追加**，
rc 版本号本身没有 range 语义（`0.1.7-rc.1` 不匹配 `0.1.7-rc.2`，semver prerelease 只匹配同三元组）。

> 注意 `dshCompat` 字段（dsh-bridge 曾用）在 `0.1.7` 源码中**零命中**——它只是自我文档，不参与门禁。

### 变更 2：插件配置从 settings.yaml 迁移到 profile entry config

`0.1.7` 首启会把 `<DSH_HOME>/settings.yaml` **改名为 `settings.yaml.imported`**，逐段写入 profile 补丁
（`profiles/<p>/cordis.patch.yml`）中对应条目的 `config:`；此后 `ctx.settings.get/register/installSection`
**全部移除**（实测 `get=undefined installSection=undefined`），改由 `describe`/`update`/`replace`/`mutate`
操作，配置经 `apply(ctx, config)` 第 2 参注入。

- **迁移前提**：目标条目必须声明 **volatile** 字段（`z.string().volatile()` 或 `s.meta.volatile = true`），
  否则 `settings.update()` 抛错、仅打印 `settings: section ... was not imported`，配置静默残留在 `.imported`。
- **版本漂移陷阱**：`.volatile()` 在 schemastery `3.18.4`（0.1.7）可用，但 `3.18.2`（rc.3）**没有**该方法；
  想同时兼容两版，必须用 `typeof field.volatile === 'function'` 守卫（或用两版都支持的 `meta.volatile = true`）。
- **`DSH_HOME`**：`0.1.7` 经 `@deepseek-ai/dsh-home-paths` 正式支持（优先级：显式配置 > `$DSH_HOME` > `~/.dsh`）。

### 变更 3：Agent preset 改为声明式（Craft-Agent 相关）

- rc.3 扫 `~/.dsh/.agent-presets/<id>/{agent.cordis.yml,preset.yml}`；`0.1.7` **不再扫描该目录**
  （源码零命中 `dsh-agent-presets` 复数包），改为由 bundle 提供一条
  `@deepseek-ai/dsh-agent-preset` 声明（`config.plugins` 即原 `agent.cordis.yml` 数组）。
- 顺带两处改名/路径失效：`dsh-workflow-worker-thread` → `dsh-workflow-ptc`；
  原技能目录绝对路径（`dsh-agent-presets/presets/cordis/skills`）失效，改用官方
  `createRequire(baseUrl).resolve('@deepseek-ai/dsh-agent-preset/package.json')` 写法。
- ⚠️ **该 preset bundle 在 rc.3 上会硬崩**（`ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-agent-preset`，退出码 `1`，
  非"跳过"），因此 `setup.ps1` 以 DSH 自身 `package.json` 是否依赖 `@deepseek-ai/dsh-agent-preset`（单数）
  作为判据做**版本门控**，只在 `0.1.7`+ 注册该 bundle。

### 变更 4：解析路由对「内置模块名 + 子路径」崩溃（connector 0.3.3 修复）

`0.1.7` 新增的 profile 包解析路由（`dsh-app-boot` `ResolutionRouter.routeScoped`）会把 specifier
切成裸包名后用 `createRequire(parent).resolve.paths(name)` 求查找路径：

- Node 对**裸内置模块名**（`punycode`）返回 `null`；
- 该处循环 `for (const searchPath of createRequire(parent).resolve.paths(name))` **无兜底**。

于是任何 `require("punycode/")`（如 `tr46@5.1.1` 第 3 行、`tough-cookie/lib/cookie.js:32`）都会抛
`TypeError: createRequire.resolve.paths is not a function or its return value is not iterable`。
关键实证：`isBuiltin("punycode") === true` 但 `isBuiltin("punycode/") === false`，因此**带子路径的
内置名不会被提前放行**，而是走进上述切名 + 求路径逻辑 ⇒ 崩溃。普通 Node 解析 `require("punycode/")`
完全正常（`node_modules/punycode/punycode.js`），这是 DSH 侧的解析器缺陷。

- **爆点**：`PluginPackages` 在进程生命周期内常驻安装该解析拦截（`installRuntimeInterception`，
  仅在 `ctx.effect` 清理时 `dispose()`），故加载任何传递依赖到 `tr46` 的包（典型 `jsdom`）都会在
  **import 期**炸掉整个插件 fiber。
- **connector 的影响面**：0.3.2 顶层静态 `import { JSDOM } from 'jsdom'` ⇒ 插件 import 失败 ⇒
  设置页卡在「已安装，重启后生效」、`/connector/api/*` 全 404（重启无效）。0.3.3 把 jsdom 挪进
  `loadJsdom()`（`await import()`），**import 期不再触发**，插件的设置页与全部路由恢复正常。
- ⚠️ **残留风险（不得宣称已根治）**：拦截常驻 ⇒ 懒加载只是把同一 `TypeError` **推迟到首次解
  WAF 挑战时**，届时魔搭市场浏览（`GET /api/mcp/market` 走 `dolphinPut` → `solveWafFromChallenge`）
  仍会失败；该分支已由 `marketError` 包成 **502 + 明确 message**（不挂起）。真正根治要上游在该循环
  补 `?? []`。当前实测该 WAF 挑战未下发（`PUT /api/v1/dolphin/mcpServers` 返回 HTTP 200、
  无 `acw_sc__v2`/`aliyunwaf`），故该路径处于休眠。
- **可复用要点**：给 DSH 插件排查「import 期崩溃」时，先看插件第三方依赖图里有没有包会
  `require` **内置模块的子路径形式**（`punycode/`、`util/`、`events/` 等）；顶层静态 import 会把
  这种崩溃放大成「整个插件失效」，改为按需 `await import()` 可把爆炸半径收敛到单个功能。

### 变更 5：`ctx.shell` 方法改名（archived-sessions 0.3.6 双时代修复）

`0.1.7` 把 `ctx.shell` 的执行方法**改名并换了返回类型**，且**旧方法被整个移除**（不是保留别名）。
逐版解包 `@deepseek-ai/dsh-shell` 的 `lib/types/index.d.ts` 核对：

| `@deepseek-ai/dsh-shell` | `abstract run(...)` | `abstract execute(...)` |
|---|---|---|
| `0.1.5-rc.1` / `0.1.5-rc.2` / `0.1.5-rc.3` | ✅ 1 处 | ❌ 0 处 |
| `0.1.6-alpha.1` | ✅ 1 处 | ❌ 0 处 |
| `0.1.7-rc.1` | ❌ 0 处 | ✅ 1 处（`execute(spec): Promise<ShellExecution>`） |

- ≤ `0.1.6`：`resolve(request) → spec` → **`run(spec)` → `Promise<ShellRunResult>`**
- ≥ `0.1.7`：`resolve(request) → spec` → **`execute(spec)` → `ShellExecution`** → `await execution.result()`
  （`ShellExecution extends ShellProcess`，见 `types.d.ts`）

**两代都只赌一边 ⇒ 必然有一代静默失效**，本仓库踩了两次镜像的坑：

| 版本 | 调用 | rc.x（≤0.1.6） | 0.1.7 |
|---|---|---|---|
| archived-sessions `0.3.4` | 只 `run()` | ✅ 可用 | ❌ 每次删除抛 `shell executor unavailable` |
| archived-sessions `0.3.5` | 只 `execute()` | ❌ 同上（**静默回归**） | ✅ 可用 |
| archived-sessions `0.3.6` | 运行期探测：`execute()` 优先，否则 `run()` | ✅ 可用 | ✅ 可用 |

- **为什么要运行期探测而非版本号判断**：插件拿不到干净的「运行时版本」比较面（DSH 版本在
  `dsh-app-boot` 里），而**能力探测**（`typeof shell.execute === 'function'`）直接对应「这个方法存不存在」，
  与版本号解耦、也不会被 backport/patch 版本骗到。
- **可复用要点**：给 DSH 抽象服务写调用时，**别用 `typeof x.method !== 'function'` 直接抛错**——
  那会把「跨版本兼容」变成「单点故障」。正确姿势是探测多个候选名、按可用性分流；两个都没有才是
  真正的不兼容。这条与「新增方法兼容、移除方法不兼容」是同一条规律的正面用法。
- ⚠️ **教训**：这两次失效都是**静默**的——插件照样加载、UI 照样渲染，只在用户点「删除」时以红字
  呈现。所以「插件加载成功」**不能**作为「功能可用」的证据，必须真的走一次该功能的端到端路径。

### 变更 6：0.1.7 配置迁移漏段导致过滤/配置静默丢失（connector 0.3.4 修复）

见「变更 2」的迁移前提：目标条目必须声明 volatile 字段，否则该段**静默残留**在 `.imported`。
`connector` 的 `toolFilters` 正是这样被漏掉的（本插件 `Config`/volatile 是 0.3.3 才引入的，
用户机器上早已迁过一次、永不重试）——表现为**工具过滤静默变回「全量放行」**。

- 症状：设置页里勾选的 allow 名单消失（或模型又能看到/调用本应被隐藏的工具），重启无效。
- 根因：`<DSH_HOME>/settings.yaml` 已被改名为 `settings.yaml.imported`，内置导入器见 `.imported`
  不再重跑；`settings.yaml` 不存在 ⇒ 老的文件后端路径永远读不到。
- 修复（connector 0.3.4）：`ensureLegacyFiltersMigration()` —— 若活的 `config.toolFilters` 为空
  而 `.imported` 里有值，则经 `settings.replace()` 写回 profile 条目。三个安全约束：
  ① 只在**首个 HTTP 请求**时执行（`apply()` 期间 fiber 未 ACTIVE，`settings.replace()` 会抛
  `No configurable plugin entry`）；② 有非空规则时**不覆盖**用户当前设置；③ `.imported` **只读、
  永不删除**（它是遗留配置的唯一副本）。
- **可复用要点**：DSH `0.1.7` 的迁移是「改名 + 逐段导入」的**全有或全无**动作，且**失败不重试**。
  凡是「配置放在 `settings.yaml` 里、需要跨 0.1.7 存活」的插件，都应自查这段配置是否真的迁到了
  profile 条目；没有 volatile `Config` 声明的字段**一定**没迁过去。

### 变更 7：profile 补丁文件必须问 `profileContext`（connector 0.3.6 修复）

0.1.7 起，插件若要读写「当前 profile 的 `cordis.patch.yml`」，**必须**从启动器提供的服务取路径，
不能自己拼 `$DSH_HOME/profiles/<name>/cordis.patch.yml`：

```ts
// @deepseek-ai/dsh-app-boot — lib/types/profile-context.d.ts
interface ProfileContext {
  readonly name: string
  readonly dir: string          // 当前 profile 目录（绝对路径）
  readonly patchPath: string    // ★ 当前 profile 的 cordis.patch.yml
  readonly installAnchor: string
  readonly cwd: string
  readonly home: string
  readonly startedBundles: readonly string[]
  readonly overlays: readonly PatchOptions[]
  readonly telemetryDisabledEnv: string | undefined
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only in a profile launched by dsh. */
    profileContext: ProfileContext
  }
}
```

- 写法：`ctx.get('profileContext')?.patchPath`（`dsh-app-boot` 自己就这么读；`ctx.get` 在服务缺失时返回
  `undefined`，不抛异常）。
- **实例教训（connector 0.3.5 及以前）**：`patchPath()` 硬编码 `profiles/web/cordis.patch.yml`。
  桌面端实际跑 `profiles/desktop`（命令行证据：`DeepSeek Harness.exe … dsh-desktop-host … C:\Users\xj\.dsh\profiles\desktop`），
  于是「Connector → MCP 服务器」面板读写的都是 **web profile** 的文件——对自己的 MCP 配置毫无影响，
  只因为两个 profile 的 MCP 块当时恰好一致才没暴露；UI 提示里的错误路径也误导了排障。
- **可复用要点**：0.1.5/0.1.6 没有 `profileContext`，回退逻辑要保留（connector 保留了历史路径）；
  另外**同一份 `cordis.patch.yml` 在多个 profile 下内容可能不同**，任何「读文件 → 解析 → 写回」的插件
  都要先确认自己拿到的是当前 profile 的那份。

### 变更 8：CRLF 的 `cordis.patch.yml` 会让锚定正则静默失配（connector 0.3.6 修复）

JS 的 `$`（无 `m` 标志）**不匹配 `\r` 之前的位置**，而 `.` 也不匹配 `\r`。因此

```js
line.match(/^\s+(\w+):\s*(.*)$/)   // CRLF 文件里每一行都以 \r 结尾 ⇒ 永远匹配失败
```

在 CRLF 文件上会**静默**把 `transport`/`serverName`/`command`/`url` 全部丢进 `preserve` 桶，
接口回 `serverName:""`，前端 `if (!props.serverName) return null` 于是让整个「工具过滤」区消失
（transport 徽标还会退化成默认的 `stdio`）。修复：解析入口 `toLf()` 归一化换行、写回统一 LF。

- **可复用要点**：**任何**逐行解析用户可编辑文本的插件，解析前先 `String(text).replace(/\r\n?/g, '\n')`；
  写文件时也要显式选一种换行，别把两种混进同一个文件。
- 排查手法：直接打插件自己的 HTTP 接口看字段（`GET /connector/api/mcp` 回 `serverName:""` 就是它），
  比在 UI 上猜快得多；再用 `Get-Content -Raw` 数 `\r\n` 定位换行被谁改的。

## DSH 0.2.0 兼容性专项（2026-09-28）

### 现象与根因

桌面端升级到 `0.2.0-rc.1` 后，插件设置页里 **connector / key-fallback /
archived-sessions 三项整项消失**（vision-bridge 正常），实测路由
`GET /connector/api/mcp` → **404**、`GET /dsh-key-fallback/pools` → **404**、
`POST /dsh-archived/list` → **405**（路由存在但方法不匹配，说明该前缀未被注册），
而 `GET /vision-bridge/capabilities` → **200**。

**根因不是崩溃，是门禁第二次生效**：三个插件声明的 `@deepseek-ai/dsh` peer 枚举止于
`0.1.7-rc.2`，而运行时已变成 `0.2.0-rc.1` —— `semver.satisfies('0.2.0-rc.1',
'0.1.7-rc.1 || 0.1.7-rc.2', { includePrerelease: true })` = `false`（预发布版本只在
**同一 `[major,minor,patch]` 三元组内**匹配）⇒ `skipping profile bundle` ⇒ 插件根本
没被加载。**vision-bridge 因为没有声明任何 `@deepseek-ai/dsh*` peer 而完全不受门禁约束，
所以它是唯一活着的**——这正好是根因的对照实验。

> 这是「**声明范围 = 承诺测试过的范围**」（`AGENTS.md` 规范 3）的代价也是价值：
> 门禁宁可 unmet peer 也不预先放行，因此 DSH 每升级一个版本、插件就会**优雅跳过一次**
> 直到重新核查。跳过是**安全行为**（DSH 本体不崩、其他插件不受影响），不是故障。

### 逐包 API diff（npm tarball 解包 + 逐文件 SHA1）

对比 `@deepseek-ai/<pkg>@0.1.7-rc.2` 与 `@0.2.0-rc.1` 的 `lib/` 全量文件：

| 包 | `lib/` 变化 | 结论 |
|---|---|---|
| `dsh-credentials` / `dsh-llm` / `dsh-settings` / `dsh-shell` / `dsh-tools` | **0 文件变化** | 插件调用面零变化 |
| `dsh-mcp-client` / `dsh-web` / `dsh-agent` / `dsh-agent-preset` | **0 文件变化** | 同上 |
| `dsh-session` | 5 文件变化（`index.js` +1150 字符、`types/*` 三件） | **附加式**：新增导出 `ToolCallRecovery` / `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN`；`SessionStore` 等既有导出全保留（导出集合比对：仅「新增」无「删除」） |
| `dsh-tool-cordis` | `types/api-catalog.js` | 目录数据，与插件无关 |
| `dsh-app-boot` | `lib/index.js` | 门禁本体（`evaluatePluginCompatibility` 逻辑与 rc.2 等价，导出集合一致） |

**方法级存在性复核**（在解包后的实现里正则检索）：`dsh-credentials` 的
`resolve`/`describe`/`set`/`unset`、`dsh-llm` 的
`listConfigurableProviders`/`listProviders`/`listModels`/`registerAdapter`/
`resolveModelInfo`/`stream`、`dsh-settings` 的 `replace`/`set`、`dsh-tools` 的
`guard`/`register`、`dsh-shell` 的 `execute`/`resolve`/`result` —— **两版全部命中，
零缺失**。

### 门禁判定实测（用 0.2.0-rc.1 自带的函数）

沙箱安装官方 `@deepseek-ai/dsh@0.2.0-rc.1`（542 包）后，调用其
`dsh-app-boot` 的 `evaluatePluginCompatibility(manifest, {}, getDshRuntimeVersion())`
（`getDshRuntimeVersion()` 返回 `0.2.0-rc.1`）：

```
❌ 拦截  @omdp/dsh-connector@0.3.6            → 不满足: dsh@0.1.7-rc.1 || 0.1.7-rc.2
✅ 放行  @omdp/dsh-connector@0.3.7            → 声明含 0.2.0-rc.1
❌ 拦截  @omdp/dsh-key-fallback@3.2.3         → 不满足: dsh / dsh-llm / dsh-settings / dsh-credentials
✅ 放行  @omdp/dsh-key-fallback@3.2.4
❌ 拦截  @omdp/dsh-archived-sessions@0.3.7    → 不满足: dsh@0.1.7-rc.1 || 0.1.7-rc.2
✅ 放行  @omdp/dsh-archived-sessions@0.3.8
✅ 放行  @omdp/dsh-vision-bridge@0.1.12       （无 dsh peer，门禁不适用）
```

### 真机装配实测（不是只看声明）

沙箱：独立 `DSH_HOME` + 官方 0.2.0-rc.1 运行时 + 改过声明的四个插件构成的
`smoke` profile，执行 `dsh --profile smoke --dump-config`：

- 四个插件 **全部出现**在装配树里；
- **零门禁拦截、零错误**（无 `incompatible` / `skipping profile bundle` / `ERR_`）；
- `dsh --version` = `0.2.0-rc.1`。

另用 `npm pack` 打真实 tarball 复核发布件：三个包的 `package.json` 均含
`0.2.0-rc.1`，同一门禁函数对 tarball 内 manifest 判定 **放行**。

### 0.2.0 带来的结构性变化（非破坏，但影响运维）

| 变化 | 说明 |
|---|---|
| **运行时内置进应用** | 桌面端不再用全局 npm 安装的 DSH：`app.asar` 内的 `dsh/package.json` 是 `@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.1`（`dependencies` 里全部 `@deepseek-ai/*` 均为 `0.2.0-rc.1`，cordis `4.0.4`）。旧 `~/.dsh/profiles/node_modules/@deepseek-ai/*` 的 junction 指向已失效 |
| **`~/.dsh/logs` 消失** | 启动日志改到 `AppData\Roaming\@deepseek-ai\dsh-desktop\logs\`（`crash-*.log` / `main.log`），插件管理日志在 `profiles/<p>/.plugin-manager/logs/operation-*/pnpm.log` |
| **profile 名变化** | `web` → `headless`（本机 `profiles/` 下现为 `desktop` + `headless` + `node_modules`） |
| **新增官方 bundle** | `@deepseek-ai/dsh-experimental-agent-team-profile`、`@deepseek-ai/dsh-experimental-auto-review` 出现在桌面 profile 的 `dsh.profile.bundles` |

### 第三方插件：门禁拦截与持久修复（pnpm patch）

0.2.0-rc.1 下桌面 profile 的 9 个第三方 bundle 全部被拦。逐个跑真门禁后，判定与
「有没有声明 dsh peer」**完全一致**——两个"不异常"的恰好是没声明 peer 的：

| bundle | dsh* peer | 门禁 |
|---|---|---|
| `@omdp/dsh-vision-bridge@0.1.12` | **0** | ✅（门禁不适用） |
| `dsh-preset-craft-bot@0.2.0` | **0** | ✅（门禁不适用） |
| `dshmarket@1.66.3` | 1（`dsh-settings`） | ❌ |
| `@mars-sea/dsh-commandcode-provider@0.11.17` | 16 | ❌ |
| `dsh-cost-meter@1.7.41` | 2 | ❌ |
| `dsh-client-auto-continue@0.11.9` | 1（`dsh-settings`） | ❌ |
| `dsh-watcher@0.6.1` | 11 | ❌ |
| `@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.1` | 5 | ❌ |

**为何不能手改 `node_modules`**（三个独立原因，缺一不可）：

1. `node_modules` 里的文件是**指向 pnpm 内容寻址存储的硬链接**
   （`LinkType = 'HardLink'`，`fsutil hardlink list` 可验证），就地改写会污染
   **跨项目共享**的 store；
2. DSH 启动/更新流程会跑 `pnpm install`，改动按 lockfile 被还原；
3. **`packageExtensions` 不行**：实测它只把扩展写进 lockfile
   （`packageExtensionsChecksum`），**不改磁盘 `package.json`**，而门禁读的正是磁盘文件。

**采用 `pnpm patch`**（安装期改写 + 每次 install 自动重放），实测：连续 `pnpm install`
存活、`--frozen-lockfile` 存活、安装后文件不再是指向 store 的硬链接。产出 6 个补丁，
登记在 profile 的 `pnpm-workspace.yaml` → `patchedDependencies`：

```
patchedDependencies:
  dshmarket@^1.66.3: patches/dshmarket@1.66.3.patch                       # +1 条 peer
  '@mars-sea/dsh-commandcode-provider@0.11.17': …                         # +16 条
  dsh-cost-meter@^1.7.41: …                                               # +2 条
  dsh-client-auto-continue@^0.11.9: …                                     # +1 条
  dsh-watcher@0.6.1: …                                                     # +11 条
  '@wxg-prc-cpg/browser-skill-dsh-plugin@^0.3.1': …                       # +5 条
```

⚠️ **key 必须用 range**：`patchedDependencies` 的 key 匹配不到实际解析版本时，
pnpm **直接报错中止安装**（`Either remove them from "patchedDependencies" or update
them to match packages in your dependencies.`）。实测教训：`dsh-cost-meter` 声明 `^1.7.41`
但 registry 已到 `1.7.43`，用精确 key 时**全新解析的安装直接失败**；改成
`dsh-cost-meter@^1.7.41` 后既装得上又仍然生效。因此 key 应与 `dependencies` 的
specifier 对齐（`github:` 类用解析出的版本号）。

**验证方式**：`desktop` 是 Electron 保留 profile，CLI 装配自检会拒绝
（`profile "desktop" is managed exclusively by the Electron application`）。
改为把清单 + 补丁复制到**隔离 `DSH_HOME` 下的副本 profile**（不复制 `node_modules`），
在副本里 `pnpm install` → `dsh --profile <副本> --dump-config`，实测
`incompatible` 0 处、`skipping profile bundle` 0 处、11 个插件全部进入装配树。

### 教训（可复用）

1. **门禁只拦「声明过 `@deepseek-ai/dsh*` peer 的插件」**——没声明 dsh peer
   （vision-bridge）的在任何 DSH 版本上都不会被跳过，但这也意味着**它没有自动保护**，
   兼容性只能靠运行时行为证明。
2. **「插件消失 + 路由 404」的第一嫌疑是门禁，不是代码 bug**：先跑
   `evaluatePluginCompatibility`，再看 `skipping profile bundle` 日志，最后才查源码。
   判据速记：**404/405 且 DSH 本体正常启动** ⇒ 大概率是 bundle 被跳过。
3. **跨三元组才需要重新枚举/核查**：`0.1.7-rc.2 → 0.2.0-rc.1` 跨了 `minor`，任何
   `^0.1.7-rc.2` / `<0.2.0` 式范围都不可能放行。但**同一三元组内**（如
   `0.2.0-rc.1 → rc.2`）用三元组区间 `>=0.2.0-rc.1 <0.2.1-0` 即可一次性覆盖，
   不必每版追加——这是 2026-09-30 改用区间声明的直接动因（见下一节与
   `AGENTS.md` 规范 3）。
4. **升级 DSH 后要同时核查「官方包 API diff」与「门禁声明」两件事**：本轮 API 面
   逐字节零变化（本可零改动兼容），却因为声明没跟上而全部被跳过——**两者是独立的关卡**。
5. **`--dump-config` 是最省事的真机装配验证**：不启动 web、不依赖浏览器，一条命令就能
   看到「某个 bundle 到底进没进树」。

## DSH 0.2.0-rc.2 兼容性专项（2026-09-30，当前 `latest`/`next`）

> 本节只记录 **rc.1 → rc.2** 的增量结论；rc.1 的核查方法与结构性变化见上一节。

### 结论：API 面仍零变化，但门禁第三次生效，且上轮的补丁失效

被拒活的**判据只有一个**：声明里有没有 `0.2.0-rc.2`。
`0.2.0-rc.1` 与 `rc.2` 属于**同一 `[major,minor,patch]` 三元组**，因此：

| 声明写法 | rc.2 下 | 实测 |
|---|---|---|
| `^0.2.0-rc.1` | ✅ 满足 | true |
| `>=0.2.0-rc.1 <0.2.1` | ✅ 满足 | true（**但会漏放行 `0.2.1-rc.1`**，见下） |
| `>=0.2.0-rc.1 <0.2.1-0` | ✅ 满足 | true —— **本仓库采用的写法**（正确排除下一三元组的预发布） |
| `>=0.2.0-rc.1 <0.3.0-0` | ✅ 满足 | true（放行过宽，跨了 minor，违规） |
| 逐版本枚举 `… \|\| 0.2.0-rc.1` | ❌ 不满足 | 需再追加一项 |

⚠️ **上界必须带 `-0`**：semver 里预发布排在正式版**之前**，所以
`semver.satisfies("0.2.1-rc.1", ">=0.2.0-rc.1 <0.2.1", { includePrerelease: true })` 为
**true**——写 `<0.2.1` 会把**下一个三元组的 rc** 漏放行。`<0.2.1-0` 才是干净切割。

⇒ **「谁的声明写成了范围」就是本轮「谁炸谁幸存」的唯一分界线。**

### 逐包 diff（20 个包，rc.1 ↔ rc.2 全量逐文件 SHA256）

| 包 | 变化 |
|---|---|
| `dsh-credentials` / `dsh-settings` / `dsh-shell` / `dsh-session` / `dsh-host-webserver` / `dsh-web-app` / `dsh-attachment` / `dsh-tools` / `dsh-mcp-client` / `dsh-agent` / `dsh-session-persistence-jsonl` / `dsh-workspace` / `dsh-session-query` / `dsh-client-ui-settings` / `dsh-client-ui-slots` / `dsh-app-boot` / `dsh-base` | **仅 `package.json`（版本号）** |
| `dsh-llm` | `lib/typert.host.js` + `package.json` |
| `dsh-agent-preset` | `package.json` + `skills/…/packages.md`（文档） |
| `dsh` 主包 | `bin.js` / `plugin-*.js` / 三个 `.d.ts` / README |

`dsh-llm` 的唯一代码变化是 `typert.host.js` 内嵌的 `MessageSourceMap` 类型**新增**
`'user-question-reply'` 字段——附加式，四个插件都不用。

### `dsh` 主包的变化全部是 `desktop` profile 支持 ⚠️

新增 `requireDesktopProfile()`、`manageDesktopProfile` 选项、`runProfilePnpm`，
`runPlugin(profile, args, packageManager)` 多了一个参数。README 措辞变化：

- rc.1：CLI「rejects boot, config-dump, and plugin-management requests」for `desktop`
- rc.2：CLI「rejects boot and config-dump requests」；**plugin-management 也拒绝，
  但桌面应用内置的命令可以管已初始化的 desktop profile**

⇒ **插件安装入口变了**：rc.2 起 desktop profile 的插件要用**应用内置的命令**装，
npm CLI 管不了。

### 真门禁判定（rc.2 自带函数，`runtimeVersion = 0.2.0-rc.2`）

```
❌ 拦截  @omdp/dsh-connector@0.3.7            → 不满足: @deepseek-ai/dsh
❌ 拦截  @omdp/dsh-archived-sessions@0.3.8    → 不满足: @deepseek-ai/dsh
❌ 拦截  @omdp/dsh-key-fallback@3.3.1         → 不满足: dsh / credentials / llm / settings（四条）
✅ 放行  @omdp/dsh-vision-bridge@0.1.12       → 零 peer，门禁不适用
```

追加 `|| 0.2.0-rc.2` 后：connector `0.3.8` / archived-sessions `0.3.9` /
key-fallback `3.3.2` **全部 ✅ 放行**。

### 真机装配复现（官方 `dsh@0.2.0-rc.2` + 隔离 `DSH_HOME` + desktop profile 副本）

`--dump-config` 的 stderr 实测**被拒活 6 个 / 幸存 4 个**：

| 结果 | 插件 | 原因 |
|---|---|---|
| ❌ | `@omdp/dsh-connector@0.3.7` | 枚举止于 rc.1 |
| ❌ | `@omdp/dsh-key-fallback@3.3.1` | 四条枚举止于 rc.1 |
| ❌ | `@omdp/dsh-archived-sessions@0.3.8` | 枚举止于 rc.1 |
| ❌ | `dsh-client-auto-continue@0.11.9` | **补丁写的 `…\|\| 0.2.0-rc.1` 已失效** |
| ❌ | `@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.1` | **同上，补丁失效** |
| ❌ | `dsh-watcher@0.6.1` | `>=0.1.7-rc.1 <0.1.8`（该补丁上轮已移除，等上游 0.7.0） |
| ✅ | `@omdp/dsh-vision-bridge` | 零 peer |
| ✅ | `dsh-preset-craft-bot` | 零 peer |
| ✅ | `dsh-cost-meter` | 上游用 `>=0.2.0-rc.1 <0.3.0-0` 范围 |
| ✅ | `dshmarket` | 上游用 `^0.2.0-rc.1` 范围 |

### ⚠️ 本轮最大认知增量：pnpm patch 生效 ≠ 有效

上轮给两个第三方插件打的补丁把 peer 改成 `"^0.1.5-rc.3 || 0.2.0-rc.1"`。
本轮 `pnpm install` **补丁依然成功应用（零报错）**，但补出来的声明只认 `0.2.0-rc.1`
⇒ **补丁应用成功却已无意义**。

教训：**pnpm patch 是按行匹配的文本 diff，补丁内容里的版本号不会随运行时演进**。
升级 DSH 后必须**复查补丁内容**，而不只是复查补丁是否还在清单里。
补丁应始终当作临时桥接——上游改用范围声明（如 `dsh-cost-meter` / `dshmarket` 那样）后
即可删补丁回到真实声明。

### 修复动作（按优先级）

1. **omdp 三个插件**：peer 声明**改用三元组区间 `>=0.2.0-rc.1 <0.2.1-0`**
   （connector `0.3.7→0.3.8`、archived-sessions `0.3.8→0.3.9`、key-fallback `3.3.1→3.3.2`；
   key-fallback 要同步四条：dsh / credentials / llm / settings），发版并抬高 desktop profile 钉版。
   ⚠️ 不采用「枚举追加 `|| 0.2.0-rc.2`」——那只是把下一次 rc 的故障推迟，本轮已是第三次。
2. **两个失效补丁**：内容改为 `>=0.2.0-rc.1 <0.2.1-0`（一劳永逸覆盖同三元组后续 rc）。
   ⚠️ **上界必须带 `-0`**：写 `<0.2.1` 会漏放行 `0.2.1-rc.1`
   （`satisfies("0.2.1-rc.1", ">=0.2.0-rc.1 <0.2.1")` 实测为 **true**）。
3. `dsh-watcher`：等上游 `0.7.0`（已原生声明 `>=0.2.0-rc.1 <0.2.1`）后抬钉版即可，无需补丁。
4. `dsh-cost-meter` / `dshmarket` / `vision-bridge` / `craft-bot`：**无需动作**。

### 处理结果（2026-09-30）

三个本仓库插件已改为三元组区间并**发布新版本**：

| 插件 | 新版本 | 新声明 |
|---|---|---|
| `@omdp/dsh-connector` | `0.3.8` | `>=0.2.0-rc.1 <0.2.1-0` |
| `@omdp/dsh-archived-sessions` | `0.3.9` | `>=0.2.0-rc.1 <0.2.1-0` |
| `@omdp/dsh-key-fallback` | `3.3.2` | 四条 dsh peer 均为 `>=0.2.0-rc.1 <0.2.1-0` |

`@omdp/dsh-vision-bridge` 无 dsh peer ⇒ 不受门禁影响，无需改动。
三个第三方插件（`dsh-client-auto-continue` / `dsh-watcher` / `browser-skill-dsh-plugin`）
由用户自行处理（补丁方案见下文「第三方插件」节）。

### 可复用要点

1. **诊断顺序**：设置项消失 + 路由 404/405 ⇒ 先看 stderr 的 `skipping profile bundle` /
   `disabling profile plugin`（rc.2 两种措辞都出现过），**先怀疑门禁**。
2. **同三元组的预发布升级，范围声明免疫、精确枚举必须追加**——据此可预判谁会炸。
   本仓库自 2026-09-30 起统一改用三元组区间（`AGENTS.md` 规范 3），上界必须带 `-0`。
3. **每次升 DSH 都要复查 pnpm patch 的内容**，不只是它是否还在。
4. **优先等上游原生修复**（范围声明），补丁只作临时手段。
5. **`dsh-client-runtime` 这个包不存在**，别在依赖里引用它。
6. 自检仍用**隔离 `DSH_HOME` 的副本 profile**（`desktop` 是保留名，rc.2 起 npm CLI
   连 plugin-management 都拒绝）。

## 总体结论

1. **活跃插件都不会导致 DSH 崩溃**——这是共同的硬保证（架构设计使然）；`0.1.7` 的门禁机制同样只"跳过 bundle"而非崩溃。
2. **最坏情况**：DSH 大版本更新后，某个插件功能不可用/降级，需适配更新插件版本（不是 DSH 的问题）。
3. **相互隔离**：任一插件失效，不影响其他插件和 DSH 本体。
4. **建议**：DSH 大版本升级后，逐个验证活跃插件（connector API、vision-bridge 识图、key-fallback），
   有问题就更新对应插件版本。
5. **本仓库现状**：`0.2.0` 线（rc.1 → rc.2）适配已全部落地，三个插件**声明改用三元组区间**
   `>=0.2.0-rc.1 <0.2.1-0` —— 同三元组后续 rc 与正式版 `0.2.0` **不再需要改声明/重发包**：
   `connector` **v0.3.8**（jsdom 懒加载修 import 崩溃 + 工具过滤迁 volatile `Config` + 遗留过滤救援 +
   声明 DSH peer + CRLF 解析与 `profileContext` 补丁路径修复）、
   `key-fallback` **v3.3.2**（双后端 + 遗留池救援 + **`credentials.resolve` 包装切换 key，自 v3.0.0 生效，
   实机 200 条 diag 佐证**）、
   `archived-sessions` **v0.3.9**（`ctx.shell` 契约**双时代自适应**修删除失效）；
   `vision-bridge` v0.1.12 无改动（也无 dsh peer）。
   ⚠️ 本轮共识（2026-09-30）：三个插件**只承诺 `0.2.0` 线**，`0.1.7` 线不再声明——
   需要在 0.1.7 上运行请用 connector `0.3.7` / key-fallback `3.3.1` / archived-sessions `0.3.8`。
   ⚠️ 注意 cron：**抽象服务的「新增方法」兼容、「移除方法」不兼容**（`ctx.shell` 的 `run`→`execute` 是典型：
   改名而非别名），以及**宿主解析器缺陷会在插件 import 期放大**——这两类都不体现在 `.d.ts` 的
   「删除行」比对里，需靠真实运行时报错定位。另一类盲区是**版本相关的新机制**：`evaluatePluginCompatibility`
   仅存在于 `0.1.7+`，比较「相邻版本」的 diff **无法**发现它的引入，只有跨版本存在性扫描（逐版解包统计符号命中）
   才能定界。
6. **发布与生效**：本仓库的插件由 GitHub Actions 在 `v*` tag 推送时自动发包（见 `docs/npm-publish.md`）；
   **仓库改动不会影响在跑的系统**——必须先把版本发到 registry、再把 profile 钉版抬高并 `pnpm install`，
   然后重启 DSH。用手工拷贝覆盖 `node_modules` 里的文件是**不可靠**的：DSH 启动会跑 `pnpm install`，
   pnpm 会按 `pnpm-lock.yaml` 把文件**还原回旧版本**（本轮实测踩过这个坑）。
7. **第三方插件（非本仓库维护）**：声明跟不上时，**不要在 `node_modules` 里就地改**（详见上文
   「第三方插件：门禁拦截与持久修复」）——用 `pnpm patch` + `patchedDependencies`，key 用 range。
   这是临时桥接：上游发版修好声明后应删除补丁、回到真实声明。
8. **本仓库自己的声明用三元组区间**（2026-09-30 起，`AGENTS.md` 规范 3）：
   `>=0.2.0-rc.1 <0.2.1-0` 这类写法让同三元组的后续 rc 与正式版**自动放行**，
   不必每发一版就改声明 + 重发包——本轮之前已因此连续踩三轮。
   上界**必须**带 `-0`。

## 桌面 profile 本次落地内容（2026-09-28）

`C:\Users\xj\.dsh\profiles\desktop`：

| 项目 | 变更 |
|---|---|
| `package.json` | `@omdp/dsh-connector` `0.3.6`→`^0.3.7`、`@omdp/dsh-key-fallback` `^3.2.3`→`^3.2.4`、`@omdp/dsh-archived-sessions` `0.3.7`→`^0.3.8` |
| `pnpm-workspace.yaml` | 新增 `patchedDependencies`（6 个第三方插件补丁，key 用 range） |
| `patches/` | 新建，6 个 `.patch` |
| 备份 | `package.json.bak-020rc1-20260928-220049`、`pnpm-workspace.yaml.bak-020rc1-…`、`pnpm-lock.yaml.bak-020rc1-…` |

门禁复核结果：**11 个 bundle 全部放行，0 拦截**（其中 vision-bridge / craft-bot 无 dsh peer）。
⚠️ 需**重启 DSH** 才会重新装配；重启前实测端点：connector `/connector/api/mcp` → 404、
key-fallback `/dsh-key-fallback/pools` → 404、archived `POST /dsh-archived/list` → 405、
vision `/vision-bridge/capabilities` → **200**（与"只有视觉插件和预设不异常"的现象完全吻合）。
