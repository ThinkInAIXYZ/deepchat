# Task Checklist

- [x] Define the typed Main event catalog, strict runtime projectors, safe primitive bounds, error
      categories, JSONL envelope, and focused pure tests.
- [x] Implement the Main JSONL adapter with fixed console projection, synchronous persistence,
      unknown/enabled/disabled state, bounded startup buffering, record-size enforcement, safe
      rotation, incomplete-tail repair, and failure isolation.
- [x] Add Main logger path/transport tests for profile resolution, setting gates, one-line JSON,
      archive validity, rotation failures, and untouched historical `main.log`.
- [x] Audit and classify app/bootstrap, database, scheduler, watcher, updater, window, knowledge,
      memory, remote, and MCP Main logs; exclude content-bearing and high-frequency diagnostics from
      persistence while retaining required lifecycle/degradation/terminal events.
- [x] Audit and classify Agent, ACP, Provider, Tool, Orchestration, and Tape logs; exclude prompt,
      protocol, PTY, command, provider body, tool payload, environment, path, and raw errors from the
      persistent transport.
- [x] Replace runtime generic Error redaction with operation-owned safe categories and add
      privacy regression tests using secret-bearing third-party-style Error objects.
- [x] Add Agent admission wait/hold timing, bounded distributions, correlation context, close
      summary, richer snapshot, observer failure isolation, and race/fairness tests.
- [x] Share the bounded asynchronous admission/delegation observation queue and skip queue insertion
      and event-loop scheduling while all diagnostic output is disabled.
- [x] Fingerprint unsafe opaque Session and Message correlation IDs without changing durable
      imported business identifiers.
- [x] Avoid false updater-operation attribution during overlapping phases and contain delayed
      normal-restart failures.
- [x] Add payload-free Run, Turn, child Session, Delegation, suspend/resume, settlement, recovery,
      stale-result, and quarantine events at existing ownership boundaries.
- [x] Migrate retained persistent call sites to typed events; leave legacy diagnostics on the
      non-persistent native console and aggregate or exclude non-actionable persistent logs.
- [x] Atomically cut over to `logs/main.jsonl`: remove global console interception, disconnect the
      variadic compatibility logger from persistence, remove direct business imports of
      `electron-log`, and remove the old Main file transport path.
- [x] Add source-boundary guards for the single transport owner and absence of persistent variadic
      APIs or console interception.
- [x] Update `LoggingService`, startup setting application, test mocks, maintained profile-path
      contract, renderer performance references, and validation documentation.
- [x] Before every commit, review the staged diff for side effects, compatibility, edge cases,
      performance, security, naming, tests, and maintenance cost; rank and fix confirmed findings,
      then run focused validation.
- [x] Run final format, i18n, lint, node/web typecheck, Main tests, and any touched native/renderer/E2E
      suites; document any environment blocker honestly.
- [x] Confirm no remote Git operation was performed.

## Completion evidence

- `pnpm run format:check`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck:node`,
  `pnpm run typecheck:web`, and `pnpm run build` passed.
- `pnpm run test:main` passed 552 test files and 6,802 tests; 29 files were skipped entirely and 403
  tests were skipped in total. Of those tests, 399 were blocked because the installed native SQLite
  module targets Node ABI 145 while the active Node runtime requires ABI 137; this includes all 56
  `liveDelegationService` tests. The remaining four skips require an unavailable DuckDB VSS
  extension or Windows.
- The focused Electron launch smoke test passed against the built application.
- No remote Git operation was performed.
