# DeepChat Agent vs ACP Agent

Status: current implementation, reviewed on 2026-07-13.

The agent-session separation is implemented:

- `kind=deepchat` uses the typed DeepChat backend, per-session instance and DeepChat-only LoopEngine.
- `kind=acp` uses the direct ACP backend and external ACP protocol loop.
- `kind=deepchat + providerId=acp` remains the explicit provider-compatibility path.

## Files

- [spec.md](./spec.md): current routing, ownership, data and lifecycle comparison.
- [Agent System Layered Runtime](../agent-system-layered-runtime/README.md): migration decisions, compatibility
  contract and final validation record.

## Stable conclusions

- Direct ACP cannot enter the DeepChat LoopEngine or fall back to a DeepChat backend.
- The ACP provider remains only for DeepChat descriptors that explicitly select it.
- Both paths write the existing app transcript/Tape/event projection, while their runtime state and loops remain
  separate.
- Permission promises/interactions settle on every decision/cancel/timeout/close path without replaying tool
  side effects.
