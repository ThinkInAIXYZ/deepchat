# Specification-Driven Development for DeepChat

## Core Philosophy

Specification-Driven Development (SDD) eliminates the gap between requirements and implementation by making specifications the primary artifact. Specifications don't serve code—code serves specifications. When implementing features in DeepChat, start with clear specifications that define WHAT users need and WHY, before deciding HOW to implement.

In practice, SDD works best when the spec is concrete enough to drive design decisions, tests, and PR review. Prefer small, reviewable increments that keep spec → plan → code traceability.

## Recommended Artifacts

Keep feature work in a lightweight spec folder so reviewers can find the intent without hunting through code:

- `docs/specs/<feature>/spec.md` - user stories, acceptance criteria, non-goals, open questions
- `docs/specs/<feature>/plan.md` - architecture decisions, event flow, data model, test strategy
- `docs/specs/<feature>/tasks.md` - small, ordered tasks that map to commits/PRs (optional but recommended)

If a change is tiny, a single `spec.md` is enough—don’t over-document.

## Workflow

1. **Feature Specification** - Define user stories, acceptance criteria, business value, non-goals
2. **Implementation Plan** - Architecture decisions, event flow, IPC surface, test strategy
3. **Task Breakdown** - Small tasks that can be reviewed independently
4. **Implementation & Validation** - TDD (pragmatic), Presenter patterns, UI consistency, quality gates

## Six Core Principles

### 1. Specification-First Development

Write clear requirements with measurable acceptance criteria before writing code. Mark any ambiguities with `[NEEDS CLARIFICATION]` and resolve them before implementation. Focus on user needs and business value, avoiding premature technical decisions.

### 2. Architectural Consistency

Follow DeepChat's existing architectural patterns:
- **Presenter Pattern**: Add behavior in the appropriate module under `src/main/presenter/`
- **Event-Driven Communication**: Use `EventBus` + event constants for main ↔ renderer flows
- **Secure IPC**: Prefer typed IPC via `src/preload/` (contextIsolation on); avoid ad-hoc channels
- **Type Definitions**: Shared types live in `src/shared/`

Every feature should integrate seamlessly with existing Presenters and use the established event flow patterns.

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
- [ ] Run: `pnpm run format && pnpm run lint && pnpm run typecheck`

## Common Patterns

```typescript
// 1. Presenter Method Signature
async methodName(params: InputType): Promise<OutputType>

// 2. EventBus Communication (Main Process)
eventBus.sendToRenderer(CONFIG_EVENTS.SETTING_CHANGED, SendTarget.ALL_WINDOWS, payload)

// 3. Component-Presenter Integration
const configPresenter = usePresenter('configPresenter')
await configPresenter.methodName()

// 4. Vue 3 Component Pattern
<script setup lang="ts">
import { usePresenter } from '@/composables/usePresenter'

const sessionPresenter = usePresenter('sessionPresenter')
// Composition API logic
</script>
```

## Quick Reference

- **Presenters**: `src/main/presenter/**`
- **Tests**: `test/main/**/*`, `test/renderer/**/*`
- **EventBus**: `src/main/eventbus.ts`
- **Events**: `src/main/events.ts` (main) and `src/renderer/src/events.ts` (renderer)
- **IPC bridge**: `src/preload/`
- **i18n**: `src/renderer/src/i18n/`
- **Shared types**: `src/shared/presenter.d.ts`

## Definition of Done (DoD)

A feature is “done” when:

- The acceptance criteria are met (and ideally covered by tests)
- Lint/typecheck/tests pass locally
- User-facing strings use i18n keys
- Any migrations or breaking changes are documented
