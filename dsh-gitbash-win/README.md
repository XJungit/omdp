# @omdp/dsh-gitbash-win

## Overview

DSH (DeepSeek Harness) 全局 Git Bash 工具插件（Windows）。

注册一个全局 `gitbash` 工具：通过 Git for Windows 的 `bash.exe`（`bash -c`）执行命令，
让模型在 Windows 上获得真正的 POSIX shell —— 无需 WSL、无需 node-pty、轻量无负担。

> Windows 上推荐使用 Git Bash：提供标准的 grep/sed/awk/管道/通配符等 POSIX 环境，
> 模型在这种环境下训练效果更好（对齐 Unix 语义，可迁移到 Linux/macOS）。

适合：Windows 用户想让 DSH 模型用真正的 POSIX shell（而非 PowerShell），
且不想要 WSL / node-pty 的重量级方案。

## Quick start

```sh
# 1. 安装（npm）
dsh plugin --profile web add @omdp/dsh-gitbash-win

# 2. 确认 Git for Windows 已装（bash.exe 存在，插件自动探测）
#    C:\Program Files\Git\bin\bash.exe

# 3. 重启 dsh web
# 4. 在任意会话里，模型即可调用 gitbash 工具
```

最小可复现：安装 + 重启后，让模型执行
`gitbash(command: "echo hello from git bash", description: "Test git bash")`
→ 应返回 `hello from git bash`。

## 特性

- **全局可用**：注册为 `gitbash` 工具，与 `pwsh` 平级，任何会话/预设都能用（不需要选预设）
- **轻量**：无 node-pty、无 WSL、无额外运行时依赖（只复用 DSH 官方 seam 包）
- **沙箱感知**：受限模式走 `sandbox` provider 的 confine；被拒时给出升级提示（danger-full-access）
- **超时控制**：SIGTERM → grace → SIGKILL 进程树终止
- **输出截断**：溢出时写 spill 文件，不丢输出
- **后台任务**：`run_in_background` / `job_output` / `job_kill`
- **卡片 UI**：Web UI 里 `gitbash` 调用显示专属终端卡片

## 安装

```bash
dsh plugin --profile web add @omdp/dsh-gitbash-win
```

然后重启 `dsh web`。插件通过 `dsh.bundle`（包内 `cordis.patch.yml`）自动挂载，
无需手动改 profile 配置。

**前置依赖**：Git for Windows（提供 `bash.exe`）。安装后确认以下任一路径存在
（插件自动探测，也可用 `GIT_BASH` 环境变量指定）：

- `C:\Program Files\Git\bin\bash.exe`
- `C:\Program Files\Git\usr\bin\bash.exe`

## 卸载

```sh
# 1. 从依赖移除
dsh plugin --profile web remove @omdp/dsh-gitbash-win

# 2. 若 bundles 里还有残留，手动从 profiles/web/package.json 的 dsh.profile.bundles 删掉
```

**禁用（临时）**：从 `dsh.profile.bundles` 移除后重启（无需删包），
或在 `cordis.patch.yml` 加 `- id: tool-gitbash\n  disabled: true`。

## 使用

模型获得 `gitbash` 工具后，直接传命令即可：

```
gitbash(command: "git status", description: "Show working tree status")
```

参数：

| 参数 | 说明 |
| --- | --- |
| `command` | 要执行的 Git Bash 命令（`bash -c`） |
| `description` | 命令用途的一句话描述（界面展示用） |
| `timeoutMs` | 超时（默认 120s，上限 600s） |
| `workdir` | 工作目录，默认会话目录 |
| `run_in_background` | 后台运行，立即返回 jobId |
| `sandbox_permissions` / `justification` | 沙箱升级（配置了沙箱时可用） |

路径同时支持 Windows 原生形式（`C:\...`）与 Git Bash 形式（`/c/...`）。

## 为什么不用官方 tool-bash？

DSH 官方 `code`/`standard` 预设里，`tool-bash` 带有
`disabled: !!js process.platform === 'win32'` —— 官方在 Windows 上默认禁用了 bash
（因为 Git Bash 不在标准 PATH、PTY 不支持）。本插件把 `bash` 映射到 Git for Windows，
并去掉这个平台禁用，让 Windows 上真正能用 Git Bash。

## 配置

可选：`GIT_BASH` 环境变量指向自定义的 `bash.exe`（默认自动探测常见安装路径）。

## Troubleshooting

| 问题 | 原因 / 解决 |
|---|---|
| `Git Bash not found` | 未装 Git for Windows，或 `bash.exe` 不在常见路径。装 Git 或设 `GIT_BASH` |
| workspace-write 下报 `CreateFileMapping` / `fatal error` | **已知限制**：MSYS 运行时无法在 Windows ACL 受限令牌沙箱内启动（官方 dsh-gitbash-preset 同）。用 `sandbox_permissions: "danger-full-access"` 升级，或把会话切到完全访问 |
| 之前报 `windows-acl-run: --temp is not an existing directory` | DSH 上游 bug（Discussion #758）：手动重建同名目录即可恢复 |
| 工具不出现在模型工具列表 | bundle 未挂载：确认 `dsh.profile.bundles` 含 `@omdp/dsh-gitbash-win`，重启 dsh |
| 命令无输出 / 被截断 | 输出超 64KB 会截断并写 spill 文件，看完整输出需读 spill 路径 |

