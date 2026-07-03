# Plan

## Implementation

- Add small pure helpers in the memory presenter for recall keywordization and soft timeout handling.
- Extend the agent-memory repository search contract with a keyword match mode, defaulting to current all-term behavior.
- Add a corpus-aware recall keyword stats query to the repository contract. It counts active recallable rows per candidate term and excludes persona, working, archived, conflicted, and superseded rows.
- Implement corpus-aware term stats as one aggregate SQL statement per recall: `COUNT(*)` plus `SUM(CASE WHEN content LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)` for bounded candidate terms.
- Guard warm query embedding with one tracked in-flight entry per `agentId + providerId + modelId`. Skip vector recall while a fresh entry is active; replace stale entries after 30 seconds and let late promises clear only their own map entry.
- Add `recordAccessBatch` to the repository contract, SQLite implementation, and fake repository.
- Route public agent-facing recall and injection through dynamically selected keywordized OR matching; leave management search and internal neighbor lookups on precise all-term matching.
- Keep keyword candidate extraction pure and stopword-free. Extract ASCII/code and CJK candidates into one position-ordered pool before applying the candidate cap, then rank terms by low corpus hit count, term length, and original position; emit the selected terms back in original query order.
- Add settings-panel hints for missing embedding/extraction model configuration.
- Archive memory SDD #19 and #20 with explicit rejection notes and update the memory README.

## Compatibility

- Existing callers of `repository.search(agentId, query, limit)` continue to work because search mode defaults to all-term matching.
- Existing public contracts and persisted memory rows are unchanged.
- Late query embedding promises are intentionally not aborted; their result is ignored after timeout. The in-flight guard is a tracked rate gate, not a provider-level hard concurrency cap, so stale replacement may leave old provider calls running until they settle.
- If no extracted term hits the active memory corpus, the keyword branch returns no rows; vector recall still uses the original query when available.

## Test Strategy

- Main presenter tests cover timeout degradation, corpus-aware English and CJK recall, management search precision, no-hit keyword behavior, and batch access updates.
- SQLite table tests cover OR search mode, aggregate corpus term stats filtering, and batch access persistence.
- Presenter tests cover query-embedding in-flight suppression and stale replacement.
- Pure recall keyword tests cover extraction/ranking edge cases without presenter setup, including mixed CJK/ASCII candidate caps.
- Renderer tests cover new missing-model hints.
- Final validation runs through mise.
