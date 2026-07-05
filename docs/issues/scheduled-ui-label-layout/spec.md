# Scheduled UI Label Layout

## User Need

Scheduled task settings should use a user-friendly name and avoid over-wide history rows.

## Goal

Rename user-facing Cron Jobs labels to Scheduled, constrain the settings content width, and show only
the latest run timestamp.

## Acceptance Criteria

- The settings nav and page title use Scheduled semantics in every locale.
- Chinese labels use `定时任务`.
- The Scheduled settings content has a narrower max width.
- Run history shows one latest timestamp, not status, preview text, or multiple rows.

## Non-Goals

- No internal route or domain rename.
- No run detail redesign.
