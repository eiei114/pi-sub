# Proposal: an optional account-level limits dashboard

**Status: design proposal only.** This PR adds no package, command, provider
adapter, credential access, or executable behavior. It asks whether a separate
consumer package would fit the maintenance fork before introducing that scope.

## Motivation and placement

A small status bar is useful for the current model; comparing multiple accounts
needs more room. A separate Codex-only prototype already demonstrates a searchable
list/detail interface, quota/reset-credit details, refresh controls and explicit
account switching. The proposed contribution is a portable, provider-aware version
of that interaction, **not a claim that the prototype is already part of pi-sub**.

The roadmap explicitly keeps comparison UI outside core maintenance scope unless
a contributor owns it. An optional `pi-sub-limits` package would respect that:

- `sub-core`: provider contracts, account-bound retrieval and caching.
- `sub-shared`: typed account identity, capability and observation semantics.
- `sub-bar`: remains the compact current-provider widget.
- `sub-limits`: opt-in comparison UI consuming owner-provided data/actions.

The UI must not grow a second set of HTTP adapters or scan arbitrary credential
stores independently of core. New providers should benefit both bar and dashboard.

## Interaction sketch

Wide terminals: searchable account list on the left, detail pane on the right.
Narrow terminals: one pane at a time with preserved selection and scroll position.
Use Pi's existing theme tokens rather than adding a palette.

| Key | Proposed action |
| --- | --- |
| `/` | Fuzzy search provider/account labels |
| Up/Down or j/k | Move selection |
| Enter or Tab | Inspect/change pane; never switch accounts |
| PgUp/PgDn | Scroll details |
| r / R | Refresh selected / all visible allowed accounts |
| s | Explicitly switch to the selected account |
| a | Reveal the active account |
| o | Change sort, within comparable metric groups |
| ? | Keyboard help |
| Esc | Clear search, leave details, or close |

Inspection and search are always read-only. Switching must enforce current
project restrictions, available credentials, idle state and model compatibility;
any model fallback needs confirmation. Recheck after confirmation, and ignore
late actions if the dashboard was closed/reloaded.

## Account and data contract comes first

`sub-core:update-all` currently returns **provider-level** entries. It is useful
prior art, but not sufficient for an all-account dashboard. Before implementation:

1. Define an account descriptor with opaque identity, provider id, display label,
   active marker and supported capabilities. Do not expose tokens or raw headers.
2. Define exact account-bound read/refresh actions, with identity validation and
   stale-response protection. Never substitute a base credential for an alias.
3. Specify allowed-account filtering without forcing every user to install a
   particular multi-account extension. Unsupported registry integration should
   show a clear limitation, not silently broaden project scope.
4. Decide whether signed-out/configured-but-unavailable accounts remain visible
   and how callers obtain actionable, sanitized status without triggering login.
5. Ensure empty or malformed observations remain unknown, not 100% remaining.

Distinguish these data types in both storage and UI:

- Percentage quota windows and their reset timestamps.
- Per-key spending caps versus account-level wallet balances.
- Reset credits, including each credit's expiry, where the provider supports them.
- Authentication state and freshness; neither is a subscription cancellation date.

Do not sort incomparable providers by one invented "headroom" score. A key with
no spending cap is not an account with unlimited money. Credit expiry is not a
quota-window reset. No reset-credit spending, payments or automatic account
switching belongs in the initial dashboard.

## Operational requirements

- Bounded, coalesced refresh queue; independent per-account/per-endpoint failures.
- Closing/reloading cancels queued work and discards late results. Cancellation
  must not pretend to undo a host-owned action already dispatched.
- No additional persistent credential copies or logs containing private API bodies.
- Account-scoped cache keys and explicit stale labels where cached data is retained.
- Headless mode returns a useful textual report without requiring TUI components.
- Avoid duplicate `/limits` registrations during migration from an existing package;
  choose one command owner and provide an explicit transition path.

## Proposed acceptance gate

Unit/integration tests for account identity, project restrictions, search without
switching, zero/unknown/error states, quota-versus-wallet semantics, bounded refresh,
late cancellation, confirmation races and Unicode/narrow-width rendering.

Then real Pi TUI acceptance: inspect multiple accounts, search/scroll, refresh one
and all, deliberately switch, resize, close/reopen and reload. Observe the process
through clean termination; an early in-process success receipt is insufficient.

## Questions for maintainers

- Is an optional consumer package welcome, rather than adding UI scope to core?
- Which account identity/retrieval contract should core expose first?
- Is `/limits` an acceptable opt-in command name, given possible existing packages?

No release changeset is included because this is a discussion document, not a
shipped feature. Provider fixes and current-account correctness remain separate
PRs; this proposal should not block them.
