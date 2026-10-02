# Session references implementation

- [x] Add bounded transcript reader and reference resolution in the session data owner; reuse
      projections and Tape identity. Reviewed and validated before the first local commit.
- [ ] Wire typed renderer routes to the reader.
- [ ] Connect the native tool and structured reference model input/persistence. Enforce caller-owned
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
