# CUA macOS Distribution Integrity

Status: implemented locally; signed distribution and clean-install validation pending.

GitHub issue: not created; this is a local SDD record. PR #1801 introduced the current managed
helper packaging model, but this fix does not change its runtime/TCC ownership model.

## Issue

A quarantined DeepChat DMG can fail on a clean macOS installation with Gatekeeper reporting that it
cannot verify the developer and cannot determine whether the application contains malware. The same
build can appear healthy when installed as an update because the update path does not reproduce the
first-install quarantine and distribution assessment.

The affected release artifact passes ordinary `codesign`, stapler and `spctl` checks, while
`syspolicy_check distribution` reports a fatal error for the nested
`DeepChat Computer Use.app` helper.

## Impact

- Clean macOS installations can reject an otherwise notarized DeepChat release.
- Existing installations can hide the defect, so upgrade-only release testing is insufficient.
- CI currently validates the staged CUA helper before electron-builder performs its final signing
  pass, not the helper identity and entitlements present in the distributed application.

## Root Cause

The failure requires two conditions:

1. The upstream universal CUA executable contains absolute `LC_RPATH` entries pointing into the
   Xcode installation used to build the upstream release.
2. DeepChat signs the rebranded helper with its dedicated entitlement, then electron-builder signs
   it again with the main application's inherited entitlements. That second entitlement set includes
   `com.apple.security.cs.disable-library-validation`.

Disabling library validation causes Gatekeeper's distribution policy to inspect a wider Mach-O
surface and exposes the invalid build-machine RPATHs. The upstream content defect and DeepChat's
second-signing policy therefore combine into the user-visible failure.

Re-signing the helper once is required: DeepChat renames the application and executable, changes the
bundle identifier and display metadata, and removes the invalid upstream signature. The defect is
the later recursive re-sign with unrelated entitlements, not the initial DeepChat signature.

## Required Invariants

### Mach-O sanitation

- Inspect every architecture represented by `otool` output.
- Remove non-system absolute RPATHs before any DeepChat signature is created.
- Preserve system Swift lookup paths, direct token-relative paths and the canonical
  `@loader_path/../Frameworks` / `@executable_path/../Frameworks` bundle lookup.
- Reject all other traversal-bearing relative paths that can escape the helper bundle.
- Reject unexpected non-system linked-library paths instead of silently rewriting them.
- Reinspect the executable after mutation and fail if a disallowed path remains.

### Signing purpose

- Reuse the package purpose contract; do not introduce another environment-only signing mode.
- Distribution packaging requires purpose `distribution`, a non-empty `build_for_release` release
  notarization mode, a Developer ID Application identity, hardened runtime and a secure timestamp.
  CI uses mode `2` for Apple ID credentials; the existing keychain-profile mode remains supported.
- Verification packaging explicitly permits an ad-hoc helper signature and must not set
  `build_for_release`.
- Local packaging without a package purpose is treated as development only outside CI.
- A CI invocation without an explicit supported purpose fails closed.
- The signer validates the purpose/build-mode relationship itself; workflow validation alone is not
  authoritative.

### Signing ownership

- The CUA staging step is the only phase that signs the nested helper.
- electron-builder ignores the complete `Contents/Helpers/DeepChat Computer Use.app` subtree while
  still signing the containing DeepChat application.
- CUA signing does not use `codesign --deep`; any future nested code must be signed explicitly.
- The dedicated CUA entitlement remains an exact allowlist containing only
  `com.apple.security.automation.apple-events`.
- Verification does not assume `codesign --deep --test-requirement` propagates the external
  requirement to nested code; each discovered Mach-O is checked as an explicit path.

### Final artifact verification

Distribution verification runs after electron-builder and notarization and must:

- verify the nested helper's strict code signature;
- verify Developer ID authority, hardened runtime and secure timestamp, and apply the expected
  Team-ID requirement to the helper bundle and every discovered Mach-O;
- compare its effective entitlements with the exact CUA allowlist;
- recursively reject non-system absolute or unsafe traversal-bearing Mach-O load paths and RPATHs;
- extract the staged updater ZIP and apply the same helper and application checks to its sole
  `DeepChat.app`;
- run `syspolicy_check distribution` on the final DeepChat application in addition to existing
  `codesign`, stapler and `spctl` checks.

