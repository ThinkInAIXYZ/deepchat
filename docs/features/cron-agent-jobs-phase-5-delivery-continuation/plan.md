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
4. Dispatch through target adapters:
   - DeepChat Inbox adapter.
   - Desktop notification adapter.
   - Origin session adapter.
   - Remote control adapter.
5. Persist receipt status per target.

## Remote Boundary

Add a narrow remote presenter port:

```ts
type CronJobRemoteDeliveryPort = {
  deliverCronJobResult(input: RemoteCronJobDeliveryInput): Promise<RemoteCronJobDeliveryReceipt>
  resolveCronJobContinuation(input: RemoteInboundMessage): Promise<CronJobContinuationTarget | null>
}
```

Remote channels decide whether their message model supports thread continuation. Cron Jobs only
stores receipts and continuation target mapping.

## Continuation Flow

```text
remote message
  -> inbound reply/action
  -> RemoteControlPresenter resolves remote_message_id
  -> cron_job_deliveries -> run_id -> session_id
  -> ChatService.sendMessage(sessionId, reply)
  -> response delivered to same remote thread
```

DeepChat UI continuation simply activates the stored session.

## UI Plan

Add a Delivery section in the job editor and delivery logs in run detail:

```text
+---------------------------------------------------------+
| Delivery Logs                                           |
| Inbox    success   2026-07-03 09:02                     |
| Desktop  success   2026-07-03 09:02                     |
| Feishu   failed    missing channel binding              |
+---------------------------------------------------------+
```

Keep delivery controls compact and use checkboxes for target enablement.

## Compatibility

- Jobs without `delivery_json` default to DeepChat Inbox plus failure notification only if product
  chooses that default; otherwise default to no delivery.
- Existing remote bindings are reused, not migrated.

## Test Strategy

- Router tests for success, failure, partial failure, and multiple targets.
- Remote port tests for mapping delivered message to run/session.
- Authorization tests proving unauthorized remote replies do not continue sessions.
- Renderer tests for delivery config and receipt display.

## Validation Commands

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- test/main/presenter/cronJobs`
- `pnpm test -- test/main/presenter/remoteControlPresenter`
- `pnpm test -- test/renderer`
