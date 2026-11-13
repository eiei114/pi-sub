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

All three extensions use `ctx.hasUI`, `registerCommand`, `registerTool`,
`session_start`, `model_select`, the shared sub-* event bus, and `pi-tui`
components (`Container`, `Input`, `SelectList`, `Text`, `DynamicBorder`,
`getSettingsListTheme`, width helpers). Those APIs behave the same on 1.5.0.

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

`npm run smoke:pi` loads all three extensions in the actual locally pinned Pi
host through RPC. `npm run verify` runs `check`, `test`, `lint`, and that smoke
harness, and CI runs it on Ubuntu and Windows.

The committed result is `docs/verification/pi-sdk-smoke.json` with
`verification_contract=pi-sdk-behavior-v2` and all four SDK versions set to
`1.5.0`.

The harness asserts actual extension registration (`sub-core:settings`,
`sub-bar:settings`, `sub-bar:import`), the seeded usage rendered through
`sub-status`, a handled malformed-input error followed by a successful response,
a second actual Pi process's registration and feature response plus clean
shutdown, and the native host-shell boundary (PowerShell on Windows, `/bin/sh`
on POSIX). It resolves the CLI from the installed SDK manifest, checks all four
installed versions against the exact pins, and uses an isolated temporary agent
directory without touching global Pi settings.

The feature path is deterministic and offline, so verification makes no paid
model requests. Pi's extension loader, host process, RPC handling, lifecycle, and
feature response are real rather than mocked; provider inference is outside this
compatibility contract. `scripts/pi-sdk-smoke-contract.test.mjs` keeps the
assertions honest by requiring the second-process reload fields and by
rejecting deliberately missing or malformed responses.
