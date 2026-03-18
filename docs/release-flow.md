# Release Flow

This document defines the maintainer release flow for DeepChat without rewriting existing `dev` / `main` history.

## Goals

- Keep `dev` as the only long-lived integration branch.
- Keep `main` as a stable mirror of reviewed release commits.
- Keep releases tag-driven through [`.github/workflows/release.yml`](/Users/zerob13/Documents/deepchat/.github/workflows/release.yml).
- Avoid creating new merge commits on `main`.

## Branch Roles

- `dev`: active development and integration branch.
- `main`: stable mirror of released source snapshots.
- `release/<version>`: short-lived review branch cut from an existing commit on `dev`.

`release/<version>` must not carry release-only commits. If a release fix is required, land it on `dev` first and then move the release branch forward to the updated `dev` commit.

## Standard Release Sequence

1. Prepare release metadata on `dev`.

   - Update the version, `CHANGELOG.md`, and any release notes on `dev`.
   - Run the required local checks before cutting a release branch.

2. Cut the review branch from the release-ready commit on `dev`.

   ```bash
   git switch dev
   git pull --ff-only origin dev
   git switch -c release/v1.0.0-beta.4
   git push -u origin release/v1.0.0-beta.4
   ```

3. Open a PR from `release/<version>` to `main`.

   - The PR exists for review and CI only.
   - Do not use the GitHub merge button to land the PR.
   - Do not click "Update branch" on the PR, because it creates new merge commits.

4. If review finds a release issue, fix it on `dev` first.

   ```bash
   git switch dev
   git pull --ff-only origin dev
   # land the release fix on dev
   git branch -f release/v1.0.0-beta.4 origin/dev
   git switch release/v1.0.0-beta.4
   git push --force-with-lease origin release/v1.0.0-beta.4
   ```

   Use `--force-with-lease` only because the release branch is a disposable review branch that must stay identical to a commit already on `dev`.

5. After the PR is approved, fast-forward `main` locally.

   ```bash
   pnpm run release:ff -- release/v1.0.0-beta.4 --tag v1.0.0-beta.4
   ```

   The helper script validates:

   - the working tree is clean
   - the target release commit already exists on `origin/dev`
   - `origin/main` is an ancestor of the target commit
   - `main` can be updated with `git merge --ff-only`

6. Create and push the release tag on the same commit.

   ```bash
   git tag v1.0.0-beta.4 release/v1.0.0-beta.4
   git push origin v1.0.0-beta.4
   ```

7. Delete the temporary release branch after the release is published.

   ```bash
   git push origin --delete release/v1.0.0-beta.4
   git branch -d release/v1.0.0-beta.4
   ```

## Repository Settings

These settings are not stored in the repository and must be configured manually on GitHub:

- Enable **Require linear history** on `main`.
- Keep PR checks required for PRs targeting `main` and `dev`.
- Allow maintainers to push `main` only through the documented `ff-only` procedure.
- Treat the PR merge button for `main` as disabled by policy, even if the repository UI still shows it.

## CI Guardrails

- PRs targeting `main` must come from `release/<version>` branches.
- The head commit of a PR targeting `main` must already be contained in `origin/dev`.
- Release tags must point to commits that are already reachable from `origin/main`.

These rules are enforced in the repository workflows so the documented flow and the automation stay aligned.

## History Hygiene

Use first-parent history for day-to-day inspection:

```bash
git log --oneline --decorate --first-parent dev -n 30
git log --oneline --decorate --first-parent main -n 30
```

Avoid using `git log --all --decorate --graph` as the default project view because old release merges and stale branch refs make it noisier than the actual mainline history.

Clean up short-lived branches after they are merged:

```bash
git fetch --prune origin
git branch --merged dev
```
