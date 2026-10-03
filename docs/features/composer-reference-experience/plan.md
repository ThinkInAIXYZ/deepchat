# Composer reference experience execution

- [x] Inspect composer, inline persistence, queue/message edit contracts, and reference products.
- [x] Create `feat/composer-reference-experience` and record the hybrid design.
- [ ] Preserve structured workspace references through shared contracts and document projections;
      keep provider input semantics unchanged. Validate and commit this coherent slice.
- [ ] Implement lightweight reference details, grouped picker, and separate attachment shelf using
      existing Vue/Tiptap/shadcn components. Preserve representation controls and legacy content.
- [ ] Carry structured edits through queue and message editing, enforce original session grants,
      and use rendered-height message disclosure. Validate and commit integrated behavior.
- [ ] Review the complete branch for P0/P1/P2/P3 defects, compatibility and permission boundaries.
      Fix confirmed findings and run focused regression checks.
- [ ] Perform ablation: remove unnecessary layers or state, and demonstrate that retained guards
      protect a concrete failure case. Keep durable tests only for observable contracts.
- [ ] Run format, i18n, lint, typecheck, relevant main/renderer tests and isolated Electron checks.
      Inspect light/dark and narrow/normal rendered states; keep review screenshots in `.amp/in/`.
- [ ] Update affected session-reference documentation, record validation, and make the final local
      commit. Do not push or create a PR.

Implementation precedes new tests. Existing tests may run during each slice. The final review covers
all commits from the branch base, not only the last working diff.
