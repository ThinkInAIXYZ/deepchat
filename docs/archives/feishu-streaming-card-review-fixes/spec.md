# Feishu streaming card review fixes

## User need

Review PR #1823 comments, fix valid issues, and push the fixes to the existing PR branch.

## Goal

Address valid review feedback for Feishu streaming cards with minimal, focused changes.

## Acceptance criteria

- `sendCardEntity` fails fast when Feishu does not return a non-empty `message_id`.
- Any created CardKit streaming card is best-effort closed when a run is cancelled, exits mid-stream, or fails after card creation.
- Reviewed Feishu settings strings are localized instead of leaving new English copy in localized bundles.
- Relevant tests and project validation commands pass.
- Fixes are committed and pushed to `feat/feishu-streaming-cards`.

## Constraints

- Preserve the existing markdown fallback behavior.
- Do not weaken existing error handling or authentication.
- Keep changes limited to PR review feedback.
- Do not stage unrelated generated files.

## Non-goals

- Real Feishu/Lark app runtime validation.
- Broader CardKit design changes.
- Reworking unrelated i18n content.

## Open questions

None.
