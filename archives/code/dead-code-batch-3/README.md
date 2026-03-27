# Dead Code Batch 3

- Purpose: archive retired MCP runtime code that is no longer part of the active in-memory server set.
- Archived at: 2026-03-26
- Rationale: `meetingServer.ts` has been removed from live MCP registration and default config, but is retained in source form for precise rollback if the feature is rebuilt later.

## Archived Paths

- `src/main/presenter/mcpPresenter/inMemoryServers/meetingServer.ts`

## Notes

- This directory is not part of the runtime, build, typecheck, or test target set.
- Restore by moving files back to their original paths only if a future audit proves the retired MCP server is needed again.
