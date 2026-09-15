# DSH 0.1.6-alpha.1 兼容性核查（首次引入运行时冒烟 + 发现 slot id 撞名冲突）

日期：2026-09-15 ｜ 分类：dsh-compat ｜ 结论：**connector / vision-bridge 零改动兼容；key-fallback 追加 peer 枚举 → 3.1.7；archived-sessions 撞原生 slot id → 修复 → 0.3.4**（同日补声明 **0.1.5-rc.2**，见文末）

## 版本双查

- GitHub：tag `dsh-v0.1.6-alpha.1`，Pre-release，published 2026-09-15T04:57:57Z；
- npm dist-tags：`latest=0.1.5-rc.1`、`next=0.1.5-rc.2`、`alpha=0.1.6-alpha.1`。
- 基线：本机全局安装的 **0.1.5-rc.2**（上次 rc.1 核查后官方又发了 rc.2；本次以 rc.2 为"最近已运行版本"做 diff，声明链沿用已核查的 rc.1）。
- cordis 仍 `4.0.2`、schemastery 仍 `3.18.2`（connector / key-fallback 的这两项 peer 枚举无需动作）。
- alpha.1 的依赖变化：新增 `dsh-mcp-resources`、`dsh-workflow-ptc`，移除 `dsh-workflow-worker-thread`；`node-addon-require-builtin` 0.1.4→0.1.6。

## 方法论（本轮升级：源码级 + 真实运行时冒烟）

