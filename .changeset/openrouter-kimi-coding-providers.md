---
"@eiei114/pi-sub-core": minor
---

Add OpenRouter and Kimi for Coding usage providers.

Ports upstream PRs marckrenn/pi-sub#66 (OpenRouter credits) and #63 (Kimi for Coding week/5h windows) into the @eiei114 fork. PR #67 (Kiro stderr + ISO reset date) was already landed separately.

- **OpenRouter**: credits endpoint, env/auth token resolution, sub-bar credit extras and toggles.
- **Kimi for Coding**: `api.kimi.com/coding/v1/usages`, pi-mono `KIMI_API_KEY` / auth.json support, sub-bar week/5h window toggles.
