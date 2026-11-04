# Remaining Renderer Boundary Work

The maintained startup, window, navigation, and MCP contracts are in [spec.md](./spec.md).

- [ ] Extract remaining ChatPage-local orchestration only where an explicit owner reduces coupling;
      preserve the single `messageIpc` stream gate.
- [ ] Replace remaining Settings-to-chat implementation imports with explicit shared contracts as
      their owning features are changed. Keep the constrained-import baseline enforced.
- [ ] Extract an application service only if a real cross-feature orchestration duplicate appears;
      do not introduce an IPC forwarding facade.

For each selected slice, verify callers, asynchronous cancellation, disposal, and window ownership,
then run the relevant behavior suite and the repository quality/baseline checks.
