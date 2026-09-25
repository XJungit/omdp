# @omdp/dsh-archived-sessions

> Archived-sessions manager for the DeepSeek Harness web UI — fork of [`@muwinds/dsh-archived-sessions`](https://github.com/MuWinds/dsh-archived-sessions) (0.2.0), adapted for DSH **0.1.5-rc.1** through **0.1.7-rc.2**.

DSH 归档会话管理：在 设置 → 归档会话管理 中查看、释放、删除已归档会话（支持按树删除子会话、清理孤儿会话）。自 0.3.4 起与 DSH 0.1.6 内置的「已归档会话」设置页共存、互不冲突。0.3.6 起 `ctx.shell` 双时代自适应（`run()` / `execute()`），**0.1.5-rc.1 → 0.1.7-rc.2 全区间删除可用**（0.3.7 追加 rc.2 声明）。

[English](#english) · [中文](#中文)

---

## 中文

### 这是什么

DSH 的会话可以归档（移到「归档云店」），本插件在设置页提供归档会话的管理界面：

- **列表**：标题、会话 ID、所属工作区、磁盘占用、创建时间、是否运行中；
- **释放**：把会话从归档集合移回活动列表（不删数据）；
- **删除**：从硬盘删除会话目录 + 从归档集合移除（两步确认）；
- **按树删除**：删除主会话时，其下的 subagent 子会话（`parentSession` 链）一并删除，不再留孤儿（修复上游 issue #2）；
- **孤儿清理**：一键扫描并清理「父会话已删除、自己还在盘上」的残留子会话目录；
- **详情**：展开查看会话内容（前 100 条消息）。

### 为什么有这个 fork

上游 `@muwinds/dsh-archived-sessions` 0.2.0 与 DSH **0.1.5-rc.1 不兼容**（作者已一个月未维护）：

| 症状 | 根因 |
| --- | --- |
| 归档列表全部显示「文件缺失」 | 0.1.5-rc.1 的 `sessionPersistence.list()` 返回 `SessionPersistenceSnapshot[]`（`{header, revision, eventCount?, sizeBytes?}`），不再是裸 `SessionHeader[]`；插件按旧形状取值，`header.id` 变 `undefined` |
| 「删除」和「释放」行为相同（都只移除归档标记） | 0.1.5-rc.1 抽象服务移除了 `locate(meta)`；插件 `persistence.locate(header)` 返回 `undefined` → `.path` 抛 TypeError → 被 catch 吞掉 → 走 `no-artifact` 分支，跳过删目录 |

本 fork 的修复：

1. `list()` 改为识别快照形状，从 `snapshot.header` 取值；优先用快照自带的 `sizeBytes`；
2. 不再依赖 `locate()`，改用 DSH JSONL 后端同款路径编码（`encodeSegment` / `projectKey`）自行解析会话目录，并经 `fs.resolve` 确认存在后才操作；
3. 删除前校验目录名必须是会话目录（`session-<uuid>` 或裸 UUID），**拒绝删除任何非会话路径**，杜绝误删；
4. 删除按 `parentSession` 递归收集整棵子树，连同子会话一起删 + 一起移出归档集合；
5. 新增 `/dsh-archived/orphans` 与 `/dsh-archived/sweep`：扫描/清理孤儿子会话（父会话已不在 persistence 中）。

### 安装

```bash
pnpm add @omdp/dsh-archived-sessions -w
```

> 若从 `@muwinds/dsh-archived-sessions` 迁移：先在 profile 的 package.json 中移除旧依赖（`github:MuWinds/dsh-archived-sessions`），再安装本包。旧包与新版 API 路由相同（`/dsh-archived/*`），安装后刷新页面即可。

### 要求 / Requirements

- DeepSeek Harness **0.1.5-rc.1**、**0.1.5-rc.2**、**0.1.6-alpha.1**、**0.1.7-rc.1**、**0.1.7-rc.2**（实测版本；**0.3.6 起全兼容**，0.3.7 追加 rc.2 声明，0.3.5 与 0.1.5/0.1.6 系列**静默不兼容**——见变更记录）
- `@deepseek-ai/dsh` `0.1.7-rc.1 || 0.1.7-rc.2`（peer，逐版本枚举，0.3.6 起新增、0.3.7 追加 rc.2；语义见下方「兼容性门禁」）
- `@deepseek-ai/cordis` `4.0.1` / `4.0.2` / `4.0.4`（peer，逐版本枚举）
- `@deepseek-ai/dsh-session-persistence-jsonl`（可选，随 DSH 自带；缺失时回退到内置路径编码）

### `ctx.shell` 双时代自适应（0.3.6）

删目录那一步是本插件唯一会「真正碰磁盘」的操作，而 `ctx.shell` 的契约在 DSH 0.1.7 改过名——
两侧方法名不同、且**旧方法在新版被整个移除**（解包 npm tarball 核对 `@deepseek-ai/dsh-shell` 的
`lib/types/index.d.ts`：`0.1.5-rc.1`/`0.1.5-rc.2`/`0.1.5-rc.3`/`0.1.6-alpha.1` 里
`abstract run(...)` 存在、`execute` 为 0 次；`0.1.7-rc.1` 里 `abstract execute(spec): Promise<ShellExecution>`
存在、`run` 为 0 次）：

| DSH | 调用链 | 结果 |
|---|---|---|
| ≤ `0.1.6`（rc.x / alpha） | `resolve(request) → spec` → **`run(spec) → Promise<ShellRunResult>`** | 只有 `run` |
| ≥ `0.1.7` | `resolve(request) → spec` → **`execute(spec) → ShellExecution`** → `await execution.result()` | 只有 `execute` |

所以 `removeDir()` 现在**运行期探测**：优先 `execute()`（0.1.7+），否则回退 `run()`（≤0.1.6），
两者都没有才报错。这样同一个包在整条版本线上都能删。教训：0.3.4 只调 `run()`（rc.x 可用、
0.1.7 全废），0.3.5 只调 `execute()`（0.1.7 可用、rc.x **静默失效**——`typeof shell.run !== "function"`
守卫直接抛错，被 UI 收敛成红字「删除失败」），两次都是「只赌一边」。

### 兼容性门禁（0.3.6 起声明）

0.3.6 起在 `peerDependencies` 显式声明 `"@deepseek-ai/dsh": "0.1.7-rc.1 || 0.1.7-rc.2"`（0.3.7 追加 rc.2）。
该声明由 DSH 自己的
**`evaluatePluginCompatibility()`**（`dsh-app-boot` 的公开导出）在安装与每次启动时校验：命中未实测
的新版本时会**整包优雅跳过**（stderr 打 `skipping profile bundle`，DSH 照常启动），命中实测版本
则正常加载。声明从 `0.1.7-rc.1` 起是因为**这个门禁本身是 0.1.7 才引入的**（逐版解包核对
`dsh-app-boot`：`0.1.5-rc.2`/`0.1.5-rc.3`/`0.1.6-alpha.1`/`0.1.6-alpha.2`/`0.1.7-alpha.1`/`0.1.7-alpha.2`
里 `evaluatePluginCompatibility` 出现 0 次）——旧运行时读到这条 peer
只是不认识的声明，**不影响加载**，所以老用户不会因为这条声明而失去插件。
0.3.7 追加 `0.1.7-rc.2` 的依据：rc.1→rc.2 tarball 逐文件 diff 显示 `dsh-shell`（本插件删除功能的
唯一 shell 依赖面）的 `lib/` **逐字节零变化**；再用 rc.2 的门禁跑新声明 → 放行；并在 scratch
profile（`dsh@0.1.7-rc.2` + 插件 0.3.6 + 精确版本豁免）上**真机实测完整删除链路**：
`POST /dsh-archived/delete` → `{"ok":true}` + 磁盘目录消失 + 归档集合清空。

### API

| 方法 | 请求 | 响应 |
| --- | --- | --- |
| `POST /dsh-archived/list` | `{}` | `{ items, totalBytes }` |
| `POST /dsh-archived/unarchive` | `{ sessionId }` | `{ ok, changed, archivedSessionIds }` |
| `POST /dsh-archived/delete` | `{ sessionId }` | `{ ok, deleted, sessionId, alsoDeleted[], reason? }` |
| `POST /dsh-archived/detail` | `{ sessionId }` | `{ id, createdAt, cwd, parentSession, totalEvents, messageCount, truncated, messages }` |
| `POST /dsh-archived/orphans` | `{}` | `{ items, totalBytes }` |
| `POST /dsh-archived/sweep` | `{}` | `{ removed, freedBytes, items }` |

### 变更记录

- **0.3.7**（2026-09-25）：**追加 DSH `0.1.7-rc.2` 支持**（peer 枚举 `0.1.7-rc.1 || 0.1.7-rc.2`，代码零改动）。
  背景：DSH 桌面版 0.1.7-rc.2 上线后，门禁把只声明 `0.1.7-rc.1` 的 0.3.6 拦下（插件列表「异常」）。
  核查：`dsh-shell` 的 `lib/` 在 rc.1→rc.2 **逐字节零变化**（本插件唯一 shell 依赖面）；rc.2 门禁执行
  新声明 → 放行；scratch profile（`dsh@0.1.7-rc.2` + 0.3.6 + 豁免）**真机删除实测通过**——
  `POST /dsh-archived/delete {"sessionId":"session-f71d25a2-…"}` → `{"ok":true,"deleted":true}` +
  磁盘目录消失 + `archivedSessionIds` 清空 + `list` 回 `{items:[]}`（测试会话已从备份还原）。

- **0.3.6**（2026-09-24）：**`ctx.shell` 双时代自适应 + 声明 DSH 版本支持**。
  1. **修复 0.3.5 对 rc.x 的静默回归**：0.3.5 改用 `execute()` 修好了 0.1.7，但 `run()` 在
     0.1.5/0.1.6 上才是唯一存在的方法，于是 0.3.5 在那些版本上**每次删除都抛**
     `shell executor unavailable; cannot delete from disk`（0.3.4 用 `run()` 反而是 rc.x 可用、
     0.1.7 全废）。0.3.6 改为运行期探测：优先 `execute()`（0.1.7+，需再 `await execution.result()`），
     否则回退 `run()`（≤0.1.6），两者皆无才报错 ⇒ **0.1.5-rc.1 → 0.1.7-rc.1 全区间删除可用**。
     依据：逐版解包 `@deepseek-ai/dsh-shell` 的 `lib/types/index.d.ts`（见上方「`ctx.shell` 双时代自适应」）。
  2. 新增 `@deepseek-ai/dsh` peer 声明 `0.1.7-rc.1`（逐版本枚举，语义见上方「兼容性门禁」）。
  3. 文档同步说明 0.3.5 的 rc.x 回归——避免有人把 0.3.5 当作「rc.x 也能用」的版本。

- **0.3.5**（2026-09-24）：**适配 DSH 0.1.7-rc.1 —— 修复"删除失败"**。0.1.7 的 `ctx.shell` 是「
  `resolve(request) → spec` / `execute(spec) → ShellExecution` / `execution.result()`」三件套，
  **没有 `run()`**（0.1.5/0.1.6 的 `run(spec)` 已移除）。旧代码 `removeDir()` 用
  `typeof shell.run !== "function"` 做前置检查，在 0.1.7 上必然抛出
  `shell executor unavailable; cannot delete from disk` —— 每个会话目录都在真正碰磁盘之前就被拒，
  UI 表现为红色「删除失败 N 个会话: session-…」。修复：改用 `resolve` + `execute` + `result()`；
  任一执行异常都包成明确的「删除失败」错误。同时把 peer 的 `@deepseek-ai/cordis: ^4.0.1`
  范围改为逐版本枚举 `4.0.1 || 4.0.2 || 4.0.4`（本仓库规范 3：只声明实测过的版本，不用开放范围）。
  > ⚠️ 本版的代价：`execute()` 在 0.1.5/0.1.6 上不存在 ⇒ **rc.x 上删除静默失效**，由 **0.3.6** 的
  > 双时代探测修回。
- **0.3.4**（2026-09-15）：**适配 DSH 0.1.6-alpha.1**——DSH 0.1.6 起在 web-app 内置了原生「已归档会话」设置页（`@deepseek-ai/dsh-client-ui-settings-unarchive-sessions`），它在 `settings.section` 槽位注册的 id 恰为 `archived-sessions`，与本插件旧 id 相同 → slot 冲突，**整个 Web UI 启动报「Failed to load plugins」被拦截**（运行时二分实测：去掉本插件即恢复）。修复：本插件 slot id 改为唯一的 `omdp-archived-sessions`、导航标签改为「归档会话管理」，与原生项共存（原生只有查看+恢复，删除/按树删除/孤儿清理仍是本插件能力）。其余 API 面（`sessionPersistence.list`/`workspaceRegistry`/`sessionQuery`/`shell.run`/`fs`/jsonl 路径编码）对 0.1.6-alpha.1 源码核查零差异。
- **0.3.3**（2026-09-10）：**修复 0.3.2 的删除回归**——0.3.2 把会话根目录改为 `DSH_HOME` 推导时拼出了**混合分隔符**路径（`C:\Users\xj\.dsh/sessions/...`），而删除前校验 `assertSessionDirName` 的 basename 提取对混合分隔符失效（先按 `/` 切再按 `\` 切，把名字切成残缺片段），导致所有删除被"拒绝删除非会话目录"拦截。修复：① basename 提取改为按分隔符整体切分；② 根目录统一为 `/`。删除/孤儿清理恢复正常。
- **0.3.2**（2026-09-10）：修两处 fork 遗留——① client 半区的模块 id 仍是 `@muwinds/dsh-archived-sessions`（未随包名改），浏览器端按 `@omdp/...` 找不到模块、设置页不显示；② 会话根目录改为从 `DSH_HOME` 环境变量推导（`<DSH_HOME>/sessions`，缺省 `~/.dsh/sessions`），不再硬编码本机路径。
- **0.3.1**（2026-09-10）：**修复 0.3.0 的发布事故**——0.3.0 的 tarball 里没有 `lib/`（仓库 `.gitignore` 的 `**/lib/` 规则把源码吞了，npm 只打包到 4 个文件），安装后插件加载失败会拖垮 DSH；0.3.1 补回 `lib/index.js` + `lib/client.js`（发布前已核对 tarball 内容）。
- **0.3.0**（2026-09-10）：fork 自 0.2.0；适配 DSH 0.1.5-rc.1（list 快照形状 + 路径自解析）；按树删除子会话；孤儿清理；删除路径安全校验。

---

## English

### What is this

DSH sessions can be archived; this plugin adds an archived-session manager under **Settings → 归档会话管理 (Archived Sessions Manager)**:

- **List**: title, session ID, workspace, disk usage, created time, running state;
- **Release** (释放): move a session out of the archive set back to active (no data deleted);
- **Delete** (删除): delete the session directory from disk + remove from the archive set (two-step confirm);
- **Tree delete**: deleting a main session also deletes its subagent children (`parentSession` chain) — fixes upstream issue #2;
- **Orphan sweep**: scan and clean leftover subagent dirs whose parent session is already gone;
- **Detail**: expand to read the session content (first 100 messages).

### Why this fork

Upstream `@muwinds/dsh-archived-sessions` 0.2.0 is **incompatible with DSH 0.1.5-rc.1** (author unmaintained for a month):

| Symptom | Root cause |
| --- | --- |
| All archived items show 文件缺失 (missing) | 0.1.5-rc.1 `sessionPersistence.list()` returns `SessionPersistenceSnapshot[]` (`{header, revision, eventCount?, sizeBytes?}`), not bare `SessionHeader[]`; the plugin read the old shape, so `header.id` was `undefined` |
| Delete behaves like Release (both only prune the archive id) | 0.1.5-rc.1 removed `locate(meta)` from the abstract service; `persistence.locate(header)` returned `undefined` → `.path` threw TypeError → swallowed by catch → `no-artifact` branch skipped the disk deletion |

Fixes in this fork:

1. `list()` recognizes the snapshot shape and reads `snapshot.header`; prefers the snapshot's `sizeBytes`;
2. No longer uses `locate()`; resolves the session directory with the same path encoding as the DSH JSONL backend (`encodeSegment` / `projectKey`), confirmed via `fs.resolve`;
3. Refuses to delete anything whose directory name is not a session dir (`session-<uuid>` or bare UUID) — no accidental deletions;
4. Delete collects the whole `parentSession` subtree recursively and removes children together (dirs + archive set);
5. New `/dsh-archived/orphans` and `/dsh-archived/sweep` to scan/clean orphan subagent sessions (parent no longer in persistence).

### Install

```bash
pnpm add @omdp/dsh-archived-sessions -w
```

> Migrating from `@muwinds/dsh-archived-sessions`: remove the old dependency (`github:MuWinds/dsh-archived-sessions`) from the profile package.json first, then install this package. Same API routes (`/dsh-archived/*`); refresh the page after installing.

### Requirements

- DeepSeek Harness **0.1.5-rc.1**, **0.1.5-rc.2**, **0.1.6-alpha.1**, **0.1.7-rc.1**, **0.1.7-rc.2** (tested; **0.3.6+ works on all of them** — 0.3.7 adds the rc.2 declaration, 0.3.5 is *silently broken* on the 0.1.5/0.1.6 line, see changelog)
- `@deepseek-ai/dsh` `0.1.7-rc.1 || 0.1.7-rc.2` (peer, enumerated per version, new in 0.3.6, rc.2 added in 0.3.7)
- `@deepseek-ai/cordis` `4.0.1` / `4.0.2` / `4.0.4` (peer, enumerated per version)
- `@deepseek-ai/dsh-session-persistence-jsonl` (optional, ships with DSH; falls back to the built-in path encoding when absent)

### Dual-era `ctx.shell` adaptation (0.3.6)

The directory-removal step is the only place this plugin actually touches the disk, and `ctx.shell`'s
contract was renamed in DSH 0.1.7 — the two eras expose *different* methods, and the old one is removed
outright in the new one (verified by unpacking each `@deepseek-ai/dsh-shell` npm tarball and reading
`lib/types/index.d.ts`: `abstract run(...)` exists and `execute` appears 0 times in
`0.1.5-rc.1`/`0.1.5-rc.2`/`0.1.5-rc.3`/`0.1.6-alpha.1`; `0.1.7-rc.1` has
`abstract execute(spec): Promise<ShellExecution>` and `run` appears 0 times):

| DSH | Call chain | Result |
|---|---|---|
| ≤ `0.1.6` (rc.x / alpha) | `resolve(request) → spec` → **`run(spec) → Promise<ShellRunResult>`** | only `run` |
| ≥ `0.1.7` | `resolve(request) → spec` → **`execute(spec) → ShellExecution`** → `await execution.result()` | only `execute` |

`removeDir()` now probes at runtime: prefer `execute()` (0.1.7+), fall back to `run()` (≤0.1.6), and only
error out when neither exists — so one build deletes across the entire line. The lesson: 0.3.4 called
only `run()` (fine on rc.x, dead on 0.1.7) and 0.3.5 called only `execute()` (fine on 0.1.7, **silently
dead** on rc.x, where the `typeof shell.run !== "function"` guard threw immediately and the UI surfaced
it as the red "删除失败" banner) — both were bets on a single era.

### Compatibility gate (declared since 0.3.6)

Since 0.3.6 the plugin declares `"@deepseek-ai/dsh": "0.1.7-rc.1 || 0.1.7-rc.2"` in `peerDependencies`
(rc.2 added in 0.3.7). DSH's own
**`evaluatePluginCompatibility()`** (a public export of `dsh-app-boot`) checks it at install time and on
every boot: on an untested newer runtime the **whole bundle is gracefully skipped** (stderr prints
`skipping profile bundle`; DSH still boots), and on the tested runtime it loads normally. The declaration
starts at `0.1.7-rc.1` because **the gate itself only exists from 0.1.7** (verified per version by
unpacking `dsh-app-boot` tarballs: `evaluatePluginCompatibility` appears 0 times in
`0.1.5-rc.2`/`0.1.5-rc.3`/`0.1.6-alpha.1`/`0.1.6-alpha.2`/`0.1.7-alpha.1`/`0.1.7-alpha.2`) — older
runtimes simply see an unrecognized peer declaration, so **existing users on older
DSH versions do not lose the plugin** because of it.
The `0.1.7-rc.2` addition (0.3.7) is based on: a file-by-file tarball diff showing `dsh-shell`'s `lib/`
(**this plugin's only shell surface**) is **byte-identical** rc.1 → rc.2; running the rc.2 gate against the
new declaration → pass; and a **live end-to-end delete test** on a scratch profile
(`dsh@0.1.7-rc.2` + 0.3.6 + exact-version exemption): `POST /dsh-archived/delete
{"sessionId":"session-f71d25a2-…"}` → `{"ok":true,"deleted":true}` + directory gone from disk +
archive set emptied + `list` returning `{items:[]}` (the test session was restored from backup).

### API

| Method | Request | Response |
| --- | --- | --- |
| `POST /dsh-archived/list` | `{}` | `{ items, totalBytes }` |
| `POST /dsh-archived/unarchive` | `{ sessionId }` | `{ ok, changed, archivedSessionIds }` |
| `POST /dsh-archived/delete` | `{ sessionId }` | `{ ok, deleted, sessionId, alsoDeleted[], reason? }` |
| `POST /dsh-archived/detail` | `{ sessionId }` | `{ id, createdAt, cwd, parentSession, totalEvents, messageCount, truncated, messages }` |
| `POST /dsh-archived/orphans` | `{}` | `{ items, totalBytes }` |
| `POST /dsh-archived/sweep` | `{}` | `{ removed, freedBytes, items }` |

### Changelog

- **0.3.7** (2026-09-25): **adds DSH `0.1.7-rc.2` support** (peer enumeration `0.1.7-rc.1 || 0.1.7-rc.2`, zero code changes). Background: the DSH **desktop** app ships runtime `0.1.7-rc.2`, so the gate skipped 0.3.6's exact-`rc.1` declaration (plugin list badge 异常). Verification: `dsh-shell`'s `lib/` is **byte-identical** rc.1 → rc.2 (this plugin's only shell surface); the rc.2 gate passes the new declaration; and a live delete test on a scratch profile (`dsh@0.1.7-rc.2` + 0.3.6 + exemption) succeeded end-to-end — `POST /dsh-archived/delete {"sessionId":"session-f71d25a2-…"}` → `{"ok":true,"deleted":true}` + directory gone + archive set emptied + `list` → `{items:[]}` (test session restored from backup).

- **0.3.6** (2026-09-24): **dual-era `ctx.shell` adaptation + declared DSH version support**.
  1. **Fixes a silent rc.x regression from 0.3.5**: 0.3.5 switched to `execute()` and thereby fixed 0.1.7, but `run()` is the only method that exists on 0.1.5/0.1.6, so on those versions 0.3.5 threw `shell executor unavailable; cannot delete from disk` on **every** delete (0.3.4's use of `run()` was conversely fine on rc.x and dead on 0.1.7). 0.3.6 probes at runtime: prefer `execute()` (0.1.7+, awaiting `execution.result()`), else fall back to `run()` (≤0.1.6), and only error when neither exists ⇒ **deletes work across 0.1.5-rc.1 → 0.1.7-rc.1**. Basis: unpacked `@deepseek-ai/dsh-shell` `lib/types/index.d.ts` per version (see "Dual-era `ctx.shell` adaptation" above).
  2. Added the `@deepseek-ai/dsh` peer declaration `0.1.7-rc.1` (enumerated per version; see "Compatibility gate" above).
  3. Documented 0.3.5's rc.x regression so nobody treats 0.3.5 as "fine on rc.x".

- **0.3.5** (2026-09-24): **DSH 0.1.7-rc.1 support — fixes the "删除失败" (delete failed) banner**. 0.1.7's `ctx.shell` is the trio `resolve(request) → spec` / `execute(spec) → ShellExecution` / `execution.result()`; there is **no `run()`** any more (0.1.5/0.1.6 had `run(spec)`). The old `removeDir()` guarded on `typeof shell.run !== "function"` and therefore always threw `shell executor unavailable; cannot delete from disk` on 0.1.7 — every session directory was rejected before touching the disk, surfacing in the UI as the red banner "删除失败 N 个会话: session-…". Fix: use `resolve` + `execute` + `result()`; any execution error is wrapped into an explicit delete-failure error. Also changed the peer from the range `@deepseek-ai/cordis: ^4.0.1` to per-version enumeration `4.0.1 || 4.0.2 || 4.0.4` (repo rule 3: only declare actually-tested versions, never open ranges).
  > ⚠️ What this version cost: `execute()` does not exist on 0.1.5/0.1.6 ⇒ **deletes silently stopped working on rc.x**, fixed again by **0.3.6**'s dual-era probe.
- **0.3.4** (2026-09-15): **adapted to DSH 0.1.6-alpha.1** — since DSH 0.1.6 the web-app ships a native archived-sessions settings page (`@deepseek-ai/dsh-client-ui-settings-unarchive-sessions`) that registers the `settings.section` slot with id `archived-sessions` — exactly the id this plugin used → slot collision, and the whole Web UI boot failed with a "Failed to load plugins" screen (verified at runtime by bisecting plugin subsets: removing this plugin restores boot). Fix: this plugin's slot id is now the unique `omdp-archived-sessions` and its nav label is "归档会话管理", coexisting with the native entry (the native page only lists/restores; delete, tree-delete and orphan sweep remain this plugin's features). All other DSH surfaces used by the plugin (`sessionPersistence.list`/`workspaceRegistry`/`sessionQuery`/`shell.run`/`fs`/jsonl path encoding) verified byte- or removal-free against 0.1.6-alpha.1.
- **0.3.3** (2026-09-10): **fixes a 0.3.2 delete regression** — 0.3.2 derived the session root from `DSH_HOME` with a **mixed-separator** path (`C:\Users\xj\.dsh/sessions/...`), and the pre-delete guard `assertSessionDirName`'s basename extraction broke on mixed separators (it sliced by `/` then by `\`, producing a truncated fragment), so every delete was rejected with "拒绝删除非会话目录". Fixed: ① basename extraction now splits on either separator; ② roots are normalized to `/`. Delete and orphan sweep work again.
- **0.3.2** (2026-09-10): fixes two fork leftovers — ① the client half's module id was still `@muwinds/dsh-archived-sessions` (not renamed with the package), so the browser could not find the module and the settings page never rendered; ② the session root is now derived from the `DSH_HOME` environment variable (`<DSH_HOME>/sessions`, falling back to `~/.dsh/sessions`) instead of a hard-coded local path.
- **0.3.1** (2026-09-10): **fixes a 0.3.0 release accident** — the 0.3.0 tarball contained no `lib/` (the repo's `**/lib/` gitignore rule swallowed the source, so npm packed only 4 files); installing it broke the plugin load and could take DSH down. 0.3.1 restores `lib/index.js` + `lib/client.js` (tarball contents verified before publishing).
- **0.3.0** (2026-09-10): forked from 0.2.0; DSH 0.1.5-rc.1 support (snapshot list shape + self path resolution); tree delete; orphan sweep; deletion path safety check.

## License

MIT — original by MuWinds (upstream package), fork maintained by XJungit.
