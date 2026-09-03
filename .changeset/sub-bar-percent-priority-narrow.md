---
"@eiei114/pi-sub-bar": patch
"@eiei114/pi-sub-status": patch
---

Keep usage percent visible with top priority on narrow terminals. Narrow widths now degrade in priority order (percent first, dividers and provider chrome last) using ASCII-only minimal text so macOS and Windows render identically. Lines hide only when even the first window percent cannot fit.
