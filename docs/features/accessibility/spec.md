# Accessibility

## Context and goal

DeepChat must expose its first-party functionality to people who navigate without vision using a keyboard and assistive technology. The renderer spans the main chat shell, separate settings windows, onboarding, messages, tool approvals, plugins, workspace tools, and auxiliary windows. Visual affordances alone do not provide a usable interface.

## Design and ownership

Use native semantic controls and the existing Reka/shadcn primitives. Keep labels in vue-i18n, name icon actions, associate form labels and errors with their inputs, and expose selected, expanded, busy, and disabled states. Fix shared primitives only when the contract is shared; retain feature-specific naming and focus behavior at the surface owner. Preserve typed preload/IPC boundaries and existing persistence behavior.

Provide named navigation and main landmarks, keyboard entry to primary content, and meaningful focus after navigation. Dialog owners retain initial focus, trapping, Escape, and restoration through existing primitives. Hover actions and drag operations require keyboard alternatives. Editors must expose a named multiline input and allow focus to leave. Message history must remain readable, including content outside a virtual window; streaming notifications must convey useful progress without repeating every token.

Keep the normal visual layout and pointer behavior. Do not add a parallel accessibility UI, a blanket application role, DOM-wide label inference, new dependencies, or force operating-system accessibility settings.

## Interaction layout

```text
BEFORE
[Icon rail] [Session text / mouse actions] | [Visual content]
                                          [Unnamed editor]

AFTER
[Skip to content]
[Named navigation] [Session buttons]      | [Named main content]
                   [Keyboard actions]    | [Named editor + status]
```

## Invariants and compatibility

- All first-party actions are discoverable by name and operable using a keyboard.
- Focus is visible, follows a logical order, and never enters hidden/inert surfaces.
- Navigation and asynchronous feedback preserve user control of focus.
- Accessible names track the active locale and visible labels.
- Tests and exploration use isolated profiles; credentials and personal conversations are never committed.
- Third-party content and external-service availability are identified separately from first-party defects.

## Acceptance and evidence

A dedicated exploration agent follows keyboard and accessibility-tree workflows across onboarding; agent/provider/model setup; conversation creation, selection, search, editing, generation, recovery and export; attachments; tool approval; plugins, MCP and skills; projects/workspace/artifacts/terminal/browser; every settings route; and auxiliary windows. It reports concrete blockers, then independently verifies each repaired phase before its commit. `exploration.md` records observed evidence, coverage, and remaining limitations. Source review and automated semantics are not represented as human screen-reader testing or platform certification.

The implementation is complete when this inventory has been explored, all reproducible first-party blockers are repaired and accepted, relevant regression checks and repository quality gates pass, and a PR targets `dev`. Any unavailable real screen-reader or external integration verification remains explicit in the report rather than being counted as passed.

## References

- [W3C APG keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [W3C APG accessible names](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)
- [W3C APG landmarks](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/)

## Assistive-technology rendering

The device snapshot reports Electron accessibility support on macOS and Windows, and a typed application event reports changes. One shared renderer subscription feeds Markdown and conversation windowing. When support is active, retain all loaded message rows and all Markdown nodes, including streaming prefixes, in the accessibility tree. Keep explicit pagination for older stored messages. Linux has no reliable Electron detection API, so use complete rendering there. Snapshot failure also preserves complete rendering. Do not change operating-system settings or force native accessibility support in production.

The tradeoff is increased DOM/memory use for long conversations while complete rendering is needed. Existing windowing remains enabled when native support is known to be off. Subscribers release listeners with their Vue scope, and a late snapshot cannot overwrite a newer native event.

Reference: [Electron accessibility support](https://www.electronjs.org/docs/latest/api/app#appisaccessibilitysupportenabled-macos-windows).
