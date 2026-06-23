# Build Action Platform Failures Tasks

- [x] Inspect failed GitHub Actions logs.
- [x] Update ACP registry build-time fetch behavior.
- [x] Update CUA Linux smoke-check behavior.
- [x] Make Windows build workflow fail fast.
- [x] Add focused regression coverage.
- [x] Run local verification.
- [x] Add stable `vuedraggable` type resolution for macOS arm64 CI.
- [x] Push the branch to trigger a new Build Application workflow.
- [x] Inspect Build Application run `28011329887` and identify macOS notarization 403 as the
  failing step after successful CUA helper staging.
- [x] Keep notarization in release workflow only and skip it for manual Build Application branch
  artifacts.
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm vitest run test/main/presenter/pluginPresenter.test.ts` after the workflow change.
