---
"@eiei114/pi-sub-shared": minor
"@eiei114/pi-sub-core": minor
"@eiei114/pi-sub-bar": minor
---

Add an xAI (Grok) subscription usage provider.

The bar can now show the SuperGrok/Grok **subscription** quota for the base `xai` OAuth
credential in `~/.pi/agent/auth.json` (or the `XAI_OAUTH_TOKEN` override) as a single
`Week`/`Month`/`Usage` window with its reset time, plus sub-bar window toggles.

Limitations, on purpose:

- The billing endpoint is unofficial and undocumented, so it can change or break without
  notice. Failures soft-error with a static message plus HTTP status; response bodies are
  never surfaced.
- Only quota percentage and reset are parsed. Prepaid balance, on-demand spend, credit/unit
  counts and plan names are not shown, and a missing percentage is reported as an error
  instead of being displayed as 0%.
- xAI API keys (`XAI_API_KEY`, `api_key` auth entries) are never used: they are valid for the
  developer API, which is a different billing bucket that cannot report subscription quota.
- Only the base `xai` account is supported. Numbered aliases (`xai-2`, …) resolve to no
  provider instead of showing the base account's usage.
