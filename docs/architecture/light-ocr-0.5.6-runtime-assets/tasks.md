# Light OCR 0.5.6 Runtime Assets Tasks

## Specification

- [x] Inspect the v0.5.6 release, package closure, native tarball inventory, and
  PDFium loader behavior.
- [x] Define the exact font-resource, platform, security, compatibility, and
  validation contracts.
- [x] Write the architecture specification and implementation plan.

## Dependency And Packaging

- [x] Pin facade 0.5.6, runtime 0.1.6, model 0.3.4, and native 0.5.6.
- [x] Regenerate and inspect the pnpm lockfile closure.
- [x] Extend the exact recursive PDFium resource inventory.
- [x] Require and verify the bundled Noto Sans SC license assets.
- [x] Preserve macOS code encoding while retaining raw font data.

## Runtime

- [x] Resolve and verify PDFium loader, code, and font resources independently.
- [x] Materialize bounded verified font resources beside the macOS loader.
- [x] Preserve helper private-runtime containment and cleanup behavior.
- [x] Keep direct Linux and Windows package loading unchanged.

## Smoke And Tests

- [x] Update package, resolver, materialization, and smoke fixtures to v0.5.6.
- [x] Add missing, unexpected, corrupt, and symlinked font-resource regressions.
- [x] Preserve existing image and raster-PDF packaged smoke.
- [x] Add deterministic non-embedded Chinese-font packaged OCR smoke.
- [x] Update the maintained PDF OCR feature specification.

## Validation And Delivery

- [x] Run focused OCR packaging and runtime tests.
- [x] Run format, i18n, lint, typecheck, full tests, and production build.
- [x] Run current-platform packaged offline smoke when prerequisites permit.
- [x] Complete the severity-ranked pre-commit review and resolve findings.
- [x] Commit the validated upgrade locally with a behavior-specific message.
- [x] Do not push.

## Local Validation Evidence

- Focused OCR suites: 7 files, 112 tests passed.
- Full Vitest run: 713 files and 7,606 tests passed; 20 files and 280 tests skipped.
- Format, i18n validation, lint, typecheck, and production build passed.
- Unsigned macOS arm64 unpacked packaging passed through `afterPack`.
- Network-denied packaged OCR smoke passed for image, raster PDF, and a
  non-embedded Chinese-font PDF.
- Packaged OCR assets measured 75,502,371 compressed bytes, below the 90 MiB
  component budget.
- Performance smoke measured 542,261,248 peak RSS bytes, below the 768 MiB
  threshold.
