# AI SDK System Message Warning Plan

## Approach

Adapt the final AI SDK call shape inside `src/main/presenter/llmProviderPresenter/aiSdk/runtime.ts`.

`buildPromptRuntime` will continue to map messages and build provider options using the current message list. After provider option mapping, it will split only the leading system messages into a top-level AI SDK `system` value and keep all remaining messages as the AI SDK `messages` value.

## Behavior

- Leading system message contents are trimmed and joined with a blank line.
- Empty leading system messages are dropped.
- Non-leading system messages are not moved. They stay in `messages`, and AI SDK rejects them because calls pass `allowSystemInMessages: false`.
- Provider options and tool mapping are computed before splitting so existing provider option behavior is preserved.

## Validation

- Add focused runtime tests for `generateText` and `streamText`.
- Cover multiple leading system messages, blank leading system messages, and non-leading system messages.
- Run the focused AI SDK runtime test file plus repository formatting, i18n, and lint checks.