## Compatibility and Risk

- Verification packages remain unsigned at the outer application level, while their CUA helper
  remains ad-hoc signed so it can execute locally.
- Removing the two observed Xcode RPATHs is low risk because the executable retains
  `/usr/lib/swift`, but launch, ScreenCaptureKit, Accessibility, CGEvent injection and lazy-loaded
  paths still require end-to-end testing across supported macOS versions.
- Library validation stays enabled for the helper. Its visible direct dynamic load target is the
  Apple-signed SkyLight framework, but private API compatibility is a separate technical risk.
- `signIgnore` deliberately creates a phase dependency on the staged signature. Explicit purpose
  validation and final-artifact checks are mandatory parts of the same fix, not optional follow-up.

## Non-goals

- Do not include the updater-metadata follow-up from PR #2025.
- Do not choose or implement a host-owned versus helper-owned TCC responsibility model.
- Do not patch hard-coded `CuaDriver.app` strings in the upstream binary.
- Do not remove the Apple Events entitlement without runtime evidence.
- Do not replace upstream SkyLight private API usage or sanitize inert Rust source-location strings.
- Do not create or synchronize a GitHub issue without explicit approval.

## Task Checklist

- [x] Add a shared CUA macOS Mach-O contract and sanitize the helper before signing.
- [x] Thread an explicit package purpose from the macOS workflow through plugin bundling.
- [x] Validate distribution, verification and local-development signing modes at the signer.
- [x] Remove `--deep` from helper signing.
- [x] Prevent electron-builder from re-signing the staged helper.
- [x] Verify the final helper signature, Team ID, runtime, timestamp, entitlements and load paths.
- [x] Verify the extracted updater ZIP application with the same distribution checks.
- [x] Add `syspolicy_check distribution` to final macOS application verification.
- [x] Add focused regression tests for every fail-closed boundary.
- [x] Run formatting, i18n, lint and relevant main-process test suites.
- [ ] Validate a signed DMG first install on a clean supported macOS machine or VM.

## Validation

Automated validation must cover:

- universal `otool` output with duplicate per-slice RPATHs;
- allowed system and bundle-contained relative load paths, plus rejected relative traversal;
- removal and post-mutation rejection of disallowed RPATHs;
- missing and contradictory purpose/build-mode combinations;
- distribution and verification signing command differences;
- electron-builder ignore-pattern scope;
- entitlement additions, removals and value changes;
- wrong Team ID, ad-hoc identity, missing timestamp and missing hardened runtime;
- `syspolicy_check distribution` execution against the final app.

Manual release validation must start from the notarized DMG on a machine with neither DeepChat nor
the upstream `/Applications/CuaDriver.app` previously installed. It must exercise startup, screen
capture, Accessibility access, CGEvent input and the permission flow while observing helper exit
status and macOS code-signing/library-validation logs.

### Local results

Validated on 2026-07-26:

- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck:node` passed.
- `pnpm exec vitest run test/main/scripts` passed 25 files and 178 tests.
- `pnpm exec vitest run --config vitest.config.ts test/main --reporter=dot` passed 436 files and
  5,040 tests, with 19 files and 239 tests skipped.
- A copy of the generated universal helper was sanitized and ad-hoc signed through the production
  scripts. Both Xcode RPATHs were removed across the x86_64 and ARM64 slices; final inspection found
  one Mach-O file, only `/usr/lib/swift` as its RPATH, and exactly the managed Apple Events
  entitlement.
- A synthetic universal Mach-O with different disallowed RPATHs in its x86_64 and ARM64 slices
  reproduced `install_name_tool`'s whole-file failure. Per-slice sanitation removed both paths,
  rebuilt both architectures, and preserved executable permissions.
- An existing electron-builder macOS updater ZIP passed the new 3,220-entry path contract, `ditto`
  extraction, sole-root application check, and cleanup path. Its distribution signatures were not
  used as current-fix evidence; current Developer ID verification still requires a new CI artifact.

Local verification cannot prove the Developer ID, notarization, stapling, final
`syspolicy_check distribution`, or clean-install behavior because the local run has no signed and
notarized distribution artifact. Those checks remain fail-closed CI requirements, and the
clean-machine DMG test remains the release acceptance gate.
