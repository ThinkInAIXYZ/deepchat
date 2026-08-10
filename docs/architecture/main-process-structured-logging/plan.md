# Implementation Plan

## Architecture

```text
Main business owner
  └─ emit(eventName, typed context)
       └─ event-specific projector
            ├─ fixed severity
            ├─ strict allowlist and bounds
            └─ safe error classification
                 └─ Main JSONL adapter
                      ├─ unknown: bounded memory buffer
                      ├─ disabled: no-op
                      ├─ enabled: synchronous electron-log file transport
                      └─ development console: fixed human-readable projection
```

The implementation replaces the current shared variadic logger and global console interception. It
does not add a second persisted Agent log or a released dual-write stage.

## 1. Typed Event Catalog

Add a Main-owned event catalog with:

- a closed event-name map;
- an event-specific TypeScript context for each name;
- a fixed severity and component description;
- a runtime projector that constructs a new output object from allowed fields only;
- shared bounded primitive helpers for identifiers, counts, durations, enums, and safe error codes.

The emitter accepts only a catalog event and its matching context. It has no free-form message,
unknown metadata, generic `Record<string, unknown>`, or variadic overload.

Pure tests cover projection, unknown-field removal, invalid numbers, oversized strings, control
characters, prohibited secret sentinels, and maximum encoded size.

## 2. Main JSONL Adapter

Replace `src/shared/logger.ts` with Main-owned logger modules under `src/main/app` after call-site
migration. The final adapter:

- is the only importer of `electron-log`;
- creates `MainLogRecordV1` with ISO timestamp, monotonic sequence, process UUID, app version, fixed
  event severity, and projected context;
- returns one pre-serialized JSON string to the file formatter;
- keeps console rendering separate and human-readable;
- never invokes an arbitrary object's getter, iterator, `toJSON`, or serializer;
- keeps file writes synchronous;
- starts with file transport disabled;
- owns the bounded startup buffer, oldest-record eviction, dropped-count summary, and persistence-state
  transition;
- provides a non-throwing setting gate used by Main startup and `LoggingService`;
- provides safe archive rotation and incomplete-tail repair;
- rate-limits logger-internal native-console warnings.

The adapter resolves `app.getPath('userData')` only when persistence is enabled, after explicit
profile selection has run.

## 3. Call-Site Classification And Privacy Audit

Audit Main call sites by subsystem. Every current persisted `logger.*`, intercepted `console.*`, and
direct `electron-log` call is assigned one final disposition:

1. typed persisted event;
2. safe development-only native console output;
3. aggregate/rate-limited event;
4. removal.

Prioritize removal or replacement of known high-risk paths:

- raw MCP stderr and protocol payloads;
- ACP PTY/protocol/update payloads and process environment/path dumps;
- provider request/response bodies, stream chunks, prompt/messages, and raw error payloads;
- OAuth callback/authorization URLs, code, state, and credential diagnostics;
- SQL/params and user content in database diagnostics;
- remote attachment URLs and message metadata;
- Calendar search terms/event titles;
- shell command/arguments, tool raw input/output, and absolute paths;
- whole Electron window/native object dumps.

Normal high-frequency window, queue, refresh, chunk, retry, and capability logs are removed,
converted to safe console debug output, or aggregated. State transitions, final failures, recovery,
degradation and restoration remain persisted.

Each subsystem audit lands as a reviewable commit with focused tests where a security or observable
contract changes.

## 4. Error Classification

Replace generic Error serialization and the current `{ name: 'Error' }` runtime projection with
operation-owned safe classification:

- known error classes map to stable categories and bounded codes;
- arbitrary Error properties, messages, response payloads, URLs, causes, and stacks are not copied;
- only fatal process events may project bounded application stack frames after removing the
  message-bearing line and absolute paths;
- worker/utility boundaries send typed safe error categories rather than arbitrary Error objects.

Tests include third-party-style errors carrying secret sentinels in message, cause, headers,
response body, request config, and enumerable fields.

## 5. Agent Admission Diagnostics

Extend `AgentInvocationAdmission` with an optional, fail-open typed observer and monotonic clock.
Callers pass an explicit correlation object instead of encoding identity inside `ownerId`.

The implementation records:

- queue entry and current queue/active counts;
- each grant wait interval;
- each active hold interval and release reason;
- queue-full, abort, close and cancellation outcomes;
- bounded wait/hold samples and high-water marks in the snapshot;
- one close summary event.

