---
"@eiei114/pi-sub-core": minor
"@eiei114/pi-sub-bar": minor
"@eiei114/pi-sub-shared": minor
---

Add an OpenDesign usage provider.

`sub-core` reads the Design Plan Coding Plan windows from
`vela billing preflight --format json` (`usedCredits / limitCredits`, per window)
after `vela login`, and `sub-bar` adds the matching `5h` / `Week` / `Month`
window toggles. A Go plan reports `5h` and `Week`.

The workspace id is resolved from `OPENDESIGN_WORKSPACE_ID`,
`~/.pi/agent/opendesign-workspace.json`, the OpenDesign desktop app-config
`workspaceScope`, or — after `vela login` — `GET /api/v1/workspaces` with the
Vela control key in `~/.amr/config.json` (personal workspace preferred).

The `opendesign` auth.json entry (an `sk-amr-…` AMR Link key) authenticates chat
only: amr-api billing routes reject it, so the provider reports that HTTP error
instead of fabricating numbers and the CLI session is what unlocks quota reads.
Vela 0.1.4-test.0+ exposes `billing preflight`; `sub-core` resolves the Windows
npm shim (`vela.cmd`) through `where.exe` and runs it via a quoted command line,
because `execFileSync` cannot start a `.cmd` without a shell.
