# @omdp/dsh-key-fallback

[English](README.md) | 简体中文

**为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 提供多 key 池 + 自动轮换**——插件位于 LLM 适配器与凭证存储之间：每次请求前从按 provider 分组的 key 池里选一把，预写入该 provider 的凭证引用；遇到配置的触发错误时，把失败 key 标记为冷却（固定 `cooldownMs`，无指数退避）并前进到下一把。**重发完全交给 DSH 自带的 `dsh-llm-retry`**——本插件从不自行重发，只负责换 key，重试策略由 retry policy 决定。

当前版本：**v3.2.1**（v7 UI 代）。

## 环境要求

- DeepSeek Harness 带 `web` profile GUI（`npx @deepseek-ai/dsh web`）
- Node.js `^22.19` 或 `>=24`
- peer 范围**只枚举已实际进行过兼容测试的版本**——`@deepseek-ai/dsh-credentials` `0.1.0-rc.6 || 0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.6-alpha.1 || 0.1.7-rc.1`、`@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-settings` `0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.6-alpha.1 || 0.1.7-rc.1`、`@deepseek-ai/cordis` `4.0.1 || 4.0.2 || 4.0.4`、`@deepseek-ai/schemastery` `3.18.1 || 3.18.2 || 3.18.4`。不使用 `<0.2.0`、caret 之类的开放范围：未测试版本在核查通过前刻意排除。插件只使用 credential-reference 半边（`resolve`/`describe`/`set`/`unset`/`credentialRef`，自 `0.1.0-rc.6` 起稳定）与 `agent/request` + `agent/request-error` waterfall（载荷跨上述枚举版本未变）；`isCredentialRefName`（rc.8 新增）本地实现兜底。`0.1.2-alpha.2 → alpha.5 → 0.1.2-rc.1` 配套包逐字节一致（2026-09-03 复核），故 DSH `0.1.2-rc.1`（`next`）无需改动插件。

## v3.2.1 新增

- **救回滞留在 `settings.yaml.imported` 里的池**（2026-09-24）。`0.1.7` 的一次性导入器会在写入任何东西**之前**
  先把 `settings.yaml` 改名为 `settings.yaml.imported`——所以某段导入失败时（典型：目标条目没声明 volatile 字段）
  它永远不会重试，池子会永久留在 `.imported` 里。表现恰是：徽标显示 **「尚未启用」**、页面显示
  **「还没有任何池，点上方「启用新 provider 池」开始。」**，尽管池子就在磁盘上。
  注意**文件回退在 v3.2.0 里本来就写了**（`readSettingsFromFile()` 会在 `settings.yaml` 缺失时退读
  `settings.yaml.imported`）——但在 `0.1.7` 上它**永远轮不到**：只要 `_liveRef` 非空，
  `readSettings()` 第一行就从 live-ref 分支返回，而 ref 里是 `{}`。**真正缺的不是又一个读回退，
  而是两个后端之间的一座桥。**
  `v3.2.1` 在**首个 HTTP 请求**时做一次性显式搬运（不在 `apply()` 里——原因见下）：
  当 live 配置里 provider 数为 0 *且* 旧文件里有池时，经 `settings.replace()` 写进 profile 条目。
  标记文件（`<DSH_HOME>/.key-fallback-migrated`）保证「真正只做一次」，因此有意删光所有池后不会在下次启动被复活。
  - **为什么不能放在 `apply()`：** `settings.replace()` 走 `configEditor.edit()`，要求本 entry 的 fiber 已
    **ACTIVE**——`describe()` 会跳过 `fiber.state !== 2` 的条目，而 `apply()` 执行时 fiber 还在创建中，
    调用必抛 `No configurable plugin entry`。首个 UI 请求（`/pools`）才是最早的安全时机。
  - 标记**只在落盘成功之后**才写，因此写失败会在下次启动重试。

## v3.2.0 新增

- **声明支持 DSH `0.1.7-rc.1`，同时保留 `0.1.5-rc.3`**（2026-09-24）。这是本插件首个需要改动代码的版本，原因是 DSH `0.1.7`
  **改变了插件配置的存放位置**——详见下节。

