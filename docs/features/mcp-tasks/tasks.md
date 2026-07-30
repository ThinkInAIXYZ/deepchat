# MCP Tasks Extension Tasks

Status: Gate 0 evaluated and blocked on an official public v2 result/dispatch adapter as of
2026-07-29.

## Required Upstream Condition

All implementation items remain gated until an official package or public v2 API can:

- [ ] return the extension's Task result without bypassing SDK result validation;
- [ ] dispatch get/update/cancel methods on modern wire without private transport access;
- [ ] receive validated Task notifications;
- [ ] expose a stable revision and compatibility contract.

## Post-Gate Work

After the upstream condition is met, update the spec against the stable API before implementation.
The design must cover official schema integration, durable lifecycle ownership, atomic history
updates, input handling, cancellation, restart/auth/deletion behavior, renderer status, and
packaged validation.

DeepChat must not claim MCP Tasks support while these items remain gated.
