# Spec

## Goal

Cron Jobs timezone editing should use a selector instead of free text input.

## Requirements

- Show available IANA timezone IDs in the Cron Jobs settings editor.
- Preserve existing saved timezone values.
- Saving a selected timezone keeps the existing Cron Jobs route contract unchanged.

## Non-Goals

- No new timezone dependency.
- No timezone search UI in this slice.

