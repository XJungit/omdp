# @omdp/dsh-key-fallback

A minimal API-key fallback plugin for DeepSeek Harness (DSH). When a provider request fails with a retryable error, it silently retries the same call with the next key in the pool instead of committing a partial message.

## Install

```sh
dsh plugin --profile web add @omdp/dsh-key-fallback
```

Restart DSH, then add a config block to `~/.dsh/settings.yaml`:

```yaml
keyFallback:
  providers:
    ninerouter:
      env: NINEROUTER_API_KEY   # optional; defaults to ${PROVIDER}_API_KEY
      cooldownMs: 30000          # optional; cooldown after a failure
      keys:
        - <your original key>
        - <alternate key 1>
        - <alternate key 2>
```

## How it works

- `agent/request`: picks the next live key (round-robin) and writes it into `process.env[<env>]` **and** `ctx.credentials.set(<env>, key)` so `llm-pi-ai` providers (e.g. `ninerouter` via `apiKeyEnv`) actually receive it, before the request goes out.
- `agent/request-error`: on a retryable error (`RATE_LIMIT`, `AUTH`, `QUOTA_EXCEEDED`, `TIMEOUT`, `TRANSPORT`, any 4xx/5xx, or a message matching rate/limit/quota/timeout/auth/key…), marks the current key as cooling and returns `{ kind: 'retry' }` so the loop retries and picks the next key (bounded to `keys.length` per `turn:step`).

## UI

An always-visible settings section **Settings → API Key 回退** plus a card in Settings → 插件 → 插件配置 (when the settings namespace is served) — both show key count, cursor, and `分nek` cooling/healthy keys. The section refreshes only while it is in view (`IntersectionObserver` + `visibilitychange`; zero polling otherwise).

## Boundaries

- The plugin **overrides** `process.env[<env>]` and the matching credentials record for every provider you list under `keyFallback.providers`. Put your original key in `keys` so it stays in rotation.
- Providers you don't list are left untouched.
- With a single key, a retryable error surfaces directly (no pointless retry, no crash).
- With no configured keys for a provider, the plugin does nothing.
- Host is **ESM** (`type: module`, static imports of `@deepseek-ai/dsh-settings` + `@deepseek-ai/schemastery`) so the DSH bundle loader resolves DSH-internal packages; the client half stays a `window.__ModuleLoader__` bundle.

## License

MIT
