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

- `agent/request`: picks the next live key (round-robin) and writes it into `process.env[<env>]` before the request goes out.
- `agent/request-error`: on a retryable error (`RATE_LIMIT`, `AUTH`, `QUOTA_EXCEEDED`, `TIMEOUT`, `TRANSPORT`, any 4xx/5xx, or a message matching rate/limit/quota/timeout/auth/key…), marks the current key as cooling and returns `{ kind: 'retry' }` so the loop retries and picks the next key.

## Boundaries

- The plugin **overrides** `process.env[<env>]` for every provider you list under `keyFallback.providers`. Put your original key in `keys` so it stays in rotation.
- Providers you don't list are left untouched.
- With a single key, a retryable error surfaces directly (no pointless retry, no crash).
- With no configured keys for a provider, the plugin does nothing.

Settings → 插件 shows a read-only card with the key count, cursor, and cooling/healthy keys.

## License

MIT
