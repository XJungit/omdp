# peerDependencies 改用「三元组区间」：逐版本枚举在 rc 迭代下必然过时

> 分类：`plugin-dev/` · 日期：2026-09-30
> **取代** `notes/2026-08-31/plugin-dev/peer-declaration-strictness.md`（「只枚举实测版本、禁开放范围」）。
> 该笔记的**动机仍然成立**（不许放行未测版本），但**实现手段已作废**——见下方「为什么枚举错了」。

## 背景：同一类故障连续发生了三轮

DSH 每发一个新 rc，三个声明了 `@deepseek-ai/dsh` peer 的插件就集体被门禁跳过：

| 轮次 | DSH 版本 | 现象 | 当时的处理 |
|---|---|---|---|
| 1 | `0.1.6-alpha.1 → 0.1.7-rc.1` | — | 0.3.4 起**开始**逐版本枚举 |
| 2 | `0.1.7-rc.2` | 插件项消失 | connector 0.3.5 / archived 0.3.7 / key-fallback 3.2.3 追加 rc.2 |
| 3 | `0.2.0-rc.1` | 插件项消失、路由 404/405 | connector 0.3.7 / archived 0.3.8 / key-fallback 3.2.4 追加 `0.2.0-rc.1` |
| 4 | `0.2.0-rc.2` | 同上 | **本轮：改为三元组区间**（connector 0.3.8 / archived 0.3.9 / key-fallback 3.3.2） |

关键事实：**每一轮的 API 面都是零变化**（逐文件 SHA256 实证）。故障从来不是"不兼容"，
而是**声明写法**——枚举把"我测过哪一版"和"我承诺兼容到哪一版"混为一谈，
于是每次 rc 都要改声明 + 重发包。

用户 2026-09-30 指示：

> 更新一下我的插件的版本声明规则，兼容 0.2.0 rc1 的话后续 rc 版本放行
> 比如 `>= 0.1.0 rc1 <0.1.1`

## 🔴 用户给的示例上界是漏的（必须写 `-0`）

用户示例 `>=0.1.0-rc.1 <0.1.1` 按字面实现**会漏放行**。实测：

```js
semver.satisfies("0.1.1-rc.1", ">=0.1.0-rc.1 <0.1.1",   { includePrerelease: true }) // true  ← 漏放行！
semver.satisfies("0.1.1-rc.1", ">=0.1.0-rc.1 <0.1.1-0", { includePrerelease: true }) // false ← 正确
```

原因：semver 里预发布排在正式版**之前**，`0.1.1-rc.1 < 0.1.1` 成立。
`-0` 是该三元组的**最小预发布**，以它为上界才是干净切割。

**这是本次最容易写错的一处**——`<0.2.1` 语法完全合法、看起来也更自然，
但会把下一个三元组的 rc 放进来自动放行，等于悄悄放宽了承诺范围。
已作为硬要求写入 `AGENTS.md` 规范 3。

## 规则（现行）

```jsonc
"@deepseek-ai/dsh": ">=0.2.0-rc.1 <0.2.1-0"          // ✅ 实测 rc.1 ⇒ 放行 rc.2/rc.3/正式版
"@deepseek-ai/dsh": ">=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0"  // ✅ 多三元组用 || 串联
"@deepseek-ai/dsh": "0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1"          // ❌ 逐版本枚举
"@deepseek-ai/dsh": ">=0.1.0-rc.6 <0.2.0"                             // ❌ 跨 minor 开放范围
```

- **每个 `[major,minor,patch]` 三元组一段**，上界 `<下一 patch>-0`；
- 同一三元组内自实测版本起的**后续预发布 + 正式版**视为兼容；
- **跨三元组必须重新核查**后再新增一段，未核查的宁可报 unmet peer；
- **例外**：`@deepseek-ai/cordis` / `@deepseek-ai/schemastery` **不进版本门禁**
  （实测门禁只检查 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 前缀），
  且版本稀疏无预发布链，**继续精确枚举**。

本次三个插件最终声明：

| 插件 | 新版本 | 声明 |
|---|---|---|
| `@omdp/dsh-connector` | 0.3.8 | `>=0.2.0-rc.1 <0.2.1-0` |
| `@omdp/dsh-archived-sessions` | 0.3.9 | `>=0.2.0-rc.1 <0.2.1-0` |
| `@omdp/dsh-key-fallback` | 3.3.2 | 四条 dsh peer 均为 `>=0.2.0-rc.1 <0.2.1-0` |

