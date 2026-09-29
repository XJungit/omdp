# `process.env` 写不进 DSH 凭据层：启动环境快照，以及一次「把冗余当根因」的误判

**日期**：2026-09-29（正文于当日更正）
**类别**：dsh-internals
**涉及插件**：`@omdp/dsh-key-fallback` 3.2.4 → 3.3.0 → **3.3.1（文档更正）**
**DSH 版本**：桌面端 `0.2.0-rc.1`

> ⚠️ **本笔记曾有一个错误结论，已更正。** 初版标题是「key 回退轮换『看起来生效、其实没生效』的根因」，
> 断言「≤ 3.2.4 换 key 从未到达 provider」。**该断言错误。** 真相见下方「更正」一节——
> `credentials.resolve` 包装自 **v3.0.0（`75ea76a`）** 就存在，轮换一直在生效。
> 本笔记保留原排查过程，因为它记录的**源码事实**（启动环境快照）仍然成立且有价值，
> 但它**不能**推出「轮换失效」的结论。

## 背景 / 问题

`dsh-key-fallback`（≤ 3.2.4）里同时存在两种「切换 API key」的写法：

```js
process.env[pool.cfg.env] = key.value   // 写法 A：5 处（3.2.4 的 :489/:532/:561/:711/:808）
credSvc.resolve = async (ref) => { … }  // 写法 B：包装 credentials.resolve（自 v3.0.0）
```

排查时发现 `/pools` 的两个字段互相矛盾：

```json
{ "currentRef": "key_fallback_sensenova_key1",   // 池认为在用 key1
  "activeRef":  "SENSENOVA_API_KEY",              // 而 env 里是启动时那把
  "envSource":  "file",                           // 凭据层看到的是「文件」来源
  "envWritable": true }
```

三个事实拼在一起，能**确定**的是「写法 A 无效」：

1. `activeRef` 当时是**字符串匹配 `process.env[pool.cfg.env]`** 反推出来的，它等于
   `SENSENOVA_API_KEY` ⇒ **写法 A 确实写进了真实 `process.env`**（不是没写进去）。
2. 同一响应里 `envSource=file` ⇒ 凭据层的 `describe()` 认为该 ref 来自**文件**，
   **没有**看到那个 env 值。
3. 而 `dsh-credentials-local.inherited()` 读的是 `process` 层且**优先级最高**——
   如果它能看到那个值，`envSource` 必然会是 `env` 而不是 `file`。

⇒ 结论：**写法 A 是死代码**。

## 更正：写法 A 是死代码 ≠ 轮换失效

**当时的推断多走了一步**：从「写法 A 无效」跳到「所以轮换没生效」。
这一步**没有证据支撑**，而且被后续核查证伪：

| 核查 | 结果 |
|---|---|
| `git log -S 'credSvc.resolve =' -- dsh-key-fallback/lib/index.js` | 引入于 **`75ea76a`（v3.0.0 重写）**，不是 v3.3.0 |
| 从 registry 下载**已发布** `@omdp/dsh-key-fallback@3.2.4` tarball | `lib/index.js:298` 即该包装，`:305` 即 `pool-hit` 诊断——**3.2.4 就有** |
| 逐行比对 3.2.4 与 3.3.0 的包装主体 | **逻辑逐字相同**（仅 3.3.0 多命名变量与卸载还原） |
| 实机 `/diag`（3.3.0） | 200 条，池中两把 key 各被用 **26 / 25 次**并逐次交替，57 条 `pool-hit` 写明当时生效的那把 |

**为什么会误判**：排查时只读了**3.2.4 的 `process.env` 写入**（那段代码确实显眼且明显可疑），
却**没有先读 3.2.4 里同时存在的包装**。`/pools` 显示的 `activeRef` 矛盾是真的
（那是 `activeRef` 的反查逻辑有 bug），但它只证明「用 env 反推 key 不可靠」，
**不证明**「交付给 provider 的 key 不对」——因为交付路径根本不经过 `process.env`。
**把「一处冗余代码无效」误当成「整个机制无效」，是本轮最该记住的教训。**

## 根因（这一部分仍然成立）

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

