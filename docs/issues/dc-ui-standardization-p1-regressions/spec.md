# DC UI standardization regressions

- **Issue**: Closes #2092
- **Status**: In progress

## Problem

The DC UI standardization changed shared renderer contracts. The regression is broader than a visual migration: native form submission, confirmation lifecycle, accessible names, responsive sheet sizing, tooltip behavior, toggle-row layout, dark surface hierarchy, and asynchronous-operation feedback require explicit contracts.

## Impact

- Native form submission can skip provider, MCP profile, browser address, and model-config handlers.
- Confirmation dialogs can render literal translations or emit duplicate cancellation events.
- Icon-only controls can lose caller-provided accessible names.
- Prompt and MCP sheets can be incorrectly constrained on desktop viewports.
- Tooltip timing and long MCP error wrapping are ignored.
- Described settings toggles can no longer keep their action right-aligned.
- Dark cards and popovers lack sufficient separation from the window background.
- A visible surface can close while a long-running operation settles without a terminal user-visible result.

## Root cause and fix plan

1. `DcForm` receives a caller `onSubmit` through Vue attribute fallthrough in addition to its own submit handler. Disable implicit fallthrough, derive the listener from `useAttrs()` at submit time, forward remaining attributes once, and consume failures after emitting the form error state.
2. Bind all static `confirm-label` and `cancel-label` calls with Vue `:` syntax and reject unbound translation expressions in renderer templates.
3. Preserve caller `aria-label` unless `label` or `tooltip` explicitly overrides it; icon-only buttons require a resolved accessible name.
4. Give every sheet width preset a matching `sm:max-w-*` override so it defeats shadcn's inherited `sm:max-w-sm` cap.
5. Make `DcConfirmDialog` cancellation single-owner. A close transition emits `cancel` once unless the transition was caused by confirmation.
6. Forward tooltip delay to the tooltip root, use renderer-level providers, expose a content-class contract, and restore constrained MCP error wrapping.
7. Keep `DcToggleRow` main rows full-width, use a right-aligned trailing region, and indent descriptions only when an icon column exists.
8. Restore dark card/popover surface separation from the window background while retaining the approved hover accent behavior.
9. Keep the simplified feedback architecture: form errors remain inline; operations that can outlive a surface must publish terminal renderer notifications. Do not restore the historical controller.
10. Reuse shadcn button variants, repair declared `class` prop forwarding, and remove unused DC UI exports rather than growing speculative APIs.

## Acceptance criteria

- A native click or Enter submit invokes each caller handler exactly once without Vue `onSubmit` warnings or unhandled rejections.
- No renderer template contains an unbound component attribute whose value is a `t(...)` call.
- A caller-supplied `aria-label` renders on `DcButton` when no wrapper label or tooltip overrides it.
- Prompt, system-prompt, MCP, and plain sheets retain their intended responsive widths.
- Every cancel/dismissal route emits exactly one cancellation; confirmation emits no cancellation.
- Tooltip delay, placement, disabled/focus behavior, and content-width parameters are honored; MCP errors wrap at `max-w-xs`.
- Described toggle rows preserve a right-aligned switch/trailing slot in LTR and RTL, including long labels.
- Dark card and popover tokens are visibly separated from the window background and have source-level coverage.
- Migrated asynchronous operations have explicit inline or terminal notification feedback contracts.
- Shared DC components have direct contract tests, renderer tests do not add unexpected Vue warnings, and repository validation passes.

## Constraints and non-goals

- Do not change main/preload/IPC contracts or add another UI framework/dependency.
- Do not restore the removed surface-feedback controller or visibility leases.
- Do not redesign unrelated settings pages.
- Remove unused shared exports instead of introducing new speculative APIs.

## Task checklist

- [x] Repair `DcForm`, translation bindings, and `DcButton` accessible-name behavior.
- [x] Repair sheet, confirmation, tooltip, and toggle-row contracts.
- [ ] Repair shared-layer variant/class/export drift.
- [ ] Record feedback contracts and apply terminal feedback where required.
- [ ] Revise dark surface tokens and coverage.
- [x] Add direct contract and consumer regressions.
- [x] Run complete validation and commit the scoped change.

## Validation

- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- Focused DC UI and affected consumer renderer tests
- `pnpm run test:renderer`
