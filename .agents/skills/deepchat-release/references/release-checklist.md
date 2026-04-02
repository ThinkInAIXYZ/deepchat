# DeepChat Release Checklist

Use this file for the exact command sequence after you know the target version and the current git state.

## 1. Inspect state

```bash
git status --short
git branch --show-current
git branch --list "release/vX.Y.Z"
git branch -r --list "origin/release/vX.Y.Z"
git rev-parse --verify --quiet "refs/tags/vX.Y.Z"
git ls-remote --tags origin "refs/tags/vX.Y.Z"
```

If a tag already exists locally or remotely, verify it before continuing. Ask before replacing or deleting a tag.

## 2. Prepare metadata on `dev`

```bash
git switch dev
git pull --ff-only origin dev
```

Then update:

- `package.json`
- `CHANGELOG.md`

Recommended checks:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

Commit and push:

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): prepare vX.Y.Z"
git push origin dev
```

## 3. Cut a new release branch

Use this when `release/vX.Y.Z` does not exist yet.

```bash
git switch -c release/vX.Y.Z
git push -u origin release/vX.Y.Z
```

Open a PR from `release/vX.Y.Z` to `main`.

## 4. Update an existing release branch

Use this when the release branch already exists and metadata changed afterward.

```bash
git switch dev
git branch -f release/vX.Y.Z HEAD
git push --force-with-lease origin release/vX.Y.Z
```

If a PR from `release/vX.Y.Z` to `main` already exists, let it update in place.

## 5. Publish after PR approval

```bash
pnpm run release:ff -- release/vX.Y.Z --tag vX.Y.Z
git tag vX.Y.Z release/vX.Y.Z
git push origin vX.Y.Z
```

## 6. Clean up the disposable release branch

```bash
git push origin --delete release/vX.Y.Z
git branch -d release/vX.Y.Z
```

## 7. Changelog format from `v1.0.1` onward

```md
## vX.Y.Z (YYYY-MM-DD)
- English bullet
- English bullet
- 中文条目
- 中文条目
```

Keep English bullets first, Chinese bullets second, and preserve older sections unless the user explicitly asks to rewrite history.
