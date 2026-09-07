import { describe, expect, it, vi } from 'vitest'
import {
  buildTapeViewSelection,
  DeepChatLoopRunner
} from '@/agent/deepchat/runtime/deepChatLoopRunner'
import { hashJsonData } from '@/tape/domain/canonicalJson'

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
          messageContentHashByMessageId: new Map(),
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

  it('carries pinned-user authority from initial selection into tool-loop manifests', () => {
    const appendViewManifest = vi.fn()
    const pinnedMessage = { role: 'user' as const, content: 'original task' }
    const contentHash = hashJsonData(pinnedMessage)
    const record = {
      id: 'user-1',
      sessionId: 'session-1',
      orderSeq: 1,
      role: 'user' as const,
      content: JSON.stringify({ text: 'original task', files: [] }),
      status: 'sent' as const,
      isContextEdge: 0,
      metadata: '{}',
      traceCount: 0,
      createdAt: 1,
      updatedAt: 1
    }
    const selection = buildTapeViewSelection({
      includedRecords: [{ record, reason: 'pinned_first_user', contentHash }],
      excludedRecords: [],
      summaryCursor: {
        summaryCursorOrderSeq: 2,
        preCursorOrderSeqMin: null,
        preCursorOrderSeqMax: null,
        preCursorCount: 0
      },
      includesSystemPrompt: false,
      pinnedFirstUser: {
        record,
        message: pinnedMessage,
        sourceContentHash: hashJsonData(record.content),
        contentHash
      }
    })
    const runner = new DeepChatLoopRunner({
      tape: {
        getViewManifestSourceMaps: vi.fn(() => ({
          latestEntryId: 11,
          anchorEntryIds: [1],
          reconstructionAnchorEntryIds: [1],
          reconstructionAnchorEntryId: null,
          entryIdByMessageId: new Map([['user-1', 11]]),
          messageContentHashByMessageId: new Map([
            ['user-1', hashJsonData(record.content)]
          ]),
          toolCallEntryIdByToolId: new Map(),
          toolResultEntryIdByToolId: new Map()
        })),
        appendViewManifest
      }
    } as never)

    expect(selection.pinnedFirstUser).toEqual({
      messageId: 'user-1',
      orderSeq: 1,
      sourceContentHash: hashJsonData(record.content),
      contentHash
    })
    runner.commitTapeProviderView({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      requestSeq: 2,
      taskType: 'tool_loop',
      policy: 'tool_loop_shadow',
      messages: [pinnedMessage, { role: 'assistant', content: 'working' }],
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
      summaryCursorOrderSeq: 2,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      contextBuilderVersion: 'cache-aware-v2',
      pinnedFirstUser: selection.pinnedFirstUser,
      toolSurfaceSnapshot: null,
      programmaticToolCapability: null
    })

    expect(appendViewManifest).toHaveBeenCalledOnce()
    expect(appendViewManifest.mock.calls[0][0].included[0]).toEqual({
      entryId: 11,
      messageId: 'user-1',
      orderSeq: 1,
      role: 'user',
      source: 'tape',
      reason: 'pinned_first_user',
      sourceEntryIds: [11],
      contentHash
    })
  })
})
