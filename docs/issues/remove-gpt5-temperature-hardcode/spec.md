# Remove GPT-5 Temperature Hardcode

## User Story

As a user configuring chat generation settings, I want temperature controls to follow model
capability metadata instead of frontend model-name matching, so supported models keep their controls
and unsupported models hide them consistently.

## Acceptance Criteria

- ChatConfig hides the temperature slider only when model capabilities explicitly report
  temperature control as unsupported.
- GPT-5-like model IDs do not automatically hide temperature when capabilities report support.
- Missing or unavailable capability data keeps the existing conservative behavior and shows
  temperature.

## Non-goals

- Do not change backend request filtering.
- Do not update provider model database contents.
- Do not introduce OpenAI-specific frontend special cases.

## Constraints

- Reuse the existing `models.getCapabilities` surface.
- Keep the change scoped to renderer configuration UI behavior.
