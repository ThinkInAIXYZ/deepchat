# Reasoning control compatibility

- [x] Import upstream effort/budget exclusivity in build and runtime catalogs, invalidate old
      sanitized caches, and prevent conflicting wire options. Review, ablate, verify, commit.
- [x] Preserve explicit override intent through model/session defaults, atomically persist the
      control pair, and cover actual adapter serialization. Review, ablate, verify, commit.
- [x] Expose declared budget as an advanced alternative to effort and refresh active capability
      consumers after catalog updates. Review, ablate, verify, commit.
- [x] Run formatting, i18n, lint, typechecks, targeted main/renderer tests and UI acceptance.
      Record evidence and limitations. Keep all commits local; do not push.

Slice 1: 102 focused tests pass; new importer/request regressions produce six failures against the
base implementation. Format, i18n, lint and both typechecks pass. P0–P3 review found no outstanding
issue in this slice. Keep a normalized boolean rather than introducing a generic constraint engine.
Normal prebuild catalog and ACP registry refreshes are retained. Live API calls were not performed.

Slice 2: main/provider and agent runtime coverage passes (2049 tests, one existing skip); the
additional route projection cases pass. Five new main-process regressions fail against the base.
Production build passes. Review found and fixed persistence of a cleared counterpart and an
unsendable budget advertised on Responses. Keep existing optional settings and no mode column.

Slice 3: all 2688 renderer tests pass; after final display/spacing adjustments, the four affected
suites pass again (145 tests). Three renderer regressions fail against the base. Reuse one shared
budget-support predicate instead of duplicate UI rules. P0–P3 review leaves no outstanding finding.
The production build and Electron acceptance pass: effort/default switching, explicit budget saved
and reopened through real IPC, and clearing both overrides. Inspected screenshots cover default and
budget states, including the effort menu at a 900-pixel viewport. No authenticated inference request
was sent; captured SDK requests verify serialization, not live provider acceptance. Review logs and
screenshots remain under ignored `.amp/in/artifacts/`; disposable probes are not shipped.

Follow-up deep review found two P2 issues: draft serialization dropped explicit clears and restored
model overrides on first send; unsupported routes retained stale budgets in settings and UI labels.
Both are fixed without a schema change. New-session contract parsing preserves explicit clears,
model changes reset draft clear intent, and unsupported budget alternatives are discarded. All 2692
renderer tests and 2043 provider/runtime/importer tests pass (one existing skip). Five regression
assertions fail on the pre-review commit and pass with the fixes.
