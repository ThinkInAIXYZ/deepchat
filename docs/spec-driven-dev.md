# Specification-Driven Development for DeepChat

## Core Philosophy

Specification-Driven Development (SDD) makes the specification the primary artifact. Specifications
do not serve code; code serves specifications. For substantial DeepChat work, the specification is
an RFC that defines the problem, required behavior, design decisions, invariants, and implementation
constraints before execution begins.

The spec is the durable source of truth. The plan is the single live execution tracker. Tests are
one validation mechanism and a form of regression protection; they do not drive implementation by
default. Use SDD for substantial work that needs shared context or a durable decision record, not
for every small edit. Keep spec → plan → code traceability without duplicating the same design or
status across files.

## Required Artifacts

Keep substantial active changes in a lightweight SDD folder so reviewers can find the intent without
hunting through code. Use one kebab-case folder per goal when SDD is needed:

- `docs/features/<goal>/` - new features, user-visible capabilities, integrations, and tools large
  enough to need a shared plan
- `docs/issues/<goal>/` - complex bug fixes, regressions, failing tests, CI failures, reliability
  issues, and prompt/runtime problems
- `docs/architecture/<goal>/` - refactors, migrations, dependency boundaries, shared contracts, runtime architecture, and cross-module design

Skip SDD unless a developer explicitly asks for it when the change is trivial or tightly localized:

- visual/style fixes, copy changes, and small UI layout adjustments
- simple localized logic changes with a clear owner module
- routine docs edits that do not change project direction

Pure release metadata work is exempt from SDD. Version bumps, `CHANGELOG.md` updates, release branch
management, tags, and release PR preparation should follow `docs/release-flow.md` without creating a
release-specific SDD folder.

Feature and architecture goals use two artifacts:

- `spec.md` - the RFC: context, goals, non-goals, design, invariants, interfaces, compatibility,
  acceptance criteria, and open questions
- `plan.md` - the ordered implementation steps and their live completion state, including final
  review, validation decisions, cleanup, and quality gates

Do not create `tasks.md`. The plan is the only execution tracker.

Complex bug goals normally use one file:

- `spec.md` - issue description, impact, root cause or suspected location, fix design, a concise
  implementation checklist, validation outcome, and linked GitHub issue if one exists

Add `plan.md` to a complex bug only when the implementation has multiple independently trackable
slices. Use the same artifact boundaries as feature and architecture work, and never add
`tasks.md`.

A bug is SDD-worthy only when the root cause, blast radius, or fix path is complex enough that
future developers benefit from the written record. For simple style defects or obvious local logic
fixes, skip `docs/issues/*` and implement directly.

If a bug fix introduces a new user-visible capability, data migration, public contract, or
cross-module redesign, classify the work as feature or architecture instead.

If a change is tiny, prefer skipping SDD over creating a token artifact.

## Artifact Responsibilities

### Specification

Write `spec.md` as the normative RFC. It should explain enough of the implementation direction that
a capable developer can make local coding decisions without inventing architecture. Include only
sections that carry real information, chosen from:

- context and problem
- goals and non-goals
- current and proposed design
- ownership, dependency direction, interfaces, and data flow
- invariants, failure behavior, compatibility, and migration
- security, privacy, and performance constraints
- acceptance criteria, open questions, and rejected alternatives

Acceptance criteria describe observable outcomes or independently verifiable contracts. They are
not a test-case inventory. Keep file-by-file work, status checkboxes, and command transcripts out of
the spec.

### Implementation Plan

Use `plan.md` as both the implementation plan and task tracker. Organize it into ordered checkbox
sections. Each step should be a coherent, reviewable implementation slice with its objective,
ownership boundary, essential implementation guidance, dependencies when any, and completion
condition.

Reference the spec instead of repeating its design. Do not split individual functions, files, or
tests into bookkeeping tasks unless they are independently meaningful deliverables. End the plan
with whole-change review, validation selection, temporary-verification cleanup, and required
quality gates.

## GitHub Issue Sync

Do not sync GitHub issues by default. Issue sync is a follow-up record, not a gate for local SDD or
implementation.

Only create or link a GitHub issue when the developer explicitly asks, or after asking and getting
approval once the SDD artifacts are written or the implementation is complete.

Eligible work:

- Complex bugs only; simple style defects and obvious local logic fixes should not get issues.
- Whole new features or major feature rewrites only; single actions, small behavior tweaks, and
  ordinary adjustments should not get issues.

If eligibility is unclear, ask the developer after the work is understood. Never self-authorize issue
creation just because local `gh` is installed and authenticated.

When approved:

- Feature work uses the `[feature]` label.
- Bug work uses the `[bug]` label.
- If the label is missing and `gh` has permission, create it.
- Record the issue URL or number in the SDD artifact.
- If `gh` is unavailable or unauthorized, continue local-only and note that no GitHub issue was
  created only when sync was requested or approved.

