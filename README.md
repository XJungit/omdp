# omdp — only my DSH plugins

A single GitHub repo that collects all of my [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugins as a **monorepo**. Each plugin lives in its own subdirectory and is an independently installable DSH bundle, published to npm on every `v*` tag.

## Layout

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
│   └── resume-stream/
├── _skeleton-client/    # copy-paste template: client + host bundle (Web UI plugin)
├── _skeleton-host/      # copy-paste template: host-only bundle
├── docs/                # research notes, compatibility matrix, publish guide
└── <future plugins>/    # each its own subdirectory + package.json
```

## Plugins

### `@omdp/dsh-connector` — MCP + Skills manager (`v0.2.5`)

One settings tab (**Connector**) that manages three things from the DSH Web UI:

- **MCP servers** — edits the MCP block in `cordis.patch.yml` (stdio / streamable-http), with full validation so bad config never reaches the next boot. Legacy SSE servers (e.g. Zhihu) are kept as `mcp-remote --transport sse-only` stdio bridges; the plugin only manages that config text.
- **User skills** — read / write / delete skills under `~/.dsh/skills/<name>/SKILL.md` (frontmatter preserved).
- **Market explorer (v0.2.0+)** — read-only browsing of ModelScope [Skills hub](https://modelscope.cn/skills) and [MCP plaza](https://modelscope.cn/mcp) via anonymous OpenAPI; one-click copy of install commands / `mcpServers` config snippets, skill "check update" via `source`/`sourceUpdated` frontmatter. Market data lives only in process memory (30-min TTL), never on disk.

```jsonc
"dependencies": { "@omdp/dsh-connector": "^0.2.5" }
```

### `@omdp/dsh-key-fallback` — multi-key API key pool with rotation (`v3.1.1`)

Sits between the LLM adapter and the credential store. Before each request the plugin picks a key from the per-provider pool and pre-writes it into the provider's credential reference; on a configured trigger error it marks the failed key cooling and advances to the next key — **re-sending is left entirely to DSH's own `dsh-llm-retry`**. Ships an always-visible settings page (**Settings → API Key 回退**) with a redesigned UI:

- Configurable **rotation triggers** (`rotateOn`) — clickable chips covering the full DSH `LlmError` standard code set (`QUOTA`/`AUTH`/`RATE_LIMIT`/`TIMEOUT`/`TRANSPORT`/`SERVER`/`EMPTY_RESPONSE`/`INVALID_CREDENTIAL`) plus custom codes (matched exactly against `failure.code`).
- Shows the **actually-used key** (derived from the last value written to the env), not a truncated hash.
- **Short refs** (`key_fallback_<provider>_key1`, …) with one-time idempotent migration of legacy long refs.
- **Plaintext reveal** via an eye toggle (`GET /keys/plain`, pool-owned keys / env key only) and **editable env keys** (file-backed ones; read-only when supplied by the launching environment).
- Per-key `nextRef`, pool lock ("设为当前"), cooldown reset, and delete.

```jsonc
"dependencies": { "@omdp/dsh-key-fallback": "^3.1.1" }
```

### `@omdp/dsh-vision-bridge` — vision for text-only models (`v0.1.7`)

A zero-dependency plugin that gives **text-only models** vision: it auto-detects whether the routed model supports images (`llm.resolveModelInfo().inputModalities`), and for text-only models forwards pasted / attached images to a configurable OpenAI-compatible multimodal endpoint (default Agnes `agnes-2.5-flash`) and feeds the returned text back as evidence. Ships a `vision_bridge_read_image` tool, a paste/drop → temp-path browser handler, a wrapped `(vision bridge)` provider entry, and an `agent/pre-step` auto-read hook.

```jsonc
"dependencies": { "@omdp/dsh-vision-bridge": "^0.1.7" }
```

## Installing from npm (recommended)

All three plugins are published to **npm** automatically by GitHub Actions on every `v*` tag. This is the **preferred** install path — it avoids the git-`#path:` normalization, cross-resolution, and `allowBuilds` friction that GitHub installs cause (see the history in `docs/npm-publish.md`).

```jsonc
// ~/.dsh/profiles/<name>/package.json — you can use one or mix-and-match
"dependencies": {
  "@omdp/dsh-connector": "^0.2.5",
  "@omdp/dsh-vision-bridge": "^0.1.7",
  "@omdp/dsh-key-fallback": "^3.1.1"
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

## Remote installs from GitHub (alternative)

Each active plugin is a standalone npm package in its own subdirectory, so it can also be installed straight from GitHub without a local checkout:

```sh
dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector
dsh plugin --profile web add github:XJungit/omdp#path:dsh-vision-bridge
dsh plugin --profile web add github:XJungit/omdp#path:dsh-key-fallback
```

> **安装命令前提**：上面的 `dsh plugin add` 需要 `dsh` 已在 PATH。若你是按官方文档用 `npx` 运行 dsh（没有全局 `dsh` 命令），上面这几行会报 `command not found: dsh` —— 每行前面加 `npx @deepseek-ai/dsh` 即可（不要求 `dsh` 在 PATH）。

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

## Releasing a new version (GitHub Actions)

1. Bump `version` in the subdirectory's `package.json` (only the one(s) you touched).
2. Commit, then tag and push:
   ```sh
   git tag v3.1.1
   git push origin master && git push origin v3.1.1
   ```
3. `.github/workflows/publish.yml` publishes the touched packages to npm with provenance (re-publishing an already-published version is a no-op — skip message is printed).
4. Update your profile: `pnpm update @omdp/<plugin>`.

See [`docs/npm-publish.md`](docs/npm-publish.md) for the full setup (npm token, GitHub Secret, troubleshooting) and [`docs/plugin-compatibility.md`](docs/plugin-compatibility.md) for the crash-resistance matrix.

## Historical: GitHub and local-link installs

GitHub installs (`dsh plugin add github:XJungit/omdp#path:<plugin>`) worked but hit network/TLS friction (e.g. `UNABLE_TO_VERIFY_LEAF_SIGNATURE`) and pnpm's git-`#path:` normalization on `update` (which dropped the `#path:` spec and could cross-resolve both packages to the repo root). A one-shot repair script (`~/.dsh/profiles/web/update-omdp.ps1`) handled those, but npm installs make all of that unnecessary.

Local `link:` installs (`"@omdp/<plugin>": "link:<abs-path>/omdp/<plugin>"`) still work: `pnpm install` creates a junction so the running plugin **is** the repo source, and updating = edit/pull + restart. They remain a good choice during active development.

## Conventions

- Every plugin subdirectory is a standalone npm package with a `dsh.bundle` (and optionally `dsh.client`) manifest.
- Package names are scoped under `@omdp/` to avoid colliding with upstream `dsh-*` packages on npm.
- Plugins in this repo are plain JavaScript (no build step), so both local-link and GitHub installs work without a compile stage.
- **Installing locally is preferred** during development: add `"@omdp/<plugin>": "link:<abs-path>/omdp/<plugin>"` to the profile's `dependencies` and run `pnpm install` — the plugin loads straight from the repo and updates with a restart.
- `_skeleton-client/` and `_skeleton-host/` are copy-paste templates for new plugins; they are not installable bundles themselves.

## Docs index

| Doc | What it covers |
|---|---|
| [`docs/npm-publish.md`](docs/npm-publish.md) | npm publishing pipeline, why npm over GitHub installs, release flow |
| [`docs/plugin-compatibility.md`](docs/plugin-compatibility.md) | crash-resistance matrix per plugin against DSH updates |
| [`docs/AI-DSH-plugin-quality.md`](docs/AI-DSH-plugin-quality.md) | community research: why AI-written DSH plugins break, and defensive practices |
| [`docs/DSH-plugin-quality-zh-discussion.md`](docs/DSH-plugin-quality-zh-discussion.md) | Chinese write-up of the same research + omdp practice |
| [`docs/dsh-drag-and-drop-troubleshooting.md`](docs/dsh-drag-and-drop-troubleshooting.md) | troubleshooting record for the `dsh-drag-and-drop` plugin (Windows/Chinese) |
