# @omdp/dsh-archived-sessions

> Archived-sessions manager for the DeepSeek Harness web UI — fork of [`@muwinds/dsh-archived-sessions`](https://github.com/MuWinds/dsh-archived-sessions) (0.2.0), adapted for DSH **0.1.5-rc.1**.

DSH 归档会话管理：在 设置 → 归档会话 中查看、释放、删除已归档会话（支持按树删除子会话、清理孤儿会话）。

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

- DeepSeek Harness **0.1.5-rc.1**（实测版本）
- `@deepseek-ai/cordis` ^4.0.1（peer）
- `@deepseek-ai/dsh-session-persistence-jsonl`（可选，随 DSH 自带；缺失时回退到内置路径编码）

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

- **0.3.3**（2026-09-10）：**修复 0.3.2 的删除回归**——0.3.2 把会话根目录改为 `DSH_HOME` 推导时拼出了**混合分隔符**路径（`C:\Users\xj\.dsh/sessions/...`），而删除前校验 `assertSessionDirName` 的 basename 提取对混合分隔符失效（先按 `/` 切再按 `\` 切，把名字切成残缺片段），导致所有删除被"拒绝删除非会话目录"拦截。修复：① basename 提取改为按分隔符整体切分；② 根目录统一为 `/`。删除/孤儿清理恢复正常。
- **0.3.2**（2026-09-10）：修两处 fork 遗留——① client 半区的模块 id 仍是 `@muwinds/dsh-archived-sessions`（未随包名改），浏览器端按 `@omdp/...` 找不到模块、设置页不显示；② 会话根目录改为从 `DSH_HOME` 环境变量推导（`<DSH_HOME>/sessions`，缺省 `~/.dsh/sessions`），不再硬编码本机路径。
- **0.3.1**（2026-09-10）：**修复 0.3.0 的发布事故**——0.3.0 的 tarball 里没有 `lib/`（仓库 `.gitignore` 的 `**/lib/` 规则把源码吞了，npm 只打包到 4 个文件），安装后插件加载失败会拖垮 DSH；0.3.1 补回 `lib/index.js` + `lib/client.js`（发布前已核对 tarball 内容）。
- **0.3.0**（2026-09-10）：fork 自 0.2.0；适配 DSH 0.1.5-rc.1（list 快照形状 + 路径自解析）；按树删除子会话；孤儿清理；删除路径安全校验。

---

## English

### What is this

DSH sessions can be archived; this plugin adds an archived-session manager under **Settings → 归档会话**:

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

- DeepSeek Harness **0.1.5-rc.1** (tested version)
- `@deepseek-ai/cordis` ^4.0.1 (peer)
- `@deepseek-ai/dsh-session-persistence-jsonl` (optional, ships with DSH; falls back to the built-in path encoding when absent)

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

- **0.3.3** (2026-09-10): **fixes a 0.3.2 delete regression** — 0.3.2 derived the session root from `DSH_HOME` with a **mixed-separator** path (`C:\Users\xj\.dsh/sessions/...`), and the pre-delete guard `assertSessionDirName`'s basename extraction broke on mixed separators (it sliced by `/` then by `\`, producing a truncated fragment), so every delete was rejected with "拒绝删除非会话目录". Fixed: ① basename extraction now splits on either separator; ② roots are normalized to `/`. Delete and orphan sweep work again.
- **0.3.2** (2026-09-10): fixes two fork leftovers — ① the client half's module id was still `@muwinds/dsh-archived-sessions` (not renamed with the package), so the browser could not find the module and the settings page never rendered; ② the session root is now derived from the `DSH_HOME` environment variable (`<DSH_HOME>/sessions`, falling back to `~/.dsh/sessions`) instead of a hard-coded local path.
- **0.3.1** (2026-09-10): **fixes a 0.3.0 release accident** — the 0.3.0 tarball contained no `lib/` (the repo's `**/lib/` gitignore rule swallowed the source, so npm packed only 4 files); installing it broke the plugin load and could take DSH down. 0.3.1 restores `lib/index.js` + `lib/client.js` (tarball contents verified before publishing).
- **0.3.0** (2026-09-10): forked from 0.2.0; DSH 0.1.5-rc.1 support (snapshot list shape + self path resolution); tree delete; orphan sweep; deletion path safety check.

## License

MIT — original by MuWinds (upstream package), fork maintained by XJungit.
