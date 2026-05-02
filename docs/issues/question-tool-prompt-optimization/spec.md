# Question Tool Prompt Optimization

## Summary

This change intentionally keeps the existing `deepchat_question` runtime contract unchanged.
It only improves model-facing content so the agent is more likely to use the tool and more likely to provide valid single-question arguments.

## Decisions

- Keep the public tool name as `deepchat_question`.
- Keep the current single-question schema:
  - `header?`
  - `question`
  - `options`
  - `multiple?`
  - `custom?`
- Do not add questionnaire support, alias fields, or runtime auto-repair.
- Improve:
  - schema field descriptions
  - tool definition description
  - system prompt guidance
  - validation error wording

## Non-Goals

- No new UI or remote behavior
- No state or protocol changes
- No compatibility parsing for `questions`, `allowOther`, or stringified `options`