日志：DSH 启动的 stderr（profile 下 `dsh-boot.err`）。回滚：卸载/禁用（见上）。

## Permissions & data

| 数据 | 访问方式 | 说明 |
|---|---|---|
| `bash.exe`（Git for Windows） | **执行** | 每次调用 `bash -c <command>` |
| 工作区 / 指定 workdir | 读写（取决于命令） | 命令在沙箱策略下运行（受限或全权限） |
| 环境变量 | 读取 | `$DSH_*` 环境事实 + 继承的环境 |
| 沙箱 / 审批 | 调用 DSH 服务 | `ctx.sandbox` / `ctx.sandboxPolicy` / `approval` |

**不收集**：无遥测、无外部网络请求（gitbash 只执行本地命令，不联网）。
**注意**：命令**完全按模型意图执行**——沙箱/审批是唯一防线；`danger-full-access` 下命令拥有完整权限。

## Development

```sh
# 本地开发：link: 安装，改源码 → 重启 dsh 即生效
cd ~/.dsh/profiles/web
pnpm add "link:D:/WorkSpace/omdp/dsh-gitbash-win"

# 语法检查
node --check D:/WorkSpace/omdp/dsh-gitbash-win/lib/index.js
node --check D:/WorkSpace/omdp/dsh-gitbash-win/lib/client.js

# 发布（GitHub Actions 自动发包）
# 改 dsh-gitbash-win/package.json 的 version → git tag vX.Y.Z → push
```

结构：`lib/index.js`（host，动态加载 @deepseek-ai/*）/ `lib/client.js`（toolview 卡片）/ `cordis.patch.yml`。
贡献：PR 到 https://github.com/XJungit/omdp。

## 兼容性

### 架构：为抗崩溃而设计

本插件采用**三层保护**，确保 DSH 更新时**绝不导致 DSH 崩溃**：

| 层 | 做法 | 效果 |
|---|---|---|
| **顶层零依赖** | 模块顶层只 `import` Node 内置模块（`node:*`），不静态引用任何 `@deepseek-ai/*` | DSH 怎么更新都不会在**加载阶段**失败 |
| **动态加载依赖** | 所有 `@deepseek-ai/*` 在 `apply()` 内 `await import()` 按序加载 | 依赖解析失败时**干净报错，插件不加载，DSH 照常运行** |
| **失败隔离** | 每个依赖加载都 try/catch，失败仅影响 gitbash 工具 | 单个 API 变化不会拖垮 DSH 或影响其他插件 |

### 依赖的 DSH 接口

运行时会动态使用以下 `@deepseek-ai/*` 包（均为 DSH 内部 API，版本锁定 `^0.1.0-rc.6`）：

| 包 | 用到的 API |
|---|---|
| `dsh-tools` | `defineTool` / `TOOL_ABORTED`（工具定义） |
| `dsh-sandbox` | `confine` / `approveEscalation` / `ESCALATION_TARGETS`（沙箱与权限） |
| `dsh-llm` | `HarnessError`（错误类型） |
| `dsh-shell` | `parseExitStatus`（退出码解析） |
| `dsh-timeout` | `clampTimeout` / `deadline` / `timeoutOf`（超时） |

另外通过 `ctx` 使用：`ctx.tools.register`、`ctx.subprocess.spawn`、`ctx.shellEnv.collect`、`ctx.systemPrompt.section`、`ctx.get('sandbox')` / `ctx.get('sandboxPolicy')` / `ctx.get('jobs')`。

### 兼容性结论

| 场景 | 是否会导致崩溃 |
|---|---|
| DSH 小更新 / 补丁（rc.6 → rc.7） | ✅ 不会崩（API 兼容，且失败隔离兜底） |
| DSH 大版本（0.1 → 0.2） | ✅ **DSH 不崩**；gitbash 工具可能需适配新 API（更新插件版本即可） |
| `@deepseek-ai/*` 解析失败 | ✅ 干净失败，插件不加载，DSH 正常启动 |
| 其他插件（connector / vision-bridge / undo） | ✅ 互不影响（各自独立加载） |

**一句话**：实现把"崩溃"降级为"功能不可用"——DSH 永远不会因为本插件崩溃（硬保证），最坏情况只是 gitbash 工具需要跟随 DSH 版本更新适配。已知的 Windows 沙箱问题（`dsh-sandbox-windows-acl` 的 koffi bug）为 DSH 上游问题，与本插件无关；沙箱修复后本插件自动受益（动态跟随 `ctx.sandbox` 服务）。

**最后验证**：DSH `0.1.0-rc.6`（2026-08-16）。

## License & security

MIT License。安全问题请通过 GitHub Issues 私密报告（https://github.com/XJungit/omdp/issues）。
本插件执行模型提供的任意命令——请确保沙箱/审批策略已配置（尤其 `danger-full-access` 下）。
