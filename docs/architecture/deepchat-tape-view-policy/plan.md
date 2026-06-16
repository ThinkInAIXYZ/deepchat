# DeepChat Tape View Policy - Plan

## Architecture Decision

Add `src/main/presenter/agentRuntimePresenter/tapeViewPolicy.ts`. The policy owns calls into
`contextBuilder.ts`; `TapeViewAssembler` owns production orchestration and provenance.

## Flow

```text
TapeViewAssembler.buildTapeChatView()
  -> select default legacy_context_v1 policy
  -> policy.buildChat()
  -> return messages + metadata + policy id/version

TapeViewAssembler.buildTapeResumeView()
  -> select default legacy_context_v1 policy
  -> policy.buildResume()
  -> return messages + metadata + policy id/version
```

## Module Changes

| Module | Change |
| --- | --- |
| `src/main/presenter/agentRuntimePresenter/tapeViewPolicy.ts` | New policy interface and legacy policy implementation. |
| `src/main/presenter/agentRuntimePresenter/tapeViewAssembler.ts` | Delegate selection to `TapeViewPolicy`. |
| `test/main/presenter/agentRuntimePresenter/tapeViewPolicy.test.ts` | Prove legacy policy parity. |
| `test/main/presenter/agentRuntimePresenter/tapeViewAssembler.test.ts` | Assert policy metadata and policy delegation. |
| `docs/architecture/deepchat-tape-baseline/spec.md` | Record the new policy boundary. |

## Compatibility

- No runtime behavior change.
- `contextBuilder.ts` remains the legacy algorithm implementation.
- The default policy is fixed to `legacy_context_v1`.

## Verification

```bash
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewPolicy.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewAssembler.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck:node
pnpm run typecheck:web
pnpm vitest run --reporter=dot
```
