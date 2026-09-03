# @omdp/dsh-key-fallback

English | [简体中文](README.md)

**为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 提供多 key 池 + 自动轮换**——插件位于 LLM 适配器与凭证存储之间：每次请求前从按 provider 分组的 key 池里选一把，预写入该 provider 的凭证引用；遇到配置的触发错误时，把失败 key 标记为冷却（固定 `cooldownMs`，无指数退避）并前进到下一把。**重发完全交给 DSH 自带的 `dsh-llm-retry`**——本插件从不自行重发，只负责换 key，重试策略由 retry policy 决定。

当前版本：**v3.1.5**（v6 UI 代）。

## 环境要求

- DeepSeek Harness 带 `web` profile GUI（`npx @deepseek-ai/dsh web`）
- Node.js `^22.19` 或 `>=24`
- peer 范围**只枚举已实际进行过兼容测试的版本**——`@deepseek-ai/dsh-credentials` `0.1.0-rc.6 || 0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1`、`@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-settings` `0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1`、`@deepseek-ai/cordis` `4.0.1 || 4.0.2`、`@deepseek-ai/schemastery` `3.18.1 || 3.18.2`。不使用 `<0.2.0`、caret 之类的开放范围：未测试版本在核查通过前刻意排除。插件只使用 credential-reference 半边（`resolve`/`describe`/`set`/`unset`/`credentialRef`，自 `0.1.0-rc.6` 起稳定）与 `agent/request` + `agent/request-error` waterfall（载荷跨上述枚举版本未变）；`isCredentialRefName`（rc.8 新增）本地实现兜底。`0.1.2-alpha.2 → alpha.5 → 0.1.2-rc.1` 配套包逐字节一致（2026-09-03 复核），故 DSH `0.1.2-rc.1`（`next`）无需改动插件。

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
- 轮换/冷却状态为内存态 + 持久化池配置（`settings.yaml` 的 `keyFallback.providers`）；DSH 重启会重读配置并重算 live 状态。
- env key 不能通过 UI 删除（它是池的身份标识）。

## License

MIT