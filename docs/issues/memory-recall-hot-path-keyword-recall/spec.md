# Memory Recall Hot Path and Keyword Recall

## User Need

Memory recall must not add unbounded first-token latency, and FTS-only recall must remain useful for normal chat messages. Today a warm vector recall waits for the query embedding in the pre-stream memory injection path, and keyword recall uses the full user message with all terms required to match.

## Goal

- Add a bounded soft timeout to the hot-path query embedding call so a slow provider degrades the current turn to FTS-only recall.
- Use a recall-specific keyword query for agent-facing recall and memory injection so long English or CJK messages can still match relevant memories without requiring the whole message to match.
- Keep management search precise and unchanged by default.
- Archive rejected Wave 2 recall experiments #19 and #20 while preserving their decision history.

## Acceptance Criteria

- Warm vector recall returns from FTS-only when query embedding exceeds the soft timeout, without clearing vector readiness, starting reindex, or blocking on the late embedding result.
- Non-timeout vector failures keep the existing degrade-to-FTS behavior.
- Agent-facing recall and injection keyword search use a bounded keywordized query and OR-style matching.
- Recall keyword selection is corpus-aware: query terms are extracted without a static stopword list, terms with no active corpus hits are dropped, and high-frequency terms are filtered when better lower-frequency terms exist.
- Mixed ASCII/code/CJK query term extraction preserves original query order before applying the candidate cap, so earlier CJK terms cannot be starved by later ASCII/code tokens.
- Corpus-aware term stats are collected with one bounded aggregate query per recall, not one query per candidate term.
- At most one tracked warm query-embedding entry per agent/model is active; later turns skip vector recall while that entry is fresh, and stale entries older than 30 seconds can be replaced without aborting old provider requests.
- `memory.search` management search keeps the existing all-term semantics.
- Access counter updates happen in one repository call for a recalled result set.
- Settings explain the degraded FTS-only state when memory is enabled without an embedding model and warn when extraction falls back to the chat model.
- #21 remains unchanged.

## Constraints

- No DB schema migration.
- No public route, IPC, or tool schema changes.
- No new external dependencies.
- No query embedding abort requirement; late provider requests are ignored when the caller has already degraded.
- Validation commands must run through `mise exec -- pnpm ...`.

## Non-Goals

- Do not implement #19 query expansion or #20 reranker.
- Do not implement #21 policy port or deduplicate `deriveRecall`.
- Do not maintain a static recall stopword list.
- Do not add DuckDB vacuum/orphan vector cleanup.
- Do not auto-select models or change memory defaults.

## Open Questions

None.