### 两种配置后端，同一份构建

自 DSH `0.1.7` 起，插件配置不再位于 `<DSH_HOME>/settings.yaml`。首次启动时 `0.1.7` 会把该文件
**改名成 `settings.yaml.imported`**，并把每个段的内容写入 profile 补丁
（`~/.dsh/profiles/<profile>/cordis.patch.yml`）中对应 loader 条目的 `config:`；此后由 `settings` 服务托管，
插件通过注入的 `config` 参数读取，而不再自行读写该 YAML。rc.x 时代的 `ctx.settings.get()` /
`register()` / `installSection()` 在 `0.1.7` 上**已不存在**。

因此本插件在启动时自动判别后端，两条路径同时可用：

| | DSH `0.1.5-rc.3`（及更早 rc.x） | DSH `0.1.7-rc.1`（及更新） |
|---|---|---|
| 池配置位置 | `<DSH_HOME>/settings.yaml` 的 `key-fallback:` 段 | profile 补丁中 `key-fallback` 条目的 `config` |
| 插件如何读写 | 直接读写该 YAML 文件（附时间戳备份） | `config.providers` 是活的 volatile ref；写入走 `settings.replace()` |
| 判别方式 | 无 volatile schema 支持 ⇒ 文件后端 | `Config` 声明了 volatile 字段 ⇒ 后端来自 `config` |

移植该模式时有两个关键点：

1. **必须声明 `Config`，否则迁移会静默丢弃配置。** `0.1.7` 的导入路径调用
   `settings.update(ns, values)`，若该条目没有声明 **volatile** 字段就会抛错，仅打印
   `settings: section ... was not imported`，配置只残留在 `settings.yaml.imported` 里。因此
   `v3.2.0` 导出 `Config = z.object({ providers: <dict>.volatile() })`。
2. **volatile API 在两种 schemastery 构建上不同。** `.volatile()` 在 schemastery `3.18.4`（`0.1.7`）上可用，
   但在 `3.18.2`（`rc.3`）上**不存在**——在那里调用会得到 `undefined`，而若据此注册一个无 volatile 的
   schema 就会改变 rc.3 的行为。故导出做了守卫：
   `typeof field.volatile === 'function' ? z.object({ providers: field.volatile() }) : undefined`——
   rc.3 拿到 **没有** `Config`（行为与 v3.1.x 逐字节一致），`0.1.7` 拿到含 volatile 的那一份。

`config.providers` 的值被 DSH 深度冻结，故 `readSettings()` 向调用方返回可变深拷贝；写入先乐观地更新内存副本
再经 `settings.replace()` 落盘（未决写入计数避免 UI 短暂读回写入前的旧树）。

两条后端均已在真实安装上端到端实测：读取（两个 provider 都出现在 `/dsh-key-fallback/pools`，含 env key 实时值）、
增删改（POST/DELETE 往返并落盘）、以及 rc.3 回归（`settings.yaml` 未被改名也未改内容、`cordis.patch.yml` 仍为
`[]`、备份照旧生成）。

## v3.1.7 新增

- **声明支持 DSH `0.1.5-rc.2`**（2026-09-15）。源码核查：`@deepseek-ai/dsh-credentials` / `dsh-llm` / `dsh-settings` 从 `0.1.5-rc.1` 到 `rc.2` **只有 `package.json` 变化**——lib/文档逐文件 SHA256 全一致。运行时核查：对真实 `dsh@0.1.5-rc.2` web profile **严格模式**安装 peer（不加 `--legacy-peer-deps`）零告警通过，启动零浏览器控制台错误，`/dsh-key-fallback/*` 路由服务，设置页「API Key 回退」渲染。
- **声明支持 DSH `0.1.6-alpha.1`**（2026-09-15，源码级逐文件哈希比对 + **真实运行时冒烟**：在临时安装的 `0.1.6-alpha.1` 上以 web profile 实测加载）。未改动任何代码：`@deepseek-ai/dsh-credentials` 与 `@deepseek-ai/dsh-settings` 的 `lib/` 相对 `0.1.5-rc.2` **逐字节一致**（仅版本号/文档变化），`@deepseek-ai/dsh-llm` 的删除项（`priceImages`、`projectImagesForTextModel`/request-image-offload 系列）均在本插件调用面之外——本插件调用的 `credentialRef`、`credentials.resolve/set/unset/describe`、`llm.listProviders/listConfigurableProviders`、`agent/request`、`agent/request-error`、`settings`、`webServer` 全部实测保留（`webServer` 提供方 `dsh-host-webserver` 整包字节一致）。运行时验证：插件激活、`/dsh-key-fallback/*` 路由服务、设置页「API Key 回退」渲染。**旧版本继续兼容**——`0.1.5-rc.2` 与 `0.1.6-alpha.1` 均为**追加**进枚举，未删除任何版本。

