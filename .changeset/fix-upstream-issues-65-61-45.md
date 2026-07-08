---
"@eiei114/pi-sub-core": patch
"@eiei114/pi-sub-bar": patch
"@eiei114/pi-sub-shared": patch
---

Fix Anthropic and Copilot usage providers for upstream API changes (marckrenn/pi-sub#61, #65). Anthropic now reads Claude Code credentials and model-specific weekly quota windows. Copilot now parses chat/completions quota snapshots in addition to premium interactions. Add regression test for legacy cache migration (marckrenn/pi-sub#45).
