# OpenCode Zen 经 9router 接入：判据、排障与升级 SOP

> **汇总文档**（跨笔记）。分散的排查过程在 `notes/` 三篇里，本文件是**唯一入口**：
> 日常只要读这里；出问题时按第 4 节决策树走。

## 1. 现状（2026-09-24）

**用 9router，不要自己实现。** 9router ≥ **v0.5.86** 已经自己满足 Zen 免费层的
全部指纹校验（上游把我们的热补丁吸收掉了），我们只需消费它。

| 项 | 状态 |
|---|---|
| 接入方式 | 9router 网关（`http://127.0.0.1:20128`），模型名前缀 `oc/` |
| 免费模型 | chat 通道 4 个 + responses 通道 2 个（见 `verify` 脚本 `FREE_MODELS`） |
| 是否需要本地热补丁 | **不需要**（≤ v0.5.75 才需要，见 `tools/9router-fix/`） |
| 是否会自研 DSH provider 插件 | **否**，决策依据见 [`notes/2026-09-24/plugin-dev/opencode-zen-via-9router-not-a-plugin.md`](../notes/2026-09-24/plugin-dev/opencode-zen-via-9router-not-a-plugin.md) |

## 2. 决策：走 9router，不自研 DSH provider 插件

早期曾计划把 Zen 接入做成 `@omdp/*` DSH provider 插件（参考 `opencode2dsh`
的 LlmAdapter 契约）。**已放弃**，理由：

1. **上游已经做完了**，而且做得比我们更完备 —— 连官方 `descending()` 时间算法、
   工具名注入后的**响应侧回映射**都实现了（见第 3 节）。自研只是重写一遍。
2. **门禁是移动靶**：该门禁已两次加严（第一波 UA + session，第二波工具对 + 流式）。
   自研插件意味着**每次 Zen 变更都要自己跟**；9router 作为被大量使用的网关，
   会被更多人盯着并更快修复。
3. 我们的价值不在重实现，而在**判据沉淀与验证能力**（第 4、5 节正是这个）。

> 结论：**除非将来 9router 停止维护或不再跟门禁**，否则不重开自研方向。

## 3. 门禁四维判据（Zen 侧，与 9router 版本无关）

OpenCode Zen 在 `https://opencode.ai/zen/v1/*` 上校验**官方 agent 客户端指纹**，
**四条必须同时满足**，缺一即 403 `FreeTierError`：

| # | 条件 | 反例 → 结果 |
|---|---|---|
| 1 | `User-Agent` = `opencode/<maj>.<min>.<patch>`，版本 **≥ 1.17.0** | 裸 `opencode`/`node`/`curl` → **403**；`opencode/1.16.0` → **426 UpgradeRequired** |
| 2 | `x-opencode-session` 匹配 `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$` | `ses_`+32hex、裸 UUID、缺失 → **403** |
| 3 | 请求体 `tools` 同时含名为 **`read`** 和名为 **`bash`** 的工具 | 缺 `read` → 403；缺 `bash` → 403；齐全 → 200 |
| 4 | 请求体 `stream: true` | `stream:false`（两条通道都是）→ **403** |

顺序、schema 形状、工具数量、额外工具**均无关**。
`glob`/`grep` **不是**判据（早期「四件套」结论是对第一次二分的过拟合）。
判据 3 的依据是官方源码：`tool/shell/id.ts` 的 shell 工具 ID **在所有平台（含
Windows）都叫 `bash`**，所以官方客户端在 Windows 上照样发 `bash` ——
这是 DSH 类环境（shell 工具叫 `pwsh`）踩雷的原因，见
[`notes/2026-09-18/dsh-internals/windows-shell-tool-pwsh-not-bash.md`](../notes/2026-09-18/dsh-internals/windows-shell-tool-pwsh-not-bash.md)。

已排除**不**参与门禁的因素：`x-opencode-client` / `x-opencode-request` /
`x-opencode-project` / `x-session-affinity` / `X-Session-Id`、HTTP 版本、
换真 Zen key（免费模型仍 403；同 key 请求付费模型 → 401 `CreditsError`，
说明门禁认的是「免费模型」而不是凭据）。

### 9router ≥ v0.5.86 怎么满足它的

| 判据 | 上游实现 |
|---|---|
| 1 | `buildHeaders` 回退 `"opencode/1.18.31"`（`buildHeaders` 会把非 `opencode/x.y.z` 的 UA 换成它） |
| 2 | 用官方 `descending()` 算法生成规范 session：`~(4096n * t + 1n)` → 6 字节 hex + 14 位 base62 |
| 3 | 注入工具集 `["bash","glob","grep","read"]`，并把调用方别名映射成必需名、**响应里再映射回去** |
| 4 | `transformRequest` 开头强制 `b.stream = !0` |

**两条通道的工具形状不同**（这是最容易踩的静默坑）：

