# DSH 0.1.7 破坏性变更与插件双版本兼容改造

日期：2026-09-24

## 背景 / 问题

用户要求把 omdp 仓库的插件与 `D:\Craft-Agent` 的 DSH 桥接层都适配 DSH `0.1.7-rc.1`
（`next` 通道），但硬性约束是：

> **保证兼容当前版本（0.1.5-rc.3）的同时兼容新版本；如果只能兼容新版本，
> 就发布一个新版单独兼容 0.1.7，等我后续手动更新插件。**

因此前置问题不是"怎么改"，而是**"能不能双版本兼容"**。答案是：能，但 `0.1.7`
的破坏面比预期大，必须先把三处变更都摸清，且**每一处都实测**。

## 结论速览

| 变更 | 影响面 | 能否双版本兼容 | 做法 |
|---|---|---|---|
| profile bundle 版本门禁 | 只查 `@deepseek-ai/dsh-*` peer | ✅ 能 | peer 枚举追加 `0.1.7-rc.1` |
| 插件配置迁出 `settings.yaml` | 所有持久化配置的插件 | ✅ 能 | 双后端自动判别 + volatile `Config` |
| Agent preset 改声明式 | 用 `.agent-presets` 的预设 | ✅ 能 | 双格式产出 + 版本门控注册 |
| `dsh-workflow-worker-thread` 改名 | 引用该包的 preset | ✅ 能 | 生成时改名 |

只有 `key-fallback` 需要真改代码；`dsh-connector` / `dsh-archived-sessions` /
`dsh-vision-bridge` **完全不受影响**（它们的 peer 里没有 `dsh-*` 前缀，
进不了门禁；也不读写 `settings.yaml`）。**无需为 0.1.7 单独发版。**

## 变更 1：profile bundle 版本门禁

`0.1.7` 的 `dsh-app-boot` 新增 `evaluatePluginCompatibility`：

- **只检查** `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 前缀的 peer（其余忽略）；
- 判据是 `semver.satisfies(runtime, range, { includePrerelease: true })`；
- `workspace:^|~|*` 视为当前运行时版本；
- **不满足 ⇒ 跳过整个 bundle**（`dsh: skipping profile bundle "..."`），
  DSH 本体不崩、`--dump-config` 退出码仍为 `0`；
- 豁免：`dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <exact> --accept-risk`
  写 `profiles/<p>/compatibility.json`（另有 `revoke-version` / `version-exemptions`）。

**踩坑**：`includePrerelease` 必须显式传。我第一版脚本漏了这个选项，
错误地把 7 个插件标为"不兼容"；补上后真实只有 **1 个**失败（`key-fallback`）。

**另一个坑**：`package.json` 里的 `dshCompat` 字段（dsh-bridge 一直在用）
在 `0.1.7` 源码中**零命中**——它纯属自我文档，**不参与门禁**。不要指望它。

### 门禁判定脚本（可直接复用）

```js
const checked = dep === '@deepseek-ai/dsh' || dep.startsWith('@deepseek-ai/dsh-')
const ok = semver.satisfies(actualVersion, range, { includePrerelease: true })
```

12 个已装插件中 11 个通过；只有 `@omdp/dsh-key-fallback@3.1.7`（3/3 peer 不含
`0.1.7-rc.1`）被跳过。**只 append 不删旧**，rc.3 的 PASS 不受影响。

## 变更 2：插件配置从 `settings.yaml` 迁到 profile entry config

这是最需要实测的一处，因为**文档为零、行为反直觉**。

### 实测出来的完整机制

1. `0.1.7` 首启时把 `<home>/settings.yaml` **改名**为 `settings.yaml.imported`
   （`importLegacyDocument()`，在 `SettingsForms` 构造函数里 `loader.await()` 之后触发）；
2. 逐个段解析，把每段内容写进 profile 补丁
   （`~/.dsh/profiles/<p>/cordis.patch.yml`）中**同名条目**的 `config:`；
3. 段名 → 条目 id 的映射：`LEGACY_SECTION_ENTRIES = { "ui-developer-tools": "ui-settings",
   "ui-onboarding": "ui-settings-general", shell: win32 ? "pwsh-sandbox" : "bash-sandbox" }`，
   其余 `?? section`（同名直落）；
4. 此后配置由 `settings` 服务托管，插件经注入的 `config` 参数读取。

### API 断代（务必记牢）

| rc.x（≤ 0.1.5-rc.3） | 0.1.7+ |
|---|---|
| `ctx.settings.get(ns)` | **已移除**（实测 `get=undefined`） |
| `ctx.settings.register(...)` | **已移除** |
| `ctx.settings.installSection(...)` | **已移除**（实测 `installSection=undefined`） |
| — | `describe()` / `update()` / `replace()` / `mutate()` / `write()` |

### 三个必须知道的前提

**前提 A：不声明 volatile `Config` ⇒ 配置静默丢失。**

`importLegacyDocument()` 走 `settings.update(ns, values)` → `write()`，而 `write()`
要求 `volatileForm(schema) !== undefined`，否则抛
`Plugin entry "${ns}" has no volatile fields`。失败时只打印
`settings: section %s of %s was not imported into entry %s`，**配置仅残留在
`.imported` 文件里**。这正是 v3.1.7 在 `0.1.7` 上"看起来只是被跳过"、
实际连配置都进不去的原因。

**前提 B：`.volatile()` 在两种 schemastery 构建上一个有一个没有。**

- schemastery `3.18.4`（`0.1.7`）：`typeof s.volatile === 'function'` ✅
- schemastery `3.18.2`（`rc.3`）：**不存在**，调用返回 `undefined` ❌

所以想双版本兼容，**必须加守卫**：

```js
const field = z.dict(z.any()).default({})
export const Config = (typeof field.volatile === 'function')
  ? z.object({ providers: field.volatile() })
  : undefined
