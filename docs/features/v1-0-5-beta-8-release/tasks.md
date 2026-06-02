# Tasks - v1.0.5-beta.8 Release

- [x] Confirm current branch, working tree, existing release branches, and existing tags.
- [x] Pull latest `dev` and `main` refs.
- [x] Confirm `v1.0.5-beta.8` and `release/v1.0.5-beta.8` do not exist locally or remotely.
- [x] Identify first-parent commits after `v1.0.5-beta.7`.
- [x] Update `package.json` to `1.0.5-beta.8`.
- [x] Add `CHANGELOG.md` notes for `v1.0.5-beta.8`.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Commit release metadata on `dev`.
- [x] Push `dev`.
- [x] Create and push `release/v1.0.5-beta.8`.
- [x] Open PR from `release/v1.0.5-beta.8` to `main`.
