# Plan

## Review findings

CodeRabbit comments are valid. Three runtime/client issues are functional or stability risks and should be fixed before merge. Locale comments are lower risk but cheap and should also be fixed to keep UI consistent.

## Implementation approach

1. Update Feishu client CardKit send behavior:
   - Return `Promise<string>` from `sendCardEntity`.
   - Validate reply/create `message_id` immediately.
   - Throw a clear error if the id is absent or blank.

2. Update Feishu runtime streaming cleanup:
   - Add a local close helper in `deliverConversationWithStreamingCard` for cancellation and loop-exit paths.
   - Build card state immediately after `createStreamingCard`.
   - If `sendCardEntity` fails, close the created card best-effort and rethrow so existing fallback continues.

3. Update reviewed locale strings:
   - Localize new Feishu `/pair` and CardKit streaming-card copy in the commented locale files.
   - Preserve product names and permission strings.

## Test strategy

- Run Feishu client/runtime unit tests for the changed behavior.
- Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck` before commit.
