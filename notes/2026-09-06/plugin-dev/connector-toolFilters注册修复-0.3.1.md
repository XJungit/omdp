# connector toolFilters 不生效：ctx.inject 回调签名误用（v0.3.1）

日期：2026-09-06。改动：`dsh-connector` 0.3.0 → 0.3.1（`index.js` + `package.json`）。

## 背景/问题

0.3.0 的 MCP 工具过滤配置后**不生效**：`settings.yaml` 里
`connector.toolFilters.tinyfish.allow=[search, fetch_content]` 已写，重启后
模型侧依然可见 tinyfish 全部 16 个工具（UI 设置页也显示"未配置 = 全量放行"）。

## 排查证据链（按顺序）

1. `GET /connector/api/mcp/filters` → `{"filters":{}}` —— `readToolFilters` 运行时读到空；
2. schemastery 本地重建 `ToolFilterSchema` 喂同一份值 → `PARSE OK` —— schema 本身无问题；
3. `PUT /connector/api/mcp/filters`（写规则）→ 500
   `settings namespace "connector" is not registered` —— **`settings.register` 从未落地**；
   且该错误来自 `SettingsProvider.update` 内部，说明 `ctx.get('settings')` 非空（服务活着），
   只是 registrations 里没有 `connector`。

## 根因：cordis `ctx.inject(deps, cb)` 的 callback 签名

0.3.0 的 `apply()` 里写：

```js
ctx.inject(['settings'], (settingsCtx) => {
  settingsCtx.settings.register(CONNECTOR_SETTINGS_NS, ToolFilterSchema, ...)
})
```

核对 dsh 内置 cordis 源码（`lib/index.js`）：

```js
inject(inject, callback) {
  return this.plugin({ inject, apply: callback, name: callback.name })
}
```

`ctx.inject` 的 callback 是被当作**插件 body** 调用的，签名是 `(ctx, config)`，
**不是**按依赖顺序展开的服务参数。于是 `settingsCtx` 是子 fiber 的 ctx 对象，
`settingsCtx.settings` 拿不到 settings 服务（undefined → `undefined.register` 抛
TypeError，子 fiber 静默失败），register 从未执行 → `toolFilters` 恒为 `{}` → 全放行。

记忆：`ctx.inject(['settings'], cb)` 与 `ctx.inject` 的**声明式依赖**
（`export const inject = ['webServer']`）是两回事：前者是运行时动态注入且回调
按 `(ctx, config)` 调用，后者是插件启动等待列表。

## 修复（0.3.1）

1. `export const inject = ['webServer', 'settings']` —— settings 服务就绪后插件才 apply；
2. `apply()` 里改为同步拿服务并注册：

```js
const settings = ctx.get('settings')
let toolFilters = {}
const refreshFilters = () => { toolFilters = readToolFilters(ctx) }
if (settings) {
  try {
    const scope = settings.register(CONNECTOR_SETTINGS_NS, ToolFilterSchema, { base: { toolFilters: {} } })
    refreshFilters()
    ctx.effect(() => scope.watch(() => refreshFilters()), 'connector: watch tool filters')
  } catch (error) { console.error('[dsh-connector] register tool filter settings failed:', error?.message ?? error) }
}
```

`readToolFilters` 里的 `settings.get(ns)`（service 级 get 返回 resolved）保持不动。

## 验证

- `node --check index.js` 通过；
- 发布 0.3.1 后 web profile 装新包重启，`GET /connector/api/mcp/filters` 应返回
  `{"filters":{"tinyfish":{"allow":["fetch_content","search"]}}}`，模型侧只剩
  `mcp__tinyfish__search` / `mcp__tinyfish__fetch_content`。
