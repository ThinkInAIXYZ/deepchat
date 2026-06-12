# Project Group Session Update Sort

## Problem

When the sidebar groups sessions by project directory, sessions inside each directory are sorted by
title because they inherit the global sidebar ordering. This makes recently active sessions harder to
find inside a project group.

## Acceptance Criteria

- In project group mode, each project directory lists sessions by `updatedAt` descending.
- Sessions with the same `updatedAt` keep a stable title/id fallback order.
- Existing pinned-session sorting and time-group behavior remain unchanged.

## Non-Goals

- Project group labels and collapse behavior will remain as-is.
- Backend session pagination order remains unchanged.
- Pinned-session ordering will not be modified.
