# Linux ARM64 Support Plan

## Approach

Reuse the repository's existing Linux ARM64 scripts and target-aware plugin contract. Limit source
changes to CI orchestration, release artifact collection, and regression coverage.

## Workflow Changes

1. Convert each Linux matrix from an x64-only entry to explicit x64 and ARM64 entries.
2. Keep x64 on `ubuntu-24.04` and run ARM64 natively on `ubuntu-24.04-arm`.
3. Add the unpacked directory name to matrix metadata and use it for smoke checks and plugin
   verification.
4. Run `installRuntime:linux:<arch>` before packaging.
5. Split CUA bundling and verification into x64-only steps.
6. Keep Feishu bundling and verification common to both architectures.
7. Upload artifacts under architecture-specific names.

## Release Assembly

Downloaded Linux ARM64 artifacts remain separate from Linux x64 artifacts. Copy ARM64 packages,
blockmaps, and `latest-linux-arm64.yml` into the release directory without merging update metadata
across architectures.

## CUA Contract

No new business-logic branch is required. The existing `engines.targets` gate is the authoritative
visibility rule, and the existing packaging validation rejects `linux/arm64`. Regression tests will
cover those contracts together with the workflow-level skip so CI cannot accidentally package CUA.

## Verification

Run focused workflow/plugin packaging tests, then the required repository checks:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
```

After local validation, commit and push the branch, manually dispatch the build workflow for Linux,
and require the Linux ARM64 job to complete successfully before opening a Draft PR.
