# Build Action Platform Failures Plan

## Changes

- Update the ACP registry fetcher to use Node's `https` module and sequential icon downloads so the
  Windows arm64 build avoids the current built-in fetch crash path.
- Add a Linux glibc loader-mismatch branch to the CUA runtime smoke check. The staging script keeps
  all file validation and skips only the host execution check when the runner cannot load the
  target binary.
- Run the Windows build step under bash so each command exits immediately on failure.
- Add focused textual regression checks for the build scripts and workflow.

## Verification

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- test/main/presenter/pluginPresenter.test.ts`
- `pnpm run plugin:bundle -- --name cua --platform linux --arch x64`
