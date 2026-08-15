# dsh-projection-guard

[中文](README.zh.md)

A DeepSeek Harness (DSH) plugin that **guards the persisted session-projection cache** against misbehaving projection units — so session titles (and every other projection) survive restarts no matter what third-party plugins do.

## The bug it fixes

DSH persists per-session projection checkpoints (session titles, stats, permissions, …) into `session_projcache.json`. The write path serializes the **whole** per-session checkpoint in one JSON pass: if a *single* projection unit stores a non-JSON value (a `Map`, `Set`, class instance, cyclic or non-finite value — e.g. some third-party plugins), the **entire write fails**. The failure is fail-soft (log-only), so the cache silently stops updating. After a restart, every cold session loses its `title` projection and the UI falls back to showing the **workspace folder name** instead of the conversation title.

## What this plugin does

1. **Per-row degradation (runtime wrapper).** It wraps `sessionProjectionCache.put()` and drops only the rows that are not lossless JSON, keeping every healthy row durable. One bad unit can no longer stall the whole cache — titles, `sessionListMetadata`, stats etc. keep writing normally.

2. **Startup self-heal.** On startup it scans persisted sessions whose cached title is missing and cold-reads their logs to backfill the `title` projection, so an already-stale cache recovers automatically.

3. **Observability.** A read-only `GET /projection-guard/status` route reports wrapped-put call counts, dropped rows, and repaired titles (also shown as a small card in Settings when the client half is mounted).

No official or third-party files are modified — the guard is a pure runtime wrapper, so it survives dsh upgrades and works on any deployment.

## Install

```sh
dsh plugin --profile web add github:DamonKoy/dsh-projection-guard
```

Restart `dsh web`. That's it.

Or add the repo as a profile dependency and include the bundle:

```json
{
  "dependencies": {
    "dsh-projection-guard": "github:DamonKoy/dsh-projection-guard"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-projection-guard"]
    }
  }
}
```

Then `pnpm install` in the profile directory and restart `dsh web`.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `repairOnStart` | `true` | Backfill missing cached titles from persisted logs at startup. |
| `logDropped` | `true` | Warn per dropped non-JSON row (key + session id). |

Example (profile `cordis.patch.yml` overlay):

```yaml
- id: projection-guard
  config:
    repairOnStart: true
    logDropped: true
```

## Development

```sh
npm test          # unit tests for the guard core
```

## License

MIT
