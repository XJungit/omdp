# `process.env` 写不进 DSH 凭据层：key 回退轮换「看起来生效、其实没生效」的根因

**日期**：2026-09-29
**类别**：dsh-internals
**涉及插件**：`@omdp/dsh-key-fallback` 3.2.4 → **3.3.0**
**DSH 版本**：桌面端 `0.2.0-rc.1`

## 背景 / 问题

`dsh-key-fallback`（≤ 3.2.4）切换 API key 的方式是：

```js
process.env[pool.cfg.env] = key.value   // 旧实现，5 处
```

UI 上「当前使用」、池里 `currentRef`、冷却计数、`nextRef` 轮换链**全部工作正常**，
日志里也能看到完整的轮换过程（`PICK key_fallback_sensenova_key1` →
`provider=sensenova code=RATE_LIMIT` → 标记冷却 → `PICK …key2`）。

于是长期无人怀疑它——直到对比 `/pools` 的两个字段时发现矛盾：

```json
{ "currentRef": "key_fallback_sensenova_key1",   // 池认为在用 key1
  "activeRef":  "SENSENOVA_API_KEY",              // 但 env 里是启动时那把
  "envSource":  "file",                           // 而凭据层看到的是「文件」来源
  "envWritable": true }
```

三个事实拼在一起才暴露真相：

1. `activeRef` 是**字符串匹配 `process.env[pool.cfg.env]`** 反推出来的，它等于
   `SENSENOVA_API_KEY` ⇒ **写确实落到了真实 `process.env`**（不是没写进去）。
2. 同一响应里 `envSource=file` ⇒ 凭据层的 `describe()` 认为该 ref 来自**文件**，
   **没有**看到那个 env 值。
3. 而 `dsh-credentials-local.inherited()` 读的是 `process` 层且**优先级最高**——
   如果它能看到那个值，`envSource` 必然会是 `env` 而不是 `file`。

⇒ 结论：**写进 `process.env` 是无效的**。池在内存里轮换，每个请求却仍然用启动
那一刻的那把 key 鉴权。

## 根因

DSH 在启动时把环境「拍平成一个快照」，凭据层此后只读快照：

```
dsh-app-boot  loadLayeredEnv()                    // :3433-3457
  const inherited = { ...process.env }            // :3435  ← 冻结副本
  …materialize .env only if unset…
  return createLaunchEnvironmentSnapshot([...])   // :3442-3457

dsh-launch-environment  createLaunchEnvironmentSnapshot(layers)   // :30-35
  // 把每层拷进一个 Map —— 之后 process.env 再变，Map 不变

dsh  profile-boot-BZ2ZjNWi.js
  hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment) // :274

dsh-credentials-local
  inherited(ref) { const entry = launchEnvironmentOf(this.ctx)
                     .getFrom(ref, ["process"]) … }               // :427-431
```

`launchEnvironmentOf(ctx)` 拿的就是上面 `provide` 进去的那个快照对象。
**启动之后写 `process.env` 对它不可见**——写进的是 Node 的进程环境，而快照是启动时
拷走的 `Map`。

DSH 自己的注释也直说了（`dsh-base` 的 `cordis.patch.yml`，credentials 条目上方）：

> Credential sources: inherited environment over the managed `$DSH_HOME/.credentials.yaml`,
> with project and user `.env` fallbacks. Adapters resolve references per request; the Models
> page writes only the managed document, **which is never materialized into the process
> environment**.

## 正确的接缝：`credentials.resolve`

「每次请求问一次用哪把 key」的地方只有一个——`credentials.resolve(ref)`：

| 调用点 | 位置 |
|---|---|
| `dsh-llm-pi-ai` | `lib/index.js:2563`（`resolveApiKey`，每次 generate 都调） |
| `dsh-llm-deepseek-api-key` | `lib/index.js:44` |
| `dsh-web-search-deepseek` | `lib/index.js:313` |
| `dsh-webhook-github` | `lib/index.js:121` / `lib/types/handler.js:75` |
| `dsh-cost-meter`（兜底） | `queryBalance` 先 resolve、miss 才读 `process.env` |
| `@omdp/dsh-vision-bridge` | `index.js:87-99` 同上，resolve 优先 |

`dsh-credentials-local` 的 README 明确：`resolve`/`describe` **按调用**依次读
继承环境快照 → 文档快照 → `.env` 兜底 ⇒ 拦这一个方法，**下一次请求就生效，无需重启**。

因此 3.3.0 把机制换成：包装 `ctx.credentials.resolve`，ref 命中池时返回池的当前 key。
`describe()` 刻意**不包装**，继续报告存储里的真值（UI 的 env 可写性判断依赖它）。

## 可复用要点

- **判定「写入是否真的生效」不要看 UI/日志，要看两个独立字段能否互相印证。**
  本例的 `activeRef`（= 写进 env 的值）与 `envSource`（= 凭据层实际来源）矛盾，
  才暴露出问题；单独看任何一个都「正常」。
- **`process.env` 在 DSH 里不是运行时通道**：任何「启动时冻结」的机制
  （`launchEnvironment` 快照、`dsh-app-boot:3435` 的 `{...process.env}`）都不会看到
  启动后的写入。需要影响运行时行为时，优先找**按调用读取**的服务方法。
- **切换点优先选「每次请求都会问」的方法**：`resolve` 每次 generate 调一次 ⇒ 无需重启；
  相比之下「写存储」（`credentials.set`）会是持久副作用，且不解决「同一进程内立刻换」。
- **删掉 `process.env` 写入后，`currentRef` 成为唯一权威**——它能跨
  `readPools()`/`resolvePoolKeys()` 重建保留（`readPools` 只对新建 provider 置空、
  `resolvePoolKeys` 全程不碰它），而 env 反推是它的劣化投影（只会返回启动时那把）。
- **包装别人的服务方法要可还原**：用 `ctx.effect` 在卸载时还原，并加**身份校验**
  （`if (svc.m === wrapped) svc.m = raw`），否则热重载会层层叠加，且旧层闭包持有过期
  service 与已清空的池。还原前必须先 `.bind()` 保存原方法。
- **验证要做到「出站字节」级别**：本轮最终用进程内真实 `@deepseek-ai/dsh-llm-pi-ai`
  适配器 + 真实 `LocalCredentialProvider` + 本地 mock 上游，从**真实出站 HTTP
  `Authorization` 头**取值，才敢下结论：
  未装插件 `Bearer STORED-ENV-KEY` → 预选 `Bearer KEY-ONE-111` →
  `RATE_LIMIT` 轮换 `Bearer KEY-TWO-222` → `dispose()` 回 `Bearer STORED-ENV-KEY`。
  （只用 `resolve()` 返回值做断言仍属间接证据，因为那正是被包装的方法。）

## 相关文件

- `dsh-key-fallback/lib/index.js`：包装 `credentials.resolve` + `ctx.effect` 还原；
  删除 5 处 `process.env` 写入与 2 处 env 反推
- `dsh-key-fallback/README.md` / `README.zh-CN.md`：`## Rotation semantics` 更正机制描述
- 快捷判定命令（隔离 `DSH_HOME`，勿对生产 `~/.dsh` 跑）：
  `GET /dsh-key-fallback/pools` → 看 `activeRef` 是否 `=== currentRef`
  （3.3.0 起必然相等；3.2.4 之前可能不等）
