# Contributing

Thanks for helping improve **pi-sub**!

## Requirements

- Node.js >= 24 (see `.nvmrc`)
- npm

## Setup

```bash
npm install
```

## Common scripts

```bash
npm run check
npm run test
npm run lint
npm run format
npm run verify
```

Workspace-specific commands:

```bash
npm run check -w @eiei114/pi-sub-core
npm run check -w @eiei114/pi-sub-bar
npm run check -w @eiei114/pi-sub-status
npm run check -w @eiei114/pi-sub-shared
npm run test -w @eiei114/pi-sub-core
npm run test -w @eiei114/pi-sub-bar
npm run test -w @eiei114/pi-sub-status
npm run test -w @eiei114/pi-sub-shared
```

Watch mode:

```bash
npm run check:watch -w @eiei114/pi-sub-core
npm run check:watch -w @eiei114/pi-sub-bar
npm run check:watch -w @eiei114/pi-sub-status
npm run check:watch -w @eiei114/pi-sub-shared
npm run test:watch -w @eiei114/pi-sub-bar
npm run test:watch -w @eiei114/pi-sub-status
```

## Release rules

This repo uses [Changesets](https://github.com/changesets/changesets) to version and publish packages.

- `@eiei114/pi-sub-core`, `@eiei114/pi-sub-bar`, and `@eiei114/pi-sub-shared` are a **fixed** release group — one changeset bumps all three together.
- `@eiei114/pi-sub-status` is **independent** — version it in a separate changeset when only that package changes.

When you run `npm run changeset`, select every package whose published contents or behavior changed. If any package in the fixed group changed, Changesets releases all three fixed-group packages together with one shared version bump; do not create separate changesets or different bump levels just to bump each fixed-group package independently.

For the full automated publish flow (npm Trusted Publishing, Version Packages PR, auto-merge), see [RELEASE_PROCESS.md](./RELEASE_PROCESS.md).

## When to add a changeset

**Add a changeset** when your PR includes user-facing changes to any publishable package (`@eiei114/pi-sub-core`, `@eiei114/pi-sub-bar`, `@eiei114/pi-sub-shared`, or `@eiei114/pi-sub-status`).

**Skip the changeset** only when the PR changes repository-only docs, CI, or tests that are not published and do not alter package contents or behavior. Package READMEs and public API documentation are published package contents, so include a changeset when they change.

```bash
npm run changeset
```

Commit the generated `.changeset/*.md` file with your PR.

## Before you merge

Before requesting review or merging, confirm locally:

- [ ] `npm ci` (or `npm install` after dependency changes)
- [ ] `npm run verify` passes — runs `check`, `test`, and `lint` across the workspace
- [ ] A changeset is included when required (see above)
- [ ] Docs/tests updated when you change shared types, events, or public APIs

`npm run verify` is the repo's standard pre-merge gate; running only `npm test` can miss type-check or lint failures.

## Pull requests

- Keep PRs focused and include relevant docs/tests.
- If you add or change shared types/events, update `sub-shared` exports and docs.
