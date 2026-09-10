# DeepChat Design Components

## Purpose and ownership

`src/dc-ui/` provides DeepChat interaction components beside `src/shadcn/`, with imports through
`@dc-ui/*`. The component catalog and design tokens are maintained in
[Design System](../../design-system.md).

A component owns one stable interaction, including its presentation, accessibility, and shared
states. Reuse an existing component before introducing another wrapper. Feature owners retain
business operations, persistence, and IPC; design components do not own those responsibilities.

## Action contract

- `DcButton` handles text, icon-only, loading, tooltip, accessible label, disabled, active, native
  element composition, and default-slot content. `xs` provides the compact `h-7 text-xs` size;
  `iconSize` controls icon dimensions. Do not add a separate icon-only button component.
- Icon-only actions need a localized accessible name. `label` provides that name without creating a
  tooltip; `tooltip` provides visible help and a fallback name. Explicit `aria-label` attributes
  take precedence. Existing tooltip text, position, delay, display conditions, multiline content,
  and keyboard-focus behavior must survive component changes. Add missing tooltips to actionable
  icon-only controls using the existing localized action name; do not impose tooltips on text
  buttons or explanatory switches, checkboxes, and links.
- `DcCopyButton` retains clipboard behavior, copied/error events, success timing, and notifications.
  `DcSubmitButton` retains native submission, injected form state, and duplicate-submit protection.
- Menu items preserve native menu selection behavior. Confirmation dialogs preserve asynchronous
  busy state, disabled actions, error presentation, and focus restoration.

## Overlay and feedback contract

Sheets, interactive popovers, and explanatory tooltips retain distinct focus and dismissal
semantics. `DcSheetPanel` owns sheet layout modes; `DcPopover` owns interactive popover composition.
Complex triggers and composite cards may retain existing primitives when a wrapper cannot preserve
behavior.

`DcBadge` represents static metadata; `DcStatusPill` represents runtime state. Their semantic colors
must remain readable in light and dark themes. `DcToast` delegates to `notifyRenderer`; it neither
adds a notification engine nor overrides the duration policy.

Choice groups, toggle rows, forms, errors, and empty states expose accessible names, descriptions,
selection, and disabled state through their existing semantics. Shared APIs grow only for actual
callers; no speculative options or extra dependencies are required.

## Compatibility and acceptance

- Preserve event modifiers and payloads, native element types, disabled conditions, loading,
  overlay state, keyboard behavior, focus, i18n keys, and test hooks. Forward attributes to the
  owning control without swallowing or re-emitting business events.
- Keep existing Reka/shadcn primitives and semantic tokens as the foundation. User-facing text uses
  vue-i18n and existing common/dialog keys where applicable.
- Both chat and settings renderers consume the same component contracts. New behavior must satisfy
  the [accessibility contract](../accessibility/spec.md).
- Run the repository quality gates and relevant behavioral suites before handoff. Outstanding
  migration and native UI validation remain tracked in this goal's implementation records.
