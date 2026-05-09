# Provider Validation Disabled State

## User Story

As a user editing provider settings, I want the verify-key action to stay unavailable while the
provider is disabled so that I do not see a misleading `Provider not initialized` error.

## Acceptance Criteria

- Disabled providers do not open the model check flow from the generic verify-key action.
- Disabled providers do not run inline verification handlers that would surface the initialization
  error.
- Enabled providers keep the existing verification behavior.

## Non-goals

- Redesigning the provider settings layout.
- Changing provider initialization behavior in the main process.

## Open Questions

None.