When opening a PR for linked work, include `Closes #NNN` in the PR body so GitHub closes the issue
after merge.

## Workflow

1. **Classification** - Decide whether SDD is needed, then choose feature, complex bug, or
   architecture.
2. **Specification** - Write the RFC, settle ownership and design, and resolve every open question
   that would change the implementation.
3. **Planning** - For feature, architecture, or multi-slice bug work, write one ordered
   implementation plan; do not create a separate task list or an upfront test matrix.
4. **Implementation** - Complete the planned code change while following existing DeepChat
   boundaries. Existing checks may run whenever they provide useful feedback.
5. **Review** - Review the complete change against the spec for hidden side effects, compatibility,
   failure behavior, performance, security, naming, and maintenance cost.
6. **Validation** - Decide which existing checks, temporary verification, and durable regression
   tests are warranted. Remove temporary verification before handoff.
7. **GitHub Sync** - Ask whether to sync an eligible GitHub issue only after the docs or
   implementation clarify the scope, unless the developer already requested issue sync.

Before implementation, inspect existing docs, code, callers, ownership, and nearby tests; choose the
correct SDD folder; and resolve every `[NEEDS CLARIFICATION]` marker. For architecture work that
changes or replaces a historical feature, update that feature's retained `spec.md` if it is still a
maintained contract.

### Implementation-First Validation

Implementation-first means finishing the planned implementation before deciding whether to author
new test code. It does not prohibit running existing tests, type checking, linting, builds, or
manual checks during development.

New test code before implementation is exceptional. Use it only when:

- the developer explicitly requests TDD;
- a minimal executable reproduction is required to understand a complex failure; or
- migration, concurrency, recovery, or protocol compatibility cannot be designed safely without
  characterization of existing behavior.

Record the exception and its reason in one sentence in `plan.md` or the complex-bug spec. Keep the
reproduction narrow; it may become a durable regression only if it protects a qualifying contract.

After implementation, classify validation as follows:

- **Existing validation**: run the smallest relevant existing tests and static or build checks.
- **Temporary verification**: add a probe, script, or test only to investigate implementation
  behavior, then remove it before handoff.
- **Durable regression protection**: commit the smallest test that protects user-visible behavior,
  a documented cross-module contract, persistence or migration, lifecycle or concurrency,
  recovery, a security boundary, or a proven regression.

Do not retain tests that merely mirror private control flow, assert incidental call order, duplicate
the implementation through mocks, or exist only to increase coverage. Prefer no new test to a
low-value implementation-coupled test.

Cleanup policy:

- Do not perform broad SDD cleanup during ordinary feature, bug, or architecture work.
- Use the `deepchat-sdd-cleanup` skill only when a developer explicitly asks to clean, prune, or
  organize SDD docs.
- Completed feature/architecture SDD content should become current documentation in `README.md`,
  `ARCHITECTURE.md`, `FLOWS.md`, `architecture/*.md`, or `guides/*.md`; remove `plan.md` and keep a
  spec-only folder when the RFC still defines a useful maintained contract.
- Completed issue folders may be deleted when a linked GitHub issue is closed or the implementation
  and validation evidence prove the bug no longer exists.
- Long-term history should be recovered from git history, not accumulated under `docs/archives/`.

## Six Core Principles

### 1. Specification-First Development

Write clear requirements, design decisions, invariants, and independently verifiable acceptance
criteria before writing code. Mark ambiguities with `[NEEDS CLARIFICATION]` and resolve them before
implementation. Include the architectural guidance needed to constrain the implementation, but
leave file-level sequencing and status tracking to the plan.

### 2. Architectural Consistency

Follow DeepChat's existing architectural patterns:

- **明确模块职责**: 把行为放到负责该能力的 main 模块，不新增通用 Presenter 总入口
- **Typed Event Communication**: main → renderer 状态通知使用
  `shared/contracts/events.ts` + `publishDeepchatEvent()`；main 内部操作使用直接调用
- **Secure IPC**: Prefer typed IPC via `src/preload/` (contextIsolation on); avoid ad-hoc channels
- **Type Definitions**: Shared types live in `src/shared/`

Every feature should integrate seamlessly with existing Presenters and use the established event
flow patterns.

renderer-main 能力使用 typed route / typed event + `renderer/api/*Client`。
`useLegacyPresenter()` 和 legacy presenter transport 已删除，不存在可复用的兼容路径。

### 3. Minimal Complexity

Start simple. Add complexity only when proven necessary. Avoid:

- Future-proofing (build for now, not hypothetical future needs)
- Unnecessary abstraction layers
- Over-generalization
- Premature optimization

Use framework features directly. Prefer a small coherent implementation slice that proves the
end-to-end design. If a change touches many files, explain why in the plan.

