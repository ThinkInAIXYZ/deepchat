# Provider Detail Simplification

## User Story

As a user configuring providers, I want the provider detail page to avoid repeated status tags and heavy model-list card styling, so the page is easier to scan.

## Acceptance Criteria

- The repeated Connected status tag is removed from the provider list and provider detail header.
- The provider detail header still shows the enabled model count.
- The Models tab content no longer uses a card-like border or shadow container.
- Limits is merged into Advanced, leaving the visible tabs as Connect, Models, and Advanced.
- Advanced contains rate limit controls first, followed by provider-specific advanced controls when available.

## Non-goals

- No changes to provider connection, model enablement, or rate limit persistence behavior.
- No changes to Ollama or Bedrock provider architecture beyond the shared model manager styling.
