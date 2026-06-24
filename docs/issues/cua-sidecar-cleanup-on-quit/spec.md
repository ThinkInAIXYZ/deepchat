# CUA Sidecar Cleanup On Quit

## User Need

When DeepChat exits, the CUA MCP sidecar started by the official CUA plugin should not remain
running in the background. Residual `deepchat-cua-driver` processes make macOS permissions and
resource ownership confusing, and they can keep controlling computer-use resources after the app is
closed.

## Goal

Make normal DeepChat shutdown stop running MCP stdio servers earlier in the before-quit lifecycle so
CUA's sidecar process tree is terminated before presenters are destroyed.

## Acceptance Criteria

- DeepChat before-quit lifecycle includes a dedicated MCP shutdown hook before presenter teardown.
- The hook reuses the existing `McpPresenter.shutdown()` path instead of killing CUA by process name.
- MCP shutdown remains safe to call more than once during quit.
- Shutdown hook failures are logged but do not block application quit.
- Focused tests cover the hook and repeated/concurrent MCP shutdown behavior.

## Constraints

- Do not weaken the existing CUA sidecar-only safeguards from PR #1801.
- Do not terminate arbitrary user-installed CUA or upstream `CuaDriver.app` processes by name.
- Do not remove the existing final `presenter.destroy()` MCP shutdown fallback.
- Do not add user-facing UI or settings.

## Non-Goals

- Guaranteed cleanup after crashes, SIGKILL, or OS force-kill events.
- Startup-time cleanup of historical orphaned CUA processes.
- Reworking the MCP SDK stdio transport spawn implementation.

## Open Questions

None.
