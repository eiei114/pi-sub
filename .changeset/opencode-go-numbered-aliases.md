---
"@eiei114/pi-sub-shared": patch
"@eiei114/pi-sub-core": patch
"@eiei114/pi-sub-bar": patch
---

Stop numbered OpenCode provider ids (such as `opencode-go-2`) from showing the base account's OpenCode Go usage: the usage is read with the base credential only, so a numbered alias now resolves to no provider rather than falling through to model tokens (where `opencode-go-2/gpt-6-luna` would read as Codex).
