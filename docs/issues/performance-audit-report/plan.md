# Plan

## Investigation Approach

1. Inventory E2E coverage and launch/close fixture behavior.
2. Run build/preflight needed by E2E, then execute smoke coverage with repeated launch/close focus.
3. Run targeted E2E specs that exercise Settings, provider navigation, browser route, agent CRUD, workspace watcher, and route restore.
4. Inspect main-process startup/shutdown code paths, including app bootstrap, presenters, plugin/MCP/runtime startup, database initialization, watchers, and cleanup.
5. Inspect renderer hot paths covered by E2E: app mount, chat/session list, settings routes, workspace watcher UI, markdown/message rendering, virtual lists, and event subscriptions.
6. Correlate dynamic evidence with static code findings; only promote a risk to the report when the code path and trigger path are concrete.

## Evidence Rules

- Dynamic evidence: command output, E2E pass/fail, durations, logs, trace attachments when available.
- Static evidence: exact file and line numbers from current worktree, plus a logical explanation of why that code can be hot or lifecycle-sensitive.
- No item may be included as a firm finding without code evidence.
- If a suspected risk cannot be dynamically reproduced within the available environment, classify it as static-audit risk and state the missing runtime evidence.

## Commands / Validation

- `pnpm run build` if required for E2E target freshness.
- `pnpm run e2e:smoke:ci` for non-provider launch/settings smoke coverage.
- Targeted `playwright test -c test/e2e/playwright.config.ts ...` commands for route/function slices as needed.
- Optional repeated launch spec loop using Playwright CLI `--repeat-each` where safe.
- Read generated `test-results/e2e` and logs without exposing secrets.

## Report Shape

`report.md` sections:

1. Scope and methodology
2. E2E/runtime validation summary
3. High-confidence performance findings
4. Static-audit risks needing targeted profiling
5. Non-findings / areas checked without actionable risk
6. Prioritized optimization roadmap
7. Evidence appendix with commands and file references

## Risks

- Full smoke may require provider credentials for chat/provider tests; use CI smoke and targeted readonly specs when credentials are unavailable.
- Build may refresh generated provider/ACP registry files; if this happens, record but do not include unrelated changes in report unless needed.
- E2E runtime can be long; prefer focused repeated specs after initial broad run.