```

rc.3 拿到 `undefined`（行为与改造前**逐字节一致**），`0.1.7` 拿到 volatile schema。
（若不需要兼顾 rc.x，用官方 `.volatile()` 即可；`meta.volatile = true` 是两版都支持的写法。）

**前提 C：`config` 是 volatile ref，且被深冻结。**

- `apply(ctx, config)` 的 `config` 是第 2 个参数；
- `config.providers` 是 **Ref**（`.get()` 随编辑热更新）；
- 顶层 `.volatile()` 会让 `config` 整个变成 Ref 包装、`Object.keys(config) === ['get']`
  —— 所以应**逐字段** volatile 而非整体 volatile；
- Ref 的值被 DSH **deepFreeze**，就地改会抛
  `Cannot add property X, object is not extensible`。读的时候必须返回**可变深拷贝**；
- 首次 apply 时 `config` 是 `{}`（迁移在 `loader.await()` 之后才跑），
  真实值稍后经 volatile-update 路径到达 —— **不能假设首次 apply 就有配置**。

### 双后端实现要点（key-fallback v3.2.0）

- 两个 chokepoint：`readSettings()` / `writeSettings()`，13 处调用全走它们，改动集中；
- 启动时判别一次：`config.providers` 是 Ref ⇒ 0.1.7 后端（接 `settings.replace()`）；
  否则文件后端（读写 `settings.yaml`，附备份）；
- 写是异步的（`replace()` 返回 Promise），故用 `_cache` 乐观副本 + `_writing`
  未决计数，避免 UI 立刻刷新时读回旧树；
- 文件后端回退也读 `settings.yaml.imported`（只读引导），避免迁移后配置真空。

### 实测结果（两版都做了真实 boot）

| 验证项 | rc.3 | 0.1.7 |
|---|---|---|
| 后端判别 | `backend = settings.yaml file (rc.x)` | `backend = profile entry (0.1.7+), providers=agnes,sensenova` |
| 读（`/pools`） | agnes 1 池 ✅ | agnes + sensenova ✅（含 env key 实时值） |
| 写（POST 建池） | 写入 `settings.yaml` + 生成备份 ✅ | 写入 `cordis.patch.yml` 的该 entry `config:` ✅ |
| `settings.yaml` 是否被改名 | **否**（仍存在，内容未变）✅ | 是（→ `.imported`） |
| `cordis.patch.yml` | 仍为 `[]` ✅ | 含迁移后的 `providers:` ✅ |

## 变更 3：Agent preset 改声明式

- **rc.3**：扫 `~/.dsh/.agent-presets/<id>/`，目录名即 id，内含
  `agent.cordis.yml`（顶层是插件条目数组）+ 可选 `preset.yml`（name/description/order）。
- **0.1.7**：**不再扫该目录**（源码搜索 `.agent-presets` 零命中，复数包
  `dsh-agent-presets` 也不存在了），改为 bundle 里一条声明：

```yaml
- insert:
    - id: preset-craft-bot
      name: '@deepseek-ai/dsh-agent-preset'
      config: { id, name, description, order, plugins: [...] }
```

### 格式转换关系（与官方 preset 逐行比对确认）

**`config.plugins` 就是 rc.3 那份数组，整体缩进 +10 再落到 `plugins:` 之下。**
我用官方 `standard` 预设反向验证：把 rc.3 的 `standard/agent.cordis.yml` 按此规则
转换后与 `0.1.7` 的 `presets/standard.patch.yml` 语义对比 —— 19 vs 18 条，
差异**仅 3 处**且全部是官方自己有意的演进：

1. `workflow-worker-thread` → `workflow-ptc`（包改名）；
2. `tool-ralph` 的 `disabled` 由 `false` 变 `true`；
3. 新增 `tool-plugin-manager` 行。

### 两处 0.1.7 连带失效

1. **包改名**：`@deepseek-ai/dsh-workflow-worker-thread` 在 `0.1.7` 不存在，
   对应 `@deepseek-ai/dsh-workflow-ptc`（Config 均为 `{ provider, maxConcurrentAgents, ... }`）。
   craft-bot 模板引用的 25 个包中，**只有它一个**在 0.1.7 缺失。
2. **技能目录绝对路径失效**：模板原先用
   `fileURLToPath(new URL('skills/', 'file:///{{DSH_PKG_ROOT}}/node_modules/@deepseek-ai/dsh-agent-presets/presets/cordis/'))`
   复用官方 cordis 预设的技能 —— 该路径在 0.1.7 不存在。官方 0.1.7 的等价写法是
   `createRequire(baseUrl).resolve('@deepseek-ai/dsh-agent-preset/package.json')` 再取 `skills`，
   与版本/布局无关。

### ⚠️ 最大的坑：该 preset bundle 会让 rc.3 **硬崩**

我最初把 preset bundle **无条件**加进 `dsh.profile.bundles`，实测 rc.3 直接崩溃：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include
       (cordis:include): failed to import loader entry preset-craft-bot
       (@deepseek-ai/dsh-agent-preset): Cannot find package ...
       [ERR_MODULE_NOT_FOUND]                      -> exit=1
```

