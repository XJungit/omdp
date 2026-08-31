# peerDependencies 声明严谨性：只枚举实测版本，禁开放范围

> 分类：`plugin-dev/` · 日期：2026-08-31

## 背景

此前 key-fallback 3.1.2 的 peer 用了三段式范围
`>=0.1.0-rc.6 <0.2.0 || >=0.1.1-0 <0.2.0-0 || >=0.1.2-0 <0.2.0-0`，
其中 `<0.2.0` 意味着「未来任何 0.1.x 都放行」——但那些版本**从未做过兼容测试**。
用户明确要求（2026-08-31）：「声明范围就局限于测试过的版本，而不是像你那种
'0.2.0 都可以'。以后声明版本要严谨一点。」已固化为 AGENTS.md **规范 3**。

## 结论：新枚举（2026-08-31 起）

| peer 包 | 枚举值 | 实测依据 |
|---|---|---|
| `@deepseek-ai/dsh-credentials` | `0.1.0-rc.6 \|\| 0.1.1-rc.2 \|\| 0.1.2-alpha.1 \|\| 0.1.2-alpha.2` | rc.6 = profile 部署目录实际运行版（静态 import 解析到它）；rc.2 = 全局 DSH 实际；alpha.1/2 = 源码逐字核查 |
| `@deepseek-ai/dsh-llm` | `0.1.1-rc.2 \|\| 0.1.2-alpha.1 \|\| 0.1.2-alpha.2` | 服务由全局 DSH 提供（profile 未装） |
| `@deepseek-ai/dsh-settings` | `0.1.1-rc.2 \|\| 0.1.2-alpha.1 \|\| 0.1.2-alpha.2` | 同上 |
| `@deepseek-ai/cordis` | `4.0.1 \|\| 4.0.2` | 4.0.1 = alpha 生态核查时 npm latest；4.0.2 = 全局 DSH 实际安装 |
| `@deepseek-ai/schemastery` | `3.18.1 \|\| 3.18.2` | 3.18.1 = profile 实际；3.18.2 = 全局 DSH 实际 |

semver 实测（node + DSH 自带 semver 模块）：四个已测版本全 `true`；
未测的 `0.1.0-rc.5` / `0.1.1-rc.1` / `0.1.2-alpha.3` / `0.1.5` / `0.2.0` /
`4.1.0` / `5.0.0` / `3.19.0` 全 `false`——精确枚举行为符合预期。

## 可复用要点

1. **精确枚举语法**：peer 值写成 `1.2.3 || 1.2.4-alpha.1`（裸版本号 = 精确匹配）。
   预发布版本逐个列出即可，不需要 `-0` 通配（通配会放行同三元组内未测版本，
   如 `0.1.2-0` 会连 `0.1.2-alpha.3` 一起放行——正是要避免的）。
2. **枚举清单的来源 = 实测记录**：profile 部署目录 + 全局 DSH 的
   `node_modules\@deepseek-ai\<pkg>\package.json` 实际版本，加上源码核查过的
   新版本。别拿「声明的兼容范围」当实测依据。
3. **新 DSH 版本的追加流程**：核查（源码对比 + 回归）→ 通过才追加进枚举 →
   同步 README / plugin-compatibility.md → 发版。未核查宁可 unmet peer 警告。
4. **connector / vision-bridge 无 peer 声明**（零 @deepseek-ai 静态依赖），
   本规范对它们只约束 README 里的版本描述（connector README 已改为
   「已实测版本 4.0.1 / 4.0.2」措辞）。
5. 本次改动涉及文件：`dsh-key-fallback/package.json`、双语 README、
   `docs/plugin-compatibility.md`、`dsh-connector/README.md`、`AGENTS.md`（规范 3）。
   npm 上 3.1.2 的元数据仍是旧范围，需发 3.1.3 才能让线上声明同步（见同日 deploy 记录）。