### 4. Compatibility & Migration

Prefer forward-looking designs, but treat stored user data, config, and external APIs as contracts. If a breaking change is necessary:

- Document the migration path in the spec/plan
- Include upgrade/rollback considerations (data, settings, UI defaults)
- Keep user impact explicit (what changes, what might break)

### 5. UI Consistency

Maintain consistency across the codebase:

- **Vue 3 Composition API** for all components
- **i18n** for all user-facing strings in `src/renderer/src/i18n/`
- **Tailwind CSS** following existing utility patterns
- Follow existing component conventions (props, emits, composition patterns)

### 6. Implementation-First, Risk-Based Validation

Put the primary reasoning budget into design and implementation. After the implementation is
coherent, choose the cheapest validation that can reveal meaningful failures. When durable
regression coverage is warranted, use Vitest in `test/main`, Vitest with Vue Test Utils in
`test/renderer`, and Playwright in `test/e2e`. Optimize for protected contracts and project
stability, not test count or coverage percentage.

## Development Checklist

### Specification Phase

- [ ] Problem, goals, and affected users or systems are clear
- [ ] Acceptance criteria are observable or independently verifiable
- [ ] Non-goals and constraints stated
- [ ] Ownership, interfaces, data flow, and required invariants defined
- [ ] Compatibility, migration, failure, security, and performance implications addressed
- [ ] Key UX states covered (loading/empty/error)
- [ ] No `[NEEDS CLARIFICATION]` markers remain

### Planning Phase

- [ ] Identify all involved owning modules and narrow ports
- [ ] Design event flow (if cross-process communication required)
- [ ] Define/verify IPC surface (`src/preload/`) and types (`src/shared/`)
- [ ] Define shared types in `src/shared/`
- [ ] Express the implementation as ordered, coherent slices in `plan.md`, or in the bounded
  complex-bug spec when no separate plan is needed
- [ ] Keep whole-change review and validation selection after implementation
- [ ] Identify risks (security/privacy/perf) and mitigations

### Implementation Phase

- [ ] Implement owning module and typed route/client changes
- [ ] Implement UI component (if needed)
- [ ] Add i18n keys (if user-facing)
- [ ] Review the complete implementation against the spec and affected boundaries
- [ ] Run existing validation and add temporary verification only where uncertainty remains
- [ ] Add the smallest durable regression tests only for qualifying behavior or contracts
- [ ] Remove temporary probes, scripts, and tests
- [ ] Run: `pnpm run format && pnpm run i18n && pnpm run lint && pnpm run typecheck`

## Common Patterns

```typescript
// 1. Typed Route / Client Method Signature
async methodName(params: InputType): Promise<OutputType>

// 2. Typed Event Publication (Main Process)
publishDeepchatEvent('settings.changed', payload)

// 3. Renderer-main Integration
const settingsClient = new SettingsClient()
await settingsClient.update([{ key: 'fontSizeLevel', value: 2 }])

// 4. Vue 3 Component Pattern
<script setup lang="ts">
import { SettingsClient } from '../../api/SettingsClient'

const settingsClient = new SettingsClient()
// Composition API logic
</script>
```

Compatibility note:

- 新 renderer-main 能力优先定义 `shared/contracts/*` 和 `renderer/api/*Client`
- `useLegacyPresenter()`、`presenter:call`、`remoteControlPresenter:call` 和
  `src/renderer/api/legacy/**` 已退休
- copy、file、openExternal 等低层能力通过 dedicated preload API 和 renderer client 封装
- `src/renderer/api/legacy/**` 保持删除，不恢复 legacy renderer-main boundary

## Quick Reference

- **Main modules**: `src/main/{app,session,agent,provider,tool,mcp,skill,plugin,memory,knowledge,workspace,file,desktop,platform}/**`
- **Renderer clients**: `src/renderer/api/**`
- **Tests**: `test/main/**/*`, `test/renderer/**/*`
- **Typed events**: `src/shared/contracts/events.ts`
- **Raw input constants**: `src/main/events.ts` and `src/renderer/src/events.ts`
- **IPC bridge**: `src/preload/`
- **i18n**: `src/renderer/src/i18n/`
- **Shared types**: `src/shared/types/` and `src/shared/contracts/`

## Definition of Done (DoD)

A change is “done” when:

- The acceptance criteria and documented invariants are met
- The complete implementation has been reviewed against affected boundaries and failure modes
- Relevant existing tests and required quality gates pass locally, or environment limits are
  reported precisely
- Any warranted durable regression tests are focused on qualifying behavior or contracts
- Temporary verification code has been removed
- User-facing strings use i18n keys
- Any migrations or breaking changes are documented
- Linked GitHub issues, when any, are referenced from the PR with `Closes #NNN`
