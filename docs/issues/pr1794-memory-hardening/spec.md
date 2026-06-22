# PR1794 Memory Hardening

## User need

PR #1794 adds a broad long-term memory system. Before merge, the implementation must avoid silent memory loss, memory contamination, data/index corruption, confusing destructive UI behavior, and obvious reliability regressions.

## Goal

Fix the must-fix and medium-high priority review findings for PR #1794 while preserving the overall tape-native memory design.

## Acceptance criteria

- Memory extraction does not advance session memory cursors when the LLM extraction output cannot be parsed as a valid result.
- Assistant reasoning/internal thinking fields are excluded from memory extraction spans.
- Embedding reindex/reset cannot be raced by an older in-flight embedding drain writing stale vectors.
- Disabling memory consistently prevents restore/write paths from scheduling new embeddings, unless explicitly documented as read-only management.
- Archive/forget removes stale vectors from the sidecar or otherwise compacts them so archived rows do not bloat vector recall.
- Memory keyword search supports tokenized multi-word queries, not only exact phrase queries.
- SQLCipher/encryption copy preserves or rebuilds indexes/triggers required by memory/tape tables.
- FTS indexes have a version/tokenizer rebuild path so runtime capability changes do not leave stale FTS schemas.
- Tape search FTS replacement/deletion does not leave stale tokens for replaced entries.
- Memory settings UI recovers from load errors, avoids stale refresh overwrites, and makes archive vs permanent delete semantics clear.
- Relevant unit tests cover the fixed behaviors.

## Constraints

- Keep changes focused on PR #1794 memory hardening; avoid unrelated refactors.
- Preserve backward compatibility with existing local SQLite databases.
- Do not introduce new runtime dependencies.
- Main-process DB operations remain synchronous where existing SQLite presenter patterns require it.
- UI strings must use i18n keys and newly added translations must be localized for each supported locale rather than copied from English.

## Non-goals

- Redesigning the entire memory architecture.
- Changing the public PR feature scope beyond hardening and safety fixes.
- Shipping a complete vector compaction scheduler if immediate vector deletion on archive is sufficient.

## Open questions

None.
