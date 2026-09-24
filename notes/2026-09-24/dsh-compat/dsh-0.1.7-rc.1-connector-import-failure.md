# DSH 0.1.7-rc.1：connector 无法导入（dsh-app-boot L1414 解析器缺陷）+ 重启未生效判定

> ⚠️ **本笔记的部分结论已被同日笔记更正**：精确触发请求**已锁定**为 `require("punycode/")`
> （`tr46@5.1.1`），下文「排除项」里「`isBuiltin` 与 `resolve.paths` 100% 一致」的说法**是错的**。
> 权威版见 `punycode-subpath-builtin-crashes-dsh-resolver.md`（含完整根因、修复与残留风险）。
> 本文件保留下来的是**操作层**的经验（重启判定、404/405 判定、门禁不受影响）。

## 背景 / 问题

- 线上 web profile 已升到 DSH 0.1.7-rc.1（npm dist-tag `next`；`latest` 仍是 0.1.5-rc.3）。
- 2026-09-24 两次启动中 connector（`@omdp/dsh-connector` 0.3.2）均 `failed to import`，
  `/connector/api/*` 全部 404（与未知路由字节一致 = 主机兜底 404，路由从未注册）。
- 用户问"我重启了是不是更新了"；交接报告要求确认 `[dsh-connector]` 加载行与
  模型选择器里的 `ninerouter`/`a6api`。

## 结论 / 根因

### 1. 重启未生效（操作层）

3080 监听进程 pid 24672 启动于 13:25:22，早于修复文件
`cordis.patch.yml`（13:31:25）与 `package.json`/`pnpm-lock.yaml`（13:35:33-34）
→ 运行中进程不含这些修复，需再次重启。

### 2. connector 导入失败（兼容层，重启救不了）

- 启动日志 `startup-2026-09-24T05-19-20.666Z-*.log` L286-289：

  ```
  TypeError: createRequire.resolve.paths is not a function or its return value is not iterable
      at ResolutionRouter.routeScoped (dsh-app-boot/lib/index.js:1414:58)
      at routePath (…:1546:15)
      at Module.wrappedFilename [_resolveFilename] (…:1753:24)
  ```

- 0.1.7-rc.1 `dsh-app-boot/lib/index.js` **L1414**：
  `for (const searchPath of createRequire(parent).resolve.paths(name))` —— **无 `?? []` 防护**；
  同文件 **L880**（`packageDirFromAnchor`）**有** `?? []`。0.1.7 新增 routeScoped 时漏掉了该防护
  （报错列号 58 恰好落在 `.paths` 属性访问上，已按 tab=1 列核对）。
- V8 报错措辞实测：`for (const x of r.resolve.paths('fs'))` 因 `paths('fs')===null`
  产生**逐字相同**的消息（`r.resolve.paths is not a function or its return value is not iterable`）
  → 触发条件 = 某裸包名的 `resolve.paths(name)` 返回 null。
- connector 是四个插件里唯一带深 CJS 依赖树（jsdom 及 ~40 个传递依赖）的；
  同为 CJS 的 key-fallback（js-yaml，零裸依赖）在 0.1.7-rc.1 正常加载（/dsh-key-fallback/providers 200）
  → 触发点在 jsdom 依赖图内部。
- 两次启动（13:19 / 13:25）依赖均在位（jsdom 24.1.3 / yaml 2.9.1 自 09-06 / 09-12 起在 profile 根）
  仍失败 → 判定为**确定性失败**，非瞬时态；0.1.7-rc.1 已是 `next` 最新（无 rc.2），上游未修。

### 3. 排除项（部分已被更正，见文首警示）

- ~~`barePackageName`（L1156-1157）会过滤 `isBuiltin(request)` 与含 `:` 的请求；
  实测 Node v24.20.0 上 `builtinModules` 全集 + 常见子路径内建名的
  `isBuiltin` 判定与 `resolve.paths` 返回 null **100% 一致**（0 mismatch）——
  精确触发请求仍未锁定（字符串字面量扫描未命中，疑为动态 require）。~~
  ❌ **此结论已被证伪**：`isBuiltin('punycode')` 为 `true` 但 `isBuiltin('punycode/')` 为 **`false`**，
  两者**并不一致**。带子路径的内建名不会被 `isBuiltin` 放行，会走进 L1414 并在 `resolve.paths` 返回
  `null` 时崩溃。触发请求 = `require("punycode/")`（`tr46@5.1.1` → `whatwg-url` → `jsdom`）。
  详见 `punycode-subpath-builtin-crashes-dsh-resolver.md`。
- schemastery / cordis 不受 DSH peer 门控：`evaluatePluginCompatibility` L294
  只校验 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`；connector 的
  schemastery `3.18.1||3.18.2` vs 线上 3.18.4 **不阻断加载**。✅ 仍然成立
  （所以 connector 的问题是 import 崩溃，不是门禁跳过——两者表现不同）。
- 普通 Node 下 `import('…/@omdp/dsh-connector/index.js')` 成功（IMPORT OK，
  依赖全部可解析）→ 模块图本身健康，问题只在 DSH 的 hooked loader 路径。✅ 仍然成立
  （正因如此，0.3.3 的懒加载修复才有效：绕过 import 期的 hooked loader）。

## 可复用要点

- **判定"重启是否生效"**：比对 3080 监听进程 StartTime 与被改文件 mtime：
  `Get-NetTCPConnection -LocalPort 3080` → `Get-Process -Id …` → `StartTime`，
  对照 `Get-Item` 的 `LastWriteTime`。
- **判定"路由是否注册"**：404 空 body 无 Content-Type = 主机兜底（路由不存在）；
  插件 prefix 路由的 GET 会命中方法守卫返回 405（路由存在）。
- **0.1.7-rc.1 的 L1414 缺陷修复前，connector 不得在 peerDependencies 声明 0.1.7-rc.1**（规范 3）；
  key-fallback 3.2.0 的 `0.1.7-rc.1` 声明有线上 200 佐证（commit fd02ef0），可保留。
  （connector 的 peer 只有 schemastery，本就不含 `dsh-*`，故实际不受此限。）
- **a6api ≠ 模型 provider**：它是 `~/.dsh/skills/gpt-image` 的中转端点
  （`api.a6api.com`，Key 在技能目录 `.env` 的 `A6_API_KEY`），永远不会出现在模型选择器。
- 缓解思路（**已于 0.3.3 实施**）：connector 把 `jsdom` 改为惰性动态 import——
  插件可激活并注册 MCP/skills 路由，市场抓取功能首次使用时才触碰 jsdom（可 catch）。
  ⚠️ 实施后的诚实结论：这是**缓解而非根治**（DSH 的解析拦截进程常驻，同一路径的崩溃只是被
  推迟到首次解 WAF 挑战时）——详见 `punycode-subpath-builtin-crashes-dsh-resolver.md`。

## 遗留

- ~~精确触发请求未锁定（需在真实 0.1.7 启动里 hook routeScoped 记录 request）。~~
  ✅ **已锁定**：`require("punycode/")`（`tr46@5.1.1`，经 `whatwg-url` 由 `jsdom` 引入）。
- 重启必须由用户手动执行：pid 24672 是本会话宿主进程，agent 杀它等于中断自身。
- `.compat-check/`（~200MB）待清理。
