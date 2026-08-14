# omdp — only my DSH plugins

A single GitHub repo that collects all of my [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugins as a **monorepo**. Each plugin lives in its own subdirectory and is an independently installable DSH bundle.

## Layout

```
omdp/
├── README.md            # this file
├── dsh-connector/       # unified MCP + Skills manager (Web UI settings tab)
│   ├── index.js         # host half
│   ├── client.js        # client half (Web UI)
│   ├── cordis.patch.yml # bundle activation row
│   ├── package.json
│   └── README.md
└── <future plugins>/    # each its own subdirectory + package.json
```

## Plugins

### `dsh-connector` → npm name `omdp-dsh-connector`

One settings tab ("Connector") that manages two things from the DSH Web UI:

- **MCP servers** — edits the MCP block in `cordis.patch.yml` (stdio / streamable-http). Legacy SSE servers (e.g. Zhihu) are kept as `mcp-remote --transport sse-only` stdio bridges; this plugin only manages that config text.
- **User skills** — read / write / delete skills under `~/.dsh/skills/<name>/SKILL.md`.

Install into a profile (see each plugin's README for the exact command):

```sh
dsh plugin --profile web add github:XJungit/omdp/dsh-connector
```

## Conventions

- Every plugin subdirectory is a standalone npm package with a `dsh.bundle` (and optionally `dsh.client`) manifest.
- Package names are prefixed `omdp-` to avoid colliding with upstream `dsh-*` packages on npm.
- Plugins in this repo are plain JavaScript (no build step), so a GitHub install works directly without a compile stage.
