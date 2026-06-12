# Implementation Plan

- Reuse `ChatService` in the route runtime and call `sendMessage` after creating a scheduled task session.
- Load agents with `ConfigClient.listAgents()` in `ScheduledTasksSettings.vue`.
- Replace the raw agent ID input with an agent select and persist the selected agent plus its default provider/model preset.
- Keep manual model override available for users who need it.
