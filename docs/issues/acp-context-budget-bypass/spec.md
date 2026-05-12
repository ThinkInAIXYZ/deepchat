# ACP Context Budget Bypass Spec

> Status: Draft
> Date: 2026-05-12

## Background

ACP agents such as Claude Code maintain their own conversation and model context policy. DeepChat
currently routes ACP sessions through the generic agent runtime context preflight, which can block
ACP prompts before the ACP agent receives them with:

`Request was not sent because it cannot fit within the model context window after applying the safety margin.`

That check is appropriate for DeepChat-managed model calls, but ACP-backed requests should be
delegated to the ACP agent.

## Goals

- Skip DeepChat model-context preflight and recovery for every `providerId === 'acp'` request.
- Let ACP agents receive the prompt and handle context-window pressure themselves.
- Preserve current behavior for non-ACP providers.

## Acceptance Criteria

- ACP requests that exceed DeepChat's estimated context budget still reach the ACP provider.
- ACP requests do not trigger DeepChat context-pressure compaction or request trimming solely due to
  DeepChat's context-window estimate.
- ACP request max tokens are not shrunk by DeepChat's safety-margin preflight.
- Non-ACP providers keep existing preflight, compaction recovery, and overflow failure behavior.
- No public API, IPC, schema, or renderer UI changes are introduced.

## Non-Goals

- Redesign ACP prompt formatting.
- Reset or migrate existing session summaries.
- Change ACP workdir, permission, rate-limit, abort, or session lifecycle behavior.