The observer is called after or around accounting boundaries so an observation failure cannot alter
the permit state. Tests use an injected clock and throwing observer to prove behavioral isolation.

## 6. Run And Delegation Events

Instrument existing ownership boundaries rather than provider content paths:

- Loop Run creation after `run_started` commit;
- Run terminal selection after the durable terminal fact and before/after safe projection as defined
  by the Journal contract;
- delegation turn queue, child bind, handoff acceptance, suspend/resume, terminal settlement,
  reconciliation terminal, stale-result rejection, and quarantine;
- child Session and Loop Run correlation only after those identities exist.

Durations use monotonic timestamps already owned by the relevant Run/turn or a local injected clock.
No title, prompt, handoff, answer, result summary, error text, Tape payload, or tool content is logged.

## 7. Atomic Cutover

Once all persistent call sites use the typed API:

- remove the global console hook;
- remove the variadic logger façade;
- migrate fatal process handlers and the remaining direct `electron-log` imports;
- move logger ownership from `src/shared` to Main;
- switch the active path to `logs/main.jsonl`;
- add a source-boundary guard allowing `electron-log` only in the adapter;
- update test setup mocks to the typed API;
- update the maintained user-data profile contract and renderer performance references.

Intermediate branch commits may retain the old logger while event definitions and call sites are
migrated, but no commit writes both files and no released final state contains compatibility APIs.

## 8. Validation Strategy

### Pure logger tests

- every event projects the required envelope and fixed severity;
- unknown/prohibited fields and secret sentinels are absent;
- sequence/order is stable across startup buffering;
- invalid/oversized events fail safely;
- maximum line size and physical one-line behavior;
- safe error classification and fatal stack projection.

### File transport tests

- enabled/disabled/unknown states;
- explicit and default profile paths;
- `main.jsonl` and `main.old.jsonl` naming;
- active/archive files parse line-by-line;
- incomplete-tail repair;
- unlink/rename/write failures disable persistence without throwing;
- rotation never writes crop markers or partial records;
- legacy `main.log` is not touched.

### Agent tests

- immediate and queued permits;
- per-owner fairness remains unchanged;
- queue full, abort races, close, suspend/resume and duplicate release;
- wait/hold intervals and bounded p50/p95/max;
- observer failure isolation;
- Run and delegation lifecycle ordering and correlation;
- no payload fields in emitted events.

### Repository guards

- only the adapter imports `electron-log`;
- no Main persistent variadic logger remains;
- no global console interception remains;
- high-risk payload logging patterns have focused regression coverage or source guards where useful.

### Commands

Use the smallest focused suites for each commit. Before handoff run:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
```

Run broader native, renderer, or E2E suites only when their contracts are touched.

## Commit And Review Strategy

Each commit is behaviorally coherent and includes its tests. Before every commit:

1. inspect the full staged diff;
2. review hidden side effects and behavioral compatibility;
3. review edge cases and failure isolation;
4. review event-loop, allocation, sync-I/O, and log-volume performance;
5. review privacy and security boundaries;
6. review naming for semantic accuracy;
7. review test gaps and future maintenance cost;
8. rank findings by severity, fix confirmed issues, rerun focused validation, then commit with a
   concrete Conventional Commit message.

No commit message describes work as a generic review fix. No remote Git operation is performed.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Typed-looking generic metadata reintroduces payload logging | No free-form message/metadata/record context; event-specific projectors construct output fields |
| Important diagnostics disappear when console interception is removed | Complete subsystem classification before cutover; acceptance event inventory and focused lifecycle tests |
| Synchronous JSONL harms Main responsiveness | Persist only low-volume events, cap records at 16 KiB, prohibit events in chunk/protocol loops, benchmark formatter and representative bursts |
| Error text leaks user/provider content | Persist categories/codes only; crash stack removes message and absolute paths |
| Early startup writes despite logging being disabled | Initial disabled transport plus bounded unknown-state buffer |
| Rotation corrupts JSONL | Whole-file rename only; no crop fallback; line cap, tail repair, parse tests |
| Admission instrumentation changes fairness or leaks permits | Fail-open observer, monotonic injected clock, accounting/race regression tests |
| Event catalog becomes unmaintainable | Small owner-based catalog, fixed naming rules, expected-frequency documentation, no one-use event variants |
| Historical logs are lost or destructively changed | Leave old `main.log` untouched; new process writes only `main.jsonl` |
