# Execution plan

- [x] Implement reflection-local evidence IDs, per-result derivation, and source revalidation.
- [x] Validate reflection behavior, review P0–P3 risks, run attribution ablations, simplify, commit.
- [x] Carry addressable Tape evidence through extraction and per-candidate write coordination.
- [x] Validate extraction behavior and retry/deduplication lineage, review and ablate, commit.
- [x] Review the combined change, update the maintained architecture contract, and run format,
      i18n, lint, typecheck and the relevant memory suites. Keep all commits local; do not push.

Implementation precedes new tests. Each behavior slice is independently usable. No new provider
configuration, dependencies or migration is planned. Source, runtime and tests will span more than
eight files; ownership remains within the existing memory subsystem.

Reflection validation: 956 memory behavior tests passed, including source separation, forged IDs,
and revised/challenged/deleted source rejection. Review found and fixed a map-key type error and
missing challenged-source rejection. Removing the revision guard made the stale-evidence test
fail (two claims instead of one); restoring it passed. Snapshots retain only ID and revision,
not copied claim bodies. The full node typecheck also reported unrelated ACP dependency/type
errors; the memory test type gate passed. Full quality gates were deferred to the combined work below.

Extraction review fixed the runtime port input contract, evidence rendering budget amplification,
and successful cursor advancement when every otherwise valid candidate had invalid citations.
New-row provenance is precise; existing UPDATE/owner-fold origin metadata remains unchanged by
design. Removed redundant context parameters and an unnecessary empty-input branch.

Ablations: removing candidate-specific context polluted `[11, 38]` with unrelated entries 27 and 99;
resetting retry context to the batch context polluted `[27]` with entry 11 in both SUPERSEDE and
CHALLENGE. Restoring both protections passed the targeted 91 tests. Reflection's revision ablation
is recorded above. These experiments test correctness, not real-model quality or latency.

Final combined gates passed: `pnpm run test:memory` (54 files, 962 tests, plus scope/type gates),
`pnpm run typecheck`, `pnpm run format:check`, `pnpm run lint`, and `pnpm run i18n`. The earlier ACP
type errors were local dependency drift, resolved with `pnpm install --frozen-lockfile --ignore-scripts`;
no manifest or lockfile changes were needed. Both behavior slices are committed locally; no push.
