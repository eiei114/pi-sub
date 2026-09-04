---
"@eiei114/pi-sub-shared": patch
---

Republish the unpublished 2.2.2 payload as 2.2.3. The npm publish of `@eiei114/pi-sub-shared@2.2.2` failed during the 2.2.2 release, leaving `core/bar@2.2.2` and `status@2.0.3` requiring a `shared@^2.2.2` that does not exist on the registry.
