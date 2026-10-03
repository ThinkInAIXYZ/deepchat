# Reasoning control compatibility

- [x] Import upstream effort/budget exclusivity in build and runtime catalogs, invalidate old
      sanitized caches, and prevent conflicting wire options. Review, ablate, verify, commit.
- [ ] Preserve explicit override intent through model/session defaults. Expose declared budget as
      an advanced alternative to effort and refresh active capability consumers after catalog
      updates. Review, ablate, verify, commit.
- [ ] Run formatting, i18n, lint, typechecks, targeted main/renderer tests and UI acceptance.
      Record evidence and limitations. Keep all commits local; do not push.

Slice 1: 102 focused tests pass; new importer/request regressions produce six failures against the
base implementation. Format, i18n, lint and both typechecks pass. P0–P3 review found no outstanding
issue in this slice. Keep a normalized boolean rather than introducing a generic constraint engine.
Normal prebuild catalog and ACP registry refreshes are retained. Live API calls were not performed.
