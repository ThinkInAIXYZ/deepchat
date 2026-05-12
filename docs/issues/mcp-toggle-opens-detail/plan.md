# Implementation Plan

## Cause

`McpServers` attaches a click listener to the `McpServerCard` root to open the detail sheet. Inner controls in `McpServerCard`, including the switch, do not stop native click bubbling.

## Change

- Stop click propagation from the card's switch wrapper.
- Stop click propagation from card menu actions, footer buttons, and description expansion.
- Add focused component tests for propagation behavior.

## Validation

- Run the focused renderer component test.
- Run the repository-required format, i18n, and lint checks.
