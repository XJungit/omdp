# 归档会话插件 fork：DSH 0.1.5-rc.1 适配 + 按树删除 + 孤儿清理

## 背景

用户报告 `@muwinds/dsh-archived-sessions` 0.2.0 在新 DSH（0.1.5-rc.1）下两个症状：
1. 归档面板 66 个会话全部显示「文件缺失」（missing=True / size=0 / path=''）；
2. 「删除」与「释放」行为相同——都只移除归档标记，不删磁盘目录。

用户指示：先诊断不修复；诊断完讨论是否 fork 自己维护。结论：**fork 并入 omdp，发 @omdp/dsh-archived-sessions**（作者一个月未维护，不提 issue）。

## 根因（DSH 0.1.5-rc.1 契约变更）

| 变更 | 旧版 | 0.1.5-rc.1 |
| --- | --- | --- |
| `sessionPersistence.list()` | 返回裸 `SessionHeader[]` | 返回 `SessionPersistenceSnapshot[]`（`{header, revision, eventCount?, sizeBytes?}`） |
| `sessionPersistence.locate(meta)` | 服务公开方法 → `{kind, path}` | **从抽象服务表面移除**（JSONL 后端内部仍有，但不在类型面） |

插件执行路径：
- `list()` 当 header[] 用 → `header.id` 变 `undefined` → 标题/路径全丢；
- `locate(header)` 返回 `undefined` → `.path` 抛 TypeError → 被 catch 吞掉 → 走 `no-artifact` 分支 → 显示文件缺失；
- `delete` 同样拿不到路径 → 只 `removeFromArchiveSet` → 与释放无差别。

> 教训：**插件 try/catch 吞掉 TypeError 后走降级分支**是「功能静默退化、无报错」的常见来源。运行时用 `cordis_inspect_query` 核对服务契约（listService）比读旧版 API 猜可靠。

## 修复方案（@omdp/dsh-archived-sessions 0.3.0）

1. **list 形状适配**：识别 `snapshot.header`，优先用 snapshot 自带 `sizeBytes`；
2. **路径自解析**：不再用 `locate()`，改用 DSH JSONL 后端同款编码（`encodeSegment`：保留 `[A-Za-z0-9._-]`，其余 `~XXXX`；`projectKey`：`/\:` → `-`，前后 `--`，截断 251）拼出会话目录，并经 `fs.resolve` 确认存在；
3. **删除安全护栏**：`removeDir` 前校验目录名必须匹配 `session-<uuid>` 或裸 UUID，否则拒绝删除（杜绝误删任意路径）；
4. **按树删除**（issue #2）：`collectSubtreeIds` 用 `parentSession` 建父子图，BFS 收集整棵子树，逐一删目录 + 移出归档集合；
5. **孤儿清理**：新增 `/dsh-archived/orphans` 与 `/dsh-archived/sweep`——列出/清理「父会话已不在 persistence、自己还在盘」的子会话目录；
6. **client**：行内显示「含 N 个子会话」、删除确认文案注明连带子树、工具栏加「孤儿清理」面板。

## 验证

- 路径编码 3/3 自测通过（含中文路径 `D:\WorkSpace\test\测试1` → `--D-WorkSpace-test-~6D4B~8BD51--`，与磁盘实际目录一致）；
- 只读核对：67 条归档 → 新逻辑算出 1 条存在（正是 V3 在盘那条）、66 条真实缺失，与磁盘一致（修复后不再全部误报文件缺失）；
- 语法检查（node --check）host/client 均通过；
- 本地 link: 安装到 web profile 后人工验证（待做）。

## 磁盘残留（用户在意是否清干净）

- 归档 67 条：66 条磁盘已无数据（删除确实生效），1 条 V3 在盘；
- 但 `C:\Users\xj\.dsh\sessions` 有 **409 个目录未被注册表引用**，合计约 **4.2GB**（omdp 工作区 234 会话占 3.7GB、.dsh 120 会话占 434MB）——是旧格式（v0，裸 UUID + `session.jsonl.zstd`）尚未被 V3 惰性迁移的遗留，非本次删除造成；
- 真孤儿（父已删、子还在盘）仅 1 个 0MB。

## 可复用要点

- DSH 0.1.5-rc.1 会话目录路径：`<root>/<projectKey(cwd)>/<encodeSegment(id)>/session.v3.jsonl.zstd`；
- 新版拿路径：优先 `persistence.list()` 快照的 `sizeBytes`；要真实路径用 JSONL 后端导出函数 `projectDir/sessionDir/logPath`（`@deepseek-ai/dsh-session-persistence-jsonl`）；
- 删除前必须校验目录名形状，避免路径解析错误导致误删。

## 相关文件

- 新包：`dsh-archived-sessions/`（lib/index.js、lib/client.js、package.json、cordis.patch.yml、README.md）
- 根 README、docs/plugin-compatibility.md 同步更新
