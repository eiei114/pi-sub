---
"@eiei114/pi-sub-core": minor
"@eiei114/pi-sub-bar": minor
"@eiei114/pi-sub-shared": minor
---

Distinguish the OpenRouter per-key spending cap from account wallet credit.

Usage is now read from `GET /api/v1/key` first, which is authoritative for the
credential in use. `GET /api/v1/credits` is documented as requiring a management
key, so it becomes best-effort enrichment: when it fails (typically `403` for an
ordinary inference key) the key data is kept and the wallet is reported as
unavailable instead of falling back to an older reading.

- **sub-shared**: `UsageSnapshot` gains `keyLimit` / `keyRemaining` / `keyUsage`
  for the credential in use and `creditUnavailable` for an unreadable wallet.
  The existing `creditTotal` / `creditUsage` / `creditRemaining` stay
  account-level and are never overloaded with key data.
- **sub-core**: a `Key limit` window is produced only for a real numeric cap; a
  zero cap counts as fully used, and an uncapped (`limit: null`) or unknown cap
  produces no percentage. `limit_remaining` is used as-is rather than derived
  from all-time usage, and `limit_reset` is ignored because it is a period name,
  not a date. A zero-total wallet now reads as fully used instead of 0% used,
  missing amounts stay unknown instead of becoming zero, and negative or
  non-numeric values are rejected. Both requests are `GET` to fixed hosts with
  `redirect: "error"` under one timeout that stays armed through JSON parsing;
  failures report static messages only. `OPENROUTER_KEY` is no longer shadowed
  by a blank `OPENROUTER_API_KEY`, and an auth value that would need a command to
  resolve is not treated as a credential. Snapshots that carry amounts but no
  window are no longer discarded as empty.
- **sub-bar**: key data renders as `Key spend: $…` and `Key cap: $…` /
  `Key cap: none`, separately from `Account credit: $… left` /
  `Account credit: unavailable`. New `Show Key Limit Window` and
  `Show Key Spend` toggles (both on by default) cover the key lines; the
  existing credit toggles keep their defaults and now affect only account data.
  Window-less snapshots render their extras instead of showing just the provider
  name.

Resolving a specific account out of a multi-account auth file is a separate
concern and is not addressed here.
