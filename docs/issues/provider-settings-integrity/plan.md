# Execution

- [ ] Revalidate findings against current source, callers, storage and rendered UI.
- [ ] Preserve custom models/configuration on failed edits; protect model identity/status.
- [ ] Preserve VoiceAI updates and report failed saves.
- [ ] Correct provider health invalidation and preserve explicit provider ordering.
- [ ] Repair onboarding targets/readiness and failed model-toggle outcomes.
- [ ] Separate test/enable and save/probe; provide explicit credential removal.
- [ ] Remove ineffective Vertex controls and expose required connection fields.
- [ ] Fit model actions at supported sizes, expose filtered batches and localize copy.
- [ ] Review and ablate each slice, commit independently, then run combined quality gates.
- [ ] Inspect actual rendered states, push, and follow PR checks to their terminal result.

## Evidence and decisions

Baseline: fix/provider-connection-save, 001691a8; PR #2386 is open against dev.
The previous review's claim that configured/health metadata failures duplicate creation was
retracted: those metadata writers already catch their failures. It is not a repair target.
The current request authorizes the previously identified lifecycle improvements as well as bugs.
