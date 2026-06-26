# ACP Plan Reachability Audit

## Summary

- Subsystem A (`llmProviderPresenter/providers/acpProvider.ts`) is the active ACP provider stream
  path. It calls `AcpContentMapper.map(notification)` and pushes `mapped.events` into the provider
  `EventQueue`.
- Subsystem A previously dropped `mapped.blocks`. This refactor adds an internal `LLMCoreStreamEvent`
  `type:'plan'` variant and accumulator handling that upserts the same shared `type:'plan'` block
  shape, so active ACP provider streams can persist plan blocks without inventing an IPC channel.
- Subsystem B (`acpClientPresenter/mapper/AcpEventMapper.ts`) maps `mapped.blocks` to
  `content.block` and `mapped.planEntries` to `plan.updated`, but repo grep finds no
  `mapSessionUpdate` call site. It is instantiated by `acpClientPresenter/index.ts`, but not proven
  live end-to-end.
- `MessageBlockPlan` remains the single renderer. `AcpContentMapper.handlePlanUpdate` now uses the
  shared plan-block builder, so ACP subsystem A, ACP subsystem B, and the agent-runtime path produce
  the same `type:'plan'` block shape.

## Decision For This Refactor

- Do not delete `MessageBlockPlan`.
- Keep the new internal `plan` stream event scoped to provider-to-accumulator transport.
- Keep subsystem B's block-capable mapper on the shared builder shape.
- Do not add a public IPC channel or a dedicated plan table for ACP plans.
