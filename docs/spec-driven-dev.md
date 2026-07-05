# Specification-Driven Development for DeepChat

## Core Philosophy

Specification-Driven Development (SDD) eliminates the gap between requirements and implementation by making specifications the primary artifact. Specifications don't serve code—code serves specifications. When implementing features in DeepChat, start with clear specifications that define WHAT users need and WHY, before deciding HOW to implement.

In practice, SDD works best when the spec is concrete enough to drive design decisions, tests, and PR review. Prefer small, reviewable increments that keep spec → plan → code traceability.

## Required Artifacts

Keep every active change in a lightweight SDD folder so reviewers can find the intent without hunting through code. Use one kebab-case folder per goal:

- `docs/features/<goal>/` - new features, user-visible capabilities, integrations, and tools
- `docs/issues/<goal>/` - small bug fixes, regressions, failing tests, CI failures, reliability issues, and prompt/runtime problems
- `docs/architecture/<goal>/` - refactors, migrations, dependency boundaries, shared contracts, runtime architecture, and cross-module design

Pure release metadata work is exempt from SDD. Version bumps, `CHANGELOG.md` updates, release branch
management, tags, and release PR preparation should follow `docs/release-flow.md` without creating a
release-specific SDD folder.

Feature and architecture goals use the full SDD set:

- `spec.md` - user stories, acceptance criteria, non-goals, constraints, open questions
- `plan.md` - architecture decisions, event flow, data model, compatibility, test strategy
- `tasks.md` - small, ordered tasks that map to commits/PRs

Small bug goals use one file:

- `spec.md` - issue description, impact, root cause or suspected location, fix plan, task checklist,
  validation, and linked GitHub issue if one exists

A bug is small only when the failure is narrow, the owner module is clear, and the fix does not
introduce a new user-visible capability, data migration, public contract, or cross-module redesign.
If it does, classify the work as feature or architecture instead.

If a change is tiny, keep the artifact short.

## GitHub Issue Sync

For feature and small bug work, create or link a GitHub issue when local `gh` is installed and
authenticated:

- Feature work uses the `[feature]` label.
- Bug work uses the `[bug]` label.
- If the label is missing and `gh` has permission, create it.
- Record the issue URL or number in the SDD artifact.
- If `gh` is unavailable or unauthorized, continue local-only and note that no GitHub issue was
  created.

When opening a PR for linked work, include `Closes #NNN` in the PR body so GitHub closes the issue
after merge.

## Workflow

1. **Classification** - Choose feature, small bug, or architecture.
2. **Specification** - Write the required artifact set for that classification.
3. **GitHub Sync** - Create or link a labeled GitHub issue for feature and small bug work when
   local `gh` is usable.
4. **Implementation & Validation** - TDD (pragmatic), Presenter patterns, UI consistency, quality
   gates.

Before implementation, inspect existing docs and code, choose the correct SDD folder, and resolve every `[NEEDS CLARIFICATION]` marker. For architecture work that changes or replaces a historical feature, update that feature's retained `spec.md` if it is still a maintained contract.

Cleanup policy:

- Do not perform broad SDD cleanup during ordinary feature, bug, or architecture work.
- Use the `deepchat-sdd-cleanup` skill only when a developer explicitly asks to clean, prune, or
  organize SDD docs.
- Completed feature/architecture SDD content should become current documentation in `README.md`,
  `ARCHITECTURE.md`, `FLOWS.md`, `architecture/*.md`, or `guides/*.md`; keep a spec-only folder
  when the acceptance criteria still define a useful maintained contract.
- Completed issue folders may be deleted when a linked GitHub issue is closed or the local code and
  tests prove the bug no longer exists.
- Long-term history should be recovered from git history, not accumulated under `docs/archives/`.

## Six Core Principles

### 1. Specification-First Development

Write clear requirements with measurable acceptance criteria before writing code. Mark any ambiguities with `[NEEDS CLARIFICATION]` and resolve them before implementation. Focus on user needs and business value, avoiding premature technical decisions.

### 2. Architectural Consistency

Follow DeepChat's existing architectural patterns:
- **Presenter Pattern**: Add behavior in the appropriate module under `src/main/presenter/`
- **Typed Event Communication**: Use `shared/contracts/events.ts` + `publishDeepchatEvent()` for
  main → renderer state notifications; keep `EventBus` for main-internal and raw transport flows
- **Secure IPC**: Prefer typed IPC via `src/preload/` (contextIsolation on); avoid ad-hoc channels
- **Type Definitions**: Shared types live in `src/shared/`

Every feature should integrate seamlessly with existing Presenters and use the established event flow patterns.

对于 renderer-main 新能力，当前默认路径已经从 `useLegacyPresenter()` 转向 typed route / typed event +
`renderer/api/*Client`。`useLegacyPresenter()` 只保留给兼容路径，不应再作为新代码模式复制。

### 3. Minimal Complexity

Start simple. Add complexity only when proven necessary. Avoid:
- Future-proofing (build for now, not hypothetical future needs)
- Unnecessary abstraction layers
- Over-generalization
- Premature optimization

Use framework features directly. Prefer a small “first increment” (e.g. Presenter method + critical test + minimal UI); if a change touches many files, explain why in the plan.

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

### 6. Test-Driven Approach (Pragmatic)

Use Vitest + Vue Test Utils for testing. Test files mirror source structure under `/test/main/` and `/test/renderer/`. Write tests for critical paths and high-impact code. Not exhaustive: focus on value, not coverage.

## Development Checklist

### Specification Phase
- [ ] User stories clearly defined
- [ ] Acceptance criteria testable and measurable
- [ ] Non-goals and constraints stated
- [ ] Key UX states covered (loading/empty/error)
- [ ] No `[NEEDS CLARIFICATION]` markers remain
- [ ] Business value articulated
- [ ] GitHub issue linked or local-only reason recorded for feature and small bug work

### Planning Phase
- [ ] Identify all involved Presenters
- [ ] Design event flow (if cross-process communication required)
- [ ] Define/verify IPC surface (`src/preload/`) and types (`src/shared/`)
- [ ] Define shared types in `src/shared/`
- [ ] Plan test coverage for critical paths
- [ ] Identify risks (security/privacy/perf) and mitigations

### Implementation Phase
- [ ] Create/update test file
- [ ] Implement Presenter method(s)
- [ ] Implement UI component (if needed)
- [ ] Add i18n keys (if user-facing)
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
- `src/renderer/api/legacy/**` 保持删除，architecture guard 会阻止它回流

## Quick Reference

- **Presenters**: `src/main/presenter/**`
- **Renderer clients**: `src/renderer/api/**`
- **Tests**: `test/main/**/*`, `test/renderer/**/*`
- **EventBus**: `src/main/eventbus.ts`
- **Typed events**: `src/shared/contracts/events.ts`
- **Raw/internal events**: `src/main/events.ts` and `src/renderer/src/events.ts`
- **IPC bridge**: `src/preload/`
- **i18n**: `src/renderer/src/i18n/`
- **Shared types**: `src/shared/presenter.d.ts`

## Definition of Done (DoD)

A change is “done” when:

- The acceptance criteria are met (and ideally covered by tests)
- Lint/typecheck/tests pass locally
- User-facing strings use i18n keys
- Any migrations or breaking changes are documented
- Linked GitHub issues are referenced from the PR with `Closes #NNN`
