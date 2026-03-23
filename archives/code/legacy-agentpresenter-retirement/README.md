# Legacy AgentPresenter Retirement

- Purpose: archive the retired `AgentPresenter` runtime after `newAgentPresenter + deepchatAgentPresenter` became the only live chat execution path.
- Archived at: 2026-03-23
- Rationale: the remaining legacy runtime wiring, legacy loop compatibility surface, and legacy-only tests were removed from the live tree. Retained ACP/tool/message-formatting helpers were moved to new owner modules before archiving.

## Archived Paths

- `src/main/presenter/agentPresenter/`
- `src/shared/types/presenters/agent.presenter.d.ts`
- `test/main/presenter/agentPresenter/`
- `test/main/presenter/sessionPresenter/permissionHandler.test.ts`

## Notes

- This directory is not part of the runtime, build, typecheck, or test target set.
- Restore by moving files back to their original paths only if a future audit proves the retired legacy runtime is still needed.
