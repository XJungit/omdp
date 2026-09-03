# DSH next (`0.1.2-rc.1`) 兼容性核查：三插件源码零改动兼容

> 分类：`dsh-compat/` · 日期：2026-09-03

## 背景

DSH npm `dist-tags`（2026-09-03 实测）：`latest=0.1.1-rc.2`（本机部署）、`next=0.1.2-rc.1`、
`alpha=0.1.2-alpha.5`。用户要求核查 omdp 三个插件（connector / vision-bridge / key-fallback）
与 DSH next 最新版的兼容性。

## 结论

**三插件源码零改动即可兼容 `0.1.2-rc.1`**（hard guarantee 不变，插件不会让 DSH 崩）。

核心依据：`@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-settings`
三个配套包从 `0.1.2-alpha.2` → `0.1.2-alpha.3` → `0.1.2-alpha.4` → `0.1.2-alpha.5` → `0.1.2-rc.1`
**逐字节一致（`Compare-Object` 全部 NO DIFF）**。而这三个包正是 `dsh-key-fallback` 与
`dsh-vision-bridge` 消费 `ctx.credentials` / `ctx.llm` / `ctx.settings` 的配套包。

## 逐项核查的 API 面（next 保留）

| API 面 | next 状态 | 消费方 |
|---|---|---|
| `credentials.resolve/set/unset/describe` | `describe` 返回 `{configured, source, writable}`；`credentialRef`/`isCredentialRefName` 导出保留 | key-fallback |
| `ctx.llm.registerAdapter`/`stream`/`listProviders`/`listConfigurableProviders`/`resolveModelInfo`/`inputModalities` | 全部保留（`registerAdapter(providers, adapter)` 契约同） | vision-bridge、key-fallback |
| `ctx.webServer.register({kind:'prefix'/'exact'})`、`ctx.get('webServer')?.port`/`.host` | 保留（dsh-web-app rc.1 index.js 使用） | connector、key-fallback、vision-bridge |
| `agent/request` / `agent/request-error` / `agent/pre-step` 载荷 | 保留 | key-fallback、vision-bridge |
| `tools.register(definition)`、`attachments.readImage` | 保留 | vision-bridge |
| client `window.__ModuleLoader__.load({id, factory})` | 保留（`/plugins/<id>/client.js` 加载） | 三插件 client |
| 常量码 `QUOTA`/`RATE_LIMIT`/`EMPTY_RESPONSE`/`INVALID_CREDENTIAL`/`TRANSPORT`/`SERVER` | 保留（dsh-llm rc.1 导出） | key-fallback rotateOn |

DSH 主包依赖：`cordis ^4.0.2`（枚举 `4.0.1 || 4.0.2` ✓）、`schemastery ^3.18.2`（枚举 `3.18.1 || 3.18.2` ✓）、
node engines `^22.19.0 || >=24.0.0` 不变。

## 唯一动作：key-fallback peer 枚举追加

按仓库规范 3（只枚举实测版本），把 next 系列追加进 `@omdp/dsh-key-fallback` peer：
credentials 追加 `0.1.2-alpha.3/4/5`、`0.1.2-rc.1`；llm/settings 追加同 `0.1.2-rc.1`。
全部经逐字节比对确认一致才放行（不预先声明未核查版本）。

## 可复用要点

1. **判断 next 兼容的关键**：不必逐 tag 看 DSH 主包 release note，直接 diff 插件实际消费的
   配套包源码（tar 解包后 `Compare-Object`）最可靠。本案例 alpha.2→rc.1 三大配套包逐字节一致，
   等价于插件 API 面零变化。
2. `dsh-credentials`/`dsh-llm`/`dsh-settings` 的 `lib/index.js` 是**版本稳定的单一入口**，
   npm `pack` 后解包比对着 release note 猜更严谨。
3. peer 枚举从 alpha.2 追加到 rc.1 的完整链条已实测，后续同 `0.1.2-*` 预发布若再出现，
   需同样逐字比对再放行（规范 3 铁律）。
