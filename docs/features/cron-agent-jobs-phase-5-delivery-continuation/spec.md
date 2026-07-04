# Cron Agent Jobs Phase 5: Remote Delivery

## User Need

Users need scheduled run results to reach an enabled Remote channel where they already operate the
agent.

## Goal

Add Remote delivery targets:

- Deliver run results only to enabled Remote channels with an existing binding.
- Persist one delivery receipt per target.
- Do not bind delivered messages into the normal Remote conversation context.

## Delivery Model

```ts
type JobDelivery = {
  targets: DeliveryTarget[]
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
- Remote deliveries are notifications only and never continue the original session.
- Scheduled delivery messages do not become normal Remote conversation context.
- Multiple remote targets each receive independent receipts.

## UX Shape

```text
+---------------------------------------------------------+
| Delivery                                                |
| [x] Remote delivery                                     |
| Channel: [Feishu / group:oc_xxx v]                      |
+---------------------------------------------------------+
```

Run detail:

```text
+---------------------------------------------------------+
| Cron Run                                                |
| Delivery: Feishu failed                                 |
|                                                         |
| Delivery receipts show success or failure status        |
+---------------------------------------------------------+
```

## Non-Goals

- No desktop notification, DeepChat Inbox, or origin-session delivery target in this phase.
- No new remote channel protocol.
- No inbound Remote continuation.
- No `cronjob` agent tool yet.
- No retry scheduler beyond explicit delivery retry action unless already supported by remote
  infrastructure.

## Constraints

- Use `RemoteControlPresenter` channel boundaries; do not put channel-specific formatting in Cron
  Jobs service.
- Delivery receipts must not store provider secrets.
- Output rendering must use existing remote block rendering where practical.

## Open Questions

None.