## 真正的 key 切换接缝：`credentials.resolve`

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

**这个包装从 v3.0.0 起就在工作**；3.3.0 的改动只是：去掉写法 A 的 5 处冗余写入、
修 `activeRef` 的反查（改回直接等于 `currentRef`）、给 `agent/request-error` 的
归因加守卫、以及用 `ctx.effect` 让卸载可还原。
`describe()` 刻意**不包装**，继续报告存储里的真值（UI 的 env 可写性判断依赖它）。

## 可复用要点

- **判「某段代码是否有效」≠ 判「功能是否可用」。** 先找**功能实际走的那条路径**
  （`git log -S` 追溯引入点 / 读**改动前**的源码 `git show <rev>:<path>`），再下结论。
  本轮把「写法 A 无效」写成「换 key 从未生效」，并把这句错误结论写进了 commit、两版 README、
  根 README、兼容性文档和本笔记——**发布出去的错误描述比 bug 更难收回**。
- **判定「写入是否真的生效」要看两个独立字段能否互相印证。** 本例的 `activeRef`
  （= 写进 env 的值）与 `envSource`（= 凭据层实际来源）矛盾，证明的是**写法 A 无效**；
  要证明**交付失效**还需看交付路径本身（`pool-hit` / 出站头）。
- **`process.env` 在 DSH 里不是运行时通道**：任何「启动时冻结」的机制
  （`launchEnvironment` 快照、`dsh-app-boot:3435` 的 `{...process.env}`）都不会看到
  启动后的写入。需要影响运行时行为时，优先找**按调用读取**的服务方法。
- **切换点优先选「每次请求都会问」的方法**：`resolve` 每次 generate 调一次 ⇒ 无需重启；
  相比之下「写存储」（`credentials.set`）会是持久副作用，且不解决「同一进程内立刻换」。
- **`currentRef` 应当是唯一权威**——它能跨 `readPools()`/`resolvePoolKeys()` 重建保留
  （`readPools` 只对新建 provider 置空、`resolvePoolKeys` 全程不碰它），
  而用 `process.env` 值反推是它的劣化投影（可能指向错误的那把）。
- **包装别人的服务方法要可还原**：用 `ctx.effect` 在卸载时还原，并加**身份校验**
  （`if (svc.m === wrapped) svc.m = raw`），否则热重载会层层叠加，且旧层闭包持有过期
  service 与已清空的池。还原前必须先 `.bind()` 保存原方法。
- **验证要做到「出站字节」级别**：本轮最终用进程内真实 `@deepseek-ai/dsh-llm-pi-ai`
  适配器 + 真实 `LocalCredentialProvider` + 本地 mock 上游，从**真实出站 HTTP
  `Authorization` 头**取值，才敢下结论：
  未装插件 `Bearer STORED-ENV-KEY` → 预选 `Bearer KEY-ONE-111` →
  `RATE_LIMIT` 轮换 `Bearer KEY-TWO-222` → `dispose()` 回 `Bearer STORED-ENV-KEY`。
  （只用 `resolve()` 返回值做断言仍属间接证据，因为那正是被包装的方法。）
- **实机 `pool-hit` 是最好的现场证据**：每条 `resolve pool-hit <env> -> <ref>` 都写明
  当次实际生效的 key；配合 `PICK`/`marked` 能直接看出轮换时间线，无需重启或额外埋点。

## 相关文件

- `dsh-key-fallback/lib/index.js`：包装 `credentials.resolve`（自 v3.0.0）+ `ctx.effect` 还原；
  已删除 5 处冗余 `process.env` 写入与 2 处 env 反推
- `dsh-key-fallback/README.md` / `README.zh-CN.md`：v3.3.1 段落载明本次更正
- 快捷判定命令（隔离 `DSH_HOME`，勿对生产 `~/.dsh` 跑）：
  `GET /dsh-key-fallback/pools` → 看 `activeRef` 是否 `=== currentRef`
  （3.3.0 起必然相等；3.2.4 因反查逻辑有 bug 可能不等，
  **但请注意：那只是显示 bug，不代表当时的轮换失效**）
