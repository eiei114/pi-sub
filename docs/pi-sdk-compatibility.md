# Pi SDK compatibility (pi-sub)

The `@eiei114/pi-sub-*` packages are verified against the frozen Pi SDK wave:

- `@earendil-works/pi-agent-core`: `1.5.0`
- `@earendil-works/pi-ai`: `1.5.0`
- `@earendil-works/pi-coding-agent`: `1.5.0`
- `@earendil-works/pi-tui`: `1.5.0`

These are exact dev/test pins only. Every published package keeps the `*`
peer range it already declared, so consumers are not forced onto one SDK
version.

## What this repository actually uses

`sub-core` and `sub-bar` import `Type` from `typebox` directly (not from
`@earendil-works/pi-ai`) and only build `Type.Object` / `Type.Optional` /
`Type.Boolean` tool parameter schemas, which stay inside JSON Schema. `sub-status`
uses no TypeBox schemas at all.

Package API inventory on Pi 1.5.0:

- **sub-core** (`packages/sub-core/index.ts`): registers `sub-core:settings`,
  conditionally registers tools (`sub_get_usage`/`get_current_usage`,
  `sub_get_all_usage`/`get_all_usage`) from settings, listens to
  `session_start`, `turn_start`, `tool_result`, `turn_end`,
  `session_before_switch`, `session_before_fork`, `model_select`, and
  `session_shutdown`, and uses the shared `sub-core:*` / scoped-usage event bus.
  Its extension entry does not use `ctx.hasUI` or `pi-tui` UI components.
- **sub-bar** (`packages/sub-bar/index.ts`): uses `ctx.hasUI`, registers commands
  `sub-bar:settings` and `sub-bar:import`, registers shortcuts, listens to
  `session_start`, `model_select`, and `session_shutdown`, uses the shared
  `sub-core:*` event bus, and uses `pi-tui` components/helpers in its settings
  and theme-import UI flows (for example `Container`, `Input`, `SelectList`,
  `Spacer`, `Text`, `truncateToWidth`, `wrapTextWithAnsi`, `visibleWidth`, and
  `ctx.ui.custom` dialogs).
- **sub-status** (`packages/sub-status/index.ts`, `src/runtime.ts`): listens to
  `session_start` and `session_shutdown`, reacts to `sub-core:ready` /
  `sub-core:update-current`, and renders compact status via `ctx.ui.setStatus`.
  It does not register commands or tools, does not handle `model_select`, does
  not use `ctx.hasUI`, and does not use `pi-tui` components.

These package-specific APIs behave the same on 1.5.0.

`pi-coding-agent` 1.5.0 pins `typebox` to exactly `1.3.27`; this workspace keeps
that version at the root, so only one copy is installed.

## 1.5.0 migration notes that apply downstream

The official [Pi v1.5.0 release notes](https://github.com/earendil-works/pi/releases/tag/v1.5.0)
move tool argument validation to `@earendil-works/pi-schema`. TypeBox schemas
are JSON Schema and keep working, but TypeBox features outside JSON Schema
(`Type.Refine()`, `Type.BigInt()`, `Type.Undefined()`, `Type.Void()`, codecs,
`Format.Set()` formats) no longer apply to tool arguments; check such
constraints in `execute()`. Loosely typed arguments are coerced before
validation (numeric strings, `"true"`, single value to one-item array), and
validation errors use pi-schema messages.

The published `@earendil-works/pi-ai` no longer re-exports TypeBox, and its
`StringEnum` is declared to return a pi-schema `Schema<string>`, not a TypeBox
enum. A `StringEnum` property inside `Type.Object` keeps that declared type, so
`Static<typeof schema>` resolves the property to `string` and the literal union
is lost. Importing `Type` from `typebox` does not change this: `StringEnum`'s
return type decides it, not which `Type` builder wraps it. Wrap the value as
`Type.Unsafe<T>(StringEnum(...))` to get the literal union back; pi-sub needs
neither workaround because it imports `Type` from `typebox` and uses no
`StringEnum`.

Checked against the installed `typebox@1.3.27` and
`@earendil-works/pi-ai@1.5.0` types: `Type.Object({ op: StringEnum(["add",
"subtract"]) })` type-checks `op` as `string`, while
`Type.Object({ op: Type.Unsafe<"add" | "subtract">(StringEnum([...])) })`
type-checks it as the literal union and rejects other strings.

### 1.2.0 notes (still applicable)

`before_agent_start` became a `messageType` union (`user` with `prompt` and
`images`; `custom` with `message`). pi-sub's extensions do not handle that
event, so no change was needed. Pi 1.2.0 also made the session busy during
startup handlers (`ctx.isIdle()` false, `sendUserMessage()` needs `deliverAs`);
pi-sub only registers startup work through `session_start`, which is unaffected.

## Runtime verification

`npm run smoke:pi` runs two actual Pi 1.5.0 host checks:

- `scripts/pi-sdk-smoke.mjs` loads all three extensions through RPC and records
  `docs/verification/pi-sdk-smoke.json`
  (`verification_contract=pi-sdk-behavior-v2`, all four SDK versions `1.5.0`).
- `scripts/pi-sdk-tui-smoke.mjs` executes automated interactive UI operations in
  the real Pi 1.5.0 / `pi-tui` environment against `sub-bar`'s
  `ctx.ui.custom`/`SelectList` settings and theme-import flows and records
  `docs/verification/pi-sdk-tui-smoke.json`.

`npm run verify` runs `check`, `test`, `lint`, and `smoke:pi`, and CI runs it on
Ubuntu and Windows.

The RPC harness asserts actual extension registration (`sub-core:settings`,
`sub-bar:settings`, `sub-bar:import`), the seeded usage rendered through
`sub-status`, a handled malformed-input error followed by a successful response,
a second actual Pi process's registration and feature response plus clean
shutdown, and the native host-shell boundary (PowerShell on Windows, `/bin/sh`
on POSIX). It resolves the CLI from the installed SDK manifest, checks all four
installed versions against the exact pins, and uses an isolated temporary agent
directory without touching global Pi settings.

The TUI harness drives real `sub-bar` custom UI components in the actual Pi 1.5.0
environment: theme import opens a `ctx.ui.custom` `SelectList` action prompt,
accepts pasted share input through a `ctx.ui.custom` input prompt, applies a
selected action with observed feedback, and navigates the settings UI custom menu
to theme/import-related options. Rendered UI output and interaction results are
captured as assertions in the committed TUI evidence.

The feature paths are deterministic and offline, so verification makes no paid
model requests. Pi's extension loader, host process, RPC/TUI component handling,
lifecycle, and feature responses are real rather than mocked; provider inference
is outside this compatibility contract. `scripts/pi-sdk-smoke-contract.test.mjs`
keeps the RPC assertions honest by requiring the second-process reload fields and
by rejecting deliberately missing or malformed responses.
