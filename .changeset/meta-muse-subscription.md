---
"@eiei114/pi-sub-shared": minor
"@eiei114/pi-sub-core": minor
"@eiei114/pi-sub-bar": minor
---

Add a Meta (Muse) subscription provider.

The provider reports the Muse **subscription** sign-in state of the base `meta` OAuth
credential in `~/.pi/agent/auth.json`, so consumers such as `/limits` can list the
account alongside the other subscriptions.

Limitations, on purpose:

- Meta publishes no Muse subscription usage endpoint, so there is no quota, window, or
  balance to fetch. The provider performs no network request and reports an empty window
  list: signed in, quota unknown — never unlimited, never zero used.
- Only credential presence is read. Tokens are never refreshed, minted, logged, or
  returned; pi owns the OAuth lifecycle when a model is used.
- Meta API keys (`META_API_KEY`, `api_key` auth entries) are never used: they are valid
  for the pay-as-you-go Model API, which is a different billing bucket.
- Only the base `meta` account is supported. Numbered aliases (`meta-2`, …) resolve to
  no provider instead of showing the base account's state, and Muse models routed
  through other providers keep that provider's usage.
