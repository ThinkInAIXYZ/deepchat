# OpenAI Codex OAuth Only

## User Need

OpenAI Codex sign-in should use the working browser OAuth flow. The OpenAI Codex device-code
flow is unreliable for DeepChat's product shape and should no longer appear as an available login
method.

## Goal

Remove the OpenAI Codex device-code login path while keeping browser OAuth, token refresh, logout,
and status reporting intact.

## Acceptance Criteria

- OpenAI Codex settings show one primary ChatGPT browser OAuth login action and no device-code
  login action, device-code panel, copy-code action, or verification-page action.
- OpenAI Codex shared route contracts, renderer API client, main route dispatcher, and OAuth
  presenter no longer expose `oauth.openaiCodex.startDeviceLogin`.
- OpenAI Codex auth status no longer advertises a `pending-device` state or device-code payload.
- Existing OpenAI Codex browser OAuth, cancel, logout, account status, storage status, and token
  refresh behavior remain unchanged.
- GitHub Copilot device flow remains unchanged.
- Focused route, presenter, renderer client, and component tests cover the OAuth-only behavior.
- SDD files contain no unresolved clarification markers.

## Constraints

- Keep the change scoped to OpenAI Codex auth.
- Preserve existing i18n patterns for user-facing settings text.
- Do not change OpenAI API-key provider behavior.
- Do not expose OAuth tokens or account identifiers beyond the existing masked status behavior.

## Non-Goals

- Repairing the OpenAI Codex device-code backend flow.
- Removing GitHub Copilot device flow.
- Reworking Codex model discovery or request adapters.
- Changing storage format for existing OpenAI Codex tokens.

## Open Questions

None.
