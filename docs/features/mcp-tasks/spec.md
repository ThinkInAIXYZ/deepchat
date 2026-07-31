# MCP Tasks Extension Gate

Status: blocked on an official public v2 Tasks result/dispatch adapter as of 2026-07-29.

## Decision

DeepChat does not implement or advertise `io.modelcontextprotocol/tasks`.

`@modelcontextprotocol/client@2.0.0` exports Task schemas but its public API cannot accept
`resultType: "task"`, dispatch reserved `tasks/*` methods, or receive Task notifications. The
client rejects these values and methods before transport dispatch, so `client.request(...)` is not
an extension escape hatch.

DeepChat must not bypass SDK dispatch, monkey-patch the SDK registry, vendor the draft schema, or
write directly to a private transport. No setting, persistence table, coordinator, renderer UI, or
extension advertisement is added while this gate is closed.

## Upstream Baseline

- Repository commit:
  `2c1425d9a288b9b1f489430fe1e00bb392b47e48`
- Extension ID: `io.modelcontextprotocol/tasks`
- Draft specification:
  <https://github.com/modelcontextprotocol/ext-tasks/blob/2c1425d9a288b9b1f489430fe1e00bb392b47e48/specification/draft/tasks.md>
- Draft schema:
  <https://github.com/modelcontextprotocol/ext-tasks/blob/2c1425d9a288b9b1f489430fe1e00bb392b47e48/schema/draft/schema.json>
- Overview: <https://modelcontextprotocol.io/extensions/tasks/overview>
- v2 migration behavior:
  <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>

## Recheck Trigger

Reopen the design only when an official stable package or public v2 API can:

1. return the extension Task result through SDK validation;
2. dispatch get, update, and cancel methods on modern wire;
3. receive validated Task notifications;
4. provide a stable revision and compatibility contract.

Until then, `MV-TASK-01` remains `BLOCKED` in the ecosystem runbook and diagnostics must not claim
Tasks support.
