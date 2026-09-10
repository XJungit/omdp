# DSH 0.1.5-rc.1 兼容性核查（omdp 三插件）

日期：2026-09-10 ｜ 分类：dsh-compat ｜ 结论：**源码零改动兼容，仅 key-fallback 追加 peer 枚举 → 3.1.6**

## 背景 / 问题

用户要求核查仓库三个插件（connector / vision-bridge / key-fallback）对 **DSH 0.1.5-rc.1** 的兼容性：
不兼容就维护发新包；兼容旧版就保持兼容；若必须在旧版与新版取舍，则选新版并声明支持信息。

先确认目标版本真实存在（**releases + npm 双查**，这是 2026-09-05 立下的教训）：

- GitHub：`gh release list -R deepseek-ai/deepseek-harness` → `dsh-v0.1.5-rc.1` Pre-release，2026-09-10T03:09Z（tag `dsh-v0.1.5-rc.1`，注意 **tag 名带 `dsh-` 前缀**，`gh release view v0.1.5-rc.1` 会 "release not found"）；
- npm：`npm view @deepseek-ai/dsh dist-tags` → `latest=0.1.2-rc.1`、`next=0.1.5-rc.1`、`alpha=0.1.5-alpha.2`（本地仍装 `0.1.2-rc.1`）。

## 方法

不做整仓 diff，而是**先定位插件真实调用面，再逐包比对**：

1. 用 grep 列出三插件实际 import / inject / 调用的 DSH 面（插件不静态 import `@deepseek-ai/*` 服务包，服务全靠 `inject` + `ctx.*`，所以必须同时查源码文本与 release notes）；
2. `npm pack <pkg>@0.1.5-rc.1` 到 `%TEMP%` 解压，与本地 `0.1.2-rc.1` 安装副本做**逐文件 SHA256 比对**（旧版基线直接用本机全局安装，省一次下载）；
3. 对 git 判定为「仅 package.json 变化」的包直接结案；对 lib 有变化的包做**类型声明（`.d.ts`）diff** 与关键 API 名计数比对，判断是附加式还是破坏式。

## 结论（逐包）

| 包 | 变化 | 对本生态影响 |
|---|---|---|
| `dsh-credentials` / `dsh-settings` / `dsh-base` | **只有 `package.json` 版本号变化**（lib 逐文件哈希一致） | 服务面零变化 ✅ |
| `dsh-llm` | 附加式：新增 `lib/types/assistant-stream.js`、`FileBlock`、`fileHandleText`、`projectFilesToText`、`projectImagesForTextModel`、可选 `systemPromptUpdate` | `registerAdapter`/`stream`/`listProviders`/`listModels`/`resolveModelInfo`/`inputModalities` 全保留；`types.d.ts` diff **无删除项** ✅ |
| `dsh-tools` | 内部重构 + 事件改名 `tool/code-dispatch` → `tool/ptc-dispatch` | `register`/`guard` 保留；插件不监听该事件 ✅ |
| `dsh-attachment` | 附加式（新增文件存储半边 `saveFile`/`admitEncodedFile`） | `readImage`/`fileHostPath` 保留 ✅ |
| `dsh-system-prompt` | lib/index.js 变化 | `system-prompt/assemble` 事件保留（connector 的过滤三件套之一） ✅ |
| `dsh-agent-loop` | lib/index.js 变化 | `agent/pre-step`/`agent/request`/`agent/request-error` 保留；`preStep()` 的 `dispatch.waterfall("agent/pre-step", {messages, ...position, signal})` 语句**逐字相同**，`position` 由调用方传 `{turn, step}` ✅ |
| `dsh-web-app` | 仅 `launchedThroughSsh` 改从 `dsh-launch-environment` 导入 | `webServer.register` 未变 ✅ |
| `dsh-mcp-client` | 新增重复 cursor 防护 | connector 只生成引用它的配置 ✅ |
| client：`settings.section` slot、composer | `dsh-client-ui-settings-general`/`-plugins` 仍声明 `settings.section`；composer 仍是 Lexical（`data-composer-input` + `__lexicalEditor` 俱在） | connector/key-fallback 设置页、vision-bridge 0.1.10 粘贴修复继续有效 ✅ |

**0.1.5-rc.1 的破坏性变更（release notes「其他变更」段）全部落在本插件使用面之外**：
移除 `ctx.agent`、Inbox API 调整、Session 格式升级 V3 + `SessionHandle` 生命周期、`conversation` slot 迁移为 `main` 的 key、`tool/code-dispatch` 改名、persona 前缀/后缀拆分、默认工具调整、pi-ai 0.85.1 升级。

另外注意到：新版 DeepSeek 适配器新增 `DeepSeek-V41-Flash`（`deepseek-flash`，**支持图片**）并成为新会话默认模型；对 vision-bridge 而言这是**正常路径**——`resolveModelInfo().inputModalities` 含 `image` → 判定多模态 → 原图直进上下文、不走 bridge。新版 dsh-llm 还新增了纯文本模型的图片**占位符投影**（`projectImagesForTextModel`），与 vision-bridge 在 `agent/pre-step` 做的「图片转证据」不冲突：插件先转换 → 请求装配时已无 image 块可投影。

## 动作

- `@omdp/dsh-key-fallback` `3.1.5` → **`3.1.6`**：`dsh-credentials`/`dsh-llm`/`dsh-settings` 的 peer 枚举**追加** `0.1.5-rc.1`（旧版本全部保留，未取舍）——符合 AGENTS.md 规范 3「核查通过才追加进枚举」；
- connector / vision-bridge 无 DSH 包 peer（connector 仅 schemastery `3.18.1 || 3.18.2`、vision-bridge 无 peer），**不需要发版**，兼容结论记入 `docs/plugin-compatibility.md`；
- 文档：`dsh-key-fallback/README.md` + `README.zh-CN.md`（版本号、peer 段、新增 v3.1.6 段）、根 `README.md`（双语版本号与发布示例）、`docs/plugin-compatibility.md`（新增 0.1.5-rc.1 结论块、§4 版本、汇总表）。

## 可复用要点

- **只读 DSH 新版做兼容核查的最短路径**：`npm pack <pkg>@<ver>` 解压到 `%TEMP%` → 与全局安装的旧版副本逐文件 SHA256 比对 → 差异文件落到 `.d.ts`/关键字面判断附加 vs 破坏。比读压缩 bundle 的 `Compare-Object` 可靠得多（`.d.ts` 是语义层，`lib/*.js` 是压缩产物）。
- **「只有 package.json 变化」= 服务面零变化**，可直接结案，不必读代码。
- **release notes 的「其他变更」段比新增功能段更值得逐条过**：破坏性条目（移除 `ctx.agent`、slot 迁移、事件改名、Session 格式）都藏在那里；判断标准是「插件是否真的调用过」——用 grep 落实，不靠印象。
- 本机全局装的 DSH 版本即旧版基线，省去下载旧包；差异比对务必以 `package/` 解压根为基准，别把 tgz 文件名也算进路径。
- `gh release view` 的 tag 名要按 `gh release list` 输出原样给（本项目是 `dsh-v0.1.5-rc.1`），否则报 "release not found" 误导判断。

## 相关文件

- `dsh-key-fallback/package.json`（version + peerDependencies）
- `dsh-key-fallback/README.md` / `README.zh-CN.md`
- `README.md`、`docs/plugin-compatibility.md`
