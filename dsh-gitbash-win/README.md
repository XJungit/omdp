# @omdp/dsh-gitbash-win

DSH (DeepSeek Harness) 全局 Git Bash 工具插件（Windows）。

注册一个全局 `gitbash` 工具：通过 Git for Windows 的 `bash.exe`（`bash -c`）执行命令，
让模型在 Windows 上获得真正的 POSIX shell —— 无需 WSL、无需 node-pty、轻量无负担。

> Windows 上推荐使用 Git Bash：提供标准的 grep/sed/awk/管道/通配符等 POSIX 环境，
> 模型在这种环境下训练效果更好（对齐 Unix 语义，可迁移到 Linux/macOS）。

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

## License

MIT
