# @omdp/dsh-key-fallback

[简体中文](README.zh-CN.md) | English

**Multi-key API key pool with automatic rotation for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)** — sits between the LLM adapter and the credential store. Before each request the plugin picks a key from the per-provider pool and pre-writes it into the provider's credential reference; when a configured trigger error occurs it marks the failed key cooling (fixed `cooldownMs`, no exponential backoff) and advances to the next key. **Re-sending is left entirely to DSH's own `dsh-llm-retry`** — this plugin never re-sends on its own; it only switches the key and lets the retry policy decide.

Current version: **v3.1.5** (`v6` UI generation).

## Requirements

- DeepSeek Harness with a `web`-profile GUI (`npx @deepseek-ai/dsh web`)
- Node.js `^22.19` or `>=24`
- Peer ranges strictly enumerate **only compatibility-tested versions** — `@deepseek-ai/dsh-credentials` `0.1.0-rc.6 || 0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1`, `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-settings` `0.1.1-rc.2 || 0.1.2-alpha.1 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4 || 0.1.2-alpha.5 || 0.1.2-rc.1`, `@deepseek-ai/cordis` `4.0.1 || 4.0.2`, `@deepseek-ai/schemastery` `3.18.1 || 3.18.2`. No open-ended ranges (`<0.2.0`, caret): untested versions are deliberately excluded until verified. The plugin only uses the credential-reference half (`resolve`/`describe`/`set`/`unset`/`credentialRef` — stable since `0.1.0-rc.6`) and the `agent/request` + `agent/request-error` waterfall (payload unchanged across the enumerated versions); `isCredentialRefName` (added `rc.8`) is implemented locally for compatibility. The `0.1.2-alpha.2 → alpha.5 → 0.1.2-rc.1` companion packages are byte-identical (2026-09-03 verified), so DSH `0.1.2-rc.1` (`next`) needs no plugin change.

## What v3.1.4 offers

- **Env name auto-derivation sanitized**: creating a pool for a provider whose id contains non-identifier characters (`b-ai`, `B.AI`, …) no longer fails with `env must be POSIX identifier` — the derived env name (`<PROVIDER>_API_KEY`) now strips `-`/`.` etc. (`b-ai` → `B_AI_API_KEY`). Explicit `env` values are still validated as before. Fixes the "选择 LLM provider → 启用" 400 error for such providers.

## What v3.1.3 offers

**Settings → API Key 回退** — a top-level settings page with a redesigned UI (status dots, badges, gradient pool cards, per-key rows):

- **Configurable rotation triggers that are actually enforced** (`rotateOn`): click chips to select which error codes cause rotation. The preset chips cover the **full DSH `LlmError` standard code set** — `QUOTA` / `AUTH` / `RATE_LIMIT` / `TIMEOUT` / `TRANSPORT` / `SERVER` / `EMPTY_RESPONSE` / `INVALID_CREDENTIAL` — or add a non-standard/custom code (matched **exactly** against the provider's `failure.code`). What you save is what runs: there is no "magic upgrade" that rewrites three selected codes back into a six-code superset. `ABORTED` (user cancel) never triggers rotation.
- **真实当前使用 key 显示**: the page shows which key is actually being used right now (derived from the last value written to the provider's env) — not a truncated hash, not a guessed name.
- **短 ref 命名**: new keys are auto-named `key_fallback_<provider>_key1`, `key_fallback_<provider>_key2`, … so the UI shows clean short names (`key1`, `key2`, … or your custom `label`) instead of long ref strings. Existing legacy long refs are migrated **once, automatically and idempotently** (write new ref → persist config → best-effort unset old ref; any failure aborts and retries safely).
- **明文揭示**: every key row has an eye toggle (`👁` / `🙈`) that fetches and shows the real value via `GET /keys/plain` (only for keys owned by that pool, or the pool's env key). The env key row also reveals plaintext — it is not swallowed by the read-only note.
- **环境密钥可编辑**: the pool's env key (`AGNES_API_KEY` etc.) can be updated right in the page when it is backed by the writable credential file. If it is supplied by the launching environment (read-only), the UI says so and refuses to edit (HTTP 400).
- **Per-key controls**: update value, set the "失败后→" next key (`nextRef`), lock the pool to a specific key ("设为当前"), delete a key (the env key is not deletable).
- **Pool-level controls**: enable switch, cooldown display, "↺ 重置冷却", pool lock/auto-rotation, per-pool status (`live` / `cooling` / `recovered`).

## Rotation semantics

- **pick** (`agent/request`, pre-write): respects `useKeyRef` lock first (but a cooling locked key is skipped so the pool never deadlocks on a bad key), otherwise cursor round-robin over live keys. The chosen key is written via `credentials.set` **and** `process.env` so the provider actually authenticates with it.
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

> Note: the profile currently installs the package from npm (`^3.x`) into `~/.dsh/profiles/web/node_modules/@omdp/dsh-key-fallback`; copying updated `lib/index.js` + `lib/client.js` there and restarting DSH picks up a newer version. The package declares a `dsh.bundle.patch`, so it activates automatically — no manual `cordis.patch.yml` editing.

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
- The plugin manages rotation/cooldown state in-memory plus persisted pool config (`keyFallback.providers` in `settings.yaml`); a DSH restart re-reads config and recomputes live status.
- The env key cannot be deleted through the UI (it is the pool's identity).

## License

MIT