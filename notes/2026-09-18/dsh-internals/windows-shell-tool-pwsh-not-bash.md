# Windows 上 DSH 只给模型 `pwsh`，不给 `bash`——是设计选择，不是环境缺依赖

## 背景 / 问题

在给 9router 的 OpenCode Zen 免费层打补丁时，Zen 的门禁要求请求体
`tools` 里必须**声明** `read` 和 `bash` 两个工具名。而 DSH 在 Windows 上
暴露给模型的 shell 工具叫 **`pwsh`**，没有 `bash`。于是产生两个必须分清的问题：

1. DSH 在 Windows 上**是不是**只有 `pwsh` 可用？
2. 如果是，能不能把 `bash` 接回来？本机 `bash` 到底存不存在？

猜这两件事会导致很不一样的结论，所以直接读源码 + 实测环境。

## 结论

### 1. 对模型可见的工具名：是的，Windows 上只有 `pwsh`

`@deepseek-ai/dsh-base/cordis.patch.yml` L246-252 **硬编码**了互斥开关：

```yaml
    - id: tool-bash
      name: '@deepseek-ai/dsh-tool-bash'
      disabled: !!js process.platform === 'win32'      # Windows 上关闭

    - id: tool-pwsh
      name: '@deepseek-ai/dsh-tool-pwsh'
      disabled: !!js process.platform !== 'win32'      # 非 Windows 上关闭
```

`dsh-base` 的 `package.json` **同时依赖** `dsh-tool-bash` 和 `dsh-tool-pwsh`，
装不装不是问题——是 patch 层按平台决定启用哪个。

### 2. 这不是"多装一个就行"：`ctx.shell` 是**单实现**接缝

`@deepseek-ai/dsh-shell/lib/index.js` L55-62 注释写得很明确：

> a host composes **exactly one** provider of `ctx.shell` (the win32 layer
> **swaps** the POSIX rows for the pwsh ones, and **mounting both fails loud on a
> duplicate service registration**)

即：win32 层是把 POSIX 那几行**换掉**，不是**追加**。想同时挂
`dsh-bash-sandbox` + `dsh-pwsh-sandbox` 会因为重复 service 注册直接报错。
配套的 sandbox 行（L214-222）也是同一组互斥开关：

```yaml
    - id: bash-sandbox
      name: '@deepseek-ai/dsh-bash-sandbox'
      disabled: !!js process.platform === 'win32'
    - id: pwsh-sandbox
      name: '@deepseek-ai/dsh-pwsh-sandbox'
      disabled: !!js process.platform !== 'win32'
```

### 3. 但本机 `bash` **确实存在且可用**——别被 System32 误导

```powershell
Get-Command bash        # -> C:\Windows\System32\bash.exe   ← WSL 桩，无发行版，报错
& "C:\Program Files\Git\bin\bash.exe" -c 'echo $BASH_VERSION'
                        # -> 5.3.15(1)-release             ← Git Bash，真的能跑
```

- `C:\Windows\System32\bash.exe`：WSL 启动桩，本机未装发行版，执行即报
  "适用于 Linux 的 Windows 子系统没有已安装的分发"。
- `C:\Program Files\Git\bin\bash.exe`：**Git Bash 5.3.15，工作正常**，
  且 `C:\Program Files\Git\bin` 已在 `PATH` 上。
- `dsh-bash-local` 是以 `bash -c` 的**显式 argv** 执行的（源码注释 L7），
  默认按 `PATH` 解析 `bash`。

**所以"不能给模型 bash"的原因不是缺 bash，而是 DSH 平台层主动关掉了这个工具。**

### 4. 想接回来在技术上可行，但代价是"用 bash 换掉 pwsh"

要改 `dsh-base` 的 patch 把两条 `disabled` 反过来，并且**必须同时关掉 pwsh**
（单实现约束）。再加 `dsh-bash-sandbox` 自带 POSIX 假设、沙箱语义在 Windows
上不成立。净效果是**牺牲 Windows 原生 shell 体验去换一个 Git Bash**，不划算。

## 对 9router Zen 补丁的含义

Zen 门禁要求 `tools` 里**声明** `bash`。补丁注入的 `bash` 是**纯指纹声明**
（空 `parameters`、无实现），**不需要本机真的有 bash，也不该被真正调用**。
这个「不该被调用」是**实测**过的，不是想当然：

`tools/9router-fix/probes/probe-injected-tool-vs-real.cjs` 三种场景对比：

| 场景 | 模型选中空壳/别名 `bash` 的次数 |
|---|---|
| **A. 真实 DSH 工具集 + 空壳 `bash`**（生产情形） | **0/4**（全选有真实 schema 的 `pwsh` / `glob`） |
| B. 真实工具集 + 空壳 `read` 与 `bash`（手工造重名） | 0/4，但整批 **400**：重名被上游拒 |
| C. 真实工具集 + 把 `pwsh` **别名为** `bash`（真实 schema） | 2/4 选 `bash` |

- **A 行是生产情形**：真实调用方（DSH 等）永远会带上自己的工具集，
  模型在"有真实 schema 的 `pwsh`"与"空壳 `bash`"之间**一致地选前者**，
  所以空壳基本不会被选中，回传未知工具调用的风险极低。
- **反例警示**：`probe-injected-tool-usage.cjs` 里**只**给空壳 read/bash 时，
  模型 **3/3** 会调用它们。所以"空壳安全"这个结论**只在真实工具集在场时成立**，
  不能推广到"调用方不带工具"的路径。幸运的是调用方不带工具时，
  调用方自己也拿不到工具调用（它没声明过工具），影响面小。
- **B 行暴露了一个真实失败模式**：**重复工具名上游返回 400**（不是 403）。
  所以补丁的去重逻辑必须同时识别 nested（chat）和 flat（responses）
  两种工具形状，否则会追加出第二份 `read`/`bash` 而整批失败。
  已固化进 `verify-opencode-freetier.cjs` 的 B 层断言。

## 可复用要点

- **"某工具在平台 A 上不可用"要先分清是三层里的哪一层**：
  ① 环境缺依赖（命令不存在）、② 平台层主动禁用（patch 的 `disabled` 表达式）、
  ③ 能力接缝不允许（单实现 service）。本次是 ②+③，不是 ①——
  用 `Get-Command` 判断环境会得出完全错误的结论。
- **`ctx.shell` 这类 capability seam 是"单实现"语义**：看到
  `extends Service / super(ctx, "xxx")` 的抽象基类，先假设同 context 只能挂一个，
  别指望"再加一个 provider"。
- **查"谁提供能力"不要只搜 `.yml`**：`dsh-bash-local` / `dsh-pwsh-local`
  在整个 `@deepseek-ai/dsh` 包树里**搜不到引用**（由 CLI 宿主层装配），
  只按 bundle patch 找会漏。最终结论靠 `dsh-shell` 的
  "exactly one provider" 契约注释 + 平台 `disabled` 开关共同确定。
- **别被 `C:\Windows\System32\bash.exe` 骗了**：它是 WSL 桩；
  判断"Windows 上有没有 bash"要试 Git Bash（`C:\Program Files\Git\bin\bash.exe`）。
- 相关文件：
  - `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-base\cordis.patch.yml` L214-252
  - `...\@deepseek-ai\dsh-shell\lib\index.js` L50-70
  - `...\@deepseek-ai\dsh-tool-bash\lib\index.js`（`toolName: "bash"` / `name: "bash"`，无平台门禁）
  - `...\@deepseek-ai\dsh-bash-local\lib\index.js`（`bash -c` 显式 argv）
- 相关笔记：`notes/2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md`
