# PR 1870 Review Fixes

## User Need

PR review comments on MCP and Codex OAuth should be verified against the current code and fixed
where they point to real bugs or user-visible polish issues.

## Goal

Address valid review feedback for OAuth error classification, stale OAuth flow handling, callback
submission guards, URL validation, credential clearing, status labels, rendered drag-region tests,
and newly added locale strings.

## Acceptance Criteria

- MCP OAuth classifies HTTP 401 errors from common error shapes.
- Superseded MCP OAuth flows cannot complete and overwrite the active flow.
- Invalid pasted MCP callback URLs return the error status created by the failure path.
- MCP OAuth authorization opens only `http:` or `https:` URLs.
- Scoped MCP OAuth credential clearing actually removes the targeted scope.
- OpenAI Codex and MCP callback submissions cannot double-submit while already in flight.
- MCP auth error cards show the failure label, not the required-auth label.
- The Sheet no-drag regression test checks rendered DOM.
- Newly added auth strings are localized in the affected locale files.

## Non-Goals

- Do not redesign OAuth.
- Do not add a new permission model.
- Do not translate unrelated legacy strings.

## Open Questions

None.
