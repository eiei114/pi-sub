---
"@eiei114/pi-sub-status": patch
---

Align status internal deps to the 2.2.3 line. status@2.0.3 requires shared@^2.2.2 and core@^2.2.2, but shared@2.2.2 was never published (registry only has up to 2.2.1), breaking npm install @latest with ETARGET. This republish lets Version Packages rewrite the ranges to ^2.2.3 once shared/core/bar@2.2.3 (#59) are published.
