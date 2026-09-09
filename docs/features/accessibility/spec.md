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

## Verification contract

Regression protection covers keyboard discovery, accessible names, focus recovery, complete loaded
content, lifecycle cleanup, and typed native focus boundaries. Exercise onboarding, chat and history,
provider/model setup, settings, integrations, workspace tools, and auxiliary windows with isolated
profiles. Local protocol fixtures validate first-party controls without requiring external accounts.

Keyboard and Chromium accessibility-tree checks do not establish human VoiceOver/NVDA speech quality
or acceptance on other operating systems. OS-owned dialog and permission speech, real microphone
input, encrypted-storage persistence, external account authorization, third-party content, and
runtime installation require their
own validation; do not report those boundaries as passed from local fixture evidence.

## Native interaction contract

The browser exposes an explicit Enter webpage action and F6 return to host controls. Main accepts
entry only for a visible browser attached to the requesting renderer's active session and focused
native host window. ACP authentication reserves F6 for returning from terminal input to authentication
controls without forwarding that key to the process. Plugin settings closure restores the initiating
control. Native window transitions must preserve both operating-system and renderer focus.

## References

- [W3C APG keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [W3C APG accessible names](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)
- [W3C APG landmarks](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/)

## Assistive-technology rendering

The device snapshot reports Electron accessibility support on macOS and Windows, and a typed application event reports changes. One shared renderer subscription feeds Markdown, conversation windowing, and the provider model catalog. When support is active, retain all loaded message rows and all Markdown nodes, including streaming prefixes, in the accessibility tree. Keep explicit pagination for older stored messages. Linux has no reliable Electron detection API, so use complete rendering there. Snapshot failure also preserves complete rendering. Do not change operating-system settings or force native accessibility support in production.

The tradeoff is increased DOM/memory use for long conversations while complete rendering is needed. Existing windowing remains enabled when native support is known to be off. Subscribers release listeners with their Vue scope, and a late snapshot cannot overwrite a newer native event.

Reference: [Electron accessibility support](https://www.electronjs.org/docs/latest/api/app#appisaccessibilitysupportenabled-macos-windows).
