import { describe, expect, it, vi } from 'vitest'
import { DeepChatLoopRunner } from '@/agent/deepchat/runtime/deepChatLoopRunner'

describe('DeepChatLoopRunner', () => {
  it('fails closed when a durable manifest is requested without Skill contexts', () => {
    const appendViewManifest = vi.fn()
    const runner = new DeepChatLoopRunner({
      tape: {
        getViewManifestSourceMaps: vi.fn(() => ({
          latestEntryId: 0,
          anchorEntryIds: [],
          reconstructionAnchorEntryIds: [],
          reconstructionAnchorEntryId: null,
          entryIdByMessageId: new Map(),
          toolCallEntryIdByToolId: new Map(),
          toolResultEntryIdByToolId: new Map()
        })),
        appendViewManifest
      }
    } as never)

    expect(() =>
      runner.commitTapeProviderView({
        sessionId: 'session-1',
        messageId: 'message-1',
        requestSeq: 1,
        taskType: 'chat',
        policy: 'legacy_context_v1',
        messages: [],
        tools: [],
        tokenBudget: {
          contextLength: 8192,
          requestedMaxTokens: 1024,
          effectiveMaxTokens: 1024,
          reserveTokens: 1024,
          toolReserveTokens: 0
        },
        providerId: 'provider-1',
        modelId: 'model-1',
        summaryCursorOrderSeq: 1,
        supportsVision: false,
        supportsAudioInput: false,
        traceDebugEnabled: false,
        contextBuilderVersion: 'legacy-v1',
        runId: 'run-1',
        tapeIncarnationId: 'tape-1',
        skillContexts: [],
        requireDurableManifest: true,
        toolSurfaceSnapshot: null,
        programmaticToolCapability: null
      })
    ).toThrow('requires Skill contexts')
    expect(appendViewManifest).not.toHaveBeenCalled()
  })
})
