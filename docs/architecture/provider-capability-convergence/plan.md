# Execution plan

- [x] Unify image route compatibility names and cover sparse New API aliases without overriding
      explicit metadata. Review and locally commit the independently useful change.
- [ ] Extend the existing main-owned capability snapshot with media settings eligibility;
      migrate renderer and agent consumers without adding independent renderer inference.
- [ ] Review the full change, fix confirmed P0–P3 findings, run regression ablation and relevant
      tests, inspect affected renderer states, then complete repository quality checks.
- [ ] Commit the remaining reviewed slices and report exact local state. Do not push.

Slice 1 validation: shared-model/OpenAI-compatible/APIMart tests passed (43 tests). Restoring the
old metadata/settings fallbacks made five regression cases fail; restoring the fix passed again.
