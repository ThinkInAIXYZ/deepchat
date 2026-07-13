# QQBot Remote Settings Clone Error Spec

## Goal

Fix the renderer IPC clone error when saving QQBot remote settings and prevent the same failure class across remote channel settings.

## Requirements

- Saving QQBot remote settings sends a structured-cloneable payload to the typed route bridge.
- Other remote channel settings with array or nested object fields also send structured-cloneable payloads.
- Save payloads follow the remote channel settings contracts.
- Existing remote settings behavior and persisted values stay unchanged.
- Tests cover the renderer save path with structured clone validation.

## Compatibility

Remote settings route names and presenter contracts remain unchanged.
