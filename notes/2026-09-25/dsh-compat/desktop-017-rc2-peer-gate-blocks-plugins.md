# DSH 桌面版 0.1.7-rc.2：精确 rc 枚举一夜过时，插件列表集体「异常」

- 日期：2026-09-25
- 分类：dsh-compat
- 影响：`@omdp/dsh-connector` 0.3.4 / `@omdp/dsh-key-fallback` 3.2.2 / `@omdp/dsh-archived-sessions` 0.3.6（以及第三方 `dsh-bridge` 0.2.0）

## 背景 / 问题

用户从 web profile 切到 **DSH 桌面版**（DeepSeek Harness desktop，`D:\DeepSeek Harness`，
profile = `~/.dsh/profiles/desktop`）后，插件列表里四个插件全部显示红色「异常」徽标。
此前 web profile（`dsh@0.1.7-rc.1`）上同一批版本一切正常。

## 根因

1. **桌面版运行时是 `0.1.7-rc.2`**，不是 web profile 的 `0.1.7-rc.1`：
   - `D:\DeepSeek Harness\resources\runtime\primary-runtime\runtime.json` → `"desktopVersion": "0.1.7-rc.2"`
   - `DeepSeek Harness.exe` 的 `FileVersion` = `0.1.7-rc.2`
2. 三个 @omdp 插件的 peer 声明是**精确枚举 `0.1.7-rc.1`**（AGENTS.md 规范 3 的要求）。
   semver 语义：`satisfies('0.1.7-rc.2', '0.1.7-rc.1', {includePrerelease:true})` = **false**
   （prerelease 只匹配同 `[major,minor,patch]` 三元组内的精确 prerelease，rc.1 ≠ rc.2）。
3. 于是 `dsh-app-boot@rc.2` 的 `evaluatePluginCompatibility()` 在**安装时**（`.plugin-manager/logs/*/pnpm.log`：
   `incompatible with dsh 0.1.7-rc.2: peerDependencies {...}` → `it stays installed but profile startup denies it`）
   和**启动时**（stderr：`skipping profile bundle "..."`）双双拒绝 → bundle 不加载 →
   UI 徽标「异常」（`dsh-client-ui-plugin-manager` 的 `statusProblem`/`rowPhaseFailed` 文案，
   含义 = **bundle 激活失败**，不是「需要重启」）。

「异常」徽标的语义定位过程：在 `dsh-client-ui-plugin-manager/lib/client.js` 里 grep
`异常`（U+5F02 U+5E38）→ `statusProblem: "异常"`、`rowPhaseFailed: "异常"`——即**组件加载失败**。

## 排查路径（可复用）

1. 看进程：`DeepSeek Harness.exe --expose-internals ...dsh-desktop-host/lib/index.js ... C:\Users\xj\.dsh\profiles\desktop`
   → 桌面版用的是 `desktop` profile（不是 `web`）。
2. 桌面版日志不在 `~/.dsh/logs`（那是 web CLI 的），**安装期判定**在
   `~/.dsh/profiles/desktop/.plugin-manager/logs/<operation>/pnpm.log` 里（`dsh:` 前缀的 warning 行）。
3. 端口：桌面版监听 `127.0.0.1:19387`（非 3080），带 401 鉴权，插件路由 404/405 是鉴权前表象，
   不能用来判断插件死活；**直接读日志最可靠**。

## 核查 + 修复（按规范 3 流程）

「追加枚举」的前提是核查，三步：

1. **tarball 逐文件 diff（rc.1 → rc.2）**：`npm pack <pkg>@<ver>` + `git diff --no-index`。
   结论：`dsh-shell` / `dsh-settings` / `dsh-credentials` 的 `lib/` **逐字节零变化**（仅 README/package.json）；
   `dsh-llm` 仅新增（tool-update projection、`ACCOUNT_QUOTA` 错误码，既有签名未动）；
   `dsh-app-boot` 的变更全部与插件无关（`skippedBundles` 诊断重构、`generateConfigSchema` 内部签名、
   `replaceErrorMessage` 提取），`evaluatePluginCompatibility` 逻辑未变且仍是公开导出。
2. **门禁执行**：用 rc.2 的 `dsh-app-boot` 跑新 manifest → `undefined`（放行），
   且 rc.1 门禁对同一 manifest 也放行（双向）。
3. **真机回归**：scratch profile（`~/.dsh/profiles/rc2test`）装 `dsh@0.1.7-rc.2` + 三个插件，
   用 `dsh plugin --profile rc2test allow-version <pkg@ver> --dsh-version 0.1.7-rc.2 --accept-risk`
   写 `compatibility.json` 豁免后启动。实测：三插件激活、connector 过滤端点 200、
   **archived-sessions 真机删除全链路成功**（`POST /dsh-archived/delete` → `{"ok":true,"deleted":true}`，
   磁盘目录消失、`archivedSessionIds` 清空、list 回空；测试会话从备份还原）。

然后：三插件各 bump 一个 patch 版本（0.3.5 / 3.2.3 / 0.3.7），把 `0.1.7-rc.2` 追加进
`@deepseek-ai/dsh`（key-fallback 另含 credentials/llm/settings）的 `||` 枚举，同步文档。

## 可复用要点

- **`0.1.7-rc.1` 这类精确 rc 枚举的保质期 = 下一个 rc 发布之前**。rc 版本号没有 range 语义，
  每个新 rc 都要对声明了 `@deepseek-ai/dsh` peer 的插件走一遍「diff → 门禁 → 回归 → 追加」。
- 桌面版 runtime 版本三处可查：`runtime.json` 的 `desktopVersion`、exe `FileVersion`、
  `resources/app.asar` 的 `package.json`（asar 解析麻烦，前两处更快）。
- scratch profile 回归的最小配方：`package.json`（`dependencies` + `dsh.profile.bundles`
  **必须**列全 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与各插件，否则插件 pending
  等不到 webServer/settings 服务）+ `pnpm-workspace.yaml`（`nodeLinker: hoisted`、
  `autoInstallPeers: false`、`minimumReleaseAge: 0`、`allowBuilds`）+ `.npmrc`（registry）。
- `allow-version` 豁免写在 `profiles/<p>/compatibility.json`：`{ "<pkg>@<ver>": ["<dsh-ver>"] }`。
- `dsh` CLI 参数顺序坑：`dsh --profile <p> web --port <n>` 里 `web` 是**默认 app 的别名**，
  写成 `--profile <p> --no-open --port <n>`（不带 `web`）也能起；但 `web --profile` 会报
  `select a profile only once`、`--profile <p> web` 在部分版本报 `too many arguments`——
  以 `node <dsh>/lib/bin.js --profile <p> <app> <app-args>` 且 app 放 `--profile` 之后为准。
- 删除测试的安全姿势：先把会话目录 `Copy-Item -Recurse` 到 `%TEMP%` 备份 → API 删除 →
  验证磁盘/归档集合 → `Copy-Item` 还原原路径。