⚠️ **本轮同时收窄了支持面**：用户明确「就声明 0.2.0 的两个 rc 版本就行」，
故 `0.1.7` 线**不再声明**。需要在 0.1.7 上运行的用户应钉旧版
（connector `0.3.7` / key-fallback `3.3.1` / archived-sessions `0.3.8`）。
这是**有意的破坏性变更**，不是疏漏。

## 门禁实现事实（本轮复核，`dsh-app-boot@0.2.0-rc.2`）

```js
if (!Object.hasOwn(fields, "peerDependencies")) return void 0;   // 零 peer ⇒ 永不检查
// 只遍历 name === "@deepseek-ai/dsh" 或 name.startsWith("@deepseek-ai/dsh-")
if (requirement.trim() === "" ||
    !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true }))
  peers[name] = range;
```

两个要点：
1. `requirement` 是**整串**传给 `semver.satisfies` ⇒ `||` 原生可用，
   不需要自己拆分（旧笔记里"逐版本追加"的写法能工作正是因为这个）；
2. `cordis` / `schemastery` **根本不在遍历范围内** ⇒ 改它们对门禁毫无影响
   （用户也说「dsh 官方插件不用管」）。

判定用的 `runtimeVersion` 来自 `getDshRuntimeVersion()` = `dsh-app-boot` 自身
`package.json` 的版本，**不是** peer 包自己的版本。

## 验证方法（可复用）

装了真门禁后跑全矩阵，**每个插件 11/11 必须符合预期**：

```js
import { evaluatePluginCompatibility } from "@deepseek-ai/dsh-app-boot";
const pass = evaluatePluginCompatibility(manifest, {}, runtimeVersion) === undefined;
```

期望矩阵（本轮实测全绿）：

| 运行时 | 期望 | 说明 |
|---|---|---|
| `0.2.0-rc.1` / `rc.2` | PASS | 实测过的 |
| `0.2.0-rc.3` / `rc.9` | PASS | 同三元组后续 rc（**本次新增能力**，不必重发包） |
| `0.2.0` | PASS | 同三元组正式版 |
| `0.2.1-rc.1` / `0.3.0-rc.1` | BLOCK | 跨三元组，须重新核查 |
| `0.1.7-rc.1` / `0.1.7-rc.2` / `0.1.7-alpha.1` / `0.1.8-rc.1` | BLOCK | **本轮收窄后的预期行为** |

⚠️ 改完声明后若沿用旧测试脚本，会得到 6 个"失败"——那是脚本还在预期
`0.1.7` 放行。**收窄支持面时务必同步更新测试的期望值**，否则会误判为回归。

`npm pack` 后要**再对打包产物复核一次**（不要只测源码目录），
确认 tarball 里的 manifest 带的是新声明。

## 可复用要点

1. **枚举 ≠ 严谨**：枚举把"测过什么"变成"必须逐版维护的清单"，
   在 rc 密集迭代的项目里必然腐化。区间才是"声明 = 承诺范围"的正确表达。
2. **上界永远带 `-0`**：`<X.Y.Z` 会漏放行 `X.Y.Z-rc.n`（实测 true）。
3. **改声明后必须跑真门禁全矩阵**，不能只靠 `semver.satisfies` 手算——
   门禁还叠加了"只检查 dsh 前缀"和"整串传参"两层语义。
4. **收窄支持面要显式声明为破坏性变更**，并在 README 里给出"需要旧版请装哪个版本"，
   否则老用户只会看到插件神秘消失（门禁是**优雅跳过**，不报错）。
5. **cordis / schemastery 不进版本门禁**，不必跟着改（改了也不生效）。

## 涉及文件

- `AGENTS.md`（规范 3 重写为三元组区间）
- `dsh-connector/package.json` + `README.md`
- `dsh-archived-sessions/package.json` + `README.md`
- `dsh-key-fallback/package.json` + `README.md` + `README.zh-CN.md`
- `README.md`（根，双语）
- `docs/plugin-compatibility.md`（多处枚举描述 + rc.2 专项的「处理结果」）
- `notes/2026-08-31/plugin-dev/peer-declaration-strictness.md`（被本笔记取代）
