# DSH 0.1.7 的插件版本门禁：`@deepseek-ai/dsh` peer 怎么读、怎么写

日期：2026-09-24
涉及：`dsh-app-boot` 的 `evaluatePluginCompatibility` / `pluginCompatibilityWarning`；三插件
（`connector` 0.3.4 / `key-fallback` 3.2.2 / `archived-sessions` 0.3.6）的 peer 声明

## 背景 / 问题

用户要求「三个插件声明一下 DSH 版本支持」。要写对这条声明，必须先弄清三件事：
① 声明写在哪个 peer 名下、② 声明的 range 是拿什么跟什么比、③ 不满足时会发生什么。
三者都**不能靠印象猜**（`AGENTS.md` 铁律：先研读 DSH 源码）。本笔记是核查结论。

## 结论 / 机制

源码位置：`dsh-app-boot/lib/index.js` 的 `evaluatePluginCompatibility(manifest, exemptions, runtimeVersion)`。

1. **只认 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 前缀的 peer**：
   ```js
   if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue
   ```
   其他 peer（`@deepseek-ai/cordis`、`schemastery`、任意第三方）**完全不参与门禁**。
   没有 `peerDependencies` 时函数直接返回 `undefined`（= 放行）。
2. **range 是拿「DSH 运行时版本」比的，不是拿 peer 包自己的版本**：
   ```js
   if (requirement.trim() === "" || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true }))
     peers[name] = requirement
   ```
   `runtimeVersion` 来自 `getDshRuntimeVersion()` → 读 **`dsh-app-boot` 自身 `package.json` 的 version**。
   所以 `"@deepseek-ai/dsh": "0.1.7-rc.1"` 的语义 = 「我实测过运行版为 `0.1.7-rc.1` 的 DSH」。
   （易误读点：这不是在要求 peer 包 `@deepseek-ai/dsh` 的版本。）
3. **不满足的后果 = 优雅跳过，不是崩溃**：
   - 启动时（`loadProfileDirectory` 内）抛 `pluginCompatibilityWarning` → 被 catch →
     stderr 打 `dsh: skipping profile bundle "<pkg>"` ⇒ **整个 bundle 不加载**，DSH 本体照常启动。
   - 安装时（preflight）→ 该条目被置 `disabled`。
   - 豁免：`dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <ver> --accept-risk`
     写 `profiles/<p>/compatibility.json`（按 `name@version` + 精确 runtimeVersion 授权）。
4. **门禁本身只存在于 0.1.7**（这是最关键的定界）。逐版解包 `@deepseek-ai/dsh-app-boot` npm tarball
   统计 `evaluatePluginCompatibility` 出现次数：

   | `dsh-app-boot` | 命中 | 门禁 |
   |---|---|---|
   | `0.1.5-rc.2` / `0.1.5-rc.3` / `0.1.6-alpha.1` / `0.1.6-alpha.2` | 0 | ❌ |
   | `0.1.7-alpha.1` / `0.1.7-alpha.2` | 0 | ❌ |
   | `0.1.7-rc.1` | 4 | ✅ |

   ⇒ 在 `≤0.1.6` 与 `0.1.7-alpha.x` 上，声明任何 `@deepseek-ai/dsh*` peer **不产生任何约束**
   （只是「不认识的声明」，插件照常加载）。这就是「只声明 `0.1.7-rc.1`」不伤害老用户的原因——
   老运行时根本不看这条声明。

## 采用的声明与理由

三个插件统一声明（逐版本枚举，无 range/caret——`AGENTS.md` 规范 3）：

```json
"peerDependencies": {
  "@deepseek-ai/dsh": "0.1.7-rc.1"
}
```

- **只写 `0.1.7-rc.1`（不补 `0.1.5-rc.x`/`0.1.6-alpha.1`）**：老运行时无法被这条声明约束，
  写进去纯装饰、无法验证；而**未实测的新版本必须被拦下**（规范 3：宁可报 unmet peer 也不预先放行）。
  本机实测运行版 = `0.1.7-rc.1`，故只声明它。
