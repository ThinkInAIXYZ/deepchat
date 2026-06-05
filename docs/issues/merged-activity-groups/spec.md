# Merged Activity Groups

## Problem

Some providers emit an empty `reasoning_content` block carrying provider metadata between visible
reasoning and tool-call blocks. The chat view does not render that empty reasoning block, but the
activity grouping pass currently treats it as a normal boundary. This splits one continuous assistant
work span into several collapsed activity summaries.

## User Story

As a chat user reviewing an imported or previously merged session, I want reasoning and tool-call
activity to stay attached to the correct assistant segment so expanded activity details match the
visible answer they summarize.

## Acceptance Criteria

- Empty reasoning metadata blocks do not split the reasoning/tool-call activity they sit between.
- Consecutive activity blocks within the same assistant segment collapse into one compact summary.
- Internal tool calls remain hidden from the assistant activity list.
- The final assistant text continues to render after its activity summaries.
- Expanding or collapsing the compact activity summary does not hard-toggle the details with
  `display: none`; details remain mounted and use a bounded height/opacity transition to reduce
  scroll and layout jitter. Collapsed details are not pointer- or keyboard-interactive.
- The compact activity summary keeps the chevron and title close enough to read as one control.
- A regression test covers the MiniMax-style sequence: visible reasoning, empty signed reasoning,
  tool call, next visible reasoning, empty signed reasoning, next tool call.
- A component test covers the collapsed and expanded activity detail states after the transition
  wrapper change.

## Non-goals

- Redesign activity group copy, visual hierarchy, or per-block detail components.
- Change session storage or import schema.
- Change the content of reasoning/tool-call blocks.

## Constraints

- Keep the fix scoped to renderer-side render item construction unless investigation shows the source
  data is malformed.
- Do not introduce new user-facing strings.
- Follow existing message rendering and test patterns.
