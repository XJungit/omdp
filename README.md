# omdp — only my DSH plugins

**🌐 语言 / Language：** [**中文**](#zh) · [English](#english)

---

<a id="english"></a>

## English

A single GitHub repo that collects all of my [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugins as a **monorepo**. Each plugin lives in its own subdirectory and is an independently installable DSH bundle, published to npm on every `v*` tag.

### Layout

```
omdp/
├── README.md            # this file
├── package.json         # root manifest — keeps bare-git installs functional (see below)
├── dsh-connector/       # unified MCP + Skills manager (Web UI settings tab)
│   ├── index.js         # host half
│   ├── client.js        # client half (Web UI)
│   ├── cordis.patch.yml # bundle activation row
│   ├── package.json
│   └── README.md
├── dsh-key-fallback/    # multi-key API key pool with automatic rotation
│   ├── lib/index.js     # host half (ESM)
│   ├── lib/client.js    # client half (Web UI settings tab)
│   ├── cordis.patch.yml # bundle activation row
│   ├── package.json
│   └── README.md
├── dsh-vision-bridge/   # vision bridge: let text-only models "see" via a configured multimodal endpoint
│   ├── index.js         # host half
│   ├── client.js        # client half (paste/drop → temp path)
│   ├── cordis.patch.yml # bundle activation row
│   ├── package.json
│   └── README.md
├── archive/             # archived plugins retained for historical reference
│   ├── dsh-gitbash-win/
│   ├── resume-stream/
│   ├── key-fallback-*/                  # dsh-key-fallback version snapshots & design drafts
│   └── README.md
├── notes/               # development lessons & notes (三层：notes/<date>/<category>/)
├── docs/                # research notes, compatibility matrix, publish guide
└── <future plugins>/    # each its own subdirectory + package.json
```

### Plugins

#### `@omdp/dsh-connector` — MCP + Skills manager (`v0.2.6`)

One settings tab (**Connector**) that manages three things from the DSH Web UI:

- **MCP servers** — edits the MCP block in `cordis.patch.yml` (stdio / streamable-http), with full validation so bad config never reaches the next boot. Legacy SSE servers (e.g. Zhihu) are kept as `mcp-remote --transport sse-only` stdio bridges; the plugin only manages that config text.
- **User skills** — read / write / delete skills under `~/.dsh/skills/<name>/SKILL.md` (frontmatter preserved).
- **Market explorer (v0.2.0+)** — read-only browsing of ModelScope [Skills hub](https://modelscope.cn/skills) and [MCP plaza](https://modelscope.cn/mcp) via anonymous OpenAPI; one-click copy of install commands / `mcpServers` config snippets, skill "check update" via `source`/`sourceUpdated` frontmatter. Market data lives only in process memory (30-min TTL), never on disk.

```jsonc
"dependencies": { "@omdp/dsh-connector": "^0.2.6" }
```

#### `@omdp/dsh-key-fallback` — multi-key API key pool with rotation (`v3.1.4`)

Sits between the LLM adapter and the credential store. Before each request the plugin picks a key from the per-provider pool and pre-writes it into the provider's credential reference; on a configured trigger error it marks the failed key cooling and advances to the next key — **re-sending is left entirely to DSH's own `dsh-llm-retry`**. Ships an always-visible settings page (**Settings → API Key 回退**) with a redesigned UI:

- Configurable **rotation triggers** (`rotateOn`) — clickable chips covering the full DSH `LlmError` standard code set (`QUOTA`/`AUTH`/`RATE_LIMIT`/`TIMEOUT`/`TRANSPORT`/`SERVER`/`EMPTY_RESPONSE`/`INVALID_CREDENTIAL`) plus custom codes (matched exactly against `failure.code`).
- Shows the **actually-used key** (derived from the last value written to the env), not a truncated hash.
- **Short refs** (`key_fallback_<provider>_key1`, …) with one-time idempotent migration of legacy long refs.
- **Plaintext reveal** via an eye toggle (`GET /keys/plain`, pool-owned keys / env key only) and **editable env keys** (file-backed ones; read-only when supplied by the launching environment).
- Per-key `nextRef`, pool lock ("设为当前"), cooldown reset, and delete.

```jsonc
"dependencies": { "@omdp/dsh-key-fallback": "^3.1.4" }
```

#### `@omdp/dsh-vision-bridge` — vision for text-only models (`v0.1.8`)

A zero-dependency plugin that gives **text-only models** vision: it auto-detects whether the routed model supports images (`llm.resolveModelInfo().inputModalities`), and for text-only models forwards pasted / attached images to a configurable OpenAI-compatible multimodal endpoint (default Agnes `agnes-2.5-flash`) and feeds the returned text back as evidence. Ships a `vision_bridge_read_image` tool, a paste/drop → temp-path browser handler, a wrapped `(vision bridge)` provider entry, and an `agent/pre-step` auto-read hook.

```jsonc
"dependencies": { "@omdp/dsh-vision-bridge": "^0.1.8" }
```

### Installing from npm (recommended)

All three plugins are published to **npm** automatically by GitHub Actions on every `v*` tag. This is the **preferred** install path — it avoids the git-`#path:` normalization, cross-resolution, and `allowBuilds` friction that GitHub installs cause (see the history in `docs/npm-publish.md`).

```jsonc
// ~/.dsh/profiles/<name>/package.json — you can use one or mix-and-match
"dependencies": {
  "@omdp/dsh-connector": "^0.2.6",
  "@omdp/dsh-vision-bridge": "^0.1.8",
  "@omdp/dsh-key-fallback": "^3.1.4"
}
```

```sh
cd ~/.dsh/profiles/<name>
pnpm install
```

Updating is a standard `pnpm update`:

```sh
cd ~/.dsh/profiles/<name>
pnpm update @omdp/dsh-connector @omdp/dsh-vision-bridge @omdp/dsh-key-fallback
```

### Remote installs from GitHub (alternative)

Each active plugin is a standalone npm package in its own subdirectory, so it can also be installed straight from GitHub without a local checkout:

```sh
dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector
dsh plugin --profile web add github:XJungit/omdp#path:dsh-vision-bridge
dsh plugin --profile web add github:XJungit/omdp#path:dsh-key-fallback
```

> **Command availability** — the `dsh plugin add` commands above assume `dsh` is on your `PATH`. If you run DSH via `npx` per the official docs (no global `dsh` command), those lines fail with `command not found: dsh` — prefix each line with `npx @deepseek-ai/dsh` instead (no `dsh` on PATH required).

The `#path:<subdir>` selector tells pnpm which workspace subdirectory to install (it resolves to that subpackage's `package.json`, not the repo root).

**pnpm ≥10 build-script gate.** A git install fetches *sources*, and pnpm refuses to run a git dependency's `prepare`/build scripts until explicitly allowed — the first `add` fails until you whitelist it in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@omdp/dsh-connector': true
  '@omdp/dsh-vision-bridge': true
  '@omdp/dsh-key-fallback': true
```

Then re-run the `add`. (These plugins are plain JavaScript with no build step, so the whitelist is the only hurdle — no `prepare` script is needed. See the official [publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) for the full "build-script catch".) Treat the allowance as permission to run the package's code at install time; for untrusted sources, pin a commit (`github:XJungit/omdp#<sha>&path:<subdir>`).

The same monorepo layout is used by other DSH plugin collections, e.g. [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui).

### Releasing a new version (GitHub Actions)

1. Bump `version` in the subdirectory's `package.json` (only the one(s) you touched).
2. Commit, then tag and push:
   ```sh
   git tag v3.1.4
   git push origin master && git push origin v3.1.4
   ```
3. `.github/workflows/publish.yml` publishes the touched packages to npm with provenance (re-publishing an already-published version is a no-op — skip message is printed).
4. Update your profile: `pnpm update @omdp/<plugin>`.

See [`docs/npm-publish.md`](docs/npm-publish.md) for the full setup (npm token, GitHub Secret, troubleshooting) and [`docs/plugin-compatibility.md`](docs/plugin-compatibility.md) for the crash-resistance matrix.

### Historical: GitHub and local-link installs

GitHub installs (`dsh plugin add github:XJungit/omdp#path:<plugin>`) worked but hit network/TLS friction (e.g. `UNABLE_TO_VERIFY_LEAF_SIGNATURE`) and pnpm's git-`#path:` normalization on `update` (which dropped the `#path:` spec and could cross-resolve both packages to the repo root). A one-shot repair script (`~/.dsh/profiles/web/update-omdp.ps1`) handled those, but npm installs make all of that unnecessary.

Local `link:` installs (`"@omdp/<plugin>": "link:<abs-path>/omdp/<plugin>"`) still work: `pnpm install` creates a junction so the running plugin **is** the repo source, and updating = edit/pull + restart. They remain a good choice during active development.

### Conventions

- Every plugin subdirectory is a standalone npm package with a `dsh.bundle` (and optionally `dsh.client`) manifest.
- Package names are scoped under `@omdp/` to avoid colliding with upstream `dsh-*` packages on npm.
- Plugins in this repo are plain JavaScript (no build step), so both local-link and GitHub installs work without a compile stage.
- **Installing locally is preferred** during development: add `"@omdp/<plugin>": "link:<abs-path>/omdp/<plugin>"` to the profile's `dependencies` and run `pnpm install` — the plugin loads straight from the repo and updates with a restart.
- New plugins should be modelled on the existing three (connector / vision-bridge / key-fallback) rather than on a skeleton — the real plugins are the living templates.
- **Doc discipline** — any plugin update (source / config / version) must keep the root README, the plugin's own README, and the `docs/` files in sync; lessons learned during development go into `notes/<date>/<category>/` (see [AGENTS.md](AGENTS.md) 规范 2).

### Docs index

| Doc | What it covers |
|---|---|
| [`docs/npm-publish.md`](docs/npm-publish.md) | npm publishing pipeline, why npm over GitHub installs, release flow |
| [`docs/plugin-compatibility.md`](docs/plugin-compatibility.md) | crash-resistance matrix per plugin against DSH updates |
| [`docs/AI-DSH-plugin-quality.md`](docs/AI-DSH-plugin-quality.md) | community research: why AI-written DSH plugins break, and defensive practices |
| [`docs/DSH-plugin-quality-zh-discussion.md`](docs/DSH-plugin-quality-zh-discussion.md) | Chinese write-up of the same research + omdp practice |
| [`docs/dsh-drag-and-drop-troubleshooting.md`](docs/dsh-drag-and-drop-troubleshooting.md) | troubleshooting record for the `dsh-drag-and-drop` plugin (Windows/Chinese) |
| [`notes/README.md`](notes/README.md) | development lessons & notes index (`notes/<date>/<category>/`) — see [AGENTS.md](AGENTS.md) 规范 2 |

---

<a id="zh"></a>

## 中文版

一个把作者全部 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件收进单一 GitHub 仓库的 **monorepo**。每个插件各自独立子目录，是可直接安装的 DSH bundle，并在每次打 `v*` tag 时自动发布到 npm。

### 目录结构

```
omdp/
├── README.md            # 本文件
├── package.json         # 根清单——保证 bare-git 安装可用（见下文）
├── dsh-connector/       # 统一 MCP + Skills 管理器（Web UI 设置页）
│   ├── index.js         # host 半区
│   ├── client.js        # client 半区（Web UI）
│   ├── cordis.patch.yml # bundle 激活行
│   ├── package.json
│   └── README.md
├── dsh-key-fallback/    # 多 key API 池 + 自动轮换
│   ├── lib/index.js     # host 半区（ESM）
│   ├── lib/client.js    # client 半区（Web UI 设置页）
│   ├── cordis.patch.yml # bundle 激活行
│   ├── package.json
│   └── README.md
├── dsh-vision-bridge/   # 视觉桥：让纯文本模型通过配置的多模态端点「看见」
│   ├── index.js         # host 半区
│   ├── client.js        # client 半区（粘贴/拖拽 → 临时路径）
│   ├── cordis.patch.yml # bundle 激活行
│   ├── package.json
│   └── README.md
├── archive/             # 已归档插件，留作历史参考
│   ├── dsh-gitbash-win/
│   ├── resume-stream/
│   ├── key-fallback-*/                  # dsh-key-fallback 各版本快照与设计草案
│   └── README.md
├── notes/               # 开发教训与笔记（三层：notes/<date>/<category>/）
├── docs/                # 研究笔记、兼容性矩阵、发布指南
└── <未来插件>/          # 每个插件一个子目录 + package.json
```

### 插件

#### `@omdp/dsh-connector` — MCP + Skills 管理器（`v0.2.6`）

一个设置页（**Connector**），从 DSH Web UI 管理三件事：

- **MCP 服务器** —— 编辑 `cordis.patch.yml` 中的 MCP 块（stdio / streamable-http），带完整校验，坏配置绝不可能带到下次启动。旧版 SSE 服务器（如知乎）保留为 `mcp-remote --transport sse-only` 的 stdio 桥；插件只管这段配置文本。
- **用户 Skills** —— 读写/删除 `~/.dsh/skills/<name>/SKILL.md` 下的技能（保留 frontmatter）。
- **市场浏览器（v0.2.0+）** —— 匿名 OpenAPI 只读浏览 ModelScope [Skills 集市](https://modelscope.cn/skills) 与 [MCP 广场](https://modelscope.cn/mcp)；一键复制安装命令 / `mcpServers` 配置片段；通过 `source`/`sourceUpdated` frontmatter 检查技能更新。市场数据只存进程内存（30 分钟 TTL），绝不落盘。

```jsonc
"dependencies": { "@omdp/dsh-connector": "^0.2.6" }
```

#### `@omdp/dsh-key-fallback` — 多 key API 池 + 轮换（`v3.1.4`）

位于 LLM 适配器与凭据存储之间。每次请求前，插件从对应 provider 的 key 池里选一把，预写入 provider 的凭据引用；遇配置的触发错误时，把失败 key 标记为冷却并切到下一把——**重发完全交给 DSH 自带的 `dsh-llm-retry`**。带一个常驻可见的设置页（**设置 → API Key 回退**）与全新 UI：

- 可配置的**轮换触发码**（`rotateOn`）——点选 chips 覆盖 DSH `LlmError` 标准码全集（`QUOTA`/`AUTH`/`RATE_LIMIT`/`TIMEOUT`/`TRANSPORT`/`SERVER`/`EMPTY_RESPONSE`/`INVALID_CREDENTIAL`），也支持自定义码（与 `failure.code` **精确匹配**）。
- 显示**当前实际使用的 key**（从最后一次写入 env 的值推导），不是截断的哈希。
- **短 ref**（`key_fallback_<provider>_key1`、…），旧长 ref 一次性幂等迁移。
- 眼睛开关**明文揭示**（`GET /keys/plain`，仅限池内 key / env key）与**可编辑 env key**（文件托管的可编辑；由启动环境注入的只读）。
- 每把 key 的 `nextRef`、池锁定（"设为当前"）、冷却重置与删除。

```jsonc
"dependencies": { "@omdp/dsh-key-fallback": "^3.1.4" }
```

#### `@omdp/dsh-vision-bridge` — 给纯文本模型的视觉（`v0.1.8`）

零依赖插件，给**纯文本模型**装上视觉：自动探测被路由模型是否支持图片（`llm.resolveModelInfo().inputModalities`）；对纯文本模型，把粘贴/附加的图片转发到可配置的 OpenAI 兼容多模态端点（默认 Agnes `agnes-2.5-flash`），并把返回文本喂回作为证据。附带 `vision_bridge_read_image` 工具、粘贴/拖拽 → 临时路径的浏览器处理器、一个包装后的 `(vision bridge)` provider 条目，以及 `agent/pre-step` 自动读取钩子。

```jsonc
"dependencies": { "@omdp/dsh-vision-bridge": "^0.1.8" }
```

### 从 npm 安装（推荐）

三个插件都会由 GitHub Actions 在每次打 `v*` tag 时自动发布到 **npm**。这是**首选**安装路径——绕开 GitHub 安装带来的 git-`#path:` 规范化、交叉解析与 `allowBuilds` 摩擦（历史详见 `docs/npm-publish.md`）。

```jsonc
// ~/.dsh/profiles/<name>/package.json —— 可用其一或自由组合
"dependencies": {
  "@omdp/dsh-connector": "^0.2.6",
  "@omdp/dsh-vision-bridge": "^0.1.8",
  "@omdp/dsh-key-fallback": "^3.1.4"
}
```

```sh
cd ~/.dsh/profiles/<name>
pnpm install
```

升级就是标准的 `pnpm update`：

```sh
cd ~/.dsh/profiles/<name>
pnpm update @omdp/dsh-connector @omdp/dsh-vision-bridge @omdp/dsh-key-fallback
```

### 从 GitHub 远程安装（备选）

每个活跃插件都是独立子目录里的独立 npm 包，因此也能不经过本地 checkout、直接从 GitHub 安装：

```sh
dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector
dsh plugin --profile web add github:XJungit/omdp#path:dsh-vision-bridge
dsh plugin --profile web add github:XJungit/omdp#path:dsh-key-fallback
```

> **安装命令前提**：上面的 `dsh plugin add` 假设 `dsh` 已在 PATH。若你是按官方文档用 `npx` 运行 dsh（没有全局 `dsh` 命令），这几行会报 `command not found: dsh` —— 每行前面加 `npx @deepseek-ai/dsh` 即可（不要求 `dsh` 在 PATH）。

`#path:<子目录>` 选择器告诉 pnpm 安装哪个 workspace 子目录（解析到该子包的 `package.json`，而不是仓库根）。

**pnpm ≥10 构建脚本门禁。** git 安装拉取的是*源码*，pnpm 默认拒绝运行 git 依赖的 `prepare`/构建脚本，直到显式放行——首次 `add` 会失败，需要先在 profile 的 `pnpm-workspace.yaml` 里白名单：

```yaml
allowBuilds:
  '@omdp/dsh-connector': true
  '@omdp/dsh-vision-bridge': true
  '@omdp/dsh-key-fallback': true
```

然后重新执行 `add`。（这些插件是纯 JavaScript、无构建步骤，所以白名单是唯一障碍——不需要 `prepare` 脚本。官方 [publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) 有完整的"构建脚本坑"说明。）放行等于允许在安装时运行该包的代码；对不可信来源，请固定到具体 commit（`github:XJungit/omdp#<sha>&path:<子目录>`）。

其他 DSH 插件集合也采用同样的 monorepo 布局，例如 [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)。

### 发布新版本（GitHub Actions）

1. 在子目录的 `package.json` 里 bump `version`（只 bump 你动过的）。
2. 提交，然后打 tag 并推送：
   ```sh
   git tag v3.1.4
   git push origin master && git push origin v3.1.4
   ```
3. `.github/workflows/publish.yml` 把动过的包发布到 npm（带 provenance；已发布的版本重复发布是 no-op，会打印 skip 信息）。
4. 更新你的 profile：`pnpm update @omdp/<plugin>`。

完整配置（npm token、GitHub Secret、排障）见 [`docs/npm-publish.md`](docs/npm-publish.md)；抗崩溃矩阵见 [`docs/plugin-compatibility.md`](docs/plugin-compatibility.md)。

### 历史：GitHub 与本地 link 安装

GitHub 安装（`dsh plugin add github:XJungit/omdp#path:<插件>`）能用，但会撞上网络/TLS 摩擦（如 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`），以及 pnpm 在 `update` 时的 git-`#path:` 规范化问题（会丢 `#path:` 片段，甚至可能把两个包都交叉解析到仓库根）。当时用一次性修复脚本（`~/.dsh/profiles/web/update-omdp.ps1`）兜底，但 npm 安装让这一切都不再必要。

本地 `link:` 安装（`"@omdp/<插件>": "link:<绝对路径>/omdp/<插件>"`）依然可用：`pnpm install` 会创建 junction，让运行中的插件**就是**仓库源码，更新 = 改代码/拉取 + 重启。开发活跃期仍是好选择。

### 约定

- 每个插件子目录都是独立 npm 包，带 `dsh.bundle`（可选 `dsh.client`）清单。
- 包名统一挂在 `@omdp/` 作用域下，避免与上游 `dsh-*` 包在 npm 上撞名。
- 仓库里的插件都是纯 JavaScript（无构建步骤），所以本地 link 与 GitHub 安装都不需要编译环节。
- 开发期**优先本地安装**：把 `"@omdp/<插件>": "link:<绝对路径>/omdp/<插件>"` 加进 profile 的 `dependencies`，跑 `pnpm install` —— 插件直接从仓库加载，改完重启即生效。
- 新插件应以现有三个插件（connector / vision-bridge / key-fallback）为蓝本，而不是复制模板——真实插件就是活的模板。
- **文档纪律**：插件有任何更新（源码/配置/版本）时，必须同步更新根 README、对应插件 README、docs/ 相关文档；开发中产生的教训/经验主动写入 `notes/<date>/<category>/`（详见 [AGENTS.md](AGENTS.md) 规范 2）。

### 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/npm-publish.md`](docs/npm-publish.md) | npm 发布管线、为什么选 npm 而非 GitHub 安装、发布流程 |
| [`docs/plugin-compatibility.md`](docs/plugin-compatibility.md) | 各插件对 DSH 更新的抗崩溃矩阵 |
| [`docs/AI-DSH-plugin-quality.md`](docs/AI-DSH-plugin-quality.md) | 社区研究：为什么 AI 写的 DSH 插件会坏，以及防御性实践 |
| [`docs/DSH-plugin-quality-zh-discussion.md`](docs/DSH-plugin-quality-zh-discussion.md) | 同一研究的中文版 + omdp 实践 |
| [`docs/dsh-drag-and-drop-troubleshooting.md`](docs/dsh-drag-and-drop-troubleshooting.md) | `dsh-drag-and-drop` 插件排障记录（Windows/中文） |
| [`notes/README.md`](notes/README.md) | 开发教训与笔记索引（`notes/<date>/<category>/`）——见 [AGENTS.md](AGENTS.md) 规范 2 |