1. 逐包 `npm pack @deepseek-ai/<pkg>@{0.1.5-rc.2,0.1.6-alpha.1}` → 解包 → **逐文件 SHA256 比对**，`.d.ts` 再做**删除行比对**（删除=破坏信号，新增=附加信号）；
2. 对照 release notes 逐条 breaking change 排除（用不用得到）；
3. **新增**：`.compat-check\runtime\` 里 `npm i @deepseek-ai/dsh@0.1.6-alpha.1`，手工搭 `DSH_HOME` + profile（bundles + `--legacy-peer-deps` 安装的发布版插件），起 `dsh --profile <name> --no-open --port <n>`，**Playwright 实测浏览器端**（console 错误、设置页渲染、路由响应）。

踩坑记录（冒烟环境）：

- **安装包无 `package/` 包装层**：首次哈希比对全 0 命中，因为 `npm i` 落地是 `<pkg>/lib/...` 而 `npm pack` 解包是 `package/lib/...`——两条路径基准不同，比对前必须统一；
- **PowerShell 变量尾缀拼接**：`"$new\dsh-x"` 里 `$new` 以 `x-` 结尾时路径重复，改用字符串 `"$new`pkg"` 显式拼接；
- **带 token 的 URL 不能用 curl 类命令访问**（触发 harness 的凭据外传防护直接拒绝）；浏览器导航访问 `127.0.0.1:<port>/?token=…` 是正常路径；
- **首次进入新版 Web UI 有「内测声明」对话框**，遮罩层（`aria-hidden` mask）会吞掉对侧栏按钮的点击——先点「继续」再操作；
- profile 的 `bundles` 必须手工给全（`dsh-base` + `dsh-web-app` + 所需服务包），照抄真实 web profile 是最快路径；插件加载链路 = package.json `dsh.bundle.patch` → cordis patch 行插入（`--dump-config --profile <p>` 可直接验证行是否入树）。

## 源码级结论（rc.2 → alpha.1）

**逐字节一致**：`dsh-host-webserver`（lib+types，四插件共同硬依赖 `webServer.register`）、`dsh-credentials`、`dsh-settings`、`dsh-fs`、`dsh-session` 的 `request-header.d.ts/.js`（vision-bridge 路由判定核心）。

**附加/无关删除**（全部在插件调用面之外，逐项核实）：

- `dsh-llm`：删 `priceImages`、`projectImagesForTextModel`/request-image-offload 系列、`AssistantProvenance`——插件用的 `registerAdapter/stream/listModels/listProviders/listConfigurableProviders/resolveModelInfo/inputModalities` 全保留；
- `dsh-attachment`：删 `readImageRequest`（未用）；`readImage/saveImages/saveImage/fileHostPath` 保留；
- `dsh-shell`：`start()` 改异步可取消（未用）；`resolve/run` 抽象签名一字未变；
- `dsh-agent-loop`：`.d.ts` 零删除行；`agent/request`、`agent/request-error`、`agent/pre-step`、`llm/adapters-updated` 全在；`agent/session-start` 在 dsh-agent 侧被 `agent/created` 取代（未用）；
- `dsh-mcp-client`：MCP SDK 升 v2（协议 2025-06-18，`server-context.d.ts` 新增）；connector 生成的行键 `name/transport/stdio/streamable-http/serverName/command/args/env/url/headers/toolCallTimeoutMs` 全部保留；
- `dsh-session-persistence`/`-jsonl`：`list()` 快照形状不变；**jsonl 路径相关字面量集合零增删**（`encodeSegment`、`session-` 前缀——archived-sessions 的自解析路径继续有效）；
- `dsh-workspace`：`archivedSessionIds`/`setState` 保留；`dsh-session-query`：`readTitleSnapshots`/`readSession` 保留（注意归档详情仍走 `query.readSession(id)`，不是 `persistence.read()`）；
- client 面：`settings.section` slot 保留；combo bundle 服务 `/plugins/??ids&rev=` 逻辑逐字一致（**不带 rev 的裸 combo 404 是设计行为，新旧相同**，排查时别误判）；conversation bundle 仍有 `data-composer-input`/`__lexicalEditor`/`contenteditable`。

## 🔴 唯一实际不兼容：archived-sessions slot id 撞名（运行时二分定位）

- 症状：全量四插件 profile 启动后**整个 Web UI 变成「Failed to load plugins」拦截页**，console 报 `web boot: 1 entry did not activate @deepseek-ai/dsh-client-ui-settings-unarchive-sessions: failed`。
- 定位：插件子集二分——裸 profile 零错误 → 去掉 archived-sessions 的三插件零错误 → 单加 archived-sessions 复现 → 根因是 **DSH 0.1.6 在 web-app 内置了原生「已归档会话」设置页**（本次新功能），它在 `settings.section` 槽位注册的 id 恰好也是 `archived-sessions`（order 25），与本插件（order 30）同名撞 slot。
- 关键教训：**抗崩溃架构对 client 槽位冲突不成立**——host 侧可选注入能保证"最坏功能降级"，但 client slot `register` 撞名会让宿主 boot 聚合处直接失败，爆炸半径是整页 UI。第三方插件的全局 slot id **必须带自己的命名空间前缀**。
- 修复（0.3.4）：本插件 slot id → `omdp-archived-sessions`、导航标签 → 「归档会话管理」，与原生项共存（原生只有查看+恢复；删除/按树删除/孤儿清理仍是本插件差异化能力）。
- 复验（0.3.4 本地 tarball 安装）：四插件 + 原生共存启动，**浏览器 console 零错误**，设置导航出现 已归档会话(原生) / 归档会话管理(本插件) / Connector 连接器 / API Key 回退 四项，插件设置页端到端取数正常（"0 个会话 · 共 0 B"，冒烟 HOME 本来就没归档）。

## 活体缺口（未做，留待后续）

1. vision-bridge 的**浏览器粘贴/拖拽路径**未在 0.1.6-alpha.1 活体验证（composer 加号菜单/附件按钮在 0.1.6 有重排；插入依赖的 Lexical 宿主标记俱在，源码级判定低风险）——升级日常 profile 后顺手粘一张图确认；
2. key-fallback 的 `agent/request-error` 真实坏 key 轮换未注入验证（事件与载荷源码级一致，低风险）；
3. 原生「已归档会话」页与本插件页的**行为互斥性**未深测（两边同时操作同一会话的归档集合刷新时序）。

## 官方变更中与插件用户相关的提醒

- **DeepSeek 官方 API 默认切到 Messages 协议**：曾为规避旧默认把自定义 `baseUrl` 改成旧官方根地址的用户需要删除或改 `https://api.deepseek.com/anthropic`（vision-bridge 用户若手配过 deepseek 官方 provider 会受影响；默认 Agnes 中转不受）；
- request 图片缓存迁移到 `DSH_HOME/cache/attachments/request-images`（服务内部，插件用自己的缓存目录，不受影响）。

## 动作清单（随本笔记同一提交）

- `dsh-archived-sessions`：`lib/client.js` slot id/label 修复，`0.3.3 → 0.3.4`，README 双语同步；
- `dsh-key-fallback`：credentials/llm/settings peer 枚举追加 `0.1.6-alpha.1`，`3.1.6 → 3.1.7`，README 双语新增 v3.1.7 段；
- `dsh-connector` / `dsh-vision-bridge`：无代码/peer 动作（无 DSH 包 peer 枚举），README 记录实测结论，connector README 版本号头修正 `v0.3.0 → v0.3.2`；
- 根 `README.md`：版本列表/安装示例/目录树同步（key-fallback `^3.1.7`、archived-sessions `^0.3.4`、发布示例 tag `v3.1.7`）；
- `docs/plugin-compatibility.md`：新增 0.1.6-alpha.1 结论块、§2/§4/§5 标题版本、撞名风险条目、汇总表；
- `.gitignore`：忽略 `.compat-check/`（可再生核查暂存，含 dsh 旧版本 tarball 与冒烟运行时）；
- npm 发布（`v3.1.7`/`v0.3.4` tag + CI）：未执行，按 `docs/npm-publish.md` 由维护者决定时点。

