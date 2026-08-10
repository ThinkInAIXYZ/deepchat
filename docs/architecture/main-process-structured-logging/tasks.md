# Task Checklist

- [ ] Define the typed Main event catalog, strict runtime projectors, safe primitive bounds, error
      categories, JSONL envelope, and focused pure tests.
- [ ] Implement the Main JSONL adapter with fixed console projection, synchronous persistence,
      unknown/enabled/disabled state, bounded startup buffering, record-size enforcement, safe
      rotation, incomplete-tail repair, and failure isolation.
- [ ] Add Main logger path/transport tests for profile resolution, setting gates, one-line JSON,
      archive validity, rotation failures, and untouched historical `main.log`.
- [ ] Audit and classify app/bootstrap, database, scheduler, watcher, updater, window, knowledge,
      memory, remote, and MCP Main logs; remove content-bearing and high-frequency persistence while
      retaining required lifecycle/degradation/terminal events.
- [ ] Audit and classify Agent, ACP, Provider, Tool, Orchestration, and Tape logs; remove prompt,
      protocol, PTY, command, provider body, tool payload, environment, path, and raw error logging.
- [ ] Replace runtime generic Error redaction with operation-owned safe categories/codes and add
      privacy regression tests using secret-bearing third-party-style Error objects.
- [ ] Add Agent admission wait/hold timing, bounded distributions, correlation context, close
      summary, richer snapshot, observer failure isolation, and race/fairness tests.
- [ ] Add payload-free Run, Turn, child Session, Delegation, suspend/resume, settlement, recovery,
      stale-result, and quarantine events at existing ownership boundaries.
- [ ] Migrate retained persistent call sites to typed events; leave safe development-only diagnostics
      on native console and aggregate or remove non-actionable logs.
- [ ] Atomically cut over to `logs/main.jsonl`: remove global console interception, variadic logger,
      direct business imports of `electron-log`, and the old Main file transport path.
- [ ] Add source-boundary guards for the single transport owner and absence of persistent variadic
      APIs or console interception.
- [ ] Update `LoggingService`, startup setting application, test mocks, maintained profile-path
      contract, renderer performance references, and validation documentation.
- [ ] Before every commit, review the staged diff for side effects, compatibility, edge cases,
      performance, security, naming, tests, and maintenance cost; rank and fix confirmed findings,
      then run focused validation.
- [ ] Run final format, i18n, lint, node/web typecheck, Main tests, and any touched native/renderer/E2E
      suites; document any environment blocker honestly.
- [ ] Confirm no remote Git operation was performed.
