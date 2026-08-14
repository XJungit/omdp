# SKELETON: DSH bundle with a Web UI settings tab

A copy-paste starting point for a DSH plugin that renders a **settings tab** in
the browser. Copy this directory, rename `REPLACE-ME`, and implement your logic.

## Rename checklist

1. Directory name → `omdp-<your-plugin>`
2. `package.json` → `name: "omdp-<your-plugin>"`, keep `dsh.client` (platform web)
3. `cordis.patch.yml` → `id: <your-plugin-id>` and `name: omdp-<your-plugin>`
4. `index.js` → replace `REPLACE-ME` (plugin name + API prefix paths)
5. `client.js` → replace every `REPLACE-ME` (module id, css scope, fetch prefix, tab id/label)

## How the two halves talk

- **host** (`index.js`): injects `['webServer']`, registers a URL prefix
  (`ctx.webServer.register({ kind: 'prefix', path, handler })`). The browser
  reaches it via `fetch('/<prefix>/api/...')`.
- **client** (`client.js`): served at `/plugins/<id>/client.js`, handed to the
  browser via `window.__ModuleLoader__.load`. It registers a `settings.section`
  entry (id + order + label + React component). `require('react')` and
  `require('slots')` are provided by the harness runtime — **not** npm deps.

This split (webserver prefix + ModuleLoader) is the installed-bundle convention
used by `dsh-mcp-manager`. It is NOT the dynamic-plugin `harness.handle` /
`host.call` RPC.

## Install

```sh
dsh plugin --profile web add github:XJungit/omdp#path:<your-plugin-dir>
```

## Notes

- `settings.section` is a **list** slot; each entry is one settings page.
- Registrations made through `ctx` are effects and auto-clean on unload/HMR.
