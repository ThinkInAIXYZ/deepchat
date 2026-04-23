# E2E Smoke Regression Tasks

Feature: `e2e-smoke-regression`
Spec: [spec.md](./spec.md)
Plan: [plan.md](./plan.md)

## Readiness And Scope Decisions

- [x] `T0.1` Keep the spec package complete with `spec.md`, `plan.md`, and `tasks.md` under
  `docs/specs/e2e-smoke-regression/`.
  Owner: QA + E2E maintainer
  Effort: XS
  Status: Completed
  References: `spec.md` Status / In Scope, `plan.md` Planning Summary
- [x] `T0.2` Resolve the v1 scope decision: default `pnpm run e2e:smoke` covers `P0-01` through
  `P0-04`, while the live provider connectivity check stays opt-in rather than part of the
  default v1 smoke slice.
  Owner: QA + E2E maintainer
  Effort: XS
  Status: Completed
  References: `spec.md` Current Decision 9 / Test Scope / Discussion Defaults 5,
  `plan.md` Increment Plan / Provider And Model Assumptions
- [x] `T0.3` Confirm there are no remaining `[NEEDS CLARIFICATION]` markers in
  [spec.md](./spec.md) or [plan.md](./plan.md).
  Owner: QA + E2E maintainer
  Effort: XS
  Status: Completed
  References: `spec.md` Discussion Defaults, `plan.md` Planning Summary

## Epic E1 Runner, Fixture, And Safety Baseline

- [x] `T1.1` Add the Playwright Electron runner, `test/e2e` layout, and the single
  `pnpm run e2e:smoke` entrypoint.
  Owner: QA + Electron tooling
  Effort: M
  Status: Completed
  References: `spec.md` Current Decision 1-8 / In Scope / Acceptance Criteria,
  `plan.md` Proposed Architecture 1 / 8
- [x] `T1.2` Launch the built desktop app from repository build output without an isolated
  `userData` profile, mock backend, or E2E-only bootstrap branch.
  Owner: QA + Electron tooling
  Effort: S
  Status: Completed
  References: `spec.md` Current Decision 3-6 / Preconditions,
  `plan.md` Proposed Architecture 2 / 3
- [x] `T1.3` Keep fixture teardown safe across relaunches and setup failures so launched
  Electron processes are always tracked and closed.
  Owner: QA + Electron tooling
  Effort: S
  Status: Completed
  References: `spec.md` Acceptance Criteria / Preconditions,
  `plan.md` Proposed Architecture 8 / Risks And Mitigations Risk 6
- [x] `T1.4` Retain screenshot, video, trace, and renderer diagnostics for failed runs under
  `test-results/e2e`.
  Owner: QA + Electron tooling
  Effort: S
  Status: Completed
  References: `spec.md` User Stories / Acceptance Criteria,
  `plan.md` Proposed Architecture 1 / Validation Plan

## Epic E2 V1 Smoke Coverage

- [x] `T2.1` Implement `P0-01` launch coverage that waits for the main shell and sidebar to
  render without fatal startup failures.
  Owner: QA + Renderer
  Effort: S
  Status: Completed
  References: `spec.md` Test Scope `P0-01`,
  `plan.md` Proposed Architecture 9 / Risks And Mitigations Risk 6
- [x] `T2.2` Implement `P0-02` basic chat coverage that selects a usable agent/model, sends a
  real prompt, waits for generation start and completion, and asserts on a non-empty assistant
  reply.
  Owner: QA + Renderer
  Effort: M
  Status: Completed
  References: `spec.md` Goal / Acceptance Criteria / Test Scope `P0-02`,
  `plan.md` Proposed Architecture 4 / 5 / 7 / 9
- [x] `T2.3` Implement `P0-03` restart persistence coverage that relaunches the app and verifies
  the created smoke sessions remain visible and reopen correctly.
  Owner: QA + Renderer
  Effort: M
  Status: Completed
  References: `spec.md` Acceptance Criteria / Test Scope `P0-03`,
  `plan.md` Proposed Architecture 5 / Increment Plan
- [x] `T2.4` Implement `P0-04` settings navigation coverage that opens the real Settings window,
  switches core tabs, and returns control to the main chat flow.
  Owner: QA + Renderer
  Effort: M
  Status: Completed
  References: `spec.md` Acceptance Criteria / Test Scope `P0-04`,
  `plan.md` Proposed Architecture 7 / 9 / Increment Plan
- [x] `T2.5` Keep the live provider connectivity smoke check available only behind an explicit
  environment flag so default smoke runs do not require credentials or network-dependent
  integration assertions.
  Owner: QA + Provider integration
  Effort: XS
  Status: Completed
  References: `spec.md` Preconditions / Non-Goals / Deferred P1 Scenarios,
  `plan.md` Proposed Architecture 4 / Later Phases / Risks And Mitigations Risk 2 and Risk 4

## Epic E3 Helper Stability And Documentation

- [x] `T3.1` Use stable selectors and exact selected-state attributes for agent/model selection
  instead of substring text matching.
  Owner: QA + Renderer
  Effort: S
  Status: Completed
  References: `spec.md` In Scope / Acceptance Criteria,
  `plan.md` Proposed Architecture 7 / Risks And Mitigations Risk 3
- [x] `T3.2` Make generation waiting lifecycle-aware by observing both the transition to
  `data-generating="true"` and the return to idle.
  Owner: QA + Renderer
  Effort: XS
  Status: Completed
  References: `spec.md` Acceptance Criteria,
  `plan.md` Proposed Architecture 5 / Risks And Mitigations Risk 4
- [x] `T3.3` Keep the E2E README environment-agnostic with repo-relative links and explicit notes
  about the opt-in provider connectivity check.
  Owner: QA + Documentation
  Effort: XS
  Status: Completed
  References: `spec.md` In Scope / Preconditions / Acceptance Criteria,
  `plan.md` Proposed Architecture 3 / Validation Plan

## Epic E4 Validation

- [x] `T4.1` Run repository quality gates after E2E smoke maintenance updates:
  `pnpm run format`, `pnpm run i18n`, `pnpm run lint`.
  Owner: QA + E2E maintainer
  Effort: XS
  Status: Completed
  References: `plan.md` Validation Plan
- [ ] `T4.2` Run `pnpm run build` and `pnpm run e2e:smoke` in a configured local profile to
  validate the manual smoke flow end to end.
  Owner: QA / local operator
  Effort: M
  Status: Pending operator run
  References: `spec.md` Acceptance Criteria / Preconditions,
  `plan.md` Validation Plan
