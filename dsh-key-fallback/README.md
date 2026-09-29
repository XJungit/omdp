# @omdp/dsh-key-fallback

[简体中文](README.zh-CN.md) | English

**Multi-key API key pool with automatic rotation for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)** — hooks DSH's credential seam `credentials.resolve`: each time an adapter asks for a key, if that ref belongs to a configured pool the wrapper returns the pool's current key; when a configured trigger error occurs it marks the failed key cooling (fixed `cooldownMs`, no exponential backoff) and advances to the next key. **Re-sending is left entirely to DSH's own `dsh-llm-retry`** — this plugin never re-sends on its own; it only switches the key and lets the retry policy decide.

Current version: **v3.3.1** (`v7` UI generation).

## What v3.3.1 offers

- **Documentation correction — no code change** (2026-09-29). The v3.3.0 release notes asserted that the plugin
  had never actually switched keys, because the `process.env` write never reached the credential layer. **That
  assertion was wrong and is retracted here.** The `credentials.resolve` wrapper that supplies the key has
  existed since **v3.0.0** (`git log -S 'credSvc.resolve =' -- dsh-key-fallback/lib/index.js` → `75ea76a`), and
  the **published 3.2.4 tarball** already contains both that wrapper and its `pool-hit` diagnostic (verified by
  downloading `@omdp/dsh-key-fallback@3.2.4` from the registry and reading `lib/index.js:298` / `:305`).
  Rotation was already reaching the provider; the redundant `process.env` writes sat *alongside* the working
  wrapper rather than being the mechanism. v3.3.0's real content is the smaller, accurate list in the section
  below.
- **Live production evidence that rotation works** — captured on the real desktop install (DSH `0.2.0-rc.1`,
  plugin v3.3.0) while a chat was routed through a pooled provider, from `GET /dsh-key-fallback/diag`:
  200 entries (`resolve` 57 / `agent/request` 51 / `request-error` 90), with the pool's two keys used
  **26 and 25 times** and alternating on each failure:
  `PICK key_fallback_sensenova_key1` → `RATE_LIMIT` → `marked key_fallback_sensenova_key1` →
  `PICK SENSENOVA_API_KEY` → … → `pool-hit SENSENOVA_API_KEY -> key_fallback_sensenova_key1`.
  Each `pool-hit` line names the key that was current at that instant, which is exactly what the adapter
  received on the wire.

## What v3.3.0 offers

- **Four real fixes** (2026-09-29). **Note**: the original v3.3.0 notes claimed this release made key switching
  "actually reach the provider" for the first time. That was wrong — see the v3.3.1 correction above. What
  v3.3.0 really changed:
  - **`activeRef` no longer misreports the current key.** `/pools` used to derive `activeRef` by matching the
    value of `process.env[<pool env>]` against the pool's members and falling back to `currentRef` only when no
    member matched — so it could highlight **the wrong key**. On a live 0.2.0-rc.1 install it reported
    `activeRef=SENSENOVA_API_KEY` while `currentRef` was `key_fallback_sensenova_key1`. `activeRef` is now
    simply `currentRef`, so the two always agree.
  - **Five redundant `process.env` writes removed.** DSH freezes `{ ...process.env }` into a *launch
    environment snapshot* at boot (`dsh-app-boot`), `dsh-launch-environment` copies that into a `Map`, and
    `dsh-credentials-local.inherited()` reads only that snapshot — so a post-boot `process.env` write is
    invisible to the credential layer. The writes were therefore dead weight for authentication (the `resolve`
    wrapper is what supplies the key). Removing them also stops the plugin from mutating the host process
    environment. **Behaviour note**: a tool that spawns a subprocess inheriting `process.env` now sees the
    launch-time value rather than the rotated one — no credential consumer depends on it, because every one of
    them resolves through `credentials.resolve`, which the wrapper intercepts.
  - **Failure attribution is guarded.** `agent/request-error` used to fall back to blaming `keyValues[0]` when
    the current key could not be identified; it now only marks a key it can actually name.
  - **Uninstall restores the original `resolve`** via `ctx.effect`, guarded by an identity check so it never
    clobbers a wrapper installed after ours — a hot reload or fiber rebuild no longer stacks wrappers whose
    closures hold expired services.
