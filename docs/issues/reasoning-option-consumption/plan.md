# Reasoning control compatibility

- [x] Import upstream effort/budget exclusivity in build and runtime catalogs, invalidate old
      sanitized caches, and prevent conflicting wire options. Review, ablate, verify, commit.
- [x] Preserve explicit override intent through model/session defaults, atomically persist the
      control pair, and cover actual adapter serialization. Review, ablate, verify, commit.
- [ ] Expose declared budget as an advanced alternative to effort and refresh active capability
      consumers after catalog updates. Review, ablate, verify, commit.
- [ ] Run formatting, i18n, lint, typechecks, targeted main/renderer tests and UI acceptance.
      Record evidence and limitations. Keep all commits local; do not push.

Slice 1: 102 focused tests pass; new importer/request regressions produce six failures against the
base implementation. Format, i18n, lint and both typechecks pass. P0–P3 review found no outstanding
issue in this slice. Keep a normalized boolean rather than introducing a generic constraint engine.
Normal prebuild catalog and ACP registry refreshes are retained. Live API calls were not performed.

Slice 2: main/provider and agent runtime coverage passes (2049 tests, one existing skip); the
additional route projection cases pass. Five new main-process regressions fail against the base.
Production build passes. Review found and fixed persistence of a cleared counterpart and an
unsendable budget advertised on Responses. Keep existing optional settings and no mode column.