## 可复用命令

```powershell
# 逐文件哈希比对两个版本（安装包路径无 package/ 包装层，解包对比要统一基准）
$a="<new>\x-<pkg>\package"; $b="<old>\x-<pkg>\package"
gi -Recurse -File "$a\lib","$a\*.d.ts" | %{ $h=Get-FileHash "$($_.FullName)" -Algorithm SHA256
  $r=Join-Path $b $_.FullName.Substring($a.Length+1)
  if(Test-Path $r){ if((Get-FileHash $r -Algorithm SHA256).Hash -eq $h.Hash){"same: $($_.Name)"}else{"DIFF: $($_.Name)"} } else {"ONLY-NEW: $($_.Name)"} }

# .d.ts 删除行（破坏信号）：
Compare-Object (gi "$a\lib\index.d.ts" | gc) (gi "$b\lib\index.d.ts" | gc) | ? SideIndicator -eq '<='

# 真实运行时冒烟（临时 DSH_HOME + 手工 profile，不碰用户 ~/.dsh）：
mkdir .compat-check\runtime; npm i @deepseek-ai/dsh@0.1.6-alpha.1 --prefix ...
# profile: bundles=[dsh-base,dsh-web-app,...] + npm i 插件 --legacy-peer-deps
$env:DSH_HOME='...\.compat-check\smoke-home'
node <runtime>\node_modules\@deepseek-ai\dsh\lib\bin.js --profile smoke --no-open --port 779x

# 验证插件激活行入树（dsh.bundle.patch → cordis.patch.yml 机制）：
node ...\bin.js --dump-config --profile smoke | ... -match '<plugin>"'

# 本地修复版打包验证（发布前 tarball 内容核对，0.3.0 事故教训）：
npm pack --pack-destination <scratch>; tar -tzf <tgz>
```

## 补充（同日）：正式补声明 0.1.5-rc.2

用户确认需要把本机在跑的 **0.1.5-rc.2** 也正式纳入声明，并问"新版插件能否回跑 rc.2"。做法与结果：

1. **源码证据（规范 3 依据）**：`npm pack` 三对包（credentials/llm/settings @ 0.1.5-rc.1 vs rc.2）逐文件 SHA256——**除 `package.json`（版本号）外全部一致**。即 rc.2 相对已声明的 rc.1 零 API 变化；
2. **枚举并入未发布的 3.1.7**：`0.1.5-rc.2` 插进 credentials/llm/settings 三行枚举（rc.1 与 alpha.1 之间，升序）。因 3.1.7 还没打过 tag，直接改 3.1.7 本体、不另升版本——重新 `npm pack` 后 tarball 内枚举已含 rc.2（行 42-44 验证）；
3. **真实 rc.2 运行时冒烟**：`.compat-check\runtime-rc2\` 装 `dsh@0.1.5-rc.2`（518 包）；profile `smoke-home\profiles\rc2` 声明嵌套版本 pin 到 rc.2 生态（credentials/llm/settings=0.1.5-rc.2、cordis=4.0.2、schemastery=3.18.2，均与 `runtime-rc2\node_modules` 实测版本一致），插件用 `file:` 指向 **3.1.7 + 0.3.4 修复版** tarball + 发布版 connector/vision-bridge。**严格模式 `npm install`（不加 `--legacy-peer-deps`）通过**——peer 枚举修复的最硬证明；
4. 启动（`--profile rc2 --port 7796`）+ 浏览器：console 零错误；设置页三项（归档会话管理/Connector 连接器/API Key 回退）渲染；**0.1.5 无原生「已归档会话」页、无撞名**（与预判一致——原生项是 0.1.6 才有）；归档页端到端取数 `{"items":[],"totalBytes":0}`；
5. 路由四发：`/vision-bridge/capabilities` 200、`/connector/api/mcp` 200、`/dsh-key-fallback/providers` 200（真实 provider 列表）、`/dsh-archived/list` 200。

**回答用户问题**：新插件版本（key-fallback 3.1.7 / archived-sessions 0.3.4）**在 0.1.5-rc.2 与 0.1.6-alpha.1 上双向可跑**——3.1.7 相对 3.1.6 仅动枚举零代码，0.3.4 相对 0.3.3 仅改 client 槽位 id/label（0.1.5 上该页照常工作，只是标签变「归档会话管理」）。

踩坑补记：`npm pack` 落地文件名是 `deepseek-ai-<pkg>-<full-version>.tgz`（含 `0.1.5-rc.1` 完整串），批处理里用简写 `rc1` 拼路径会 "Failed to open archive"——解包循环里的版本串必须与 pack 输出逐字一致。
