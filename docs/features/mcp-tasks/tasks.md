# MCP Tasks Extension Tasks

Status: Gate 0 evaluated and blocked on an official public v2 result/dispatch adapter as of
2026-07-29.

## Upstream Gate

- [x] Inspect the official extension repository, schema, package registry, pinned commit
      `2c1425d9a288b9b1f489430fe1e00bb392b47e48`, and v2 client public declarations/runtime.
- [x] Confirm the v2 client exports Task schemas but no public API that can accept
      `resultType: "task"`, dispatch reserved `tasks/*`, or receive Task notifications.
- [x] Confirm `client.request(...)` is not an escape hatch because protocol-version enforcement
      rejects the reserved methods before transport dispatch.
- [x] Stop with no source, schema vendoring, migration, setting, table, coordinator, renderer UI, or
      extension advertisement.
- [x] Keep `MV-TASK-01` marked `BLOCKED` in the ecosystem runbook.

## Required Upstream Condition

All implementation items remain gated until an official package or public v2 API can:

- [ ] return the extension's Task result without bypassing SDK result validation;
- [ ] dispatch get/update/cancel methods on modern wire without private transport access;
- [ ] receive validated Task notifications;
- [ ] expose a stable revision and compatibility contract.

## Post-Gate Work

After the upstream condition is met, execute the detailed phases in `plan.md`:

- [ ] integrate official schemas and result/dispatch/notification APIs;
- [ ] add encrypted persistence and atomic tool-history replacement;
- [ ] add one bounded polling/subscription coordinator;
- [ ] share sampling/elicitation/roots input handling with direct v2 requests;
- [ ] add cooperative cancellation, restart/auth/deletion lifecycle, and renderer status controls;
- [ ] run focused persistence, scheduling, history, renderer, and packaged manual suites.

DeepChat must not claim MCP Tasks support while these items remain gated.
