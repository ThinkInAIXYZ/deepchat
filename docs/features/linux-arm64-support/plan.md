# Linux ARM64 Support Plan

## Approach

Reuse the repository's existing Linux ARM64 scripts and target-aware plugin contract. Keep
architecture-specific behavior inside the Linux reusable workflow and keep callers declarative.

## Workflow Changes

1. Let `build.yml`, `release.yml`, and `package-regression.yml` call
   `.github/workflows/_package-linux.yml` with `x64` and `arm64`.
2. Keep x64 on `ubuntu-24.04` and run ARM64 natively on `ubuntu-24.04-arm`.
3. Derive `linux-unpacked` or `linux-arm64-unpacked` only inside the reusable workflow.
4. Run `installRuntime:linux:<arch>` before packaging.
5. Keep CUA bundling and verification x64-only.
6. Keep Feishu bundling and verification common to both architectures.
7. Stage an exact target manifest under the architecture-specific artifact name. Distribution
   callers upload the complete contract; verification callers upload diagnostics only.

## Release Assembly

Release downloads the exact `deepchat-package-linux-arm64` artifact and validates its manifest,
source identity, package smoke, installer-size report, files, and digests. The assembler publishes
its AppImage and tarball, then generates `latest-linux-arm64.yml` independently. Linux x64 and ARM64
updater metadata are never merged.

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

After local validation, a maintainer pushes the branch and runs the six-target workflow. The
reusable Linux ARM64 package job and its verification-mode regression must complete successfully
before the orchestration migration is treated as remotely validated.
