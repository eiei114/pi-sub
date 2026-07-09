---
"@eiei114/pi-sub-core": major
"@eiei114/pi-sub-bar": major
"@eiei114/pi-sub-status": major
---

Migrate the Pi SDK dependency from the frozen `@mariozechner/*` scope to the official `@earendil-works/*` scope (DOT-771).

This is a **breaking** peerDependency change: consumers must provide `@earendil-works/pi-coding-agent` (latest 0.80.x) instead of the abandoned `@mariozechner/pi-coding-agent` (last published 0.73.1, effectively frozen).

Notable adaptations required by the 0.51 → 0.80 SDK upgrade:
- `@sinclair/typebox` → `typebox` (the package was renamed and is now a direct dependency of the new SDK).
- Event handler renames to match the new event contract: `session_switch` → `session_before_switch`, `session_branch` → `session_before_fork`. Both handlers reset the usage cache and re-fetch, so behavior is preserved.
- `ctx.getContextUsage()` now returns `tokens`/`percent` as `number | null` (null while unknown, e.g. right after compaction); coerce to `0` to keep the existing non-null render contract.

`@eiei114/pi-sub-shared` has no source change but is bumped to stay version-locked with the `fixed` release group.
