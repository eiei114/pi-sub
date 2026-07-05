---
"@eiei114/pi-sub-core": patch
---

Make shared cache writes more robust on Windows by retrying transient `EPERM`, `EACCES`, `EBUSY`, and `ENOTEMPTY` rename failures, using unique temp file names, and cleaning up leftover temp files.

Also tighten cache lock ownership so one process does not accidentally release another process's lock, and skip duplicate fetch/status writes when another active process owns the lock.

Fixes upstream marckrenn/pi-sub#60 and covers the Windows cache rename failure reported in marckrenn/pi-sub#68.
