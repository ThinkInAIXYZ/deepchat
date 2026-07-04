# Implementation Plan

## Phase Boundary

This phase depends on real runs and sessions from phase 4. It should merge before the `cronjob`
agent tool because it expands the job domain and routes the tool will later call.

## Data Model

Add delivery receipts:

```sql
CREATE TABLE cron_job_deliveries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_json TEXT NOT NULL,
  status TEXT NOT NULL,
  remote_message_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_cron_job_deliveries_run
ON cron_job_deliveries(run_id, created_at);

CREATE INDEX idx_cron_job_deliveries_remote_message
ON cron_job_deliveries(remote_message_id);
```

Extend `cron_jobs`:

```sql
ALTER TABLE cron_jobs ADD COLUMN delivery_json TEXT NOT NULL DEFAULT '{}';
```

## Delivery Router

Add `CronJobDeliveryRouter`:

1. Load run output and job delivery config.
2. Resolve applicable targets for success or failure.
3. Render payload once as structured content plus channel-safe summaries.
4. Dispatch through the Remote control adapter only.
5. Persist receipt status per target.

## Remote Boundary

Add a narrow remote presenter port:

```ts
type CronJobRemoteDeliveryPort = {
  deliverCronJobResult(input: RemoteCronJobDeliveryInput): Promise<RemoteCronJobDeliveryReceipt>
}
```

Remote delivery is notification-only. Cron Jobs stores receipts but does not create a Remote
conversation binding and does not continue sessions from inbound replies.

## UI Plan

Add a Delivery section in the job editor and delivery logs in run detail:

```text
+---------------------------------------------------------+
| Delivery                                                |
| [x] Remote delivery                                     |
| Channel [Feishu / group:oc_xxx v]                       |
+---------------------------------------------------------+
```

Keep delivery controls compact. Disable Remote delivery when no enabled Remote channel has a
binding.

## Compatibility

- Existing remote bindings are reused, not migrated.
- No legacy scheduled-task delivery compatibility is kept.

## Test Strategy

- Router tests for success, failure, partial failure, and multiple targets.
- Renderer tests for delivery config and receipt display.

## Validation Commands

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- test/main/presenter/cronJobs`
- `pnpm test -- test/main/presenter/remoteControlPresenter`
- `pnpm test -- test/renderer`
