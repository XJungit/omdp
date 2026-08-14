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
├── _skeleton-client/    # copy-paste template: client + host bundle (Web UI plugin)
├── _skeleton-host/      # copy-paste template: host-only bundle
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

## Why local `link:` installs are recommended

GitHub installs (`dsh plugin add github:XJungit/omdp#path:<plugin>`) work but hit
network/TLS friction (e.g. `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, proxy rewrites).
Installing each plugin as a **local `link:` dependency** instead:

- `pnpm install` creates a `node_modules/@omdp/<plugin>` junction pointing at the
  repo subdirectory, so the running plugin **is** the repo source.
- Updating = edit/pull the repo + restart `dsh` — no re-fetch, no lockfile pins.
- The repo-root `package.json` (named `@omdp/dsh-connector`) is still kept so that
  a pnpm-canonicalized bare-git install of `dsh-connector` remains resolvable; it is
  not needed for local-link installs.

## Conventions

- Every plugin subdirectory is a standalone npm package with a `dsh.bundle` (and optionally `dsh.client`) manifest.
- Package names are scoped under `@omdp/` to avoid colliding with upstream `dsh-*` packages on npm.
- Plugins in this repo are plain JavaScript (no build step), so both local-link and GitHub installs work without a compile stage.
- **Installing locally is preferred**: add `"@omdp/<plugin>": "link:<abs-path>/omdp/<plugin>"` to the profile's `dependencies` and run `pnpm install` — the plugin loads straight from the repo and updates with a restart. GitHub installs remain possible via `github:XJungit/omdp#path:<plugin>`; the repository-root `package.json` mirrors `@omdp/dsh-connector` so a pnpm-canonicalized bare-git install of `dsh-connector` still resolves (see above).
- `_skeleton-client/` and `_skeleton-host/` are copy-paste templates for new plugins; they are not installable bundles themselves.
