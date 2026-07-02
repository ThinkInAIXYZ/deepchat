# Cron Agent Jobs Phase 5: Delivery And Continuation

## User Need

Users need scheduled run results to reach the place where they work, and they need to continue the
same run context from DeepChat or from a supported remote thread.

## Goal

Add delivery targets and continuation mapping:

- Deliver run results to DeepChat Inbox, desktop notification, origin session, and supported remote
  channels.
- Persist one delivery receipt per target.
- Link delivered remote messages back to the cron run and session.
- Continue the original session from DeepChat UI or inbound remote replies.

## Delivery Model

```ts
type JobDelivery = {
  targets: DeliveryTarget[]
  createContinuableThread: boolean
  suppressSuccessNotification: boolean
  notifyOnFailure: boolean
}

type DeliveryTarget =
  | { type: 'deepchat_inbox' }
  | { type: 'desktop_notification' }
  | { type: 'remote'; remoteId: string; channelId?: string; mode: 'summary' | 'full' }
  | { type: 'origin_session'; sessionId: string }
```

## Acceptance Criteria

- A job can configure zero or more delivery targets.
- Success and failure delivery behavior can be configured separately.
- Every delivery attempt writes a receipt.
- Delivery failure records an error without changing the run result.
- Remote deliveries persist `runId` and `sessionId` mapping.
- A supported remote thread reply resolves to the original run session and continues that session.
- DeepChat UI Continue enters the same session.
- Multiple remote targets each receive independent receipts.

## UX Shape

```text
+---------------------------------------------------------+
| Delivery                                                |
| Send result to                                          |
| [x] DeepChat Inbox                                      |
| [x] Desktop Notification                                |
| [ ] Current Session                                     |
| [x] Remote                                              |
|     Remote: [Feishu Bot v]                              |
|     Channel: [DeepChat Alerts v]                        |
|     Content: [Summary v]                                |
|                                                         |
| [x] Allow continuing this run from delivery thread      |
+---------------------------------------------------------+
```

Run detail:

```text
+---------------------------------------------------------+
| Cron Run                                                |
| Delivery: Inbox OK | Desktop OK | Feishu failed         |
|                                                         |
| [Continue Session] [View Delivery Logs]                 |
+---------------------------------------------------------+
```

## Non-Goals

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
