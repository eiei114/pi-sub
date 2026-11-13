---
"@eiei114/pi-sub-core": none
"@eiei114/pi-sub-bar": none
"@eiei114/pi-sub-shared": none
"@eiei114/pi-sub-status": none
---

Verify the existing extension lifecycle, command, tool, widget, and status-line integration against Pi SDK 1.5.0 while preserving wildcard peer ranges; the shared event contract is unchanged.

The patch releases for this verification (`2.10.1` for the fixed group, `2.1.4` for `sub-status`) are already written into this PR's package manifests, changelogs, `ROADMAP.md`, and lockfile, following the same pattern as `.changeset/bright-bears-glow.md`. This changeset records the release scope without scheduling a second increment when `npm run version` next runs.
