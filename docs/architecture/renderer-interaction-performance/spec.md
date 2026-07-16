# Renderer Interaction Performance

## Problem

Several renderer interactions still combine avoidable main-process round trips, layout-bound motion,
or hidden controls without keyboard-visible feedback. The largest confirmed cases are the MCP Router
marketplace, chat side panel motion, expandable message details, message toolbars, and lazy settings
navigation.

## Goal

Make these existing interactions responsive and predictable without redesigning the application or
replacing the chat rendering architecture.

## Acceptance Criteria

- MCP Router marketplace pages query installation state once per newly fetched batch and expose an
  explicit retry action after load failure.
- A marketplace item cannot start duplicate installs and communicates its pending state.
- Opening or closing the chat side panel does not animate layout width on every frame; persisted
  widths and drag resizing continue to work.
- Tool-call and error details use keyboard-operable disclosure controls with synchronized height,
  opacity, and chevron motion.
- Message toolbar actions become visible for keyboard focus and retain a practical desktop hit area.
- Lazy settings navigation acknowledges a click immediately and clears pending feedback on success
  or failure.
- Existing reduced-motion behavior applies to all new motion.
- Focused tests cover the new contracts, pending states, keyboard semantics, and motion classes.

## Constraints

- Keep the Presenter, typed route contract, and renderer client boundaries for MCP operations.
- Preserve the existing single-server installation query for compatibility.
- Preserve chat message windowing, scroll ownership, side-panel width persistence, and manual resize.
- Use existing motion tokens and visual components; add no new UI dependency.
- Keep all user-facing text in vue-i18n.

## Non-Goals

- Rewriting the chat renderer, message windowing, or Markdown renderer.
- Broadly splitting large renderer components without runtime profiling evidence.
- Removing all backdrop blur or changing the product's visual direction.
- Adding telemetry, a benchmark service, or a GitHub issue.
