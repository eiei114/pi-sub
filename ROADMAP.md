# Roadmap

This roadmap tracks the maintenance state of the `@eiei114/pi-sub-*` ecosystem
(the unofficial continuation of [`marckrenn/pi-sub`](https://github.com/marckrenn/pi-sub))
and lists bounded micro-maintenance candidates that the Weekly maintenance seed
planner can promote into backlog issues.

It is a living document. Update it whenever a release ships or a seed is picked
up, so the planner always has an accurate picture of "what's next".

> Scope note: this fork's goal is to keep `pi-sub` usable for current Pi users —
> stable Windows cache/TTL behavior, a working npm release flow, and safe triage
> of upstream PRs. New feature development is opportunistic, not roadmap-driven.

---

## 1. Current release status

| Package | Latest | Published | Release group |
| --- | --- | --- | --- |
| [`@eiei114/pi-sub-core`](https://www.npmjs.com/package/@eiei114/pi-sub-core) | `2.0.0` | 2026-07-10 | **fixed** |
| [`@eiei114/pi-sub-bar`](https://www.npmjs.com/package/@eiei114/pi-sub-bar) | `2.0.0` | 2026-07-10 | **fixed** |
| [`@eiei114/pi-sub-shared`](https://www.npmjs.com/package/@eiei114/pi-sub-shared) | `2.0.0` | 2026-07-10 | **fixed** |
| [`@eiei114/pi-sub-status`](https://www.npmjs.com/package/@eiei114/pi-sub-status) | `2.0.0` | 2026-07-10 | independent |

- `2.0.0` was a **major** bump ([PR #13](https://github.com/eiei114/pi-sub/pull/13),
  DOT-771): the Pi SDK peer dependency moved from the frozen `@mariozechner/*`
  scope to the official `@earendil-works/*` scope (`0.80.x`). This was a breaking
  change for consumers.
- `sub-core`, `sub-bar`, and `sub-shared` form a **fixed release group** (one
  changeset bumps all three together — see `.changeset/config.json`).
  `sub-status` is versioned independently but currently tracks the same number.
- 9 usage providers are supported: `anthropic`, `copilot`, `gemini`,
  `antigravity`, `codex`, `kiro`, `zai`, `kimi-coding`, `openrouter`.

### Release pipeline

- Changesets + GitHub Actions, npm **Trusted Publishing** (no `NPM_TOKEN`).
- `.github/workflows/release.yml` runs on every push to `main`: `npm ci` →
  `npm run check` → `npm run test`, then Changesets opens (and auto-merges via
  squash) a `Version Packages` PR, then publishes on the second run.
- Documented in [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md).

---

## 2. Maintenance priorities (next 2–3 releases)

These are the themes the fork should hold steady on. They are deliberately
boring and defensive — the fork's value is reliability, not features.

1. **Keep the SDK upgrade stable.** `2.0.0` was the first release on the
   `@earendil-works/*` SDK. Watch for behavioral regressions in event handling
   (`session_before_switch`, `session_before_fork`) and `getContextUsage()`
   null-coercion, and patch promptly.
2. **Protect Windows reliability.** The cache-rename retry, lock-ownership, and
   TTL-respecting refresh fixes are the fork's headline differentiators. Any
   change touching `packages/sub-core/src/cache.ts`, `storage/lock.ts`, or the
   usage controller must not regress these on Windows.
3. **Hardening the release/CI gate.** Today only `release.yml` runs `check` +
   `test`, and only on `main`. There is no pull-request CI and `lint` is not
   enforced anywhere automated. Closing this gap is the highest-leverage
   maintenance work available (see seed S-2).
4. **Documentation accuracy.** Several generated docs still reference the old
   `@marckrenn/*` scope. Keep docs consistent with the `@eiei114/*` reality so
   new contributors aren't misled.
5. **Provider parity triage.** Periodically scan upstream `marckrenn/pi-sub`
   for safe, small provider fixes that can be ported without pulling in
   unrelated churn.

---

## 3. Known technical debt

| Area | Detail | Source |
| --- | --- | --- |
| Stale CHANGELOG titles | Every `packages/*/CHANGELOG.md` H1 still reads `# @marckrenn/pi-sub-*` though the packages are `@eiei114/*`. | `packages/*/CHANGELOG.md` |
| No PR CI / lint not enforced | No workflow runs on `pull_request`; `release.yml` runs `check`+`test` but never `npm run lint`. | `.github/workflows/` |
| `sub-shared` has no tests | Published to npm and re-exported by core+bar, but `PROVIDERS`, `PROVIDER_METADATA`, `PROVIDER_DISPLAY_NAMES`, `MODEL_MULTIPLIERS`, `getDefaultCoreSettings`, and `getDefaultCoreProviderSettings` have no test coverage. | `packages/sub-shared/` |
| Thin `CONTRIBUTING.md` | Doesn't explain the `fixed` release group, Trusted Publishing, or the verify-before-merge gate. | `CONTRIBUTING.md` |
| Aspirational extension list | README "Ideas / planned" lists `pi-sub-compare`, `pi-sub-model-switcher`, `pi-sub-account-switcher` with no tracking or owners. | `README.md` |

---

## 4. Candidate maintenance seeds

Each seed is intentionally scoped to **30–90 minutes** of focused work so it can
be promoted into a single backlog issue and cleared in one session. Promote in
rough top-to-bottom priority order. Every seed carries its own acceptance
criteria so an agent or contributor can self-verify.

> Convention: when promoting a seed, file the backlog issue, then check the row
> off here and link the issue. Seeds are docs/CI/hygiene only — **none of these
> require a changeset or a package publish** unless explicitly noted.

---

### S-1 — Fix stale CHANGELOG package-name titles

**Size:** ~30 min · **Type:** docs · **Changeset:** no

All four package CHANGELOGs still open with `# @marckrenn/pi-sub-*` as the H1
title, left over from the `@marckrenn → @eiei114` scope migration. The titles
should match the published package names.

**Acceptance criteria**

- [ ] `packages/sub-core/CHANGELOG.md` H1 reads `# @eiei114/pi-sub-core`.
- [ ] `packages/sub-bar/CHANGELOG.md` H1 reads `# @eiei114/pi-sub-bar`.
- [ ] `packages/sub-shared/CHANGELOG.md` H1 reads `# @eiei114/pi-sub-shared`.
- [ ] `packages/sub-status/CHANGELOG.md` H1 reads `# @eiei114/pi-sub-status`.
- [ ] No other lines in the changelogs are changed (history is preserved).
- [ ] `npm run lint` still passes; no changeset added (docs-only).

**Verification:** `grep -Rn "^# @marckrenn" packages/` returns nothing.

---

### S-2 — Add pull-request CI and enforce `lint`

**Size:** ~60 min · **Type:** CI · **Changeset:** no

There is no workflow that runs on pull requests, and `lint` is never run in CI
(`release.yml` runs only `check` + `test`). PRs can therefore merge with lint
errors. Add a dedicated CI workflow that gates PRs.

**Acceptance criteria**

- [ ] New `.github/workflows/ci.yml` triggers on `pull_request` and on `push` to
      non-`main` branches.
- [ ] It runs on `ubuntu-latest` + `windows-latest` (the fork's headline fixes
      are Windows-specific, so Windows must be a first-class CI target).
- [ ] Steps: checkout → setup-node (version from `.nvmrc`) → `npm ci` →
      `npm run check` → `npm run test` → `npm run lint`.
- [ ] `release.yml`'s duplicate `test` job is left in place (it gates the
      publish); CI is additive, not a replacement.
- [ ] Workflow passes on a no-op PR before merge.

**Verification:** open a PR; both CI matrices go green; deliberately introduce a
lint error and confirm the job fails.

---

### S-3 — Add tests for `sub-shared`

**Size:** ~60 min · **Type:** tests · **Changeset:** no

`sub-shared` is published to npm and consumed by core and bar, but has no tests.
Add a `packages/sub-shared/test/all.test.ts` smoke suite that locks in the
invariants other packages depend on.

**Acceptance criteria**

- [ ] `packages/sub-shared/package.json` gains `"test": "tsx test/all.test.ts"`
      and `tsx` as a devDependency (matching sub-core/sub-bar).
- [ ] `npm run test -w @eiei114/pi-sub-shared` passes.
- [ ] `npm run test` (root) now includes sub-shared results.
- [ ] Tests assert: every entry in `PROVIDERS` has metadata + a display name;
      `PROVIDER_DISPLAY_NAMES` keys equal `PROVIDERS`;
      `getDefaultCoreProviderSettings()` returns one entry per provider with
      `enabled === "auto"`; `getDefaultCoreSettings()` returns a full
      `providerOrder` matching `PROVIDERS` and a non-null `behavior`.
- [ ] No production source changes; no changeset (test-only).

**Verification:** `npm run test -w @eiei114/pi-sub-shared` exits 0; root
`npm run test` shows the new workspace.

---

### S-4 — Expand `CONTRIBUTING.md` with release/verify rules

**Size:** ~45 min · **Type:** docs · **Changeset:** no

`CONTRIBUTING.md` lists scripts but omits the rules that actually trip up
contributors: the `fixed` release group, when a changeset is required, the
Trusted Publishing flow, and the verify-before-merge gate.

**Acceptance criteria**

- [ ] A "Release rules" section explains the `fixed` group
      (`sub-core`/`sub-bar`/`sub-shared` bump together) and that `sub-status` is
      independent.
- [ ] A "When to add a changeset" section: required for user-facing package
      changes; skip for docs/CI/test-only changes.
- [ ] A pointer to `RELEASE_PROCESS.md` for the full publish flow.
- [ ] A "Before you merge" checklist: `npm run verify` (check + test + lint)
      passes locally.
- [ ] No source changes; no changeset.

**Verification:** read-through confirms all four bullets present; `npm run lint`
passes on the doc change.

---

### S-5 — Document the Windows reliability contract

**Size:** ~60 min · **Type:** docs · **Changeset:** no

The Windows cache-rename retry, lock-ownership, and TTL-respecting refresh
behavior are the fork's main differentiators, but they are only described
loosely in the README. Capture the exact contract so future changes don't
silently regress it.

**Acceptance criteria**

- [ ] New `docs/WINDOWS_CACHE_CONTRACT.md` documents: cache/lock file locations,
      the rename-retry behavior, that a process only releases its own lock, and
      that `turn_end`/`tool_result` refreshes respect the cache TTL.
- [ ] Lists the source files that implement each behavior
      (`src/cache.ts`, `src/storage/lock.ts`, usage controller) as the "do not
      regress" surface.
- [ ] README links to the new doc from the "About this fork" section.
- [ ] No source changes; no changeset.

**Verification:** all four implementation files are named in the doc; README link
resolves.

---

### S-6 — Triage upstream `marckrenn/pi-sub` for portable fixes

**Size:** ~45 min · **Type:** triage · **Changeset:** no

Periodically scan the upstream repo's open issues/PRs for small, safe,
provider-specific fixes that can be ported without dragging in unrelated churn.

**Acceptance criteria**

- [ ] Output is a short report (issue comment or doc) listing up to 3 candidate
      upstream items, each with: link, one-line summary, estimated port effort,
      and a yes/no "safe to port" recommendation.
- [ ] Exclude anything touching the cache/lock layer or the SDK scope (already
      diverged in this fork).
- [ ] No code changes in this seed — porting is a follow-up issue.

**Verification:** report covers the 3 most relevant upstream items with
recommendations; nothing in the fork is modified.

---

## 5. Out of scope (for now)

These are tracked in the README as ideas but are **not** current maintenance
targets. They are listed here only so the planner doesn't re-evaluate them every
week:

- `pi-sub-compare` — multi-provider usage comparison chart.
- `pi-sub-model-switcher` — auto switch model/provider at a usage threshold.
- `pi-sub-account-switcher` — cycle subscriptions at usage thresholds.

Each would be a net-new package and a multi-session effort, not a 30–90 minute
seed. Revisit only if a contributor volunteers to own one.

---

## 6. Changelog

- **2026-07-14** — Initial `ROADMAP.md` created (DOT-869). Captures the post-`2.0.0`
  state and six candidate maintenance seeds (S-1 … S-6).
