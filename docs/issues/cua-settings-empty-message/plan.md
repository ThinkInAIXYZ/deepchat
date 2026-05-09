# CUA Settings Empty Message Plan

## Scope

The issue is isolated to the static Computer Use plugin settings UI in
`plugins/cua/settings/assets/index.js`.

## Implementation

- Keep `setText()` as the fallback helper for data rows that should display `Unknown`.
- Change `setMessage()` so the transient status/error area writes the provided text verbatim and
  allows an empty string after success.
- Add a jsdom regression test that loads the static settings script, invokes the Check button, and
  verifies the message area is empty after a successful permission check.

## Test Strategy

- Run the focused renderer test for the plugin settings script.
- Run repository-required formatting, i18n, and lint checks.

## Risks

- Low. The change only affects the bottom message element and keeps status rows unchanged.
