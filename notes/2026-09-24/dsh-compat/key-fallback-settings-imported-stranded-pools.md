# 0.1.7 配置迁移「全有或全无」：key-fallback 池滞留 `settings.yaml.imported`

日期：2026-09-24
插件：`@omdp/dsh-key-fallback`（v3.2.0 → v3.2.1）

## 背景 / 问题

升级到 DSH `0.1.7-rc.1` 后，key-fallback 的设置页（**设置 → API Key 回退**）显示：

- 徽标「**尚未启用**」
- 空态「**还没有任何池**，点上方「启用新 provider 池」开始。」

但主机路由是活的（`GET /dsh-key-fallback/diag` 200、`GET /dsh-key-fallback/pools` → `{"pools":[]}`），
插件**加载正常**——只是**配置是空的**。用户的池（`agnes`、`sensenova`）不见踪影。
**重启无效**（这点与 connector 的现象相似，但根因完全不同）。

## 结论 / 根因

`0.1.7` 首启的配置迁移是**「全有或全无」**动作（见同日笔记
`dsh-017-breaking-changes-dual-version.md`）：

1. `importLegacyDocument()` 先把 `<DSH_HOME>/settings.yaml` **改名为** `settings.yaml.imported`；
2. 然后**逐段**写入 profile 补丁中同名条目的 `config:`；
3. 某一段导入失败（典型：该条目没声明 volatile 字段 ⇒ `settings.update()` 抛错）时，
   只打印一行 `settings: section ... was not imported`，**该段配置就永久留在 `.imported` 里**。

而 key-fallback 的**读路径有两条，0.1.7 上走的那条绕过了文件**：

```js
function readSettings() {
  if (_liveRef) {                                   // ← 0.1.7 上 _liveRef 非空，永远走这条
    return { providers: cloneJson(_liveRef.get() || {}) }   // ref 是 {} ⇒ 返回空
  }
  return readSettingsFromFile()                     // ← rc.x 才走这条（含 .imported 回退）
}
```

⚠️ **修正一个容易误判的点**：`readSettingsFromFile()` 在 v3.2.0 **就已经**会在
`settings.yaml` 缺失时回退读 `settings.yaml.imported`（`SETTINGS_FILE_IMPORTED` 常量 + for 循环）。
所以"读回退已经写好了"——但**根本没被轮到**：0.1.7 上 `_liveRef` 一定非空，
`readSettings()` 在第一行就 return 了，文件（无论 `.yaml` 还是 `.imported`）**从不被查询**。
真正的问题因此不是"少了个回退"，而是**文件兜底与 volatile ref 两个后端之间缺一座桥**。

本机的状态正是：`settings.yaml` **已不存在**（被改名），池数据只躺在
`settings.yaml.imported`（10522 B，含 `key-fallback.providers: { agnes, sensenova }`）
——`_liveRef` 后端读到空 `{}`，文件后端又进不去，于是「配置真空」。
**再多次重启都不会变**，因为改名只发生一次、且导入路径不会再试。

## 修复（v3.2.1）：一次性遗留池救援

在**首个 HTTP 请求**时做一次性搬迁（`ensureLegacyMigration()` 挂在路由 handler 顶部）：

```js
const MIGRATED_MARKER = join(DSH_HOME, '.key-fallback-migrated')
let _migrationAttempted = false

async function ensureLegacyMigration() {
  if (_migrationAttempted) return          // 进程内只试一次
  _migrationAttempted = true
  try {
    if (!_liveRef || existsSync(MIGRATED_MARKER)) return                 // 非 0.1.7、或已处理过
    if (Object.keys(_cache?.providers || {}).length > 0) return          // 已有池，无需搬
    const migrated = (readSettingsFromFile() || {}).providers || {}      // 读 .imported（只读引导）
    const names = Object.keys(migrated)
    if (names.length === 0) { writeMarker(); return }                    // 空也算「已处理」
    if (typeof _settingsSvc?.replace !== 'function') return              // 服务不具备则静默跳过
    _cache = { providers: cloneJson(migrated) }                          // 先乐观更新内存
    await _settingsSvc.replace(ENTRY_ID, { providers: cloneJson(migrated) })  // 真正落盘
    writeMarker()                                                        // 成功后才落标记
    diag('migrate', 'imported N provider(s) from settings.yaml(.imported): ...')
  } catch (e) { diag('migrate', 'failed: ' + e.message) }
}
```

### 三个关键设计点（都有实测依据）

1. **必须在「首个请求」而不是 `apply()` 里做。**
   `settings.replace()` 内部走 `configEditor.edit()`，而 `SettingsForms.describe()` 会
   **跳过 `fiber.state !== 2`（ACTIVE）的条目**。`apply()` 执行时本插件的 fiber
   还在创建中 ⇒ 必然抛 `No configurable plugin entry "key-fallback"`。
   UI 打开设置页就会请求 `/pools`，时机正好（路由 handler 里 fiber 已 ACTIVE）。
2. **标记文件保证「真只做一次」。**
   否则用户**有意清空所有池**后，下次启动又会把 `.imported` 里的旧池灌回来。
   所以标记必须在**搬迁成功后**才写；同时「`.imported` 里也确实没有池」时也落标记
   （空文件算已处理），避免每次启动重复探测。
3. **失败不落标记 ⇒ 下次启动可重试。**
   `await replace` 抛错（磁盘/权限/服务异常）时直接进 catch（只 diag），标记不写，
   进程内 `_migrationAttempted` 也只挡当次——重启后仍会重试。

## 可复用要点

- ⚠️ **「迁移只跑一次 + 失败静默 + 源文件被改名」三者叠加会造出永久性的「配置真空」**：
  用户看到的是「功能空着」，而不是「报错」。排查这类问题时，**先去看
  `settings.yaml.imported` 里有没有数据**——有数据就说明导入失败过。
- **`settings.replace()` 的调用时机铁律**：它操作的是 **profile 条目 id**（本插件是
  `key-fallback`，connector 是 `connector`），**不是** settings 命名空间；且
  **绝不能在 `apply()` 里调用**（fiber 未 ACTIVE）。任何写入都要延到请求/事件之后。
- **一次性救援要带「幂等标记 + 成功后才落」**：`<DSH_HOME>/.key-fallback-migrated`
  用绝对路径常量，避免从 `~` 展开的路径在不同 cwd 下不一致。
- **乐观更新内存副本**：`replace()` 是异步落盘，UI 可能在前一帧就刷新，先改 `_cache`
  再 await `replace`，否则读回归属旧树（会看到空列表）。
- 该迁移与 connector 的 import 崩溃是**两个独立问题**：connector 是加载期死、这个是加载正常但配置空。
  同日排查时容易混淆，判定方法：**路由 200 还是 404**——200 说明插件活着，问题在配置层。

## 相关文件

- `dsh-key-fallback/lib/index.js`：`MIGRATED_MARKER` / `ensureLegacyMigration()` / `_liveRef` /
  `_cache` / `readSettingsFromFile()` / `writeSettings()` / 路由 handler 顶部 await
- `dsh-key-fallback/README.md`（§「What v3.2.1 offers」）/ `README.zh-CN.md`（§「v3.2.1 新增」）
- `docs/plugin-compatibility.md`：§4 风险点「遗留池救援（v3.2.1 新增）」
- 同日前置笔记：`notes/2026-09-24/dsh-compat/dsh-017-breaking-changes-dual-version.md`
  （迁移机制与 volatile `Config` 守卫的完整实测）