## v3.1.6 新增

- **声明支持 DSH `0.1.5-rc.1`**（2026-09-10 源码级兼容性核查）。未改动任何代码：`@deepseek-ai/dsh-credentials` 与 `@deepseek-ai/dsh-settings` 相对 `0.1.2-rc.1` **只有 `package.json` 版本号变化**（代码逐文件哈希一致），`@deepseek-ai/dsh-llm` 的变化是**附加式**（新增 `FileBlock` / `fileHandleText` / assistant-stream 等），本插件调用的 API 全部保留：`credentialRef`、`credentials.resolve/set/unset/describe`、`llm.listProviders/listConfigurableProviders`、`agent/request`、`agent/request-error`、`settings`、`webServer`；`agent/pre-step` waterfall 载荷两版**逐行相同**。**旧版本继续兼容**——`0.1.5-rc.1` 是**追加**进枚举，未删除任何版本。
- 注：DSH `0.1.5-rc.1` 移除了 `ctx.agent` 并调整 Inbox/Session API，本插件从未使用这些接口。

## v3.1.4 新增

- **env 名自动派生已消毒**：为 id 含非法字符（`b-ai`、`B.AI` 等）的 provider 建池不再报 `env must be POSIX identifier`——自动派生的 env 名（`<PROVIDER>_API_KEY`）现在会把 `-`/`.` 等转成 `_`（`b-ai` → `B_AI_API_KEY`）。显式传入的 `env` 仍按原规则校验。修复"选择 LLM provider → 启用"对此类 provider 的 400 报错。

## v3.1.3 提供什么

**设置 → API Key 回退** —— 顶层设置页，全新 UI（状态点、徽章、渐变池卡片、逐 key 行）：

- **可配置且真正生效的轮转触发码**（`rotateOn`）：点选 chips 决定哪些错误码触发轮换。预设 chips 覆盖 **DSH `LlmError` 标准码全集**——`QUOTA` / `AUTH` / `RATE_LIMIT` / `TIMEOUT` / `TRANSPORT` / `SERVER` / `EMPTY_RESPONSE` / `INVALID_CREDENTIAL`——也可添加非标准/自定义错误码（与 provider 的 `failure.code` **精确匹配**）。你保存什么就执行什么：不存在"把选中的三个码偷偷变回六码超集"的魔法。`ABORTED`（用户取消）永不触发轮换。
- **真实当前使用 key 显示**：页面显示当前真正在用哪把 key（从最后一次写入 provider env 的值推导）——不是截断的哈希，不是猜的名字。
- **短 ref 命名**：新 key 自动命名为 `key_fallback_<provider>_key1`、`key_fallback_<provider>_key2`、…，UI 显示干净的短名（`key1`、`key2`、…或你的自定义 `label`）。已有旧长 ref **一次性、幂等地自动迁移**（写新 ref → 持久化配置 → best-effort 删旧 ref；任何一步失败即中止、安全可重试）。
- **明文揭示**：每行有眼睛开关（`👁` / `🙈`），经 `GET /keys/plain` 显示真实值（仅限本池的 key 或本池 env key）。env key 行也会显示明文——不会被只读说明吞掉。
- **环境密钥可编辑**：池的 env key（`AGNES_API_KEY` 等）在凭证文件可写时可直接在页面里改。若由启动环境提供（只读），UI 会说明并拒绝编辑（HTTP 400）。
- **逐 key 控制**：更新值、设置"失败后→"下一把（`nextRef`）、锁定到某把 key（"设为当前"）、删除 key（env key 不可删）。
- **池级控制**：启用开关、冷却显示、"↺ 重置冷却"、池锁定/自动轮换、逐池状态（`live` / `cooling` / `recovered`）。

