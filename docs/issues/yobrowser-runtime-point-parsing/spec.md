# YoBrowser Runtime Point Parsing

## Problem

Runtime click activity parsing reads the first two `clientX`/`clientY` numeric matches by position. If `clientY` appears before `clientX`, the visible activity cue can swap the X and Y coordinates.

## Acceptance Criteria

- Runtime click expressions map `clientX` to `x` and `clientY` to `y` regardless of property order.
- Parsing returns a point only after seeing both axes.
- Duplicate same-axis matches do not substitute for the missing axis.
- Parsed numeric values continue to be rounded.

## Non-goals

- No change to scroll direction inference.
- No broader Runtime.evaluate expression parser.

## Open Questions

- None.
