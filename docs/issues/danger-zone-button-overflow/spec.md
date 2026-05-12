# Danger Zone Button Overflow

## Problem

The Data Settings Danger Zone action buttons can clip long labels, especially in English where "Reset Knowledge Base Data" exceeds the default button width and single-line height.

## Acceptance Criteria

- Danger Zone action buttons provide enough vertical height for long labels.
- Button labels can wrap instead of overflowing their destructive button container.
- The layout remains compact and keeps the three destructive actions grouped together on wider screens.
- Existing reset behavior remains unchanged.

## Non-goals

- No changes to reset confirmation logic or reset data semantics.
