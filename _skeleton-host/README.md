# SKELETON: host-only DSH bundle

A copy-paste starting point for a **host-only** DSH plugin (no Web UI). Copy this
directory, rename `REPLACE-ME`, and implement your logic in `index.js`.

## Rename checklist

1. Directory name → `omdp-<your-plugin>`
2. `package.json` → `name: "omdp-<your-plugin>"`
3. `cordis.patch.yml` → `id: <your-plugin-id>` and `name: omdp-<your-plugin>`
4. `index.js` → replace `REPLACE-ME` (plugin name) and fill `apply()`

## Install

```sh
dsh plugin --profile web add github:XJungit/omdp#path:<your-plugin-dir>
```

## Notes

- This skeleton has **no client half**: it cannot render a settings tab. If you
  need a browser UI, copy `_skeleton-client` instead.
- Keep `dsh.bundle.patch` pointing at `./cordis.patch.yml`.
- Per `config.md`, expose tunable values as a Schemastery `Config` schema rather
  than hardcoding them.
