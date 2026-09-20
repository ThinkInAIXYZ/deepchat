# Agent Judgment Model

Status: proposed.

## Context

`DeepChatAgentConfig.assistantModel` is a single `{providerId, modelId}` pair that currently has five
runtime readers: tool-permission review, context compaction, session title generation, session
translation, and memory consolidation. Issue #2326 wants TypeSafe's Jev usable as an independent
permission-review backend, which is impossible while review and compaction share one setting.

Jev cannot replace the generative assistant model, because it does not generate text. Compaction in
particular produces a rolling summary string (`compactionService.generateRollingSummary` ->
`BaseLLMProvider.summaries`) and reads the chosen model's `contextLength` for budgeting, so a
non-generative model cannot serve it. This goal therefore adds a separate, narrowly scoped slot and
leaves every existing `assistantModel` reader untouched.

This document covers the agent-facing half. The provider/protocol half is a separate goal in
`docs/features/typesafe-jev-provider/`.

## Goals

- Add an explicit, opt-in `judgmentModel` slot to a DeepChat agent.
- Restrict that slot to Jev-protocol (`ModelType.Judgment`) models.
- When set, run tool-permission review against it through the System One protocol.
- When unset, preserve today's behaviour exactly.
- Keep the review result type and the permission interaction flow unchanged.

## Non-goals

- Replacing or repointing `assistantModel` for compaction, title generation, translation, or memory
  consolidation.
- Default-enabling Jev review. The capability is experimental and opt-in.
- Widening which tools require review, or relaxing existing permission rules.
- Letting the review model execute tools, read files, or investigate the environment.
- Requiring Jev to produce free-text explanations equivalent to the generative reviewer.
- Enabling the capability on the basis of successful API calls alone; issue #2326 requires
  evaluation evidence before adoption.

## Design

### Configuration

`DeepChatAgentConfig` gains `judgmentModel?: DeepChatAgentModelSelection | null`, a sibling of
`assistantModel`. It is added to the agent config type, the config schema, and the repository's
merge list so it round-trips through the agents table.

The global config-entry surface (`CONFIG_ENTRY_KEYS`) is deliberately not extended: the slot is
per-agent, and the legacy global key is a migration source rather than a new home.

### Settings UI

The agent settings form gains one more model field alongside the existing pickers, filtered to
`ModelType.Judgment` through the existing per-field type filter. The picker reuses `ModelSelect`;
no new component is introduced. The field is dirty-tracked by the existing signature mechanism and
saved through the existing patch path.

Because the slot is Jev-only, a judgment model can never be selected into a chat-shaped slot, and a
chat model can never be selected into the judgment slot.

### Review backend selection

`reviewAutoApproveToolPermission` currently resolves `config.assistantModel` and calls
`generateCompletionStandalone` with a system prompt demanding strict JSON, then parses that JSON
back out of free text.

With a judgment model configured, the reviewer instead:

1. computes the action envelope and its hash in code, exactly as today;
2. builds the review `state` from the exact action, its arguments, the permission context, and the
   recent transcript;
3. asks a fixed set of atomic questions in one System One call;
4. composes the returned typed answers into a `ToolPermissionReviewResult` in code.

With no judgment model configured, the existing generative path runs unchanged.

### Action binding

The current generative path requires the model to echo `actionHash` and downgrades to `ask_user` on
mismatch. Jev does not generate text and cannot echo anything, so the hash echo is replaced by
code-side binding: the request is keyed by the action hash, and the result is applied only to that
action and its exact arguments. A result is never reused for a different action.

This preserves the existing invariant — a review verdict belongs to one specific action and its
arguments — while removing the mechanism that depended on text generation.

### Question set and thresholds

Following TypeSafe's own review guidance, the questions and every threshold live in a single
reviewable file rather than being spread through the review logic, because the questions and
thresholds are the parts a human must review.

Questions are atomic and composed in code rather than asking one question to reason end to end:

- a `Choice` over the risk level;
- a `Noul` for whether the recent transcript clearly authorizes this class of action;
- a `Noul` for whether the state contains content attempting to steer the decision.