注意这与"门禁跳过"**完全不同**：门禁只跳过、退出码 0；而**引用一个不存在的
bundle 条目是致命错误**。所以必须版本门控。

**版本判据用 DSH 自身 `package.json` 的 dependencies 是否含
`@deepseek-ai/dsh-agent-preset`（单数）** —— 不要用目录探测，因为两种安装形态布局不同：
rc.3（npm 全局）把包嵌套在 `dsh/node_modules/` 下，0.1.7（npx/pnpm）提升到顶层
`node_modules/`。`dependencies` 判据与布局无关。

### setup.ps1 的双格式产出

- **rc.3 格式**：展开占位符后写 `~/.dsh/.agent-presets/craft-bot/{agent.cordis.yml,preset.yml}`；
- **0.1.7 格式**：`scripts/gen-craft-bot-preset-017.mjs` 从**同一份**模板生成
  `data/dsh/craft-bot-preset-017/cordis.patch.yml`（含改名 + 技能路径重写 + 自检），
  再由 setup.ps1 注册为 profile bundle；
- 两者**共用一份模板**，避免双份漂移；生成物含本机绝对路径，已加入 `.gitignore`。

## 其他确认项

- **`dsh-bridge` 的 4 个待验证 API 全部在 0.1.7 上确认存在且签名一致**：
  `ctx.tools.register(defineTool)`、`ctx.systemPrompt.variable/context`、
  `ctx.webServer.register({ kind: 'prefix', ... })`、client 侧
  `sessions.list.getSnapshot()` + `agentPreset`。跑 `scripts/verify-in-harness.mjs`
  在 rc.3 与 0.1.7 上**均为 17/17 通过**。
- **会话日志 v0→v4 自动升级**（`dsh-session-format-v0-to-v1` … `-v3-to-v4` 链）。
- **`DSH_HOME`** 在 0.1.7 经 `@deepseek-ai/dsh-home-paths` 正式支持
  （优先级：显式配置 > `$DSH_HOME` > `~/.dsh`）。
- **office 技能无冲突**：本地 `~/.dsh/skills/document-*` 声明的 name 是
  `docx/pptx/xlsx/pdf`（rank 400），0.1.7 内置的是 `office-docx/...`（rank 600），
  名字不同且本地优先。
- **安装体积**：0.1.7 585 MB（含 `libreoffice-kit-win32-x64` 325 MB）vs rc.3 213 MB。

## 复现/验证命令

```powershell
# 门禁判定（单插件）
node -e "const s=require('semver');console.log(s.satisfies('0.1.7-rc.1','0.1.5-rc.3 || 0.1.7-rc.1',{includePrerelease:true}))"

# 0.1.7 后端判别（真实 boot，隔离 DSH_HOME）
$env:DSH_HOME='<隔离目录>'; node <runtime-017>\lib\bin.js --profile <p> --port <空闲端口> --no-open
# 然后 GET /dsh-key-fallback/diag 看 [settings] backend = ...

# preset 双版本验证
node scripts/gen-craft-bot-preset-017.mjs          # 生成 0.1.7 格式
node <dsh>\lib\bin.js --profile <p> --dump-config  # 结构校验
```

## 教训

1. **"跳过"与"崩溃"是两回事**：门禁不满足只是 skip（退出码 0），但引用不存在的
   bundle 条目是致命错误（退出码 1）。适配时要分清，别以为"最多降级"。
2. **`includePrerelease` 忘了传会得出完全相反的结论**（7 个假阳性 vs 1 个真阳性）。
3. **微版本间的 API 差异可以很致命**：schemastery `3.18.2 → 3.18.4` 之间多了
   `.volatile()`，而这个方法的有无决定了配置能否导入。想双版本兼容就得写守卫。
4. **依赖 `package.json` 的 dependencies 做版本判据**，比探测目录布局稳健
   （npm 全局嵌套 vs npx/pnpm 提升，布局完全不同）。
5. **框架的"自我文档字段"不可信**：`dshCompat` 在新版里零命中，不参与任何逻辑。
6. **配置迁移是"全有或全无"**：一个段导入失败，整份 settings.yaml 已被改名，
   配置只留在 `.imported` 里 —— 迁移类改动必须实测、不能只看类型定义。
