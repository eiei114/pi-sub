---
"@eiei114/pi-sub-core": patch
"@eiei114/pi-sub-bar": patch
"@eiei114/pi-sub-shared": patch
---

Reuse one shared `clampPercent` helper across usage providers (Antigravity, Command Code, Cursor, OpenCode, OpenDesign, OpenRouter, xAI) instead of per-provider copies. The inclusive 0–100 boundary behavior and quota output are unchanged.
