# Agent Tool Context Budget Tasks

- [x] Document diagnosis and first increment.
- [x] Add tool-definition token estimation to context budgeting.
- [x] Cap agent-loop default output budget.
- [x] Preflight-fit provider-loop requests.
- [x] Add effective per-request output cap and shared budget module.
- [x] Harden legacy function-call parsing.
- [x] Add 256-token provider-call safety margin and preflight backoff.
- [x] Trigger internal compaction/trim recovery before pressure-shrunk calls below 4000 output.
- [x] Keep recovered request messages in sync for later provider-loop iterations.
- [x] Apply safety-adjusted budget checks to tool-output continuation fitting.
- [x] Drop orphaned tool results and invalid provider options before AI SDK requests.
- [x] Report zero effective output tokens for unfittable preflight results.
- [ ] Add request budget telemetry.
- [ ] Add reasoning retention budget.
- [ ] Add compact legacy tool schema mode.
