# Cron Agent Jobs Full Remote Delivery

## User Need

Scheduled task delivery should include the same process and answer details that Remote Control sends during a normal remote conversation.

## Goal

Capture Remote Control delivery segments from cron-run assistant updates and use them for the delivered run output.

## Acceptance Criteria

- Cron run output includes ordered process and answer segments.
- Feishu scheduled task delivery is not truncated by the generic 4000-character cap.
- Existing delivery receipts continue to work.

## Constraints

- Do not add a new storage table.
- Do not change Remote Control streaming behavior.

## Open Questions

None.
