# Execution plan

- [x] Unify image route compatibility names and cover sparse New API aliases without overriding
      explicit metadata. Review and locally commit the independently useful change.
- [x] Extend the existing main-owned capability snapshot with media settings eligibility;
      migrate renderer and agent consumers without adding independent renderer inference.
- [x] Review the full change, fix confirmed P0–P3 findings, run regression ablation and relevant
      tests, inspect affected renderer states, then complete repository quality checks.
- [x] Commit the remaining reviewed slice locally. Do not push.

Slice 1 validation: shared-model/OpenAI-compatible/APIMart tests passed (43 tests). Restoring the
old metadata/settings fallbacks made five regression cases fail; restoring the fix passed again.

Slice 2 validation: provider/shared-model/DeepChat-agent/route-contract/Session tests passed
(3436 passed, one skipped); ModelConfigDialog/ChatStatusBar/useModelCapabilities passed (139 tests).
Format, i18n (23 locales), lint, node/web typechecks and the Electron Vite build passed. A disposable
Electron profile exercised image-alias and ordinary-chat forms; screenshots were inspected and the
temporary preview probe removed. No authenticated live provider requests were made.

Review fixes preserve hidden media options on capability-query failure and keep explicit Chat
metadata eligible for Responses despite image fallback aliases. Removing the preservation fix
failed its regression test; two alias regression cases failed before correction. Restoring
the fixes passed. Final review has no outstanding confirmed P0–P3 findings.
