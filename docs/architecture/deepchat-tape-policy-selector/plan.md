# DeepChat Tape Policy Selector - Plan

## Architecture Decision

Keep selector logic inside `src/main/presenter/agentRuntimePresenter/tapeViewPolicy.ts`. This avoids
adding a service and keeps the policy boundary local to the assembler.

## Flow

```text
TapeViewAssembler.buildTapeChatView()
  -> resolveTapeViewPolicy()
  -> policy.buildChat()
  -> return messages + policy id/version + selection reason

TapeViewAssembler.buildTapeResumeView()
  -> resolveTapeViewPolicy()
  -> policy.buildResume()
  -> return messages + policy id/version + selection reason
```

## Module Changes

| Module | Change |
| --- | --- |
| `src/main/presenter/agentRuntimePresenter/tapeViewPolicy.ts` | Add registry, lookup, list, and resolver helpers. |
| `src/main/presenter/agentRuntimePresenter/tapeViewAssembler.ts` | Resolve default policy through selector. |
| `test/main/presenter/agentRuntimePresenter/tapeViewPolicy.test.ts` | Cover registry and selector behavior. |
| `test/main/presenter/agentRuntimePresenter/tapeViewAssembler.test.ts` | Assert selection reason and injected policy behavior. |
| `docs/architecture/deepchat_tape_spec_v1.md` | Record the selector boundary. |

## Compatibility

- The default resolved policy remains `legacy_context_v1`.
- Existing injected policy tests continue to work.
- ViewManifest policy provenance remains `legacy_context_v1@1` for chat and resume.

## Verification

```bash
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewPolicy.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewAssembler.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewManifest.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck:node
pnpm run typecheck:web
pnpm vitest run --reporter=dot
```
