# DSH 0.1.7 移除 `ctx.shell.run()`：归档会话「删除」全军覆没

日期：2026-09-24
插件：`@omdp/dsh-archived-sessions`（0.3.4 → 0.3.5 → 0.3.6）

> ⚠️ **后续修正（0.3.6，同一天）**：本笔记记录的 0.3.5 修复本身**引入了反向回归**——`execute()`
> 在 `≤0.1.6` 上不存在，于是 0.3.5 在 rc.x 上每次删除都抛 `shell executor unavailable`（与 0.3.4
> 在 0.1.7 上的症状一字不差，只是挨了另一边）。真正的修法是 **0.3.6 的运行期双时代探测**：
> `execute()` 存在就走 `execute()`+`await result()`，否则回退 `run()`，两者皆无才报错。
> **只赌一代（无论新旧）都会在另一代静默失效。** 详见 §「修复（0.3.6，最终）」。

## 背景 / 问题

用户截图：归档会话页顶部红字

```
删除失败 2 个会话: session-1ec6c12c-938c-4b32-8a1c-f7a845a56473, session-a4b7daf9-acd9-4004-af1d-fdb761511908
```

即**每一个**删除请求都失败，磁盘上的会话目录原封不动。列表、释放（仅移除归档标记）都正常——
只有「删目录」这一步废了。

## 结论 / 根因

0.3.4 的 `removeDir()` 以 `typeof shell.run === 'function'` 作为前置条件：

```js
if (typeof shell.run !== 'function') throw new Error('shell executor unavailable; cannot delete from disk')
await shell.run({ ... })
```

而 DSH `0.1.7` 的 `ctx.shell`（`dsh-shell`）**只保留了三个方法**：

| 方法 | 签名 | 说明 |
|---|---|---|
| `resolve(request)` | `abstract resolve(request: ShellExecRequest): ShellExecSpec` | 归一化请求 |
| `execute(spec)` | `abstract execute(spec: ShellExecSpec): Promise<ShellExecution>` | 执行 |
| — | `ShellExecution extends ShellProcess`，附 `result(): Promise<ShellRunResult>` | 取结果 |

`ShellRunResult = { exitCode, signal, timedOut, aborted, timeoutMs, stdout, stderr, sandbox? }`，
`CollectedOutput = { text, truncated, spillPath? }`。

**`run()` 在整个 0.1.7 里已不存在**（全仓 grep 零命中）⇒ 前置检查必失败 ⇒ 在碰磁盘之前就抛
「shell executor unavailable」⇒ 每个删除都进 `failedIds`，于是 UI 报「删除失败 N 个会话: …」。

## 修复（0.3.5）

改为 `resolve` → `execute` → `await execution.result()` 三步（**结果要多 await 一次**）：

```js
async function removeDir(ctx, dirPath) {
  assertSessionDirName(dirPath);                       // 安全护栏：只删 session-<uuid> / 裸 UUID
  const shell = ctx.get("shell");
  if (!shell || typeof shell.resolve !== "function" || typeof shell.execute !== "function") {
    throw new Error("shell executor unavailable; cannot delete from disk");
  }
  const request = { command, timeoutMs: 60000 };       // Windows: Remove-Item -LiteralPath ... -Recurse -Force
  const policy = dangerPolicy(ctx);
  if (policy) request.sandboxPolicy = policy;          // 沙箱策略字段名是 sandboxPolicy

  const spec = shell.resolve(request);                 // 1) 归一化
  const execution = await shell.execute(spec);         // 2) 执行
  const result = await execution.result();             // 3) 取结果 ← 关键，0.1.7 契约要求再 await 一次
  if (result && result.exitCode === 0) return;
  // 非 0 → 从 result.stderr/stdout 的 .text 里取 400 字详情，抛「删除失败 (exit N): ...」
}
```

配套（既有能力，未改）：`assertSessionDirName()` 仍拒绝非 `session-<uuid>` / 非裸 UUID 的目录名，
运行中会话仍拒绝删除，两步确认保留。失败时错误被包成「删除失败: <原因>」并逐条汇总。

## 修复（0.3.6，最终）

`execute()` 与 `run()` **两代方法名不同、且互不存在**（逐版解包 `@deepseek-ai/dsh-shell` 的
`lib/types/index.d.ts` 核对：`0.1.5-rc.1`/`0.1.5-rc.2`/`0.1.5-rc.3`/`0.1.6-alpha.1` 里
`abstract run(...)` 各 1 处、`execute` 0 处；`0.1.7-rc.1` 里 `execute` 1 处、`run` 0 处）。
最终实现改为**运行期能力探测**：

