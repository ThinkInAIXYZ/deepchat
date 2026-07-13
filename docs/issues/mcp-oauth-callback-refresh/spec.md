# MCP OAuth Callback Refresh

## User Need

After an MCP OAuth provider redirects back to the local callback page, DeepChat should update the MCP
card automatically. If the callback was already consumed by the local listener, pasting the same URL
must not overwrite an authenticated state with a stale "not pending" error.

## Acceptance Criteria

- Returning to DeepChat after browser authentication refreshes the selected MCP server auth status.
- Pasting an already-consumed callback URL returns the authenticated status when credentials were
  saved.
- Starting auth for an already-authenticated server refreshes the card instead of reopening the
  browser.
- Servers without saved credentials still report a non-authenticated state when no auth flow is
  pending.
