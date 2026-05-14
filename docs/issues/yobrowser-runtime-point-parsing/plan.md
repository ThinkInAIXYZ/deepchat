# Plan

## Implementation

- Update `YoBrowserPresenter.extractPointFromRuntimeExpression` to capture the axis name and assign values by axis.
- Ignore duplicate matches for an axis after the first value has been recorded.
- Keep the existing finite-number guard and rounding behavior.

## Test Strategy

- Add focused main-process presenter tests for order-independent mapping, duplicate same-axis handling, and rounding.

## Risk

- Low. The change is scoped to activity metadata for Runtime.evaluate click cues and does not affect command execution.
