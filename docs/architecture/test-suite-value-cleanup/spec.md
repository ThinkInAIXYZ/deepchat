# Test Suite Value Cleanup

## Status

Complete

## Context

The repository has a large automated test suite. A small number of tests do not
exercise behavior, cannot fail when the claimed capability regresses, or duplicate
stronger protection in the same suite. Removing tests based only on implementation
coupling, mocks, or private access would discard useful regression protection, so
cleanup must be evidence-driven.

## Baseline

- 709 executable test files were inventoried: 703 `*.test.*`/`*.spec.*`
  files plus six memory performance suites.
- Main suite: 5,574 tests, 5,299 passed and 275 environment-gated tests skipped.
- Renderer suite: 1,596 tests passed with no skips.
- No focused `.only` tests, Vitest snapshots, or inline snapshots were found.
- Native SQLite/VSS, provider integration, and git-dependent skips are intentional
  environment gates rather than dead tests.

## Goal

Remove tests that provide no independent failure signal and strengthen weak tests
when they are the only protection for a user-visible or documented capability.

## Acceptance Criteria

1. Every test file, test configuration, and CI test entry point is included in the
   inventory.
2. A test is deleted only when it is vacuous, dead, or fully redundant with named
   retained coverage.
3. Weak assertions are replaced when the claimed behavior remains valuable.
4. Intentional environment-gated tests remain available in supported environments.
5. Production behavior and public interfaces do not change.
6. Main and renderer suites pass after cleanup.
7. Formatting, i18n validation, lint, and type checking pass.

## Deletion Rules

A test may be deleted when at least one of these conditions is proven:

- It has no assertion or observable failure path.
- It asserts only that the subject was constructed or that declared methods exist,
  while behavioral tests already exercise the same subject.
- Its assertion does not depend on the values or operation named by the test.
- A stronger test in the same boundary detects every regression the candidate can
  detect.

Mocks, private access, a duplicate title, or low line coverage are not sufficient
deletion evidence on their own.

## Retained Protection

| Candidate | Decision | Retained or replacement protection |
| --- | --- | --- |
| Unknown skill format conversion | Delete | No stable capability is claimed; the test has no assertion. |
| File adapter filtering loops | Delete | Exact supported extensions/MIME types and public validation behavior remain covered. |
| File service constructor/method existence | Delete | Public validation and fallback behavior exercise both dependency paths. |
| Knowledge service method existence | Delete | The same suite exercises validation, listing, add, and delete behavior. |
| Test-state isolation check | Delete | Model configuration persistence and reset behavior are already covered directly. |
| Ambiguous model priority cases | Consolidate | A synthetic Provider DB fixture now proves provider, user override, and reset priority exactly. |
| Skill folder tree non-negative length | Replace | Assert the exact `SKILL.md` tree node returned from the fixture. |
| Built-in skill adapter registry boilerplate | Consolidate | Assert the complete built-in adapter ID set plus lookup behavior. |
| Provider tests that swallow stream errors | Replace | Consume the mocked stream without an empty catch so unexpected failures surface. |
| Provider runtime teardown sleep | Replace | Await the runtime's public `shutdown` lifecycle instead of sleeping after every test. |
| Mermaid component fixed sleeps | Replace | Await Vue and mocked Mermaid promises directly with `flushPromises`. |
| Telegram fatal-path sleep | Replace | Poll the complete observable failure contract with `vi.waitFor`. |

## Non-Goals

- Rewriting the test framework or shared fixture architecture.
- Deleting tests merely because they use mocks or implementation details.
- Changing product code to make cleanup metrics look better.
- Running live-provider or packaged Electron end-to-end tests without their required
  external environment.
- Treating test count or coverage percentage as the primary quality measure.

## Compatibility

This change is limited to tests and architecture documentation. It does not alter
runtime data, APIs, migrations, packaging, or user-facing behavior.

## Validation Result

- Main suite: 5,545 tests, 5,270 passed and 275 environment-gated tests skipped.
- Renderer suite: 1,596 tests passed.
- Focused memory behavior gate: 873 tests passed.
- Native memory gate: 104 tests passed and 186 environment-gated tests skipped.
- Memory evaluation gate: six tests passed and one environment-gated test skipped.
- Memory performance suites: four passed and six native-SQLite cases skipped.
- Playwright discovered all 31 smoke specifications.
- The main suite has 29 fewer cases while preserving the documented contracts.
- Provider runtime test execution fell from about 2.33 seconds to 66 milliseconds.
- Mermaid artifact test execution fell from about 622 milliseconds to 21 milliseconds.
