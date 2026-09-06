# connector prompt 层过滤改走 assemble waterfall 真替换（v0.3.2）

日期：2026-09-06。改动：`dsh-connector` 0.3.1 → 0.3.2（`index.js` + `package.json`）。

## 背景/问题

0.3.1 修好了 register 落地（`GET /connector/api/mcp/filters` 返回 tinyfish allow，
UI 显示"已过滤 2/16"），但模型侧新会话**依然可见 16 个全量工具**。

## 根因：systemPrompt.tools(provider) 是追加合并语义

dsh-system-prompt 的 assembly 逻辑（`lib/index.js`）：

```js
const providers = [...this.layers.global.toolProviders.values(), ...scopeLayers.flatMap(...)];
for (const provider of providers) { collected.push(...schemas); ... }
```

**所有 provider 的 schemas 拼在一起**。0.3.0/0.3.1 用 `systemPrompt.tools(() => 过滤子集)`
注册 provider，只是多提供一份 2 个工具的子集，mcp-client 自己的全量 16 个照样输出，
合并后还是 16 个——只能加不能减。

## 成熟参照：hyqhyq3/dsh-mcp-manager

通读其 `lib/index.js`，它根本不用 `systemPrompt.tools()` 做减法，而是：

```js
ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
  const assembled = await next();
  ...
  return { ...assembled, tools: assembled.tools.filter((tool) => !isMcpToolName(tool.name)) };
}, { prepend: true, global: true })
```

三要素：① 监听 `system-prompt/assemble`；② `await next()` 拿最终 assembly 后
**返回新对象替换 tools 数组**；③ `{ global: true }` 让 scope filter 放行
（dsh-scope `scopeTarget` 的 carrier filter 有 `hook.global || ...` 短路）。

## 修复（0.3.2）

删掉 `systemPrompt.tools(...)` 追加 provider，改用同一机制（正向 allow 语义）：

```js
ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
  const assembled = await next()
  if (!assembled || !Array.isArray(assembled.tools)) return assembled
  const kept = assembled.tools.filter((t) => isToolAllowed(toolFilters, t && t.name))
  if (kept.length === assembled.tools.length) return assembled
  return { ...assembled, tools: kept }
}, { global: true })
```

`tools.guard` 执行期硬拦截保留（双保险）。`node --check` 通过。

## 验证

发布 0.3.2 后 web profile 更新重启，新会话 `mcp__tinyfish__*` 应只剩
`search` / `fetch_content` 2 个。
