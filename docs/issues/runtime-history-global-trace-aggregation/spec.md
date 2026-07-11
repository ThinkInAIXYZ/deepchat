# P-02 Runtime History Global Trace Aggregation

## Status

- Severity: High
- State: Implemented and validated
- Scope: `agent.db` message-history reads on the agent runtime path
- GitHub issue: [#1945](https://github.com/ThinkInAIXYZ/deepchat/issues/1945)

## Issue

Before this fix, `DeepChatMessagesTable.getBySession()` built a rich history projection by joining
a subquery that aggregated every row in `deepchat_message_traces` before SQLite filtered messages
to the requested session:

```sql
LEFT JOIN (
  SELECT message_id, COUNT(*) AS trace_count
  FROM deepchat_message_traces
  GROUP BY message_id
) t ON t.message_id = m.id
```

With the current in-memory SQLite schema and indexes, the previous query plan was:

```text
MATERIALIZE t
SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq
SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?)
SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
```

Reading any session therefore scanned and aggregated the global trace table. The work grew with
all stored traces rather than the requested session history. P-01 could amplify this cost by
invoking the same rich history read more than once during a single send.

## Impact

- Runtime predicates, context assembly, compaction, and Tape maintenance pay for UI/debug metadata
  they do not consume.
- Main-process synchronous SQLite work grows with global trace retention and can delay unrelated
  windows and sessions.
- A small or fixed-size session becomes slower as traces accumulate in other sessions.
- Repeated runtime history reads multiply the same global aggregation cost.

## Root Cause

The base runtime history and the UI/debug history projection shared `getBySession()` and
`DeepChatMessageStore.getMessages()`. `traceCount` belongs to the UI/debug projection, but the
shared rich read made it an implicit dependency of runtime history.

The available trace indexes do not make the current global aggregation session-bounded:

- `idx_trace_message_seq (message_id, request_seq DESC)`
- `idx_trace_session_time (session_id, created_at DESC)`

`listPageBySession()` already demonstrates the intended UI behavior: it computes trace counts per
selected message with an indexable correlated count.

## Fix Plan

1. Make `DeepChatMessagesTable.getBySession()` and `get()` the base full-session and single-message
   reads, with no access to `deepchat_message_traces`.
2. Keep trace counts in explicit UI/debug projections only:
   - `listPageBySession()` continues to use the correlated `message_id` count.
   - Trace diagnostics continue to use `listByMessageId()` and `countByMessageId()`.
3. Treat `DeepChatMessageStore.getMessages()` and `getMessage()` as trace-free runtime reads.
   Runtime records expose the existing neutral `traceCount` default, but runtime behavior must not
   depend on it.
4. Audit and keep runtime predicates, context/resume assembly, compaction, truncation/rewind, and
   Tape backfill/fact maintenance on the trace-free history path.
5. Keep renderer history restore and pagination on `listMessagesPage()` so trace dialog metadata
   remains available without restoring a global rich history model.
6. Do not add a new index, rich single-message method, or boolean `includeTraceCount` switch unless
   measurements show the existing paged projection and trace diagnostics are insufficient.

## Compatibility and Constraints

- No schema migration is required.
- No renderer, preload, IPC, or persisted message contract change is required.
- Paged UI/debug history must continue to report the exact trace count for each returned message.
- Context selection, pending-interaction guards, compaction, export, search, Tape backfill, delete,
  truncate, rewind, and fork behavior must remain unchanged apart from no longer loading trace
  counts on full-session reads.
- This issue does not remove trace capture, trace retention, or the trace dialog.
- This issue does not solve P-01's duplicate history reads; it removes the global trace-table cost
  from each runtime read so P-01 can be addressed independently.

## Acceptance Criteria

- `getBySession(sessionId)` does not reference `deepchat_message_traces` and uses
  `idx_deepchat_messages_session` for the requested session.
- Runtime predicate, context/resume, compaction, Tape, and operational single-message paths do not
  execute trace-count queries.
- `listPageBySession()` still returns correct `trace_count` values, and explicit trace diagnostics
  still return the requested message's trace rows and count.
- For a target session fixed at 1,000 messages, `getBySession()` work and latency remain effectively
  flat when unrelated global traces increase from 0 to 10,000 to 100,000 rows.
- The query plan for `getBySession()` contains neither `MATERIALIZE` nor a scan/search of
  `deepchat_message_traces`.
- Existing message ordering and structured-content materialization remain unchanged.

## Validation

### Correctness

- Add a native SQLite table test proving `getBySession()` returns only the requested session in
  ascending `order_seq` and `get()` returns one base row without requiring the trace table.
- Add or update message-store tests proving full-session and single-message runtime records
  materialize content correctly without a loaded trace count.
- Retain coverage that the paged projection returns exact per-message counts.
- Exercise representative context, pending-interaction, compaction, Tape, truncate/rewind, export,
  and search callers to catch accidental reliance on `traceCount`.

### Query Plan

Run `EXPLAIN QUERY PLAN` for the final full-session query and assert:

```text
SEARCH deepchat_messages USING INDEX idx_deepchat_messages_session (session_id=?)
```

Reject plans that mention `deepchat_message_traces` or `MATERIALIZE`.

### Scale Benchmark

Use an in-memory native SQLite database with the production schema:

| Target messages | Unrelated global traces | Warmed median | Ratio to 0 traces |
| ---: | ---: | ---: | ---: |
| 1,000 | 0 | 0.287 ms | 1.000x |
| 1,000 | 10,000 | 0.300 ms | 1.045x |
| 1,000 | 100,000 | 0.275 ms | 0.959x |

Insert global traces outside the target session, warm the prepared query, and compare multiple
iterations by median rather than a single wall-clock sample. Use the query-plan assertion as the
deterministic regression gate; report the three timings and use their ratio as supporting evidence
instead of an environment-specific absolute millisecond threshold. The recorded values above are
from an Electron ABI 143 native SQLite run and serve as supporting evidence; the query-plan check
is the deterministic gate.

### Results

- Node typecheck passed.
- Focused message-store/runtime tests passed: 214 tests, with 4 native-ABI skips covered by the
  Electron-native run.
- Context, compaction, and Tape tests passed: 108 tests, with 10 unrelated native-feature skips.
- Electron-native correctness and query-plan tests passed: 5 tests.
- Electron-native scale benchmark passed: 1 test.
- The repository-wide main suite completed with 3,359 passing tests and 6 failures in untouched
  debug-fixture and agent-session integration tests.
- Formatting, i18n validation, and lint passed.

## Tasks

- [x] Remove trace aggregation from `DeepChatMessagesTable.getBySession()` and `get()`.
- [x] Audit every full-history and operational single-message caller.
- [x] Keep UI/debug trace counts on paged projection and explicit trace diagnostics.
- [x] Add correctness and query-plan regression tests.
- [x] Add the 0/10k/100k unrelated-trace scale benchmark for a fixed 1k-message session.
- [x] Run focused main-process tests and the performance test.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.

## Open Questions

None.
