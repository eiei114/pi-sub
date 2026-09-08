---
"@eiei114/pi-sub-core": patch
---

Restrict root-level Command Code API-key discovery to its own native auth file. Shared Pi and OMP auth files now require a provider-scoped Command Code entry, so unrelated root credentials cannot be selected. Environment precedence and native-file compatibility are unchanged.