- **副作用要知情**：`connector`/`archived-sessions` 原先 peer 里没有 `dsh-*` 项 ⇒ **不受门禁**；
  加上这条后就在 0.1.7+ 上**纳入门禁**了。日后 DSH 升到未实测版本时，它们会被优雅跳过
  （设置页整项消失）——这既是保护也是提醒。
- **声明前的安全性验证**：已在 profile-like 项目里实测 `pnpm install` 带这条 peer 零摩擦
  （`autoInstallPeers: false`；`@deepseek-ai/dsh` 不会被强制安装）；且 `routeLinked` 的解析拦截只对
  **已在 `resolution.entries` 里**的名字生效，故「声明一个没安装的 peer 名」对模块解析是惰性的。

## 验证方法（可复现，不用真启动 DSH）

`evaluatePluginCompatibility` 与 `pluginCompatibilityWarning` 都是 `dsh-app-boot` 的**公开导出**，
可直接拿真实 `package.json` 跑：

```js
// 放在 profile 目录下执行（需要能 resolve '@deepseek-ai/dsh-app-boot'）
import { evaluatePluginCompatibility, pluginCompatibilityWarning } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
const m = JSON.parse(readFileSync('D:/WorkSpace/omdp/dsh-connector/package.json', 'utf8'))
console.log(evaluatePluginCompatibility(m, {}, '0.1.7-rc.1'))  // undefined  = 正常加载
console.log(evaluatePluginCompatibility(m, {}, '0.1.8-rc.1'))  // { peers:{...} } = 被拦下
```

实测三插件（peer = `0.1.7-rc.1`）：运行时 `0.1.7-rc.1` → `LOAD`；
`0.1.7-alpha.2` / `0.1.6-alpha.1` / `0.1.5-rc.3` / `0.1.8-rc.1` → `SKIP`。
（老版本那几行 SKIP 只是**函数层面**的判定；真实老运行时里没有这个函数、不会被调用——见上表。）

## 可复用要点

- **门禁的「版本」有两个，别搞混**：被检查的是**运行时版本**（`dsh-app-boot` 的 version），
  不是 peer 包自己的版本。写声明时脑子里念的是「我实测过的 DSH 版本」。
- **新机制的引入时间必须靠跨版本存在性扫描定界**，不能靠 diff 相邻版本——
  `evaluatePluginCompatibility` 在 `0.1.7-alpha.2 → 0.1.7-rc.1` 之间出现，若只比 `0.1.6 → 0.1.7`
  的「删除行」是发现不了的。手法：**逐版 `npm pack` + 解包 + 统计符号命中数**。
- **semver 预发布语义**：`satisfies(runtime, range, { includePrerelease: true })` 下，枚举式
  `||` 列表等价于**精确版本白名单**（`'0.1.7-rc.1'` 只匹配 `0.1.7-rc.1`；`0.1.7-rc.2` 不匹配）。
  故「逐版本枚举」是让它变成白名单的正确写法，符合规范 3。
- **第三方插件无法「声明得更宽松」来规避**：门禁只看 `dsh-*` peer 的存在与 range，
  要放行未实测版本只能追加进枚举（或让用户写 `compatibility.json` 豁免，风险自负）。
- **`dshCompat` 字段不参与门禁**（0.1.7 源码零命中）——它只是自我文档，别指望它有约束力。

## 相关文件

- `dsh-app-boot/lib/index.js`：`evaluatePluginCompatibility()` / `pluginCompatibilityWarning()` /
  `getDshRuntimeVersion()` ／ 调用点（`loadProfileDirectory` 启动检查、安装 preflight）
- `dsh-connector/package.json`、`dsh-key-fallback/package.json`、
  `dsh-archived-sessions/package.json`：新增的 `@deepseek-ai/dsh` peer
- `docs/plugin-compatibility.md`：0.1.7 专项「变更 1：profile bundle 版本门禁」（含易误读点与验证脚本）
- 各插件 `README.md`：新增的「兼容性门禁」小节 + Troubleshooting 条目
- 另见：`notes/2026-09-24/dsh-compat/connector-toolfilters-stranded-not-migrated.md`（同一轮修复）
