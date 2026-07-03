# Implementation Plan

## Fix

Add the missing `NULL` value for `claim_owner` in `CronJobRunsTable.insertQueued`.

## Test

Assert queued runs include the Phase 4 nullable columns before they transition to running.

