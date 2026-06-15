# DeepChat Tape View Assembler - Plan

## Architecture Decision

Add `src/main/presenter/agentRuntimePresenter/tapeViewAssembler.ts` as the production context
assembly boundary. The assembler resolves the active `TapeViewPolicy` through the selector and
constrains input history to tape-effective records.

## Flow

```text
processMessage()
  -> tapeService.ensureSessionTapeReady()
  -> compaction uses tape-ready context history
  -> TapeViewAssembler.buildChatView()
       -> TapeViewPolicy selector
       -> legacy_context_v1 policy
       -> return messages + metadata + assembler provenance
  -> runStreamForMessage()
  -> ViewManifest append

resumeAssistantMessage()
  -> tapeService.ensureSessionTapeReady()
  -> TapeViewAssembler.buildResumeView()
       -> TapeViewPolicy selector
       -> legacy_context_v1 policy
       -> return messages + metadata + assembler provenance
  -> runStreamForMessage()
```

## Module Changes

| Module | Change |
| --- | --- |
| `src/main/presenter/agentRuntimePresenter/tapeViewAssembler.ts` | New assembler boundary. |
| `src/main/presenter/agentRuntimePresenter/tapeViewPolicy.ts` | Selection policy boundary used by the assembler. |
| `src/main/presenter/agentRuntimePresenter/index.ts` | Replace direct metadata builder calls with assembler calls. |
| `test/main/presenter/agentRuntimePresenter/tapeViewAssembler.test.ts` | Add chat/resume parity tests. |
| `docs/architecture/deepchat_tape_spec_v1.md` | Update current implementation path and owner table. |

## Compatibility

- Provider-bound messages stay byte-for-byte equivalent for existing tests.
- `contextBuilder.ts` remains available for unit tests and compatibility helpers.
- ViewManifest `contextBuilderVersion` remains `legacy-v1`.

## Verification

```bash
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewAssembler.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeService.test.ts
pnpm vitest run test/renderer/components/trace/TraceDialog.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck:node
pnpm run typecheck:web
pnpm vitest run --reporter=dot
```
