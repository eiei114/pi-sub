---
"@eiei114/pi-sub-core": patch
---

fix(sub-core): fall back to stored OpenCode credentials when the env key is stale

A stale `OPENCODE_API_KEY` env var shadowed valid stored credentials (opencode auth.json /
pi agent auth.json) and permanently returned 401, hiding the OpenCode usage windows. The
provider now tries every credential candidate in priority order and only accepts one that
authenticates, so an expired env key no longer blocks the stored key.