| 目标端点 | 何时走 | `tools` 形状 |
|---|---|---|
| `/zen/v1/chat/completions` | 一般模型 | `{type:"function", function:{name, description, parameters}}` |
| `/zen/v1/responses` | `muse-spark-*` | `{type:"function", name, description, parameters}`（**扁平**） |
| `/zen/v1/messages` | `union-alpha` | anthropic 形状（附带 `anthropic-version`） |

形状给错不是 403，而是 **400 `tools[N]` missing required field `name`** —— 见下节。

## 4. 排障决策树：先看错误码，别猜

```
403 FreeTierError      → 门禁四条没满足（客户端指纹问题）
                        若 9router ≥ v0.5.86 仍复现 → 跑 A 层确认是「Zen 变了」
                        还是「9router 又落后了」（关键：A 层是版本无关的对照组）
426 UpgradeRequired    → UA 版本号过低（< 1.17.0）
400 tools[N] ... missing required field "name"
                       → 工具形状给错通道（不是门禁问题！整条通道会静默全挂）
400 duplicate tool ... → tools 里有重名（Zen 侧不接受），注入逻辑要先去重
401 CreditsError       → 付费模型缺额度，与免费层门禁无关
200 但无输出/工具不执行 → 多半是「注入了空壳工具被模型选中」，见
                        tools/9router-fix/README.md 的风险表
```

**最重要的一条方法论**：判断「Zen 改了」还是「9router 改了」**必须留对照组**。

| A 层（直连 Zen） | C 层（经 9router） | 结论 |
|---|---|---|
| 红灯（仍 403） | 绿灯 200 | **9router 修好了** —— 本地问题，别去改客户端 |
| 绿灯（放行了） | 绿灯 200 | **Zen 放宽了** —— 判据文档需更新 |
| 红灯 | 红灯 | 9router 落后于门禁，考虑升级 / 临时热补丁 |
| 绿灯 | 红灯 | 是 9router 内部问题（形状、路由、超时），查请求日志 |

只测一条路径会把结论搞反（本次 0.5.86 升级正是靠 A 层才确认「是上游修好了，
不是 Zen 放宽了」）。

## 5. 升级与验证 SOP

```bash
npm i -g 9router@latest --prefer-online

# 1) 自检：需要打补丁吗？（会自己给出结论）
node tools/9router-fix/fix-opencode-freetier.cjs --check

# 2) 三层验证：A 直连判据 + B 构建产物 + C 端到端 6 模型
node tools/9router-fix/verify-opencode-freetier.cjs
```

`--check` 退出码：`0` 表示无需动作（含「上游已自带修复」）；`1` 才需要处理。
**升级后必须重启 9router**（npm 换的是磁盘文件，运行中的进程仍是旧代码）。

### npm 全局升级的三个坑（都实测过）

1. **`EEXIST`**：`%APPDATA%\npm\9router{,.cmd,.ps1}` 是旧版启动垫片，npm 不肯覆盖。
   删掉即可（派生物，安装时自动重建），**别删 `node_modules\9router`**。
2. **postinstall 被 `allowScripts` 拦截**：只做 SQLite 运行时预热，源码写明
   「失败非致命，运行时重试」。补跑 `node hooks/postinstall.js` 或
   `npm i -g --allow-scripts=9router`。
3. **构建产物会换名/换布局**：`318.js`（≤0.5.75）→ `5330.js`/`6249.js`/`8499.js`（0.5.86）。
   **任何脚本都不要硬编码 chunk 文件名**，按内容锚点定位。

## 6. 证据与文件索引

| 位置 | 内容 |
|---|---|
| [`tools/9router-fix/`](../tools/9router-fix/README.md) | 判据文档 + 三层验证 + 自动判定的热补丁脚本 |
| [`tools/9router-fix/probes/`](../tools/9router-fix/probes/README.md) | 20 个一次性诊断探针（含判据二分、形状、空壳工具风险） |
| [`notes/2026-09-17/debug/9router-opencode-freetier-403.md`](../notes/2026-09-17/debug/9router-opencode-freetier-403.md) | 第一波：UA + session |
| [`notes/2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md`](../notes/2026-09-18/debug/9router-opencode-freetier-403-tool-pair.md) | 第二波：工具对 + 流式 + 按通道形状 |
| [`notes/2026-09-24/debug/9router-0.5.86-absorbed-hotpatch.md`](../notes/2026-09-24/debug/9router-0.5.86-absorbed-hotpatch.md) | 收束：上游吸收 + 对照组方法论 |
| [`notes/2026-09-18/dsh-internals/windows-shell-tool-pwsh-not-bash.md`](../notes/2026-09-18/dsh-internals/windows-shell-tool-pwsh-not-bash.md) | DSH 在 Windows 只暴露 `pwsh` 的原因（`ctx.shell` 单 provider 契约） |

运行数据：`%APPDATA%\9router\db\data.sqlite`
（表 `requestDetails`，`data.request.providerRequest` = 9router 实际发上游的请求体，
排障时这是第一手证据）。