```js
const useExecute = typeof shell.execute === "function";          // 0.1.7+
const useRun = !useExecute && typeof shell.run === "function";   // ≤0.1.6
if (!useExecute && !useRun) throw new Error("shell executor unavailable; cannot delete from disk");
// …
if (useExecute) {
  const execution = await shell.execute(spec);
  result = await execution.result();     // 0.1.7 契约要求再 await 一次
} else {
  result = await shell.run(spec);        // ≤0.1.6 直接返回 ShellRunResult
}
```

要点：**探测要探测多个候选名并按可用性分流**，而不是「探测一个、缺了就报错」。
这样一份构建覆盖 `0.1.5-rc.1 → 0.1.7-rc.1` 全线，且不依赖版本号比较（不怕 backport/patch 版本）。

## 可复用要点

- ⚠️ **抽象服务「新增方法」是兼容的，「移除方法」不兼容**——这是本次最值钱的教训。
  只做 `typeof x.fn === 'function'` 存在性探测的代码，在方法被移除后会**静默走到拒绝分支**，
  表现是「功能全废但插件不崩」，最容易漏掉（抗崩溃架构在这里帮不上忙：不崩 ≠ 能用）。
- ⚠️⚠️ **改名 ≠ 别名，且「修好一边」极易打坏另一边**：本插件一天内踩了两次镜像的坑——
  0.3.4 只调 `run()`（rc.x 好、0.1.7 全废），0.3.5 只调 `execute()`（0.1.7 好、rc.x 静默回归）。
  **跨代兼容的正确姿势是能力探测 + 分流，而不是选一代方法名硬写。**
  教训的可操作形式：改动涉及「宿主抽象服务方法名」时，必须对所有**声称支持**的运行时各跑一次该功能。
- ⚠️ **「插件加载成功」不能证明「功能可用」**：这两次失效的插件都正常加载、UI 正常渲染，
  只在用户点「删除」时以红字呈现。功能面的回归必须走一次端到端路径才能发现。
- **兼容性核查不能只看 `.d.ts` 的「删除行」比对**：本次 `resolve`/`run` 的**类型声明**层面
  0.1.6→0.1.7 变化不明显（0.1.6 核查时还写过「`resolve`/`run` 抽象签名一字未变」），
  真实差异要靠**运行时**报错/方法探测定位。核查清单里应补一条：
  **对插件用到的每个服务方法做运行时 `typeof` 探测**。（0.3.6 采用的办法是**逐版解包 npm tarball
  并统计符号命中数**——这个方法同时定界了「门禁函数只存在于 0.1.7」，比读 diff 更可靠。）
- **`ctx.shell` 的两代契约要背下来**：
  - ≤0.1.6：`resolve(request) → spec`；`run(spec) → Promise<ShellRunResult>`
  - ≥0.1.7：`resolve(request) → spec`；`execute(spec) → ShellExecution`；**`await execution.result()`**
- **`ctx.fs` 不能替代**：`dsh-fs` 的 `FileSystem` 没有 remove/delete/rm/unlink
  ⇒ 删目录只能走 shell。
- **判定「删除是否真的没删」**：不要只看 UI 文案，直接 `Test-Path` 那个目录；
  再核对 `Remove-Item -LiteralPath '<path>' -Recurse -Force -ErrorAction Stop` 是否真能删
  （本机实测能删，说明权限/路径都正常，问题纯在插件调用面）。

## 相关文件

- `dsh-archived-sessions/lib/index.js`：`removeDir()`（0.3.6 双时代探测：`useExecute` / `useRun`）/
  `assertSessionDirName()` / `dangerPolicy()` / `resolveSessionLocation()` / `handleDelete()`
  （`failedIds`/`deletedIds`）
- `dsh-archived-sessions/README.md`：Requirements（`0.1.5-rc.1 / 0.1.5-rc.2 / 0.1.6-alpha.1 /
  0.1.7-rc.1`，`@deepseek-ai/dsh` + cordis `4.0.1 || 4.0.2 || 4.0.4`）+ 0.3.6/0.3.5 变更条目
- `docs/plugin-compatibility.md`：§5 风险点「`ctx.shell` 契约变更」+ 0.1.7 专项「变更 5」
- 另见：`notes/2026-09-24/dsh-internals/plugin-dsh-peer-compatibility-gate.md`（同一天发现的版本门禁）
