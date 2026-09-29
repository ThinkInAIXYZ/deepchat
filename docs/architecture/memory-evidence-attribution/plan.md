# Execution plan

- [x] Implement reflection-local evidence IDs, per-result derivation, and source revalidation.
- [x] Validate reflection behavior, review P0–P3 risks, run attribution ablations, simplify, commit.
- [ ] Carry addressable Tape evidence through extraction and per-candidate write coordination.
- [ ] Validate extraction behavior and retry/deduplication lineage, review and ablate, commit.
- [ ] Review the combined change, update the maintained architecture contract, and run format,
      i18n, lint, typecheck and the relevant memory suites. Keep all commits local; do not push.

Implementation precedes new tests. Each behavior slice is independently usable. No new provider
configuration, dependencies or migration is planned. Source, runtime and tests will span more than
eight files; ownership remains within the existing memory subsystem.

Reflection validation: 956 memory behavior tests passed, including source separation, forged IDs,
and revised/challenged/deleted source rejection. Review found and fixed a map-key type error and
missing challenged-source rejection. Removing the revision guard made the stale-evidence test
fail (two claims instead of one); restoring it passed. Snapshots retain only ID and revision,
not copied claim bodies. The full node typecheck also reported unrelated ACP dependency/type
errors; the memory test type gate passed. Full quality gates remain pending for the combined work.
