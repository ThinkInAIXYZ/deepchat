# Session references implementation

- [x] Add bounded transcript reader and reference resolution in the session data owner; reuse
      projections and Tape identity. Reviewed and validated before the first local commit.
- [x] Wire typed renderer routes to the reader.
- [x] Connect the native tool and structured reference model input/persistence. Enforce caller-owned
      reference authorization without widening Tape tools. Review and validate before commit.
- [ ] Add composer session candidates, chips, drafts, sent display, and sidebar drag. Preserve file
      mentions and reorder behavior. Review, render affected states, and validate before commit.
- [ ] Review the complete change for P0–P3 defects and remove unnecessary abstractions. Record
      ablations and the smallest durable regression coverage for the actual failure boundaries.
- [ ] Run format, i18n, lint, typecheck, relevant tests, and rendered UI verification. Re-read changed
      files and final Git state. Commit review-sized slices locally; do not push.

## Validation and review record

Implementation first; existing checks may run throughout. Add durable tests only after each coherent
implementation slice is complete. Performance evidence must distinguish bounded SQL result sizes
from the cost of FTS/literal matching; do not claim constant-time search.

- Reader review: corrected missing literal fallback, missing truncation disclosure, raw JSON list
  previews, and exclusion of error-terminal evidence. Native SQLite tests reproduced these failures
  before correction. Added malformed-reference and oversized-message cases.
- Ablation: removed process-secret cursor signing (unnecessary for separately authorized reads and
  broke restart continuation), its crypto dependency, and duplicate full-message length/slice work.
  Kept source/incarnation/query/role cursor validation and SQL limits. No additional persistence.
- Reader verification: native SQLite suite 9/9 passed; node typecheck and focused lint passed.
- Native wiring review: renderer-only selection routes and model-only read dispatch preserve the
  independent reader authorization; child sessions and ACP are excluded from the native catalog.
  Tool metadata declares parallel read execution. No wrapper handler or second registry added.
- Native wiring verification: main session/runtime/tool suites 1,151/1,151 passed; catalog regression
  suite 54/54 passed; both typechecks, format, lint, and i18n validation passed. UI verification is
  still in progress and is not covered by this commit.
- Structured-input review: fixed reference-only admission across initial/send/queue/steer/retry,
  preserved initial runtime-error containment, and explicitly rejected ACP submissions. No P0/P1
  finding; the empty-input defects were P2. Existing empty and skill-only behavior stays unchanged.
- Ablation: reuse inline-items persistence instead of another reference store; emit reader guidance
  once per input rather than once per reference. Sent chips retain source ID and incarnation.
- Expanded verification: 2,097 main tests passed (one existing skipped test); all 2,630 renderer tests
  passed. Initial-turn/context suites passed again after guidance simplification (125 tests).
  Disposable-profile Electron exercised real native-tool retrieval without source-history injection,
  source navigation, keyboard controls, draft reload, and cross-workspace drag. Sent/composer/menu
  screenshots were inspected. New-thread reference-only admission required an additional P2 fix.
- Projection review found P2 omissions in reference-only search/export/copy and text edits. The
  existing projection/export owners now retain a plain title/ID label; text edits re-anchor session
  references rather than dropping them. A shared formatter removes four duplicate metadata parsers,
  with no source-history expansion or additional storage. Native projection/edit, legacy search,
  and full exporter regressions pass in the expanded 2,122-test main run (one existing test skipped).
