---
"@eiei114/pi-sub-core": minor
"@eiei114/pi-sub-bar": minor
"@eiei114/pi-sub-shared": minor
---

Add an Ollama Cloud usage provider.

`sub-core` reads `ollama.com/api/usage` with an API key (`OLLAMA_API_KEY` or the
`ollama-cloud` credential in `~/.pi/agent/auth.json`) and reports the account's
session, weekly, and monthly quotas as `Session` / `Week` / `Month` windows —
whichever the plan actually has — plus the current period cost.
`sub-bar` adds the matching window visibility settings.
