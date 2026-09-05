# connector 设置页无入口 + MCP 工具过滤（v0.3.0）

日期：2026-09-06。改动：`dsh-connector` 0.2.6 → 0.3.0（`index.js` / `client.js` /
`package.json` + 根 README + 插件 README + `docs/plugin-compatibility.md`）。

## 背景/问题

用户两件事：① 设置页左侧有 key-fallback「API Key 回退」入口，但 connector
「Connector 连接器」入口不显示（截图：通用设置/模型/Command Code/插件/Agent
预设/费用/归档会话/喵记忆/插件市场/API Key 回退/侧边卡片——无 Connector）；
② 新增"工具过滤参数"：可对特定 MCP server 只放行部分工具（如 tinyfish
15 个工具只留 `search`/`fetch_content` 两个免费的）。

## 根因①：client.js 缺 `exports.inject = ['slots']`

- 与 `dsh-key-fallback/lib/client.js` 尾部逐行对照：key-fallback 有
  `exports.inject = ['slots']`，connector 没有。
- 官方参照（`dsh-client-ui-settings-general/lib/client.js`）：
  `const inject = ["slots", "locale", ...]` + `exports.inject = inject`——`slots`
  是 client fiber 的**服务名**，缺了它 fiber 可能在 slots 就绪前跑 apply，
  `ctx.get('slots')` 得 `undefined` 直接 return，注册静默丢失。
- 曾走弯路：先怀疑 `package.json` 的 `dsh.client.inject: ["slots"]` 是裸词非法；
  深查 `dsh-client-modules/lib/index.js`（`orderByModuleGraph` 只处理 `external`，
  `inject` 只管排序等待）后确认该字段不致命——真门是 factory 的 `exports.inject`。
  教训：先把源码查到可验证结论再问用户，不要让用户为错误前提做选择。
- 修复：一行 `exports.inject = ['slots']`，尾部与 key-fallback 同构，
  `node --check` 通过。

## 设计②：工具过滤（规则存 settings，三件套生效）

- 前提核查：`@deepseek-ai/dsh-mcp-client` 的 Config schema 是**封闭的**
 （`lib/types/index.d.ts`），未知键拒收且会导致下次启动失败——规则**不能**
  写进 mcp-* 行的 config。用户拍板：存 `settings.yaml` 的 `connector` 命名空间
  （`toolFilters: {<serverName>: {allow: [rawTool...]}}`），无配置 = 全量放行。
- 做法抄 `hyqhyq3/dsh-mcp-manager`（Settings→MCP 页、OAuth/PKCE、自研 host 直连；
  包声明 `dsh.client.inject: ["@deepseek-ai/dsh-client-runtime",
  "@deepseek-ai/dsh-client-ui-settings"]`——注意前者在当前 DSH 已不存在，
  说明 inject 目标包改名/拆除是常态，更印证 connector 之前的 `["slots"]`
  包声明写法是错的、factory 声明才是正道）：
  1. `systemPrompt.tools(provider)` —— 每次 assembly 求值，被滤工具不进 schema；
  2. `ctx.tools.guard` —— 同步执行期硬拦截，返回 reason 即拒收；
  3. UI —— 每 server 卡片下 chips 多选（`GET /api/mcp/tools/:serverName`
     读 `tools.schemas()` 实时注册；`GET/PUT /api/mcp/filters` 读写规则，
     PUT 经 `settings.update` 落盘，保存后**新会话即生效**）。
- 公开名反解 `mcp__<server>__<raw>`：按 `__` 切分取第一段为 server（serverName
  本身可含单下划线，双下划线分隔无歧义），余下 join 回 raw；纯函数 8 例单测全过。
- 新增 peer `@deepseek-ai/schemastery: 3.18.1 || 3.18.2`（与 key-fallback 同版本；
  实测在位 3.18.2；`z.dict/z.array` 写法抄 dsh-mcp-client 的 Config schema）。
  host 对 settings/tools/systemPrompt 全部 `ctx.get` 可选读 + try/catch，
  无服务时静默全放行（抗崩溃架构不变）。

## 可复用要点

- 排查"设置页无入口"：先对照同仓正常插件的 client 尾部（exports.inject），
  再查 `dsh-client-modules` 的 graphRow/inject 语义，不要停在 package.json 猜。
- `settings.register(ns, schema, {base})` + `scope.get()/watch()/update()` 是
  插件自有配置的标准做法（ns 须匹配 `^[a-z][a-z0-9-]*$`）；schemastery 有
  `z.object/z.array/z.dict/z.string/z.boolean/z.number/z.union/z.const`。
- `tools.guard` 读快照（同步函数）+ `settings.watch` 刷新快照，是"配置热更新 +
  执行期拦截"的标准组合。
- 本地验证链：`node --check` 双文件 + 纯函数单测 + `pnpm add link:` 切本地调试
  + 重启 DSH 看设置页 + 发版打 tag 走 publish.yml。
