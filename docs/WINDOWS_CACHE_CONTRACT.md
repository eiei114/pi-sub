# Windows cache reliability contract

This document captures the on-disk cache and lock behavior that makes `@eiei114/pi-sub-core` reliable on Windows and under concurrent Pi instances. Treat the listed source files as a **do-not-regress** surface: changes here should preserve every invariant below unless the contract is deliberately revised.

All paths below are relative to the `packages/sub-core` package unless noted otherwise.

## Do-not-regress source files

| File | Responsibility |
| --- | --- |
| [`src/cache.ts`](../packages/sub-core/src/cache.ts) | Cache read/write, Windows rename retry, lock-coordinated fetches, cache watching |
| [`src/storage/lock.ts`](../packages/sub-core/src/storage/lock.ts) | Token-based file locks, stale-lock reclamation, lock release ownership |
| [`src/usage/controller.ts`](../packages/sub-core/src/usage/controller.ts) | Usage refresh orchestration; emits cached state before network fetches |
| [`src/paths.ts`](../packages/sub-core/src/paths.ts) | Canonical cache and lock file locations under the Pi agent directory |

Supporting wiring (also covered by regression tests):

- [`index.ts`](../packages/sub-core/index.ts) — `turn_end` and `tool_result` lifecycle handlers call `refresh()` without `force`.
- [`src/usage/fetch.ts`](../packages/sub-core/src/usage/fetch.ts) — TTL gate before `fetchWithCache`; honors `options.force` only when explicitly set.

## Cache and lock file locations

Primary storage (shared across all Pi instances for a user):

| Artifact | Path |
| --- | --- |
| Cache file | `~/.pi/agent/cache/sub-core/cache.json` |
| Lock file | `~/.pi/agent/cache/sub-core/cache.lock` |

Resolved by `getCachePath()` and `getCacheLockPath()` in `src/paths.ts` (`getAgentDir()` + `cache/sub-core/`).

Legacy paths are migrated once on first access and then removed (`src/cache.ts` → `migrateLegacyCache()`):

| Legacy artifact | Path |
| --- | --- |
| Extension-local cache | `<extension-dir>/cache.json` |
| Extension-local lock | `<extension-dir>/cache.lock` |
| Agent-root cache | `~/.pi/agent/pi-sub-core-cache.json` |
| Agent-root lock | `~/.pi/agent/pi-sub-core-cache.lock` |

**Contract:** new writes always target the primary paths under `cache/sub-core/`. Legacy files must not reappear after migration.

## Windows cache-rename retry

Cache updates use write-to-temp-then-rename (`writeCache()` in `src/cache.ts`):

1. Serialize the cache to a unique temp file: `cache.json.<pid>.<timestamp>.tmp`.
2. Atomically rename the temp file over `cache.json` via `renameCacheFileWithRetry()`.
3. Always attempt temp cleanup in a `finally` block (`removeTempCacheFile()`), even when rename fails.

Rename retries exist because Windows (and some AV software) can transiently deny renames with `EPERM`, `EACCES`, `EBUSY`, or `ENOTEMPTY`.

| Constant | Value | Meaning |
| --- | --- | --- |
| `CACHE_WRITE_RETRY_ATTEMPTS` | 8 | Maximum rename attempts |
| `CACHE_WRITE_RETRY_DELAY_MS` | 25 | Base delay; actual sleep is `25 × (attempt + 1)` ms |
| `RETRYABLE_RENAME_ERROR_CODES` | `EPERM`, `EACCES`, `EBUSY`, `ENOTEMPTY` | Errors that trigger retry |

**Contract:** non-retryable rename errors propagate immediately; retryable errors are retried with backoff before surfacing failure. Temp files must not be left behind after a successful or failed write attempt.

## Lock ownership

Cross-process coordination uses an exclusive lock file (`src/storage/lock.ts`):

1. `tryAcquireFileLock()` writes a JSON record `{ token, acquiredAt }` via `writeFileExclusive`.
2. Each acquirer gets a unique token: `<pid>-<timestamp>-<random>`.
3. `releaseFileLock(lockPath, token)` removes the lock **only when the on-disk token matches** the caller's token. A missing or mismatched token is a no-op.
4. Stale locks (older than `staleAfterMs`, default 5000 ms in cache fetch paths) may be reclaimed after verifying the observed record has not changed.
5. Unparseable (empty/corrupt) lock files are treated as held while fresh; once older than the stale window they may be reclaimed without clobbering a concurrent writer that just wrote a valid record.

**Contract:** one process must never release another process's lock. Callers that acquire a lock must pass the returned token to `releaseFileLock()` in a `finally` block (`fetchWithCache()`, `updateCacheStatus()` in `src/cache.ts`).

When a lock cannot be acquired, `fetchWithCache()` waits briefly for release and re-checks TTL freshness. It returns a fresh entry when available, a stale entry when available, or an empty result when no cache entry exists. It does not duplicate fetch work.

## TTL-respecting `turn_end` / `tool_result` refreshes

Lifecycle handlers in `index.ts`:

```ts
pi.on("tool_result", async (_event, ctx) => {
  if (settings.behavior.refreshOnToolResult) {
    await refresh(ctx); // no { force: true }
  }
  // ...
});

pi.on("turn_end", async (_event, ctx) => {
  await refresh(ctx); // no { force: true }
});
```

`refresh()` in `src/usage/controller.ts` reads the on-disk cache via `getCachedData(provider, settings.behavior.refreshInterval * 1000)` before calling `fetchUsageForProvider()`. `fetchUsageForProvider()` in `src/usage/fetch.ts` checks the minimum refresh interval before the TTL/force logic. While a cached usage entry is within `behavior.minRefreshInterval`, it returns cached usage without a network request. Otherwise, while the entry is within the TTL it skips the usage fetch unless `options.force === true`; a TTL cache hit can still call `refreshStatusForProvider()` when `options.forceStatus === true`.

Default behavior settings (`behavior.refreshInterval`, typically 60 s) define the TTL window. A separate minimum interval (`behavior.minRefreshInterval`, typically 10 s) applies before the TTL/force logic to cached usage fetches, including status refresh calls.

**Contract:** `turn_end` and `tool_result` must not pass `force: true` to `refresh()`. When the cache entry is still within TTL, these events must not trigger redundant provider API calls. `force` bypasses the TTL gate, but it does not bypass the minimum-interval gate.

Regression coverage: `packages/sub-core/test/extension.test.ts` — *"turn_end and tool_result do not bypass the cache TTL when the entry is fresh"*.

## Related tests

| Test file | What it guards |
| --- | --- |
| `test/cache.test.ts` | Rename retry, lock wait during watch, duplicate-fetch skip |
| `test/lock.test.ts` | Token ownership, stale/empty lock reclamation |
| `test/extension.test.ts` | TTL-respecting lifecycle refreshes |
| `test/controller.test.ts` | Cached fallback on fetch errors |

Run `npm run test -w @eiei114/pi-sub-core` after touching any contract surface.
