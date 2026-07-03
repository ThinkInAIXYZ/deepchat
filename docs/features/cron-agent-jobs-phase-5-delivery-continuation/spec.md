# Cron Agent Jobs Phase 5: Remote Delivery And Continuation

## User Need

Users need scheduled run results to reach an enabled Remote channel where they already operate the
agent, and they need to continue the same run context from a supported remote thread.

## Goal

Add Remote delivery targets and continuation mapping:

- Deliver run results only to enabled Remote channels with an existing binding.
- Persist one delivery receipt per target.
- Link delivered remote messages back to the cron run and session.
- Continue the original session from inbound remote replies when the channel supports it.

## Delivery Model

```ts
type JobDelivery = {
  targets: DeliveryTarget[]
  createContinuableThread: boolean
  suppressSuccessNotification: boolean
  notifyOnFailure: boolean
}

type DeliveryTarget =
  | { type: 'remote'; remoteId: string; channelId: string; mode: 'summary' | 'full' }
```

## Acceptance Criteria

- A job can configure zero or more Remote delivery targets.
- Delivery can only be enabled when a Remote channel is enabled and has at least one binding.
- The job editor lets users select the target Remote binding.
- Every delivery attempt writes a receipt.
- Delivery failure records an error without changing the run result.
- Remote deliveries persist `runId` and `sessionId` mapping.
- A supported remote thread reply resolves to the original run session and continues that session.
- Multiple remote targets each receive independent receipts.

## UX Shape

```text
+---------------------------------------------------------+
| Delivery                                                |
| [x] Remote delivery                                     |
| Channel: [Feishu / group:oc_xxx v]                      |
|                                                         |
| [x] Allow continuing this run from delivery thread      |
+---------------------------------------------------------+
```

Run detail:

```text
+---------------------------------------------------------+
| Cron Run                                                |
| Delivery: Feishu failed                                 |
|                                                         |
| [Continue Session] [View Delivery Logs]                 |
+---------------------------------------------------------+
```

## Non-Goals

- No desktop notification, DeepChat Inbox, or origin-session delivery target in this phase.
- No new remote channel protocol.
- No best-effort continuation for channels that cannot correlate replies to delivered messages.
- No `cronjob` agent tool yet.
- No retry scheduler beyond explicit delivery retry action unless already supported by remote
  infrastructure.

## Constraints

- Use `RemoteControlPresenter` channel boundaries; do not put channel-specific formatting in Cron
  Jobs service.
- Remote continuation must enforce existing remote authorization and session binding rules.
- Delivery receipts must not store provider secrets.
- Output rendering must use existing remote block rendering where practical.

## Open Questions

None. Unsupported remote channels must show delivery-only behavior without continuation.