Composition rules, all enforced in code:

- `critical` risk blocks; `high` risk asks the user. These existing constraints are preserved and
  are not overridable by the model.
- An action is auto-allowed only when its risk is at or below `autoAllowMaxRiskLevel`, the
  authorization signal clears its threshold, the risk answer is confident enough, and no injection
  signal is present.
- Any uncertain, invalid, failed, or timed-out review asks the user.
- An action that explicitly requires user confirmation keeps that confirmation; Jev never overrides
  it.

**Intentional policy difference from the generative path.** The generative reviewer allows low *and*
medium risk. The judgment path caps auto-allow at `low`, so switching an agent to a judgment model
makes it strictly more interruptive. That is deliberate for an opt-in path and the cap is a named
threshold rather than a literal, so it can be changed in one reviewable place.

It has a consequence for the evaluation in issue #2326 that must be accounted for: because the two
paths do not share a policy, an evaluation that measures interruptions is not measuring the model
alone. The cap should be aligned with the generative path before drawing a conclusion about Jev's
judgment quality.

### Confidence semantics

`confidence` describes how concentrated the answer distribution is. It is not a permission to act
and is not treated as a safety guarantee. A `Noul` near `0.5` means the yes/no probabilities are
similar, not that the risk is moderate. Thresholds are per-decision and start conservative, and are
recorded alongside the questions so they can be revised against evaluation evidence.

### Rationale

`rationale` is produced by mapping the structured classification to fixed local copy. It is not
presented as model-authored explanation, because the model does not author text.

### Input scope

The review state is filtered before it is sent: only the fields the questions need. TypeSafe's
documented weakness is that accuracy degrades as state grows with irrelevant detail, and the
current reviewer sends up to eight messages of up to 2,000 characters each plus full tool
arguments. Reusing that payload verbatim would work against the questions.

Tool results are retained deliberately, because they are a primary prompt-injection vector and the
injection question needs to see them. That makes truncation direction matter: head-only truncation
would hide an instruction placed at the end of a long tool result, which is exactly the content the
injection question exists to catch. The judgment state therefore keeps both the head and the tail of
each message. The generative path keeps its existing head-only truncation, so that path's prompt is
byte-for-byte unchanged.

## Invariants

- A review verdict is bound to one action hash and its exact arguments.
- `critical` still blocks and `high` still asks the user, regardless of model output.
- Failure, timeout, and invalid output ask the user.
- A cancelled turn never receives a verdict: the judgment path performs the same post-call abort
  re-check as the generative path, so a judgment that resolves after cancellation is discarded.
- An already-aborted caller signal is never silently dropped by the provider's request signal.
- Explicit user-confirmation requirements are never overridden.
- `assistantModel` readers other than permission review are unchanged.
- The selected judgment model takes effect on the next review without a restart, because the
  reviewer re-resolves agent config per call.

## Compatibility

- With `judgmentModel` unset, review behaviour is byte-for-byte the existing behaviour.
- Existing stored agent rows parse unchanged; the new field is optional.
- The permission interaction flow and `ToolPermissionReviewResult` shape are unchanged.

## Acceptance criteria

- An agent can be configured with a judgment model, and the selection persists across reload.
- The judgment picker offers only Jev-protocol models.
- With a judgment model set, review issues a System One request and maps typed answers to the
  existing result shape; no text JSON parsing is involved.
- With no judgment model set, the existing generative review path runs and existing tests pass
  unchanged.
- A `critical` verdict from the model still blocks and a `high` verdict still asks the user.
- Timeout, HTTP failure, and malformed answers all resolve to `ask_user`.
- The same verdict cannot be applied to a different action or different arguments.
- Compaction, title generation, translation, and memory consolidation continue to read
  `assistantModel`.

## Open questions

- The exact threshold values are placeholders until the evaluation in issue #2326 produces evidence.
- Whether the Chinese-language authorization scenarios documented as lower-accuracy by TypeSafe
  clear an acceptable bar is an evaluation outcome, not an implementation decision.
