# Agent Repeated Tool Loop

## Issue

The native Agent can repeatedly request the same tool batch with equivalent arguments after the
tools return exactly the same normalized results. The runtime currently allows that no-progress
cycle to continue until another limit, such as the 128 tool-call cap, is reached.

## Impact

- Repeated calls consume provider tokens and tool execution time without advancing the task.
- Side-effect-free tools can run many redundant times before the hard cap intervenes.
- The provider receives no explicit signal that its previous strategy produced no new evidence.

## Root Cause

`processStream` tracks only the aggregate tool-call count. It does not compare consecutive completed
tool batches, so semantically identical JSON arguments with different object-key order and identical
normalized tool results are treated as ordinary progress.

## Fix Plan

- Fingerprint each fully executed batch from canonical tool names, stable JSON arguments, and a
  compact hash of normalized tool-message contents. Normalize common generated IDs and timestamps
  in results while preserving semantic arguments and payload fields.
- Treat a changed call or result fingerprint as progress and reset the consecutive streak.
- After the second identical batch, append one structured correction to the last tool message sent
  to the next provider round, instructing the Agent to change strategy or finalize.
- After the fourth consecutive identical batch, stop before another provider request, finalize an
  error with `stopReason: 'no_progress'`, and terminally mark an open plan with `max_steps`.
- Persist the compact streak snapshot and observe the completed paused batch on permission/question
  resume so a pause cannot reset the guard.
- Treat acknowledgement-only results such as `ok` as weak evidence: still issue the correction, but
  do not hard-stop solely from those replies. The existing 128 tool-call cap remains the final bound.

## Tasks

- [x] Add the completed-batch fingerprint and consecutive-streak tracker.
- [x] Integrate correction and termination behavior into `processStream`.
- [x] Add deterministic process tests for correction, termination budgets, and streak resets.
- [x] Preserve streaks across interaction resume and normalize volatile result fields.
- [x] Avoid hard termination for acknowledgement-only result batches.
- [x] Add a native-Agent evaluation scenario for the no-progress terminal path.
- [ ] Run final unified tests, typecheck, format, i18n, lint, and build.

## Validation

- Stable-JSON-equivalent calls with the same result receive one correction after batch two.
- Four consecutive identical call-and-result batches execute four provider rounds and four tool
  calls, then return `no_progress` without a fifth provider call.
- Changing either arguments or normalized results resets the streak.
- Generated timestamps/IDs do not hide an otherwise repeated substantive result.
- UUIDs in semantic payload fields remain progress rather than being erased as transport metadata.
- Permission resume observes the completed paused batch without resetting the prior streak.
- Constant acknowledgement-only results receive correction but do not cause a false hard stop.
- The 128-call limit remains unchanged.

No GitHub issue is linked or requested for this change.