## 轮换语义

- **pick**（`agent/request` 预写）：先尊重 `useKeyRef` 锁定（但冷却中的锁定 key 会跳过，避免池在某把坏 key 上死锁），否则按游标在 live key 上轮询。选中的 key 同时写 `credentials.set` 和 `process.env`，保证 provider 真的用这把 key 鉴权。
- **fail**（`agent/request-error`，注册 `prepend` 保证先于 `dsh-llm-retry` 看到错误）：仅当错误匹配本池 `rotateOn` 时才处理——按 `failure.code`（精确）、按 HTTP 状态映射（`429→RATE_LIMIT`、`401/403→AUTH`、`402→QUOTA`、`5xx→SERVER`）、或按消息关键字。把失败 key 标记为固定 `cooldownMs`（默认 30 s），然后切到 `nextRef`（若配置）否则下一把 live key。
- **re-send** 完全交给 DSH 的 `dsh-llm-retry` 与用户自己的 per-provider 重试策略。两者独立互补：重试插件决定"同一把 key 重发几次"（`retryPolicy.retryableCodes` 默认 `EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT`——注意**不含 AUTH/QUOTA**）；本插件决定"换下一把 key"。例如 `AUTH` 失败（重试本来也不会重发，重发也白搭）仍会轮换到下一把——下一次请求就会用新 key 鉴权。

## 诊断

- client 会把运行时异常 POST 到 `POST /dsh-key-fallback/diag`。
- `GET /dsh-key-fallback/diag` 返回内存缓冲（最近 200 条）JSON。

## 安装

```sh
# 从 npm（推荐）
cd ~/.dsh/profiles/web
pnpm add @omdp/dsh-key-fallback

# 或从本地 checkout
dsh plugin --profile web add link:D:/WorkSpace/omdp/dsh-key-fallback

# 重启 DSH，然后打开 设置 → API Key 回退
```

> 注意：该 profile 目前从 npm（`^3.x`）安装到 `~/.dsh/profiles/web/node_modules/@omdp/dsh-key-fallback`；把新版 `lib/index.js` + `lib/client.js` 复制过去并重启 DSH 即可升级。包声明了 `dsh.bundle.patch`，自动激活——无需手动改 `cordis.patch.yml`。

## HTTP API（host）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/dsh-key-fallback/pools` | 列池：live 状态、`activeRef`、env 可写性/来源、逐 key 状态 |
| POST | `/dsh-key-fallback/pools` | 创建/更新池（`enabled`、`cooldownMs`、`rotateOn`、`useKeyRef`、…） |
| DELETE | `/dsh-key-fallback/pools?provider=` | 删除池 + 其全部 key |
| POST | `/dsh-key-fallback/keys` | 加 key（自动短 ref `key_fallback_<p>_keyN`） |
| PATCH | `/dsh-key-fallback/keys` | 更新值 / label / `nextRef` / `useKeyRef`（env key 的值=改 env） |
| DELETE | `/dsh-key-fallback/keys?provider=&ref=` | 删 key（env key 拒绝） |
| GET | `/dsh-key-fallback/keys/plain?provider=&ref=` | 揭示真实值（仅本池 key / env key） |
| POST | `/dsh-key-fallback/reset` | 重置某池冷却状态 |
| GET/POST | `/dsh-key-fallback/diag` | 诊断缓冲 |

## 已知限制

- 冷却为每池固定 `cooldownMs`（无指数退避）；冷却到期 key 自动恢复 live。
- 轮换/冷却状态为内存态 + 持久化池配置；DSH 重启会重读配置并重算 live 状态。在 DSH `0.1.5-rc.3` 及更早版本上，该配置是 `<DSH_HOME>/settings.yaml` 的 `key-fallback` 段；在 `0.1.7`+ 上则是 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中 `key-fallback` 条目的 `config`。
- env key 不能通过 UI 删除（它是池的身份标识）。

## License

MIT