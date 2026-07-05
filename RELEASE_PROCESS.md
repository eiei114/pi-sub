# Release Process

This repo uses Changesets + a manual GitHub Actions workflow to ship releases.

## 1) Prepare the release branch (optional)
If bundling multiple PRs, create a release branch and merge feature branches into it:

```bash
git checkout main
git pull
git checkout -b release-<version>

git merge --no-ff <feature-branch>
# repeat as needed
```

Open a PR from `release-<version>` → `main`.

## 2) Add a changeset
From your release branch (or feature branch if not bundling):

```bash
npm run changeset
```

- Choose **patch** for `@eiei114/pi-sub-bar` / `@eiei114/pi-sub-core` / `@eiei114/pi-sub-shared`.
- These packages are a **fixed group**, so one changeset bumps all three together.

Commit and push the changeset.

## 3) Merge to main
Merge the PR to `main` after review. Run tests beforehand:

```bash
npm test
```

## 4) Run the Release workflow (phase 1)
Trigger **Actions → Release (manual)** on `main`.

This creates a **Version Packages** PR with version bumps + changelogs.

## 5) Merge the Version Packages PR
Review and merge the PR created by Changesets.

## 6) Run the Release workflow again (phase 2)
Trigger **Actions → Release (manual)** on `main` once more.

This publishes to npm and creates the GitHub release + tag.

## Release notes
The workflow uses the `packages/sub-bar/CHANGELOG.md` entry for the GitHub release notes.
If you want custom notes, edit the GitHub release after it’s created.

### Optional local notes file (not committed)
You can draft a local notes file (ignored by git):

```
release-notes-<version>.md
```

Paste its contents into the GitHub release UI if needed.
