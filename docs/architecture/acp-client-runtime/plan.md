# ACP Client Runtime Plan

## Runtime Boundary

Add `src/main/presenter/acpClientPresenter/` as the internal ACP runtime boundary. The first implementation keeps the current provider-facing API stable by making `AcpProvider` a compatibility adapter over the runtime.

The runtime owns:

- connection/process lifecycle and debug backlog;
- session lifecycle and MCP forwarding;
- prompt concurrency;
- client-side handlers for permissions, filesystem, terminal, and auth;
- event mapping from ACP updates to DeepChat stream/workspace events.

## Implementation Sequence

1. Create SDD docs and conformance checklist.
2. Add the ACP runtime facade and prompt controller.
3. Move provider construction to the runtime facade while keeping public behavior compatible.
4. Remove warmup `session/new` probing and let real session responses drive config/mode/model state.
5. Register persisted load-session handlers before `session/load` so replayed updates are not dropped.
6. Route debug actions through the initialized connection state and real MCP selections.
7. Harden fs and terminal workdir guards.
8. Refresh settings on ACP agent change events and release running processes before repair.
9. Add focused regression tests, then run formatting, i18n, and lint checks.

## Compatibility

- Existing ACP registry/manual agent configuration remains valid.
- Existing ACP conversation/session records remain valid.
- Provider id `acp` and model ids remain unchanged.
- No renderer IPC contract changes are required for this slice.
