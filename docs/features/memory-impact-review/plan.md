# Execution plan

- [x] Implement bounded impact preview and revision-checked archive contracts in existing owners.
- [x] Review backend P0–P3 risks, select durable tests, run a revision-guard ablation and commit.
- [ ] Integrate explicit impact review into edit and delete flows; localize all supported locales.
- [ ] Validate selection, partial failure, stale responses and real Electron interactions.
- [ ] Review combined changes, remove unnecessary design, run format/i18n/lint/typecheck and
      relevant suites, inspect rendered screenshots and commit locally without attribution.

Implementation first, then focused regression protection. Backend and renderer are separate
ownership slices against the contracts in spec.md. No push.

Backend validation: 966 memory tests passed, including scope/type gates. The revision-guard
ablation failed on a simulated concurrent update and passed after restoration. Integration review
found that the editable-claim predicate wrongly excluded reflection rows; real reflection fixtures
reproduced the failure, and explicit reflection/lifecycle checks fixed it. Preview and mutation
both enforce reflection kind. Format, i18n, lint and full typecheck passed before the backend commit.
