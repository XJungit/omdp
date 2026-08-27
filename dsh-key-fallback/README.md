# @omdp/dsh-key-fallback

Multi-key API key pool with automatic rotation for DeepSeek Harness. Sits between the LLM adapter and the credential store:
the plugin picks a key from the per-provider pool and pre-writes it into the provider's credential reference before each request;
on a configured trigger error it marks the failed key (cooldown) and advances to the next key in the chain, then lets DSH's own
`dsh-llm-retry` decide whether/when to retry (the plugin never re-sends on its own).

Current version is **v6** (`3.1.0`).

## What v6 offers

**Settings → API Key 回退** — a top-level settings page with a redesigned UI:

- **Pool cards** with status dots, badges, enable switch, per-pool cooldown display and a "重置冷却" reset button.
- **轮转触发码 (rotation triggers) are now configurable and actually enforced**: click chips to select which error codes
  cause rotation — the preset chips cover the full DSH `LlmError` standard code set (`QUOTA` / `AUTH` / `RATE_LIMIT` / `TIMEOUT` /
  `TRANSPORT` / `SERVER` / `EMPTY_RESPONSE` / `INVALID_CREDENTIAL`), or add a non-standard/custom code (matched exactly against the
  provider's `failure.code`). The default set is the full standard set.
- **真实当前使用 key 显示**: the page shows which key is actually being used right now (derived from the last value written to the
  provider's env), instead of a truncated hash.
- **短 ref 命名**: new keys are named `key_fallback_<provider>_key1`, `key_fallback_<provider>_key2`, … so the UI shows clean short
  names (`key1`, `key2`…) instead of long ref strings. Existing long refs are migrated once, automatically and idempotently.
- **明文揭示**: every key row has an eye toggle (`👁` / `🙈`) that fetches and shows the real value via `GET /keys/plain` (only for
  keys owned by that pool, or the pool's env key).
- **环境密钥可编辑**: the pool's env key (`AGNES_API_KEY` etc.) can be updated right in the page when it's backed by the writable
  credential file. If it is supplied by the launching environment (read-only), the UI says so and refuses to edit.
- **Per-key controls**: rename/update value, set the "失败后→" next key (nextRef), lock the pool to a specific key ("设为当前"),
  delete a key (the env key is not deletable).
- **Pool-level "锁定"**: lock the pool to a specific key or return to 自动轮换 (cursor-based).

## Rotation semantics

- **pick**: respects `useKeyRef` lock first (but a cooling locked key is skipped so the pool never deadlocks on a bad key), otherwise
  cursor round-robin over live keys.
- **fail** (`agent/request-error`, registered `prepend` so it runs before `dsh-llm-retry`): only when the error matches the pool's
  `rotateOn` (code / status mapping / message keyword). Marks the failed key with a fixed `cooldownMs` (no exponential backoff), then
  switches to `nextRef` if configured, else the next live key.
- **re-send** is left entirely to DSH's `dsh-llm-retry` with the user's own retry policy; this plugin only switches the key and writes
  config/env. `ABORTED` (user cancel) never triggers rotation.

## Diagnostics

- The client POSTs runtime exceptions to `POST /dsh-key-fallback/diag`.
- `GET /dsh-key-fallback/diag` returns the in-memory buffer (last 200 entries) as JSON.

## Install

```sh
# from a local checkout (no publish required)
dsh plugin --profile web add link:D:/WorkSpace/omdp/dsh-key-fallback
# or from npm
dsh plugin --profile web add @omdp/dsh-key-fallback

# restart DSH, then open Settings → API Key 回退
```

> Note: this profile currently installs the package from npm (`^3.x`) into
> `~/.dsh/profiles/web/node_modules/@omdp/dsh-key-fallback`; copying updated `lib/index.js` + `lib/client.js` there and restarting DSH
> picks up v6.

## HTTP API (host)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dsh-key-fallback/pools` | list pools with live status, activeRef, env writability, per-key status |
| POST | `/dsh-key-fallback/pools` | create/update pool (enabled, cooldownMs, rotateOn, useKeyRef, …) |
| DELETE | `/dsh-key-fallback/pools?provider=` | delete pool + all its keys |
| POST | `/dsh-key-fallback/keys` | add key (auto short ref `key_fallback_<p>_keyN`) |
| PATCH | `/dsh-key-fallback/keys` | update value / label / nextRef / useKeyRef (env key value = edit env) |
| DELETE | `/dsh-key-fallback/keys?provider=&ref=` | delete key (env key refused) |
| GET | `/dsh-key-fallback/keys/plain?provider=&ref=` | reveal real value (pool-owned keys / env key only) |
| POST | `/dsh-key-fallback/reset` | reset cooldown state for a pool |
| GET/POST | `/dsh-key-fallback/diag` | diagnostics buffer |

## License

MIT
