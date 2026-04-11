# Legacy Provider Runtime Retirement Plan

## Outcome

Legacy provider runtime retirement is complete and no rollback path remains in the codebase.

## Executed Plan

1. Remove runtime selection and make AI SDK the only request runtime.
2. Collapse provider implementations onto shared AI SDK helpers.
3. Remove legacy MCP tool conversion surface from presenter interfaces.
4. Delete obsolete provider SDK dependencies and refresh lockfiles.
5. Archive the migration history and point readers to the final legacy-code commit.

## Exit Conditions

- No remaining source imports of `openai`, `@anthropic-ai/sdk`, `@google/genai`, `together-ai`, or `@aws-sdk/client-bedrock-runtime`
- No `DEEPCHAT_LLM_RUNTIME` or `llmRuntimeMode` references remain
- Main-process provider tests validate AI SDK-only behavior
- Documentation explicitly marks the rollback path as retired
