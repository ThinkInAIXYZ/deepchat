# Release Flow

This document defines the maintainer release flow for DeepChat without rewriting existing `dev` / `main` history.

## Goals

- Keep `dev` as the only long-lived integration branch.
- Keep `main` as a stable mirror of reviewed release commits.
- Keep releases tag-driven through [`.github/workflows/release.yml`](../.github/workflows/release.yml).
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

5. After the PR is approved, fast-forward `main` locally on macOS or Linux.

   ```bash
   pnpm run release:ff -- release/v1.0.0-beta.4 --tag v1.0.0-beta.4
   ```

   The helper script validates:

   - the working tree is clean
   - the target release commit already exists on `origin/dev`
   - `origin/main` is an ancestor of the target commit
   - `main` can be updated with `git merge --ff-only`
   - the requested tag is free locally and on `origin`

   The `--tag` option validates tag availability and prints the tag command. Create and push the
   tag in the next step.

   Windows maintainers should skip this helper and use the manual release sequence below.

6. Create and push the release tag on the same commit.

   ```bash
   git tag v1.0.0-beta.4 release/v1.0.0-beta.4
   git push origin v1.0.0-beta.4
   ```

7. Wait for the tag-triggered Release workflow and review its draft.

   - Preflight must resolve the existing tag to the expected commit, confirm that commit is
     reachable from `origin/main`, match `package.json`, and find a non-empty matching CHANGELOG
     section before any native package starts.
   - All six native package jobs must pass. macOS x64 and ARM64 must be signed, notarized, stapled,
     and verified; Windows remains unsigned.
   - The workflow writes the draft only after fail-closed assembly and local revalidation, then
     verifies the uploaded assets through the GitHub API. Treat the run as successful only after
     that remote size and digest verification passes. Do not add ad hoc assets to the draft.
   - The draft must contain exactly nineteen assets: fourteen target files, four updater metadata
     files, and `release-index.json`.
   - If a release run must be retried after a native job has completed, rerun all jobs. Package
     manifests bind `GITHUB_RUN_ATTEMPT`, so mixing artifacts from different attempts intentionally
     fails assembly.

   Publish the verified draft manually after reviewing its notes, target list, and
   `release-index.json`.

8. Delete the temporary release branch after the release is published.

   ```bash
   git push origin --delete release/v1.0.0-beta.4
   git branch -d release/v1.0.0-beta.4
   ```

## Manual Release Sequence

Use this sequence when the automatic helper is unavailable, especially on Windows. It updates `origin/main` directly from the reviewed release commit and does not depend on the state of your local `main`.

1. Fetch the latest release refs.

   ```bash
   git fetch origin main dev --prune
   ```

2. Resolve the reviewed release commit and record it as `TARGET_SHA`.

   ```bash
   git rev-parse origin/release/v1.0.0-beta.4^{commit}
   # or
   git rev-parse release/v1.0.0-beta.4^{commit}
   # or
   git rev-parse <target-ref>^{commit}
   ```

3. Confirm the release commit already exists on `origin/dev`.

   ```bash
   git merge-base --is-ancestor <TARGET_SHA> origin/dev
   ```

4. Confirm `origin/main` can be fast-forwarded to the reviewed release commit.

   ```bash
   git merge-base --is-ancestor origin/main <TARGET_SHA>
   ```

5. Confirm the release tag does not already exist locally or on `origin`.

   ```bash
   git rev-parse --verify --quiet refs/tags/v1.0.0-beta.4
   git ls-remote --exit-code --tags origin refs/tags/v1.0.0-beta.4
   ```

   Both commands should report that the tag is missing before you continue.

6. Fast-forward `origin/main` directly to the reviewed release commit.

   ```bash
   git push origin <TARGET_SHA>:refs/heads/main
   ```

7. Create and push the release tag on the same commit.

   ```bash
   git tag v1.0.0-beta.4 <TARGET_SHA>
   git push origin refs/tags/v1.0.0-beta.4
   ```

8. Wait for the Release workflow, review the exact nineteen-asset draft using the checks in the
   standard sequence, and publish it manually.

9. Delete the temporary release branch after the release is published.

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

Build, Release, and package regression call one reusable workflow per operating system. The fixed
native runner and unpacked-directory mapping live in those called workflows, not in each caller.
Secrets are passed explicitly; package jobs have only `contents: read`, and only the final draft
publication job has `contents: write`.

Release assembly accepts exactly one distribution manifest for each of Windows, Linux, and macOS on
x64 and ARM64. It recomputes file digests, rejects incomplete checks or unknown files, and generates:

- `latest.yml` for Windows x64 and ARM64 NSIS payloads;
- `latest-mac.yml` for macOS x64 and ARM64 ZIP payloads, never DMGs;
- separate `latest-linux.yml` and `latest-linux-arm64.yml` AppImage metadata;
- `release-index.json` with six-target evidence and SHA-256 for the other eighteen public files.

Windows ARM64 uses the `build:win:arm64` script, installs only runtime payloads available for
`win32/arm64`, and packages only plugins whose manifest declares that target. Artifact names and
update metadata retain architecture so an ARM64 build cannot replace or be served as an x64
package. The equivalent platform/architecture contract for bundled plugins is documented in
[plugin packaging](./guides/plugin-packaging.md).

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
