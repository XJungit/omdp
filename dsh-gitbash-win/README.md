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

## License

MIT
