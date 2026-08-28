# DSH v0.1.2-alpha.1 适配：API 全兼容 + npm semver 预发布规则的坑

> 分类：`dsh-compat/` · 日期：2026-08-28

## 背景

用户要求将三个插件（connector / key-fallback / vision-bridge）适配 DSH 新版
`v0.1.2-alpha.1`（2026-08-27 发布，tag 名 `dsh-v0.1.2-alpha.1`，**未发布 npm**，
纯源码形态），同时兼容当前版本 `0.1.1-rc.2`。结果：**三插件源码零改动**，
仅 key-fallback 的 `peerDependencies` 放宽。

## 过程与结论

1. **版本与包名**：alpha.1 各包统一 version `0.1.2-alpha.1`；cordis / schemastery
   latest 仍为 4.0.1 / 3.18.1（key-fallback 的 peer 声明天然兼容）。
2. **API 面逐字对比**（本地 `git -C dh-harness-src diff rc.2 alpha.1`，绕过 ghproxy
   用 `$env:GIT_CONFIG_GLOBAL=空文件` 直连 fetch 两 tag）——全部向后兼容：
   - `webServer.register({kind:'prefix'})` 签名未变（alpha.1 仅新增 gzip 中间件）
   - `agent/request` / `agent/request-error` 事件载荷两版本逐字节一致
   - `credentials` reference 半边（resolve/describe/set/unset/credentialRef）稳定
   - client `slots.inject('settings.section')` + `register` API 未变
   - `attachments.readImage` / `tools.register` / `llm.resolveModelInfo` 未变
   - `/plugins/<id>/client.js` + `__ModuleLoader__` 加载机制保留
   - Node 要求两版本相同（`^22.19.0 || >=24.0.0`）
3. **connector / vision-bridge 零静态 `@deepseek-ai/` 依赖**（全走 `ctx.*` 注入
   服务），天然双版本兼容，无需任何改动。

## 关键坑：npm semver 预发布版本规则

**现象**：`^0.1.0-rc.6` 对 `0.1.1-rc.2` 和 `0.1.2-alpha.1` 均 `satisfies = false`，
甚至 `>=0.1.0-rc.6 <0.2.0` 也不匹配这两个版本。

**根因**：npm semver 的预发布匹配规则——当 range 含 pre-release 时，只匹配
**同 `[major,minor,patch]` 三元组**的 pre-release。`0.1.0-rc.6` 的 range 只放行
`0.1.0-*` 系列，`0.1.1-rc.2`（0.1.1 系列）与 `0.1.2-alpha.1`（0.1.2 系列）
即便数值更大也不会被选中。

**修复**：peer 必须显式枚举各系列：

```json
">=0.1.0-rc.6 <0.2.0 || >=0.1.1-0 <0.2.0-0 || >=0.1.2-0 <0.2.0-0"
```

`-0`（如 `0.1.1-0`）是「该三元组任意预发布」的通配写法。已同步到工作区
`dsh-key-fallback/package.json` 与部署目录
`C:\Users\xj\.dsh\profiles\web\node_modules\@omdp\dsh-key-fallback\package.json`
（备份 `before-alpha1-peer.json`）。

## 验证

- 三插件 `node --check` 全过；
- key-fallback 回归：smoke 33/33 + 集成 49/49 通过（peer 放宽未破坏任何功能）；
- 结论已写入 `docs/plugin-compatibility.md` 顶部适配注记。

## 可复用要点

1. 未来适配 DSH 新版本：先 `git fetch` 两个 tag 做**本地源码 diff**（gh api compare
   只返回前 300 文件，被 .agents/notes 撑满，不可靠）。
2. 判断兼容要看插件**实际调用的 API 签名**，而非大版本号。
3. peer 声明的预发布范围一律显式枚举系列，别依赖 caret/tilde。
4. alpha.1 未发 npm，无法真机安装实测，只能用源码对比 + 回归验证；真机验证待其转正。