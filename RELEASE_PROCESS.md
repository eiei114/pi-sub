# Release Process

This repo uses Changesets + GitHub Actions for manually approved npm releases.

## One-time setup

1. **GitHub release environment**
   - Create the `release` environment and require approval from the release owners before deployments can proceed. Configure the protection rules in repository settings; the workflow references the environment but cannot configure its reviewers.
2. **npm Trusted Publishing**
   - In npm, grant this repo permission to publish each `@eiei114/pi-sub-*` package from `.github/workflows/release.yml`.
   - This workflow already requests `id-token: write`, so no `NPM_TOKEN` secret is required when Trusted Publishing is configured.
3. **Enable GitHub auto-merge**
   - Repo Settings → Pull Requests → enable **Allow auto-merge**.
   - The release workflow turns on auto-merge for the bot-created `Version Packages` PR after Changesets opens it.

## Normal release flow

### 1) Add a changeset in the feature PR

From your branch:

```bash
npm run changeset
```

- Pick the packages that changed.
- `@eiei114/pi-sub-core`, `@eiei114/pi-sub-bar`, and `@eiei114/pi-sub-shared` are a **fixed group**, so one changeset bumps them together.
- If only docs/CI changed and you do **not** want a publish, skip the changeset.

Commit the generated `.changeset/*.md` file in the same PR.

### 2) Merge the feature PR to `main`

Merging to `main` does not run the release workflow and cannot publish packages.

### 3) Release owner dispatches the workflow

From **Actions → Release**, dispatch the workflow on `main`. The `release` environment pauses the release job until a configured release owner approves it.

If unreleased changesets exist, Changesets creates or updates a **Version Packages** PR and the workflow enables auto-merge after the owner-approved job starts.

### 4) Publish after the Version Packages PR merges

The Version Packages PR merge does not run the release workflow. After it merges, the release owner dispatches the workflow again on `main`; the environment again requires approval before publishing.

- With no pending changesets, Changesets publishes eligible packages to npm.
- Changesets also creates package tags / GitHub releases for the published packages.

Pushes, pull-request events, and scheduled runs never invoke the release workflow. Do not dispatch it until the `release` environment has required release-owner reviewers configured.

## Local verification before merge

Recommended before merging a release-affecting PR:

```bash
npm ci
npm run verify
```

## Notes

- Publish scope is package-aware: only packages affected by the merged changesets are released.
- Internal dependency bumps are handled by Changesets.
- If the repo auto-merge setting is off, the workflow cannot arm auto-merge and someone must merge the `Version Packages` PR manually.
- A separate `pull_request_target` workflow is not used because PRs created with `GITHUB_TOKEN` do not reliably trigger follow-up automation.
