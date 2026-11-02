---
"@eiei114/pi-sub-core": patch
---

Normalize Anthropic, GitHub Copilot, and Codex tokens read from pi's `auth.json` before using them. Token fields now accept only non-empty strings, trim surrounding whitespace, and reject command-prefixed (`!`) values and CR/LF remaining after trimming. Command values were previously sent literally, not executed; use a resolved static token instead.

Rejected pi tokens now allow legacy credential fallback. Copilot prefers an accepted refresh token, then an accepted access token, so an invalid refresh value no longer masks a valid access token. Valid tokens and environment override precedence remain supported; environment/legacy credential acceptance and Codex account IDs are unchanged.
