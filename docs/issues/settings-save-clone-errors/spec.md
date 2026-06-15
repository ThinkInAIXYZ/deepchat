# Settings Save Clone Errors Spec

## Goal

Fix renderer IPC clone errors when settings save paths receive reactive objects.

## Requirements

- Saving an existing DeepChat Agent sends a structured-cloneable payload to the typed route bridge.
- Creating a DeepChat Agent uses the same structured-cloneable payload shape as updating.
- Adding, updating, and replacing custom prompts send structured-cloneable payloads.
- Adding, updating, and replacing system prompts send structured-cloneable payloads.
- Saving shortcut keys sends a structured-cloneable payload.
- Existing saved values and route contracts remain unchanged.
- Tests cover the renderer API client payloads with structured clone validation.

## Compatibility

Settings route names, presenter contracts, and persisted config keys remain unchanged.
