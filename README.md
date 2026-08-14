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
├── _skeleton-client/    # copy-paste template: client + host bundle (Web UI plugin)
├── _skeleton-host/      # copy-paste template: host-only bundle
└── <future plugins>/    # each its own subdirectory + package.json
```

## Plugins

### `dsh-connector` → npm name `@omdp/dsh-connector`

One settings tab ("Connector") that manages two things from the DSH Web UI:

- **MCP servers** — edits the MCP block in `cordis.patch.yml` (stdio / streamable-http). Legacy SSE servers (e.g. Zhihu) are kept as `mcp-remote --transport sse-only` stdio bridges; this plugin only manages that config text.
- **User skills** — read / write / delete skills under `~/.dsh/skills/<name>/SKILL.md`.

Install into a profile (see each plugin's README for the exact command):

```sh
dsh plugin --profile web add github:XJungit/omdp#path:dsh-connector
```

## Why the repository root has a package.json

`dsh plugin add/update` is a pnpm wrapper, and pnpm canonicalizes a
`github:XJungit/omdp#path:<plugin>` spec into a **bare**
`git+https://github.com/XJungit/omdp.git` URL, dropping the `#path:` selector
from `package.json` (the lockfile keeps the path). To keep such installs
functional, the repository root ships `package.json` named
`@omdp/dsh-connector` whose `main`/`exports` re-export the `dsh-connector/`
subdirectory and whose `dsh.bundle.patch` points into it — so a bare-git
install resolves to a complete plugin, identical to a `#path:` install.

This matters because *any* later `dsh plugin --profile <p> update @omdp/dsh-connector`
rewrites the saved spec to the bare form. Both forms are supported and
interchangeable; the root manifest exists precisely so that normalization
never breaks an install.

## Conventions

- Every plugin subdirectory is a standalone npm package with a `dsh.bundle` (and optionally `dsh.client`) manifest.
- Package names are scoped under `@omdp/` to avoid colliding with upstream `dsh-*` packages on npm.
- Plugins in this repo are plain JavaScript (no build step), so a GitHub install works directly without a compile stage.
- The repository-root `package.json` mirrors the current plugin so that pnpm-canonicalized bare-git specs still install a complete bundle (see above).
- `_skeleton-client/` and `_skeleton-host/` are copy-paste templates for new plugins; they are not installable bundles themselves.
