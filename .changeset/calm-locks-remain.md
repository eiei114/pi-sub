---
"@eiei114/pi-sub-core": patch
---

fix(sub-core): reclaim unparseable lock files that permanently block usage refresh

An empty/corrupt `cache.lock` (e.g. leftover from a hard-killed process) was never reclaimed
because stale-lock detection only handled parseable records. Every refresh then fell back to
the last cached usage forever, so macOS bars could show a frozen `0%` even while the API was
healthy. Unparseable lock files are now age-checked via file mtime and reclaimed past the stale
window.