- **Unchanged**: re-send remains DSH's job. The rotation handler only changes the pool's current ref and still
  calls `next()`, so `dsh-llm-retry` keeps deciding whether and how often to re-send. Verified: `next()` is
  called on every rotation path.
- **Verification** (all measured, no inference): the real official `@deepseek-ai/dsh-llm-pi-ai` adapter was
  applied in-process with a real `LocalCredentialProvider` and a local mock upstream; the API key was captured
  from the **actual outbound HTTP `Authorization` header** — `Bearer STORED-ENV-KEY` before the plugin,
  `Bearer KEY-ONE-111` after pre-selection, `Bearer KEY-TWO-222` after a `RATE_LIMIT` rotation, back to
  `STORED-ENV-KEY` after `dispose()`. Two further suites cover the edge cases (`enabled:false`, empty pool,
  unresolvable env, `useKeyRef` lock, `activeRef`/`currentRef` agreement over HTTP, `dispose` idempotence,
  non-matching error codes) — 14/14 and 9/9 pass. The live production timeline is in v3.3.1 above.

## What v3.2.4 offers

- **Adds DSH `0.2.0-rc.1` to the peer enumeration** (2026-09-28) — code unchanged. The DSH **desktop** app
  moved to `0.2.0-rc.1`, which made the `0.1.7-rc.2` declaration stale again: the gate skipped the bundle
  (plugin page item gone, `/dsh-key-fallback/*` → 404 — a graceful skip, not a crash). Verification before
  declaring:
  1. **Tarball diff `0.1.7-rc.2` → `0.2.0-rc.1`, file by file** (SHA1 over every `lib/` file of both official
     npm packages): `dsh-credentials`, `dsh-llm`, `dsh-settings`, `dsh-shell`, `dsh-tools`, `dsh-mcp-client`,
     `dsh-web`, `dsh-agent` are **byte-identical** — the whole surface this plugin touches
     (`credentials.resolve/describe/set/unset`, the `agent/request` + `agent/request-error` waterfall,
     `settings.describe/replace`) is unchanged. (Only `dsh-session` changes, additively, plus `dsh-app-boot`
     itself.)
  2. **Gate execution**: ran the `0.2.0-rc.1` `evaluatePluginCompatibility()` against the new manifest → pass;
     against the old 3.2.3 manifest → blocked on all four peers.
  3. **Live assembly**: installed the official `@deepseek-ai/dsh@0.2.0-rc.1` (542 packages) in a sandbox with an
     isolated `DSH_HOME` and ran `dsh --profile smoke --dump-config` → plugin present in the composed tree, no
     gate skip, no errors.
  4. **Published artifact check**: `npm pack` tarball re-verified to carry the new enumeration.

## What v3.2.3 offers

- **Adds DSH `0.1.7-rc.2` to the peer enumeration** (2026-09-25) — code unchanged. The DSH **desktop** app
  (DeepSeek Harness desktop, runtime `0.1.7-rc.2`) made the exact-`rc.1` declaration stale overnight: the gate
  skipped the bundle (`skipping profile bundle`, plugin list badge 异常). Verification before declaring:
  1. **Tarball diff rc.1 → rc.2, file by file**: `dsh-credentials` `lib/` is **byte-identical** (only README +
     package.json changed); `dsh-llm` only *adds* a content type and an `ACCOUNT_QUOTA` error code (no signature
     changes on the `agent/request` waterfall or credential-reference APIs this plugin uses); `dsh-shell` /
     `dsh-settings` `lib/` byte-identical.
  2. **Gate execution**: ran the rc.2 `evaluatePluginCompatibility()` against the new manifest → `undefined`
     (pass) on both `0.1.7-rc.1` and `0.1.7-rc.2`.
  3. **Live regression**: booted a scratch profile with `@deepseek-ai/dsh@0.1.7-rc.2` + plugin 3.2.2 under the
     exact-version exemption → the pools page served HTTP 200 (empty pools expected on a scratch profile).

## What v3.2.2 offers

