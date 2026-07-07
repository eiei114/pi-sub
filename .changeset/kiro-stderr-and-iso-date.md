---
"@eiei114/pi-sub-core": patch
---

Kiro provider: capture stderr from `kiro-cli /usage` and parse `YYYY-MM-DD` reset dates.

Ports the Kiro parts of upstream PR marckrenn/pi-sub#67 while keeping Windows working:
- Usage retrieval now reads both stdout and stderr (kiro-cli writes some usage
  data to stderr) via a new shell-free, cross-platform dependency hook
  (`execFileSyncWithStderr`, backed by `spawnSync`). No `/bin/sh` or `cmd.exe`
  is spawned, so Windows cache/TTL behavior is unaffected.
- The reset-date parser now accepts `resets on 2026-06-01` (`YYYY-MM-DD`) in
  addition to the existing `resets on 01/01` (`MM/DD`) format.
