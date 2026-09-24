# connector 工具过滤静默变回「全放行」：0.1.7 迁移漏段 + `.imported` 救援

日期：2026-09-24
插件：`@omdp/dsh-connector`（0.3.3 → 0.3.4）

## 背景 / 问题

用户报「工具过滤也没有修」：设置页里给 tinyfish 勾好的 allow 名单（只留 `search` / `fetch_content`）
失效，模型又能看到并调用全部 15 个工具。重启无效。

排查时确认了两个并存的事实：
- **代码层 0.3.3 是正确的**：`Config = z.object({ toolFilters: <dict>.volatile() })` 已声明，
  读写路径（注入的活 ref / `settings.replace()`）都对；
- **数据层不在 profile 条目里**：`profiles/web/cordis.patch.yml` 的 `connector` 行没有
  `config.toolFilters`。

## 结论 / 根因

DSH 0.1.7 的配置迁移是「**改名 + 逐段导入**」的**全有或全无**动作，且**失败不重试**：

1. 首启把 `<DSH_HOME>/settings.yaml` **改名为 `settings.yaml.imported`**（在任何写入之前）；
2. 逐段调 `settings.update(ns, values)` —— 该方法**要求目标条目声明 volatile 字段**，
   否则抛错，只打一行 `settings: section … of … was not imported into entry …`；
3. 此后内置导入器见到 `.imported` **不会再跑**，而 `settings.yaml` 已不存在。

于是：`connector` 的 `toolFilters` 落进了 `.imported` 再也没出来。本机核实：
- `C:\Users\xj\.dsh\settings.yaml` **不存在**；
- `C:\Users\xj\.dsh\settings.yaml.imported` 存在，`connector.toolFilters.tinyfish.allow = [search, fetch_content]`。

**为什么 0.3.3 的 volatile 声明没救回来**：它引入得太晚——用户机器上早已迁过一次（迁移是一次性的），
`Config` 声明只保证「以后」能托管配置，不会回头重跑迁移。

**为什么 0.3.3 的既有文件回退也没救回来**：`readToolFilters()` 的第一分支在 `_filterRef` 存在时
直接返回活 ref 的值；ref 里是空的 ⇒ 永远轮不到「读文件」那条路。**缺的不是又一个读回退，
而是两个后端之间的一座桥。**

## 修复（0.3.4）

新增 `ensureLegacyFiltersMigration()`，在**路由处理前**（不是 `apply()`）执行一次：

```js
if (_migrationAttempted) return;               // 一次性
_migrationAttempted = true;
try {
  if (!_filterRef || !_settingsSvc || typeof _settingsSvc.replace !== 'function') return;
  if (normalizeToolFilters(_filterRef.get()) 非空) return;      // 不覆盖用户当前设置
  const text = readFileSync(join(resolveHome(), 'settings.yaml.imported'), 'utf8');  // 只读
  const block = parseYaml(text)[CONNECTOR_SETTINGS_NS];          // 段名 'connector'
  const migrated = normalizeToolFilters(block && block.toolFilters);
  if (migrated 为空) return;
  await _settingsSvc.replace(CONNECTOR_ENTRY_ID, { toolFilters: migrated });         // 写回 profile 条目
  console.info('[dsh-connector] migrated toolFilters from settings.yaml.imported:', …);
} catch (err) {
  _migrationAttempted = false;                 // ← 复位：过早调用不能永久放弃救援
  console.warn('[dsh-connector] toolFilters migration skipped:', …);
}
```

三个必须遵守的约束：

1. **不能放在 `apply()` 里**：`settings.replace()` 走 `configEditor.edit()`，要求该 entry 的 fiber
   已 **ACTIVE**（`describe()` 会跳过 `fiber.state !== 2` 的条目）；`apply()` 期间 fiber 正在创建，
   调用必抛 `No configurable plugin entry`。**首个 HTTP 请求**才是最早的安全时机。
2. **不覆盖**：只在「活的 `toolFilters` 为空」时才搬，避免把用户后来的修改冲掉。
3. **`.imported` 只读、永不删除**：它是遗留配置的唯一副本。

**当下立即恢复**（不必等发版）：直接调插件自己的 HTTP API 写一次即可——
`PUT /connector/api/mcp/filters`，body `{"filters":{"tinyfish":{"allow":["search","fetch_content"]}}}`，
落盘到 `cordis.patch.yml` 的 `connector` 行 `config.toolFilters`。（本轮就是这么先恢复的。）

## 验证

- 迁移逻辑对**真实**的 `C:/Users/xj/.dsh/settings.yaml.imported` 单独跑过提取：
  得到 `{"tinyfish":{"allow":["search","fetch_content"]}}`，非空、段名匹配 ⇒ 救援会触发。
- `node --check index.js` 干净；从 profile 目录 `import('./index.js')` 冒烟通过
  （导出 `Config, apply, commandResolvable, inject, validateServer`）。
- 实况：`GET /connector/api/mcp/filters` → `{"filters":{"tinyfish":{"allow":["fetch_content","search"]}}}`。

## 可复用要点

- ⚠️ **0.1.7 的配置迁移是「全有或全无」且失败不重试**。凡是「配置放在 `settings.yaml`、
  需跨 0.1.7 存活」的插件，都应自查：这段配置**真的**迁到 profile 条目了吗？
  **没有 volatile `Config` 声明的字段一定没迁过去。**
- **判断「配置在不在」要比对三处**：① 活 ref（profile 条目 `config`）、②
  `<DSH_HOME>/settings.yaml`、③ `<DSH_HOME>/settings.yaml.imported`。
  第 ③ 个最容易被忽略，而它往往正是真值所在。
- **区分「代码对不对」和「数据在不在」**：本轮工具过滤失效**不是代码 bug**（0.3.3 代码是对的），
  而是**数据滞留**。排查时先确认数据落点，可省掉大段无用代码审查。
- **救援（rescue）与迁移（migration）不同**：迁移是 DSH 一次性动作、错过了就没有；救援是插件
  自己补的桥，必须**幂等**、**不覆盖用户现设**、**失败可重试**、**绝不破坏源数据**。
- **一次性标记要在失败时复位**：把 `_migrationAttempted` 朴素地置 `true` 会让一次过早调用
  （ref/settings 尚未就绪）永久放弃救援；正确做法是 `catch` 里复位，留给下一次请求。
- **`.imported` 是危险文件**：清理 `~/.dsh` 时**绝不能删**——0.1.7 已把原 `settings.yaml` 就改名成它，
  删掉等于抹掉所有未成功迁移的遗留配置。

## 相关文件

- `dsh-connector/index.js`：`ensureLegacyFiltersMigration()`（新增）/ `normalizeToolFilters()` /
  `readToolFilters()` / `PUT /connector/api/mcp/filters` 处理器 / 后端初始化处的 `_filterRef`、`_settingsSvc`
- `dsh-connector/README.md`：0.3.4 变更条目 2、Troubleshooting「勾好的工具过滤变回全量放行」、
  Permissions & data 表（`.imported` 只读）
- `docs/plugin-compatibility.md`：0.1.7 专项「变更 2」（迁移前提）+「变更 6」（本问题）
- 另见：`notes/2026-09-24/dsh-compat/key-fallback-settings-imported-stranded-pools.md`
  （同一机制在 key-fallback 上的实例——那是本轮较早的发现，本笔记是它的第二次复现）
