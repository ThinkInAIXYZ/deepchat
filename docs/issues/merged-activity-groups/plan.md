# Plan

## Current Behavior

`buildAssistantRenderItems` buffers completed reasoning and tool-call blocks while grouping is
enabled. The buffer flushes when a block is not completed activity.

In affected histories, an empty `reasoning_content` block with provider metadata can sit between
visible reasoning and tool-call blocks. Because that empty reasoning block is not visible but still
flushes the activity buffer, one continuous assistant work span becomes several activity summaries.

The compact summary details are currently hidden with `v-show`, so expansion changes the detail body
from `display: none` to normal layout in one frame. Long merged activity histories can make the
message list jump visibly while row measurement catches up.

## Implementation

- Treat empty settled reasoning blocks as invisible metadata blocks for activity grouping.
- Keep buffering visible completed reasoning and tool calls across those ignored metadata blocks.
- Replace the activity group detail `v-show` with an always-mounted transition shell that animates
  grid row height and opacity.
- Avoid leaving collapsed spacing behind by moving the body gap to the animated shell's expanded
  margin state.
- Mark the collapsed shell inert so mounted hidden controls cannot receive focus or pointer input.
- Add renderer regression coverage around provider signed empty reasoning blocks.
- Update the activity group component test to assert accessible collapsed state and mounted details
  rather than relying on `display: none` visibility.

## Validation

- Run focused renderer tests for message activity grouping.
- Run repository-required quality gates: `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
