# DSH v0.1.2-alpha.2 兼容性核查：三插件零改动兼容

> 分类：`dsh-compat/` · 日期：2026-08-31

## 背景

DSH 于 2026-08-30 发布 `v0.1.2-alpha.2`（tag `dsh-v0.1.2-alpha.2`，未发 npm，Pre-release）。
在 alpha.1 适配（见同日笔记）建立的 API 面清单基础上做**增量对比**（alpha.1 → alpha.2）。

## 结论

**connector / vision-bridge / key-fallback 三插件零改动兼容 alpha.2**，
无需发新 npm 包（key-fallback 3.1.2 的 peer 三段式已覆盖，semver 实测 `0.1.2-alpha.2 => true`）。

## 逐项核查（alpha.1 → alpha.2 diff）

| API 面 | 变化 | 影响 |
|---|---|---|
| `webServer.register({kind:'prefix'})` | **src 零变化**（仅 package.json） | connector / key-fallback ✓ |
| `agent/request(-error)` / `pre-step` 载荷 | `runtime-types.ts` 零变化；agent 包纯新增 `TurnBoundaryProjection` 投影类型 | key-fallback / vision-bridge ✓ |
| `credentials.credentialRef` 等导出 | 签名不变，内部 `as` 断言改 `brandString()`（运行时等价） | key-fallback 静态 import ✓ |
| settings 服务 | 注册名 `settings`、`get/update/replace/mutate` 方法面不变；内部重构（`settingsNamespace`→`parseSettingsNamespace`、`deepEqualJson`/`deepFreeze` 抽到新包 `@deepseek-ai/dsh-util-values`） | key-fallback（只 inject 服务名 + 直读 settings.yaml）✓ |
| llm 服务名 + `resolveModelInfo(provider, model, signal)` | 不变；src 变化是 import 重构（brand/never/call-config 整理） | vision-bridge ✓ |
| `tools.register(definition)` | 签名不变；变化是 util-values 抽包 import 重构 + ptc 常量清理 | vision-bridge ✓ |
| `attachments.readImage` | **src 零变化** | vision-bridge ✓ |
| client modules（`__ModuleLoader__` / `/plugins/<id>/client.js`） | **src 零变化** | 三插件 client ✓ |
| `settings.section` slot 契约 | `ui-settings/src/client/contract/slots.ts` **零变化**（官方 ui-settings 自身从 connection handle 迁移到 `ctx.remote.$host`，属内部实现） | key-fallback / vision-bridge client ✓ |
| Node engines | `^22.19.0 || >=24.0.0` 不变 | ✓ |
| 包版本 | 全部 `0.1.2-alpha.2`；官方 peer 仍 `workspace:^` | key-fallback peer 覆盖 ✓ |

## release notes 三个关注点的判定

1. **「优化 NPM 包中的 peer dependency」**——官方包自身的 peer 精简（降解析成本），不触及插件 peer。
2. **「恢复 `SessionEvent.ignorable`」**——恢复 alpha.1 移除的会话事件标志；三插件不消费该字段。
3. **「Remote 网关统一 RemoteError 异常封装」**——llm 的 TypertRemote 调用异常类型统一；
   插件侧 `try/catch` 防御依然有效（vision-bridge 的 `resolveModelInfo` 调用有兜底），无影响。

## 可复用要点

1. 增量适配流程已成型：`GIT_CONFIG_GLOBAL=空文件` + `git fetch <直连URL> refs/tags/<tag>:refs/tags/<tag>`
   → `git diff <旧tag> <新tag> -- <关键包清单>`（关键包清单见本笔记表格第一列）。
2. 判断兼容看**插件实际消费的签名/载荷/slot 契约**，import 重构、内部函数改名（未导出或插件未用）一律不算破坏。
3. peer 三段式枚举（rc.6/rc.2/0.1.2 系列）天然覆盖后续 `0.1.2-alpha.*`，同系列新预发布无需改 peer。