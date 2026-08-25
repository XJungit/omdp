# omdp — only my DSH plugins

A single GitHub repo that collects all of my [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugins as a **monorepo**. Each plugin lives in its own subdirectory and is an independently installable DSH bundle.

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
├── docs/                # research notes, e.g. AI-DSH-plugin-quality.md (community findings)
└── <future plugins>/    # each its own subdirectory + package.json
```

## Plugins

### `dsh-connector` → npm name `@omdp/dsh-connector`

One settings tab ("Connector") that manages two things from the DSH Web UI:

- **MCP servers** — edits the MCP block in `cordis.patch.yml` (stdio / streamable-http). Legacy SSE servers (e.g. Zhihu) are kept as `mcp-remote --transport sse-only` stdio bridges; this plugin only manages that config text.
- **User skills** — read / write / delete skills under `~/.dsh/skills/<name>/SKILL.md`.

Install into a profile via a **local `link:` dependency** (see its README for the exact steps):

```json
"@omdp/dsh-connector": "link:D:/WorkSpace/omdp/dsh-connector"
```

### `dsh-key-fallback` → npm name `@omdp/dsh-key-fallback`

Minimal API key fallback: on a retryable request error (`AUTH / 401 / key / rate / timeout` → `agent/request-error`), silently marks the current key cooling and **retries the same request with the next pooled key in one step**. Ships an always-visible settings section (`settings.section → API Key 回退`) that shows `分nek` key count / cursor / cooling / healthy (visibility-gated polling, no busy-loop).

Configure in `~/.dsh/settings.yaml`:

```yaml
keyFallback:
  providers:
    ninerouter:   # provider id (e.g. ninerouter / openrouter / a6api)
      env: NINEROUTER_API_KEY
      keys:
        - sk-xxx   # pooled keys
        - sk-yyy
      cooldownMs: 30000
```

**How it works:** `llm-pi-ai` providers (e.g. `ninerouter`) authenticate via the credentials domain — the host writes `ctx.credentials.set(env, key)` **and** `process.env[env]` so the retry actually reaches the model call **and** the UI `settings.section` + `settings.plugin.item` card show `分nek` cooling/healthy. The rotation is per-turn bounded (`turn:step` → ≤ `keys.length` retries) and backed by a 30s-per-failure cooldown (up to 5×). See `dsh-key-fallback/README.md` for the full reference and `dsh-vision-bridge`’s `index.js` for the ESM bundle pattern.

Install into a profile via a **local `link:` dependency** or from **npm**:

```json
"@omdp/dsh-key-fallback": "^1.0.7"
```

### `dsh-vision-bridge` → npm name `@omdp/dsh-vision-bridge`

A zero-dependency plugin that gives **text-only models** vision: it auto-detects whether the
routed model supports images, and for text-only models forwards pasted / attached images to a
configurable OpenAI-compatible multimodal endpoint (default Agnes `agnes-2.5-flash`) and feeds the
returned text back as evidence. Ships a `vision_bridge_read_image` tool, a paste/drop → temp-path
browser handler, a wrapped `(vision bridge)` provider entry, and an `agent/pre-step` auto-read hook.

Install into a profile via a **local `link:` dependency**:

```json
"@omdp/dsh-vision-bridge": "link:D:/WorkSpace/omdp/dsh-vision-bridge"
```

See its own `README.md` for the full config reference.

## Archived plugins

The following plugins are retained under [`archive/`](archive/) for historical reference and are no longer maintained or published by this repository:

- `@omdp/dsh-gitbash-win` → [`archive/dsh-gitbash-win/`](archive/dsh-gitbash-win/)
- `@omdp/dsh-resume-stream` → [`archive/resume-stream/`](archive/resume-stream/)

Existing npm versions remain available from npm. Archiving the source does not automatically uninstall an already-installed package from any DSH profile.

## Remote installs from GitHub (alternative)

Each active plugin is a standalone npm package in its own subdirectory, so it can also
be installed straight from GitHub without a local checkout:

```sh
dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector
dsh plugin --profile web add github:XJungit/omdp#path:dsh-vision-bridge
```

> **安装命令前提**：上面的 `dsh plugin add` 需要 `dsh` 已在 PATH。若你是按官方文档用 `npx` 运行 dsh（没有全局 `dsh` 命令），上面这几行会报 `command not found: dsh` —— 每行前面加 `npx @deepseek-ai/dsh` 即可（不要求 `dsh` 在 PATH）。

The `#path:<subdir>` selector tells pnpm which workspace subdirectory to install
(it resolves to that subpackage's `package.json`, not the repo root).

**pnpm ≥10 build-script gate.** A git install fetches *sources*, and pnpm refuses
to run a git dependency's `prepare`/build scripts until explicitly allowed — the
first `add` fails until you whitelist it in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@omdp/dsh-connector': true
  '@omdp/dsh-vision-bridge': true
```

Then re-run the `add`. (These plugins are plain JavaScript with no build step,
so the whitelist is the only hurdle — no `prepare` script is needed. See the
official [publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
for the full "build-script catch".) Treat the allowance as permission to run the
package's code at install time; for untrusted sources, pin a commit
(`github:XJungit/omdp#<sha>&path:<subdir>`).

The same monorepo layout is used by other DSH plugin collections, e.g.
[zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui).

## Installing from npm (recommended)

All three plugins are published to **npm** (`@omdp/dsh-connector`, `@omdp/dsh-vision-bridge`,
 `@omdp/dsh-key-fallback`),
automatically by GitHub Actions on every `v*` tag. This is the **preferred** install
path — it avoids the git-`#path:` normalization, cross-resolution, and
`allowBuilds` friction that GitHub installs cause (see the history in
`docs/npm-publish.md`).

```jsonc
// ~/.dsh/profiles/<name>/package.json — you can use three or mix-and-match
"dependencies": {
  "@omdp/dsh-connector": "^0.2.5",
  "@omdp/dsh-vision-bridge": "^0.1.6",
  "@omdp/dsh-key-fallback": "^1.0.7"
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

No `#path:` spec, no `allowBuilds` gate, no one-shot repair script, no duplicate
loader-id pitfalls — npm packages install as clean bundles.

## Releasing a new version (GitHub Actions)

1. Bump `version` in `dsh-connector/package.json`, `dsh-vision-bridge/package.json`,
 and `dsh-key-fallback/package.json` (or only the one(s) you touched).
2. Commit, then tag and push:
   ```sh
   git tag v1.0.7
   git push origin master && git push origin v1.0.7
   ```
3. `.github/workflows/publish.yml` publishes the three packages to npm with provenance
 (re-publishing an already-published version is a no-op — skip message is printed).
4. Update your profile: `pnpm update @omdp/dsh-connector @omdp/dsh-vision-bridge @omdp/dsh-key-fallback`.

See [`docs/npm-publish.md`](docs/npm-publish.md) for the full setup (npm token,
GitHub Secret, troubleshooting).

## Historical: GitHub and local-link installs

GitHub installs (`dsh plugin add github:XJungit/omdp#path:<plugin>`) worked but hit
network/TLS friction (e.g. `UNABLE_TO_VERIFY_LEAF_SIGNATURE`) and pnpm's git-`#path:`
normalization on `update` (which dropped the `#path:` spec and could cross-resolve
both packages to the repo root). A one-shot repair script
(`~/.dsh/profiles/web/update-omdp.ps1`) handled those, but npm installs make all of
that unnecessary.

Local `link:` installs (`"@omdp/<plugin>": "link:<abs-path>/omdp/<plugin>"`) still work:
`pnpm install` creates a junction so the running plugin **is** the repo source, and
updating = edit/pull + restart. They remain a good choice during active development.

## Conventions

- Every plugin subdirectory is a standalone npm package with a `dsh.bundle` (and optionally `dsh.client`) manifest.
- Package names are scoped under `@omdp/` to avoid colliding with upstream `dsh-*` packages on npm.
- Plugins in this repo are plain JavaScript (no build step), so both local-link and GitHub installs work without a compile stage.
- **Installing locally is preferred**: add `"@omdp/<plugin>": "link:<abs-path>/omdp/<plugin>"` to the profile's `dependencies` and run `pnpm install` — the plugin loads straight from the repo and updates with a restart. GitHub installs remain possible via `github:XJungit/omdp#path:<plugin>`; the repository-root `package.json` mirrors `@omdp/dsh-connector` so a pnpm-canonicalized bare-git install of `dsh-connector` still resolves (see above).
- `_skeleton-client/` and `_skeleton-host/` are copy-paste templates for new plugins; they are not installable bundles themselves.