- **Declares its DSH version support** (2026-09-24): a new `@deepseek-ai/dsh` peer entry
  (`0.1.7-rc.1`, enumerated per version) so the supported runtime is explicit. DSH's own
  `evaluatePluginCompatibility()` (`dsh-app-boot`) enforces it at install time and on boot — an untested
  newer runtime has the bundle **gracefully skipped** (`skipping profile bundle` on stderr, DSH still
  boots) instead of failing in some undefined way. The gate only exists from DSH `0.1.7`, so runtimes
  `≤0.1.6` merely see an unrecognized peer and are unaffected (this plugin already worked there through
  the file backend). Only tested versions are named — no open ranges (repo rule 3).

## What v3.2.1 offers

- **Rescues pools stranded in `settings.yaml.imported`** (2026-09-24). `0.1.7`'s one-shot importer
  **renames `settings.yaml` to `settings.yaml.imported` before it writes anything**, so if a section fails to
  import (e.g. the target entry declares no volatile field) it never retries and the pools sit in
  `.imported` forever. The symptom is exactly: badge shows **"尚未启用"** and the page shows
  **"还没有任何池，点上方「启用新 provider 池」开始。"** even though the pools are on disk.
  Note the file fallback was *already* there in v3.2.0 (`readSettingsFromFile()` falls back to
  `settings.yaml.imported`) — but on `0.1.7` it is **never reached**, because `readSettings()` returns from the
  live-ref branch first whenever `_liveRef` is set, and the ref holds `{}`. What was missing was a **bridge
  between the two backends**, not another read fallback.
  `v3.2.1` performs a **one-time explicit migration** on the first HTTP request (not in `apply()` — see below):
  when the live config has zero providers *and* the legacy file has some, it writes them into the profile entry via
  `settings.replace()`. A marker file (`<DSH_HOME>/.key-fallback-migrated`) makes it genuinely once-only, so
  deliberately deleting every pool does not resurrect them on the next boot.
  - **Why not in `apply()`:** `settings.replace()` goes through `configEditor.edit()` and requires the entry's fiber
    to be **ACTIVE** — `describe()` skips entries whose `fiber.state !== 2`, and during `apply()` the fiber is still
    being created, so the call throws `No configurable plugin entry`. The first UI request (`/pools`) is the
    earliest safe moment.
  - The marker is written **only after** the persist succeeds, so a failed write is retried on the next boot.

## Requirements

