# Spec: shadcn-vue + VueUse UI Alignment

## Goal

Align DeepChat renderer UI with the existing shadcn-vue design system (`src/shadcn/components/ui`) and VueUse (`@vueuse/core`), so feedback primitives (Spinner / Skeleton / Empty), form controls, and mechanical browser utilities stop being reimplemented ad hoc.

## Standing rule (non-negotiable)

**For all future UI-related changes, when product, interaction, and performance requirements are met, prefer shadcn-vue components over custom markup. Prefer VueUse for mechanical browser/reactivity utilities.**

Decision order:

1. Does an installed shadcn component cover the need? → compose it.
2. If not installed → `pnpm dlx shadcn-vue@latest docs/search/add`, then compose.
3. If still not a fit (special interaction, performance-critical path, or non-modal overlay) → custom implementation, and document why in the PR.

Exceptions that may stay custom:

- Virtual list measurement and chat scroll windowing
- Spotlight / guided onboarding overlays
- Agent progress and tool-interaction floating layers
- Native truncate tooltips via `title=`
- Domain-specific message, artifact, and editor surfaces that only wrap primitives

## Acceptance criteria

- Wave 1 touchpoints use `Spinner`, `Skeleton`, and `Empty` instead of hand-rolled CSS loaders / pulse blocks / empty markup where listed in `tasks.md`.
- VueUse replacements preserve existing behavior (resize clamp, debounce timing, listener cleanup).
- No shadcn component overwrite without explicit approval.
- `Agents.md` documents the standing rule.
- format / i18n / lint pass for changed surfaces.

## Constraints

- Import alias: `@shadcn/components/ui/*`
- Package runner: `pnpm dlx shadcn-vue@latest`
- Icon library in business code remains primarily `@iconify/vue`; Spinner may keep `@lucide/vue` from the shadcn component source.
- Do not rewrite the whole app’s `space-y` or icon system in this goal.
- Do not upgrade `@vueuse/core` unless a required API is missing (14.3.0 is sufficient for Wave 1).

## Non-goals

- Full redesign of settings or chat chrome
- Migrating Spotlight / AcpDebugDialog overlays in Wave 1
- Replacing domain components with shadcn “lookalikes”
- Mass i18n or dark-mode token rewrite beyond touched files

## References

- [unovue/shadcn-vue skill](https://github.com/unovue/shadcn-vue/tree/dev/skills/shadcn-vue)
- Project `components.json`
- Example usages: `MessageItemAssistant.vue` (Spinner), `SettingsOverview.vue` (Empty)
