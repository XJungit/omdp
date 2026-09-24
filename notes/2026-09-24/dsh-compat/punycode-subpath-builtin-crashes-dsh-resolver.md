# `punycode/` 触发 DSH 0.1.7 解析器崩溃：内置模块「子路径形式」的坑

日期：2026-09-24
插件：`@omdp/dsh-connector`（0.3.2 → 0.3.3）

## 背景 / 问题

DSH 升到 `0.1.7-rc.1` 后，connector 在**模块 import 期**就 `failed to import`：

- 设置页那行永远停在「**已安装，重启后生效**」（fiber 从未激活，UI 拿不到新状态）；
- `/connector/api/*` 全部 404（与任意未知路由字节一致 ⇒ 主机兜底 404，说明路由从未注册）；
- **重启无效**（抛错是确定性的，不是瞬时态）。

启动日志：

```
TypeError: createRequire.resolve.paths is not a function or its return value is not iterable
    at ResolutionRouter.routeScoped (…/dsh-app-boot/lib/index.js:1414:58)
    at routePath                 (…/dsh-app-boot/lib/index.js:1546:15)
    at Module.wrappedFilename [_resolveFilename] (…/dsh-app-boot/lib/index.js:1753:24)
```

## 结论 / 根因

DSH `0.1.7` 新增的 profile 包解析路由 `ResolutionRouter.routeScoped`（`dsh-app-boot/lib/index.js`）流程：

1. **L1156-1163 `barePackageName(specifier)`**：把 specifier 切成裸包名；
2. **L1414**：`for (const searchPath of createRequire(parent).resolve.paths(name))`
   —— **没有 `?? []` 兜底**（同文件 L880 的 `packageDirFromAnchor` 是有兜底的，新增 routeScoped 时漏了）。

Node 对**裸内置模块名**返回 `null`：

```js
createRequire(__filename).resolve.paths('punycode')   // → null      ← 迭代 null 直接抛
createRequire(__filename).resolve.paths('punycode/')  // → [ ...完整查找路径数组... ]
```

**精确触发请求已锁定为 `require("punycode/")`**（带子路径的**内置**模块名）：

- `tr46@5.1.1` 的 `index.js` 第 3 行就是 `const punycode = require("punycode/")`；
  `tough-cookie/lib/cookie.js:32` 同款；
- 依赖链：`jsdom@24.1.3` → `whatwg-url@14.2.0` → `tr46@5.1.1` → `require("punycode/")`；
- connector 是四个插件里唯一带深 CJS 依赖树（jsdom + ~40 传递依赖）的，其余插件无此路径。

### 关键实证：`isBuiltin` 与 null-`resolve.paths` **并不一致**

之前（被推翻的）分析认为「`barePackageName` 会先过滤 `isBuiltin(request)`，所以内建名不会走到 L1414」，并断言
`isBuiltin` 判定与 `resolve.paths` 返回 null **100% 一致**。**这是错的**：

| 表达式 | 结果 |
|---|---|
| `isBuiltin('punycode')` | `true` |
| `isBuiltin('punycode/')` | **`false`** ← 带子路径形式**不是**内建名 |
| `resolve.paths('punycode')` | `null` |
| `resolve.paths('punycode/')` | 完整数组 |

⇒ `punycode/` **不会**被 `isBuiltin` 提前放行，而是被切成裸名 `punycode` 后走进 L1414，命中 `null` 崩溃。
（普通 Node 解析 `require("punycode/")` 完全正常，会落到 `node_modules/punycode/punycode.js`——这是
DSH 解析器侧的缺陷，与 Node 语义不符。）

## 修复与残留风险（重要：不能宣称已根治）

DSH 的解析拦截由 `PluginPackages` 服务在**进程生命周期内常驻**安装
（`installRuntimeInterception()` patch 掉 CJS 的 `_resolveFilename` 与 ESM 的 `resolve`/`resolveSync`；
`dispose()` 只挂在 `ctx.effect` 的清理回调上，正常运行时**不会**被调用）。

因此「把 jsdom 改懒加载」**不是根治，只是把同一崩溃推迟到首次解 WAF 挑战时**：

```js
// 0.3.2：模块顶层 —— import 期就炸，整个插件失效
import { JSDOM, VirtualConsole } from 'jsdom'

// 0.3.3：仅市场 WAF 挑战求解时才拉起来
let _jsdom = null
async function loadJsdom() {
  if (_jsdom) return _jsdom
  const mod = await import('jsdom')
  _jsdom = mod.default && mod.default.JSDOM ? mod.default : mod
  return _jsdom
}
```

| | 0.3.2（顶层 static） | 0.3.3（懒加载） |
|---|---|---|
| 插件 import | ❌ 崩溃 ⇒ 设置页死的、全部路由 404 | ✅ 干净 |
| 设置页 / MCP / Skills / 工具过滤 | ❌ 全废 | ✅ 恢复 |
| 魔搭市场浏览（走 WAF 解） | ❌ （插件都没起来） | ⚠️ 首次解挑战时仍会抛，但被 `marketError` 包成 **502 + 明确 message**，不挂起 |
| 爆炸半径 | 整个插件 | 单个功能分支 |

**真正根治**要上游在 `dsh-app-boot` L1414 补 `?? []`。已实测该 WAF 挑战当前**未下发**
（`PUT https://www.modelscope.cn/api/v1/dolphin/mcpServers` 返回 HTTP 200、116103 字节、
无 `acw_sc__v2` / 无 `aliyunwaf`），所以该路径目前处于**休眠**状态。

## 可复用要点

- **排查 DSH 插件「import 期崩溃」时，先审插件第三方依赖图里有没有包 `require` 内置模块的
  子路径形式**（`punycode/`、`util/`、`events/`、`assert/` 等）。这类 specifier：
  `isBuiltin()` 判 **false**，但 `resolve.paths()` 会返回数组，于是被切名逻辑送进 L1414。
- **顶层 static import 会把依赖图的崩溃放大成「整个插件失效」**：fiber 建不起来 ⇒ 状态永远停在
  「已安装，重启后生效」⇒ 所有 HTTP 路由 404。改为按需 `await import()` 可把范围收敛到单功能。
  这条对任何「插件里有重量级/冷门第三方依赖」的场景都适用。
- **判定「重启是否生效」**：比对 3080 监听进程 `StartTime` 与被改文件 `LastWriteTime`
  （`Get-NetTCPConnection -LocalPort 3080` → `Get-Process -Id …`）。
- **判定「路由是否注册」**：404 空 body 无 Content-Type = 主机兜底（路由不存在）；
  插件 prefix 路由上方法不对会返回 **405**（说明路由存在）。
- 解析拦截常驻 ⇒ **任何**在运行期被动态拉起的包都可能踩同一个坑，不止 import 期。
  给用户报错时要留明确 message（本插件走 `marketError` → 502），别让它变成"卡住"。

## 相关文件

- `dsh-connector/index.js`：`loadJsdom()` / `solveWafFromChallenge()` / `dolphinPut()` / `marketError()`
- `dsh-connector/README.md`：§「为什么 jsdom 必须懒加载（0.3.3 修复）」
- `docs/plugin-compatibility.md`：§「DSH 0.1.7 兼容性专项 / 变更 4」
- 上游：`dsh-app-boot/lib/index.js` L1156-1163（`barePackageName`）、L1414（缺陷点）、
  L1622+（`installRuntimeInterception`）、`class PluginPackages`（拦截常驻）