- DeepSeek Harness with a `web`-profile GUI (`npx @deepseek-ai/dsh web`)
- Node.js `^22.19` or `>=24`
- Peer ranges strictly enumerate **only compatibility-tested versions** — `@deepseek-ai/dsh` `0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1` (the plugin's claimed DSH runtime; the gate that enforces it only exists from 0.1.7, so older runtimes just see an unrecognized peer), `@deepseek-ai/dsh-credentials` `0.1.0-rc.6 || 0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.6-alpha.1 || 0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1`, `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-settings` `0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.6-alpha.1 || 0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1`, `@deepseek-ai/cordis` `4.0.1 || 4.0.2 || 4.0.4`, `@deepseek-ai/schemastery` `3.18.1 || 3.18.2 || 3.18.4`. No open-ended ranges (`<0.2.0`, caret): untested versions are deliberately excluded until verified. The plugin only uses the credential-reference half (`resolve`/`describe`/`set`/`unset`/`credentialRef` — stable since `0.1.0-rc.6`) and the `agent/request` + `agent/request-error` waterfall (payload unchanged across the enumerated versions); `isCredentialRefName` (added `rc.8`) is implemented locally for compatibility. The `0.1.2-alpha.2 → alpha.5 → 0.1.2-rc.1` companion packages are byte-identical (2026-09-03 verified), so DSH `0.1.2-rc.1` (`next`) needs no plugin change.

## What v3.2.0 offers

- **DSH `0.1.7-rc.1` support declared, with `0.1.5-rc.3` kept** (2026-09-24). This release is the first to need an
  actual code change, because DSH `0.1.7` **relocates plugin configuration**: see the next section.

### Two config backends, one build

Since DSH `0.1.7`, plugin configuration stopped living in `<DSH_HOME>/settings.yaml`. On first boot, `0.1.7`
**renames that file to `settings.yaml.imported`** and copies each section into the profile patch
(`~/.dsh/profiles/<profile>/cordis.patch.yml`) as the `config:` of the matching loader entry; from then on the
`settings` service owns it, and plugins read it through an injected `config` parameter instead of touching the
YAML file. `ctx.settings.get()` / `register()` / `installSection()` — the rc.x API — **no longer exist** on `0.1.7`.

This plugin therefore auto-detects the backend at startup and keeps both paths working:

| | DSH `0.1.5-rc.3` (and older rc.x) | DSH `0.1.7-rc.1` (and newer) |
|---|---|---|
| Where pools live | `<DSH_HOME>/settings.yaml`, section `key-fallback:` | profile patch, the `key-fallback` entry's `config` |
| How the plugin reads/writes | reads/writes that YAML file directly (with timestamped backups) | `config.providers` is a live volatile ref; writes go through `settings.replace()` |
| Detection | no volatile-schema support ⇒ file backend | `Config` declares a volatile field ⇒ backend comes from `config` |

Two implementation notes that matter if you port this pattern elsewhere:

1. **`Config` must exist, or the migration silently drops your config.** `0.1.7`'s import path calls
   `settings.update(ns, values)`, which throws unless the entry declares a **volatile** field; on failure it logs
   `settings: section ... was not imported` and the section survives only inside `settings.yaml.imported`. So
   `v3.2.0` exports `Config = z.object({ providers: <dict>.volatile() })`.
2. **The volatile API differs between the two schemastery builds.** `.volatile()` is available in schemastery
   `3.18.4` (`0.1.7`) but **not** in `3.18.2` (`rc.3`) — calling it there returns `undefined` and registering a
   schema without it would change rc.3 behaviour. The export is therefore guarded:
   `typeof field.volatile === 'function' ? z.object({ providers: field.volatile() }) : undefined` — rc.3 gets
   **no** `Config` (byte-identical behaviour to v3.1.x) while `0.1.7` gets the volatile one.

The values from `config.providers` are deep-frozen by DSH, so `readSettings()` hands callers a mutable deep copy;
writes are applied optimistically to an in-memory copy and flushed via `settings.replace()` (an unresolved-write
counter prevents the UI from briefly re-reading the pre-write tree).

Both backends were exercised end-to-end on real installs: read (both providers appear in `/dsh-key-fallback/pools`
with live env-key values), create/update/delete (POST/DELETE round-trip, persisted), and the rc.3 regression
(`settings.yaml` untouched and *not* renamed, `cordis.patch.yml` still `[]`, backups still written).

## What v3.1.7 offers

- **DSH `0.1.5-rc.2` support declared** (2026-09-15). Source check: `@deepseek-ai/dsh-credentials` / `dsh-llm` / `dsh-settings` `0.1.5-rc.1 → rc.2` differ in **`package.json` only** — every lib/docs file is SHA256-identical. Runtime check: strict peer install (no `--legacy-peer-deps`) against a real `dsh@0.1.5-rc.2` web profile + clean boot, zero browser-console errors, `/dsh-key-fallback/*` routes serve, Settings → API Key 回退 renders.
- **DSH `0.1.6-alpha.1` support declared** (2026-09-15, source-level file-hash diff **plus a runtime boot smoke test** on a real `0.1.6-alpha.1` install). No code change was needed: `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-settings` are **byte-identical in `lib/`** vs `0.1.5-rc.2` (version/docs bump only), and `@deepseek-ai/dsh-llm`'s removals (`priceImages`, the `projectImagesForTextModel`/request-image-offload family) are outside every API this plugin calls — `credentialRef`, `credentials.resolve/set/unset/describe`, `llm.listProviders/listConfigurableProviders`, `agent/request`, `agent/request-error`, `settings`, `webServer` all verified present (`dsh-host-webserver` — the `webServer.register` provider — is itself byte-identical). Runtime check: plugin activates, `/dsh-key-fallback/*` routes serve, Settings → API Key 回退 renders. Old versions stay supported — both `0.1.5-rc.2` and `0.1.6-alpha.1` are *appended*, nothing dropped.

## What v3.1.6 offers

- **DSH `0.1.5-rc.1` support declared** (source-level compatibility check, 2026-09-10). No code change was needed: `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-settings` differ from `0.1.2-rc.1` **only in `package.json`** (version bump), and `@deepseek-ai/dsh-llm`'s changes are additive (`FileBlock` / `fileHandleText` / `assembleAssistantStream` …) with every API this plugin calls preserved: `credentialRef`, `credentials.resolve/set/unset/describe`, `llm.listProviders/listConfigurableProviders`, `agent/request`, `agent/request-error`, `settings`, `webServer`. The `agent/pre-step` waterfall payload is **line-identical** between the two versions. Old versions stay supported — `0.1.5-rc.1` is *appended* to the enumeration, nothing is dropped.
- Note: DSH `0.1.5-rc.1` removes `ctx.agent` and changes the Inbox/Session APIs, but this plugin never used them.

## What v3.1.4 offers

- **Env name auto-derivation sanitized**: creating a pool for a provider whose id contains non-identifier characters (`b-ai`, `B.AI`, …) no longer fails with `env must be POSIX identifier` — the derived env name (`<PROVIDER>_API_KEY`) now strips `-`/`.` etc. (`b-ai` → `B_AI_API_KEY`). Explicit `env` values are still validated as before. Fixes the "选择 LLM provider → 启用" 400 error for such providers.

## What v3.1.3 offers

**Settings → API Key 回退** — a top-level settings page with a redesigned UI (status dots, badges, gradient pool cards, per-key rows):

- **Configurable rotation triggers that are actually enforced** (`rotateOn`): click chips to select which error codes cause rotation. The preset chips cover the **full DSH `LlmError` standard code set** — `QUOTA` / `AUTH` / `RATE_LIMIT` / `TIMEOUT` / `TRANSPORT` / `SERVER` / `EMPTY_RESPONSE` / `INVALID_CREDENTIAL` — or add a non-standard/custom code (matched **exactly** against the provider's `failure.code`). What you save is what runs: there is no "magic upgrade" that rewrites three selected codes back into a six-code superset. `ABORTED` (user cancel) never triggers rotation.
- **真实当前使用 key 显示**: the page shows which key is actually being used right now (the pool's current ref — exactly what the credential seam returns to the adapter) — not a truncated hash, not a guessed name.
- **短 ref 命名**: new keys are auto-named `key_fallback_<provider>_key1`, `key_fallback_<provider>_key2`, … so the UI shows clean short names (`key1`, `key2`, … or your custom `label`) instead of long ref strings. Existing legacy long refs are migrated **once, automatically and idempotently** (write new ref → persist config → best-effort unset old ref; any failure aborts and retries safely).
- **明文揭示**: every key row has an eye toggle (`👁` / `🙈`) that fetches and shows the real value via `GET /keys/plain` (only for keys owned by that pool, or the pool's env key). The env key row also reveals plaintext — it is not swallowed by the read-only note.
- **环境密钥可编辑**: the pool's env key (`AGNES_API_KEY` etc.) can be updated right in the page when it is backed by the writable credential file. If it is supplied by the launching environment (read-only), the UI says so and refuses to edit (HTTP 400).
- **Per-key controls**: update value, set the "失败后→" next key (`nextRef`), lock the pool to a specific key ("设为当前"), delete a key (the env key is not deletable).
- **Pool-level controls**: enable switch, cooldown display, "↺ 重置冷却", pool lock/auto-rotation, per-pool status (`live` / `cooling` / `recovered`).

## Rotation semantics

- **How a key actually gets used**: DSH's credential seam is `credentials.resolve(ref)`. Every model adapter reads its key through it (`dsh-llm-pi-ai`, `dsh-llm-deepseek-api-key`, and any plugin that resolves a credential ref), and it is called **per request**. This plugin wraps that one method: when the resolved ref belongs to a configured pool, the wrapper returns the pool's current key instead of the stored value. Switching the key is therefore just changing the pool's current ref — the next request picks it up with no restart.
  - Writing to `process.env` would **not** work: the credential provider reads the *launch environment snapshot* that DSH froze at boot (`{...process.env}` in `dsh-app-boot`, copied into a `Map` by `dsh-launch-environment`), so anything written to `process.env` after startup is invisible to it. DSH's own comment on the provider entry says the managed document "is never materialized into the process environment". **History**: up to 3.2.4 the plugin *also* wrote `process.env[<pool env>]`, but always **alongside** the wrapper above — that write was redundant rather than the mechanism, so rotation worked regardless. The writes were removed in v3.3.0 for hygiene. If you are reading an older note claiming rotation "never worked", it is wrong; see the v3.3.1 section.
- **pick** (`agent/request`, pre-select): respects `useKeyRef` lock first (but a cooling locked key is skipped so the pool never deadlocks on a bad key), otherwise cursor round-robin over live keys. The chosen ref becomes the pool's current ref, which is what the credential seam hands to the adapter on the next resolve.
- **fail** (`agent/request-error`, registered `prepend` so it runs before `dsh-llm-retry`): only when the error matches the pool's `rotateOn` — by `failure.code` (exact), by HTTP status mapping (`429→RATE_LIMIT`, `401/403→AUTH`, `402→QUOTA`, `5xx→SERVER`), or by message keyword. Marks the failed key with a fixed `cooldownMs` (default 30 s), then switches to `nextRef` if configured, else the next live key.
- **re-send** is left entirely to DSH's `dsh-llm-retry` with the user's own per-provider retry policy. The two are independent and complementary: the retry plugin decides "retry the same key N times" (`retryPolicy.retryableCodes`, default `EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT` — which notably excludes `AUTH`/`QUOTA`); this plugin decides "switch to the next key". So e.g. an `AUTH` failure (which retry would not re-send anyway) still rotates to the next key — that next request will authenticate with the fresh key.

## Diagnostics

- The client POSTs runtime exceptions to `POST /dsh-key-fallback/diag`.
- `GET /dsh-key-fallback/diag` returns the in-memory buffer (last 200 entries) as JSON.

## Install

```sh
# from npm (recommended)
cd ~/.dsh/profiles/web
pnpm add @omdp/dsh-key-fallback

# or from a local checkout
dsh plugin --profile web add link:D:/WorkSpace/omdp/dsh-key-fallback

# restart DSH, then open Settings → API Key 回退
```

> **To upgrade, move the profile pin — do not copy files into `node_modules`.** A hand-copied
> `lib/index.js` looks like it works until something re-runs `pnpm install` (DSH does this on boot), at
> which point pnpm restores the version recorded in `pnpm-lock.yaml` and the "fix" silently disappears.
> Edit the version in `~/.dsh/profiles/web/package.json`, then run `pnpm install` in that directory and
> restart DSH. The package declares a `dsh.bundle.patch`, so it activates automatically — no manual
> `cordis.patch.yml` editing.

## HTTP API (host)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dsh-key-fallback/pools` | list pools with live status, `activeRef`, env writability/source, per-key status |
| POST | `/dsh-key-fallback/pools` | create/update pool (`enabled`, `cooldownMs`, `rotateOn`, `useKeyRef`, …) |
| DELETE | `/dsh-key-fallback/pools?provider=` | delete pool + all its keys |
| POST | `/dsh-key-fallback/keys` | add key (auto short ref `key_fallback_<p>_keyN`) |
| PATCH | `/dsh-key-fallback/keys` | update value / label / `nextRef` / `useKeyRef` (env key value = edit env) |
| DELETE | `/dsh-key-fallback/keys?provider=&ref=` | delete key (env key refused) |
| GET | `/dsh-key-fallback/keys/plain?provider=&ref=` | reveal real value (pool-owned keys / env key only) |
| POST | `/dsh-key-fallback/reset` | reset cooldown state for a pool |
| GET/POST | `/dsh-key-fallback/diag` | diagnostics buffer |

## Known limitations

- Cooldown is a fixed per-pool `cooldownMs` (no exponential backoff); a cooled key becomes live again when the timer expires.
- The plugin manages rotation/cooldown state in-memory plus persisted pool config; a DSH restart re-reads config and recomputes live status. On DSH `0.1.5-rc.3` and older that config is the `key-fallback` section of `<DSH_HOME>/settings.yaml`; on `0.1.7`+ it is the `key-fallback` entry's `config` inside `~/.dsh/profiles/<profile>/cordis.patch.yml`.
- The env key cannot be deleted through the UI (it is the pool's identity).

## License

MIT