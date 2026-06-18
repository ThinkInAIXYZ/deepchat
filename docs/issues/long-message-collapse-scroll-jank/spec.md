# Long Message Collapse Scroll Jank

## Problem

Long assistant messages can contain many collapsible blocks, such as thinking, tool call, action, or
activity blocks. When a generated response is very long and many blocks are collapsed or expanded,
the chat viewport can become slow and visibly jitter while the user scrolls or while auto-follow is
trying to keep the latest response visible.

## User Need

As a user reading a long generated conversation, I need scrolling to stay smooth and stable even
when the message contains many collapsible sections, so I can review content without the viewport
lagging or jumping.

## Goals

- Upgrade `markstream-vue` to the current npm `latest` release before investigating renderer
  behavior.
- Identify whether the jitter comes from Markdown rendering, collapsible block transitions,
  message-height measurement, auto-scroll retry logic, or the message windowing layer.
- Keep the chat message layout and existing collapsed/expanded affordances unchanged unless a
  behavior change is required for stability.
- Prefer a scoped renderer-side fix over broader scrolling rewrites.

## Acceptance Criteria

- `markstream-vue` resolves to the current npm `latest` release in `package.json` and the local
  pnpm install state. `pnpm-lock.yaml` is intentionally ignored by this repository.
- Long assistant messages with many collapsible blocks can be scrolled without repeated forced
  bottom jumps when the user is not at the bottom.
- Collapsing or expanding one block adjusts scroll position predictably and does not trigger a
  feedback loop between measurement and auto-scroll.
- Existing chat auto-follow behavior still works while a response is generating and the user stays
  near the bottom.
- No new user-facing strings or settings are introduced.

## Non-goals

- Redesign the chat message UI.
- Replace the chat message windowing implementation.
- Replace `markstream-vue`.
- Add a new virtualization dependency.

## Constraints

- Use existing Vue 3, Pinia, Tailwind, and renderer composable patterns.
- Keep changes focused on dependency resolution and the smallest root-cause fix.
- Do not patch `node_modules`.

## Root Cause

Collapsed message activity still mounted heavy hidden content:

- `ThinkContent` used `v-show`, so collapsed thinking blocks still instantiated
  `markstream-vue`'s `NodeRenderer` whenever content existed.
- `MessageBlockActivityGroup` started collapsed, but still rendered every grouped
  `MessageBlockThink` and `MessageBlockToolCall` inside a zero-height grid.
- Long settled assistant messages with many completed reasoning/tool blocks therefore kept large
  hidden DOM and Markdown renderer work in the visible message row.
- Those hidden children also interacted with row `ResizeObserver` measurement; when heights changed
  during expansion/collapse, `ChatPage` could repeatedly run bottom-follow or anchor-restore logic
  while the user was scrolling.

The first fix is to avoid mounting collapsed body content until the user expands it, and to unmount
it again after the collapse transition.
