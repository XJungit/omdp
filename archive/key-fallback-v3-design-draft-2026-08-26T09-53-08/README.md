# @omdp/dsh-key-fallback

Multi-key API key pool with automatic rotation for DeepSeek Harness. Sits between the LLM adapter and the credential store:
the plugin picks a key from the per-provider pool and writes it into the provider's credential reference before each request;
on a retryable error (`AUTH` / `QUOTA_EXCEEDED` / `RATE_LIMIT` by default), it advances to the next key in the chain and returns `{ kind: 'retry' }` so the agent loop retries with the rotated key.

This is **v3** (work in progress; not yet feature-frozen). v3 supersedes v1 (which stored keys in plaintext under `~/.dsh/settings.yaml#keyFallback.providers`);
v1 still ships in this profile (it registers the `key-fallback` settings namespace), so v3 deliberately uses a different namespace (`key-fallback-pools`) to avoid the registration conflict.

## What's in v3

- **Independent settings page**: **Settings → API Key 回退** — a top-level section, not a card under plugin config.
- **Provider dropdown** (the chooser merges `ctx.llm.listProviders()` and `ctx.llm.listConfigurableProviders()`).
- **Add / remove keys via the UI** (write-only; the value is never read back into the page).
- **Per-provider enabled switch** (disable = the pool is bypassed entirely).
- **Environment key in the pool**: the runtime composes `effectiveKeys = [envKey, ...userKeys]`. The env key is the first entry, marked `[环境来源]` in the UI, and cannot be edited or deleted; the environment remains the source of truth for it.
- **Manual key selector** (pool-level dropdown "当前使用") — pick any key (including the env one) to lock the pool to that key. Failures do **not** auto-rotate while a key is locked; select "自动轮换" to return to cursor-based rotation.
- **Rotation on retryable errors** (`agent/request-error` waterfall) with cooldown tracking per key.
- **Pre-write on every request** (`agent/request` waterfall) so the LLM adapter always reads the pool key, not the original env value.
- **v1 → v3 one-shot migration** on first launch: reads `~/.dsh/settings.yaml#keyFallback.providers`, writes the plaintext keys into the credential store, copies the pool metadata into the new namespace, and marks `keyFallbackMigratedToV3: true` to prevent re-running. The v1 plaintext block is **left in place** (deleting it would touch a file DSH is actively using; verify the v3 UI looks right, then delete manually).

## What's still in flight / not done

- **Cooldown / failure status rendering in the UI**: host returns `failCount / cooldownUntil / cooldownRemainingMs / lastErrorAt / lastErrorMsg / status: 'cooling' | 'healthy'` per key and a pool-level `cursor`; the client currently shows the basic list and the env-key badge but does not yet render the cooldown progress bars. Pending — I stopped here for a stable checkpoint after you said "收尾" (wrap up).
- **v1 and v3 running side by side**: v1's host still loads alongside v3 and both touch the same `~/.dsh/.credentials.yaml`. This is the root cause of the credential-file lock contention you hit while editing model config. To eliminate it: uninstall v1 (remove the dep from `~/.dsh/profiles/web/package.json` and delete `node_modules/@omdp/dsh-key-fallback` so only v3 remains). **Until you do, behavior is undefined under concurrent writes.**
- **DSH-side bundle caching**: the browser keeps old client bundles by `rev=` hash. The settings-page fix you saw (label-as-function contract) only lands after a DSH restart that re-hashes the plugin. Use Ctrl+Shift+R if a page shows stale UI.

## Install

```sh
# 1) from a local checkout (no publish required)
dsh plugin --profile web add link:D:/WorkSpace/omdp/dsh-key-fallback
# or from npm
dsh plugin --profile web add @omdp/dsh-key-fallback

# 2) restart DSH

# 3) open Settings → API Key 回退
```

## Diagnostics (built in for v3, not for v1)

- The client wires `window.addEventListener('error' / 'unhandledrejection')` to POST every runtime exception to `POST /dsh-key-fallback/diag`.
- The host keeps the last 50 reports in memory.
- `GET /dsh-key-fallback/diag` returns the buffer as JSON. Use this to see what's actually breaking in the browser (instead of reading minified DSH bundles).

## License

MIT
