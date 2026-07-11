# History Read Model Baseline Results

- Commit: `e16b00c403190d72aa791bf86312b12434b25cef`
- Worktree: `clean`
- Generated: `2026-07-11T09:09:36.822Z`
- Runtime: Node `v24.15.0`, Electron `40.10.5`, ABI `143`, SQLite `3.53.0`, better-sqlite3-multiple-ciphers `12.9.0`
- Host: `darwin 25.5.0 arm64`, `Apple M5`, 10 logical CPUs
- Fixture: seed `history-read-v1`, 1 warmup + 5 measured samples

| Messages | Global traces | getMessages median / p95 | SQL statements median / p95 | Header rows median / p95 | Structured total median / p95 | User; file; link; assistant median / p95 | SQL ms median / p95 | Materialization ms median / p95 | Provider-start ms median / p95 | Event-loop delay ms median / p95 (censored) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 0 | 8 / 8 | 120 / 120 | 80 / 80 | 80 / 80 | 40 / 40; 0 / 0; 0 / 0; 40 / 40 | 0.824 / 0.869 | 0.116 / 0.138 | 2.335 / 2.801 | n/a / n/a (5/5) |
| 10 | 10000 | 8 / 8 | 120 / 120 | 80 / 80 | 80 / 80 | 40 / 40; 0 / 0; 0 / 0; 40 / 40 | 2.237 / 2.311 | 0.089 / 0.112 | 3.458 / 3.837 | n/a / n/a (5/5) |
| 10 | 100000 | 8 / 8 | 120 / 120 | 80 / 80 | 80 / 80 | 40 / 40; 0 / 0; 0 / 0; 40 / 40 | 14.614 / 15.135 | 0.105 / 0.107 | 15.889 / 16.502 | n/a / n/a (5/5) |
| 100 | 0 | 8 / 8 | 840 / 840 | 800 / 800 | 800 / 800 | 400 / 400; 0 / 0; 0 / 0; 400 / 400 | 4.646 / 5.342 | 0.693 / 0.900 | 9.226 / 10.807 | n/a / n/a (5/5) |
| 100 | 10000 | 8 / 8 | 840 / 840 | 800 / 800 | 800 / 800 | 400 / 400; 0 / 0; 0 / 0; 400 / 400 | 6.230 / 6.310 | 0.747 / 1.010 | 10.789 / 11.189 | n/a / n/a (5/5) |
| 100 | 100000 | 8 / 8 | 840 / 840 | 800 / 800 | 800 / 800 | 400 / 400; 0 / 0; 0 / 0; 400 / 400 | 18.300 / 18.374 | 0.654 / 0.721 | 22.401 / 22.618 | n/a / n/a (5/5) |
| 1000 | 0 | 8 / 8 | 8040 / 8040 | 8000 / 8000 | 8000 / 8000 | 4000 / 4000; 0 / 0; 0 / 0; 4000 / 4000 | 44.465 / 52.780 | 6.680 / 16.018 | 90.155 / 92.464 | n/a / n/a (5/5) |
| 1000 | 10000 | 8 / 8 | 8040 / 8040 | 8000 / 8000 | 8000 / 8000 | 4000 / 4000; 0 / 0; 0 / 0; 4000 / 4000 | 44.777 / 51.705 | 6.374 / 13.053 | 87.630 / 90.247 | n/a / n/a (5/5) |
| 1000 | 100000 | 8 / 8 | 8040 / 8040 | 8000 / 8000 | 8000 / 8000 | 4000 / 4000; 0 / 0; 0 / 0; 4000 / 4000 | 57.734 / 69.821 | 6.442 / 6.791 | 101.546 / 106.345 | n/a / n/a (5/5) |
| 10000 | 0 | 8 / 8 | 80040 / 80040 | 80000 / 80000 | 80000 / 80000 | 40000 / 40000; 0 / 0; 0 / 0; 40000 / 40000 | 512.728 / 526.647 | 94.339 / 113.248 | 933.941 / 941.965 | n/a / n/a (5/5) |
| 10000 | 10000 | 8 / 8 | 80040 / 80040 | 80000 / 80000 | 80000 / 80000 | 40000 / 40000; 0 / 0; 0 / 0; 40000 / 40000 | 512.091 / 518.333 | 95.507 / 107.211 | 930.582 / 945.512 | n/a / n/a (5/5) |
| 10000 | 100000 | 8 / 8 | 80040 / 80040 | 80000 / 80000 | 80000 / 80000 | 40000 / 40000; 0 / 0; 0 / 0; 40000 / 40000 | 529.244 / 554.301 | 110.796 / 154.993 | 974.807 / 1037.528 | n/a / n/a (5/5) |

## Findings

- Every measured send performed `8` complete history reads before the first provider call.
- The 10-message/0-trace scenario executed a median of `120` history SQL statements; the 10,000-message/0-trace scenario executed `80040`.
- The real table wrappers observed five batch table calls per complete read plus two empty file/link fallback calls per user message. With the alternating fixture, that is an observed N+1 statement shape per read, not a constant inferred by the renderer.
- For 10 target messages, raising global trace noise from 0 to 100,000 increased median history SQL time from `0.824ms` to `14.614ms`.
- For 10,000 target messages, median provider-start time increased from about `0.93s` at 0 traces to `0.97s` at 100,000 traces. These wall-clock values describe this host only and are not a cross-device performance forecast.
- All `60/60` event-loop probes were censored before firing, so this baseline makes no event-loop delay or CPU claim.

## Go / No-go

| Follow-up | Decision | Evidence gate |
| --- | --- | --- |
| `HIS-002` | `GO` | The non-empty `hadMessages` path performs a complete history materialization. |
| `HIS-003` | `GO` | Real query plans aggregate global traces and trace noise has a repeatable local timing effect. |
| `HIS-004` | `NO-GO` | Keep the ordering gate until HIS-002 predicate and HIS-003 projection contracts are stable. |

## Query plan

- 10 messages / 0 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 10 messages / 10000 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 10 messages / 100000 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 100 messages / 0 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 100 messages / 10000 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 100 messages / 100000 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 1000 messages / 0 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 1000 messages / 10000 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 1000 messages / 100000 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 10000 messages / 0 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 10000 messages / 10000 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
- 10000 messages / 100000 traces; global trace aggregation: yes; MATERIALIZE t | SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq | SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?) | SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN

Raw measured samples are preserved in `raw.json`.
