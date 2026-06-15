# Settings Save Clone Errors Plan

## Approach

Normalize renderer-owned settings payloads into plain objects before invoking config routes.
Keep route names, persisted config keys, and presenter contracts unchanged.

## Implementation

- Add a small recursive serializer in the renderer config client for arrays, objects, and dates.
- Apply the serializer to settings save paths that can receive Vue reactive proxies.
- Normalize DeepChat Agent model selections before building create/update payloads.
- Cover serialized bridge payloads with structured clone assertions.

## Verification

- `pnpm vitest --config vitest.config.renderer.ts test/renderer/api/clients.test.ts test/renderer/components/DeepChatAgentsSettings.test.ts`
