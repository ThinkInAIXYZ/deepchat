# Assistant `action_type` Null Renderer Crash Plan

## Approach

- Normalize persisted action types inside `DeepChatMessageStore` while converting `DeepChatAssistantBlockRow` rows into `AssistantMessageBlock` objects.
- Return only `tool_call_permission`, `question_request`, or `rate_limit`; treat `null` and unknown strings as absent.
- Build the hydrated block with conditional spreading so omitted action types are not serialized as `null` or `undefined`.
- Keep `AssistantMessageBlockSchema` unchanged to preserve route/event validation.

## Tests

- Extend `messageStore` tests to materialize assistant rows containing nullable content/tool blocks and assert the resulting JSON omits `action_type`.
- Add a mixed persisted-block regression where an unknown value is omitted and a valid action block is retained.
- Pass hydrated blocks through `cloneBlocksForRenderer()` to verify the renderer snapshot contract accepts them.
