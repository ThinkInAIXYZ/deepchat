# Plan

## Core memory runtime

1. Change extraction parsing to return a discriminated result so parse errors can propagate as `ok:false` from `extractAndStore()`.
2. Filter memory extraction spans to user-visible text only; exclude assistant reasoning fields.
3. Add a current-embedding fingerprint guard and/or queue wait before reindex reset to prevent stale drains from writing old vectors.
4. Gate `restoreMemory()` with `canWriteAgentMemory()` and delete vectors when rows are archived/forgotten.
5. Update memory FTS query construction to tokenize multi-word queries while retaining safe quoting.

## Database and FTS

1. Extend database security copy to preserve non-shadow indexes and triggers, or run a schema repair/rebuild pass after copy.
2. Add FTS meta/version/tokenizer tracking to agent memory FTS and rebuild when capability differs.
3. Make tape search FTS replacement/deletion stable by using a deterministic rowid or external-content style rebuild/delete path.
4. Make clear/reset paths tolerate missing FTS/meta tables.
5. Seed schema version for newly created databases or otherwise avoid running historical migrations against freshly-created latest schemas.

## Renderer UI

1. Add top-level MemorySettings error/finally handling.
2. Add request-id guards to MemoryManagerPanel refresh.
3. Surface search errors distinctly from empty results.
4. Rename default destructive memory operations to archive/restore semantics; keep permanent delete as an explicit dangerous action if still exposed.
5. Move/label advanced retrieval tuning to reduce accidental misuse.
6. Localize all newly added memory management and advanced settings copy in every supported locale, preserving interpolation placeholders.

## Tests

- Main tests for extraction parse failure cursor behavior and reasoning exclusion.
- Main tests for reindex/drain stale guard and restore disabled behavior.
- SQLite tests for FTS tokenizer rebuild and stale token replacement.
- Database security migration tests for indexes/triggers if existing harness supports it.
- Renderer tests for MemorySettings error state and stale refresh/search behavior.

## Compatibility

- Existing rows remain valid. FTS rebuilds are derived from canonical SQLite rows/projection.
- Archived rows remain available for restore; sidecar vectors are treated as cache and can be regenerated.
