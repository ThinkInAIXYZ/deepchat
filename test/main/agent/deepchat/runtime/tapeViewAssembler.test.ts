import { describe, expect, it, vi } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import {
  buildCacheAwareContextWithMetadata,
  buildCacheAwareResumeContextWithMetadata,
  buildContextWithMetadata,
  buildResumeContextWithMetadata
} from '@/agent/deepchat/runtime/contextBuilder'
import {
  buildTapeChatView,
  buildTapeResumeView,
  getTapeContextHistoryRecords,
  TAPE_VIEW_ASSEMBLER_VERSION,
  TAPE_VIEW_HISTORY_SOURCE
} from '@/agent/deepchat/runtime/tapeViewAssembler'
import {
  CACHE_AWARE_TAPE_VIEW_POLICY_ID,
  CACHE_AWARE_TAPE_VIEW_POLICY_V1_ID,
  CACHE_AWARE_TAPE_VIEW_POLICY_VERSION,
  LEGACY_TAPE_VIEW_POLICY_ID,
  LEGACY_TAPE_VIEW_POLICY_VERSION,
  type TapeViewPolicy
} from '@/agent/deepchat/runtime/tapeViewPolicy'
import { createEmptyContextRuntimeContributions } from '@/agent/deepchat/runtime/contextContributions'

vi.mock('tokenx', () => ({
  approximateTokenSize: vi.fn((text: string) => Math.ceil(text.length / 4))
}))

function createMockMessageStore(messages: ChatMessageRecord[] = []) {
  return {
    getMessages: vi.fn().mockReturnValue(messages)
  } as any
}

function makeUserRecord(orderSeq: number, text: string): ChatMessageRecord {
  return {
    id: `user-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'user',
    content: JSON.stringify({ text, files: [], links: [], search: false, think: false }),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: orderSeq * 100,
    updatedAt: orderSeq * 100
  }
}

function makeAssistantRecord(
  orderSeq: number,
  text: string,
  status: ChatMessageRecord['status'] = 'sent'
): ChatMessageRecord {
  return {
    id: orderSeq === 4 ? 'resume-target' : `asst-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'assistant',
    content: JSON.stringify([
      { type: 'content', content: text, status: 'success', timestamp: orderSeq * 100 }
    ]),
    status,
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: orderSeq * 100,
    updatedAt: orderSeq * 100
  }
}

describe('TapeViewAssembler', () => {
  it('assembles the default cache-aware chat view while recording tape provenance', () => {
    const records = [
      makeUserRecord(1, 'old user'),
      makeAssistantRecord(2, 'old assistant'),
      makeUserRecord(3, 'recent user')
    ]
    const store = createMockMessageStore(records)
    const historyRecords = getTapeContextHistoryRecords(records)
    const options = {
      summaryCursorOrderSeq: 2,
      extraReserveTokens: 16,
      supportsAudioInput: false
    }

    const expected = buildCacheAwareContextWithMetadata(
      's1',
      { text: 'next user', files: [] },
      'System',
      1000,
      100,
      store,
      false,
      {
        ...options,
        historyRecords,
        pinFirstUser: true,
        contextContributions: createEmptyContextRuntimeContributions()
      }
    )
    const assembled = buildTapeChatView({
      sessionId: 's1',
      newUserContent: { text: 'next user', files: [] },
      systemPrompt: 'System',
      contextLength: 1000,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords,
      options
    })

    expect(assembled.messages).toEqual(expected.messages)
    expect(assembled.metadata).toEqual(expected.metadata)
    expect(assembled.messages.map((message) => message.content)).toEqual([
      'System',
      'old user',
      'old assistant',
      'recent user',
      'next user'
    ])
    expect(assembled.metadata.includedRecords[0]).toMatchObject({
      record: { id: 'user-1' },
      reason: 'pinned_first_user'
    })
    expect(assembled.historyRecords).toEqual(historyRecords)
    expect(assembled.assemblerVersion).toBe(TAPE_VIEW_ASSEMBLER_VERSION)
    expect(assembled.historySource).toBe(TAPE_VIEW_HISTORY_SOURCE)
    expect(assembled.policyId).toBe(CACHE_AWARE_TAPE_VIEW_POLICY_ID)
    expect(assembled.policyVersion).toBe(CACHE_AWARE_TAPE_VIEW_POLICY_VERSION)
    expect(assembled.policySelectionReason).toBe('default')
  })

  it('assembles the default cache-aware resume view while recording tape provenance', () => {
    const records = [
      makeUserRecord(1, 'old user'),
      makeAssistantRecord(2, 'old assistant'),
      makeUserRecord(3, 'recent user'),
      makeAssistantRecord(4, 'partial answer', 'pending')
    ]
    const store = createMockMessageStore(records)
    const options = {
      summaryCursorOrderSeq: 1,
      fallbackProtectedTurnCount: 1,
      extraReserveTokens: 12,
      supportsAudioInput: false
    }

    const expected = buildCacheAwareResumeContextWithMetadata(
      's1',
      'resume-target',
      'System',
      260,
      100,
      store,
      false,
      {
        ...options,
        historyRecords: records,
        pinFirstUser: true,
        contextContributions: createEmptyContextRuntimeContributions()
      }
    )
    const assembled = buildTapeResumeView({
      sessionId: 's1',
      assistantMessageId: 'resume-target',
      systemPrompt: 'System',
      contextLength: 260,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords: records,
      options
    })

    expect(assembled.messages).toEqual(expected.messages)
    expect(assembled.metadata).toEqual(expected.metadata)
    expect(assembled.historyRecords).toEqual(records)
    expect(assembled.assemblerVersion).toBe(TAPE_VIEW_ASSEMBLER_VERSION)
    expect(assembled.historySource).toBe(TAPE_VIEW_HISTORY_SOURCE)
    expect(assembled.policyId).toBe(CACHE_AWARE_TAPE_VIEW_POLICY_ID)
    expect(assembled.policyVersion).toBe(CACHE_AWARE_TAPE_VIEW_POLICY_VERSION)
    expect(assembled.policySelectionReason).toBe('default')
  })

  it('records requested and fallback policy selection reasons', () => {
    const records = [makeUserRecord(1, 'old user')]
    const store = createMockMessageStore(records)

    const requested = buildTapeChatView({
      sessionId: 's1',
      newUserContent: { text: 'next user', files: [] },
      systemPrompt: '',
      contextLength: 1000,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords: records,
      requestedPolicyId: LEGACY_TAPE_VIEW_POLICY_ID
    })

    const fallback = buildTapeChatView({
      sessionId: 's1',
      newUserContent: { text: 'next user', files: [] },
      systemPrompt: '',
      contextLength: 1000,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords: records,
      requestedPolicyId: 'missing-policy'
    })

    expect(requested.policySelectionReason).toBe('requested')
    expect(fallback.policySelectionReason).toBe('fallback_default')
    expect(fallback.policyId).toBe(CACHE_AWARE_TAPE_VIEW_POLICY_ID)
  })

  it('retains the v1 projection when explicitly requested', () => {
    const records = [makeUserRecord(1, 'original task'), makeAssistantRecord(2, 'answer')]
    const store = createMockMessageStore(records)
    const assembled = buildTapeChatView({
      sessionId: 's1',
      newUserContent: { text: 'next user', files: [] },
      systemPrompt: 'System',
      contextLength: 1000,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords: records,
      requestedPolicyId: CACHE_AWARE_TAPE_VIEW_POLICY_V1_ID,
      options: { summaryCursorOrderSeq: 2 }
    })

    expect(assembled.policyId).toBe(CACHE_AWARE_TAPE_VIEW_POLICY_V1_ID)
    expect(assembled.assemblerVersion).toBe('cache-aware-v1')
    expect(assembled.messages.some((message) => message.content === 'original task')).toBe(false)
    expect(assembled.metadata.pinnedFirstUser).toBeUndefined()
  })

  it('delegates assembly to an injected policy', () => {
    const records = [makeUserRecord(1, 'old user')]
    const store = createMockMessageStore(records)
    const customPolicy = {
      id: LEGACY_TAPE_VIEW_POLICY_ID,
      version: LEGACY_TAPE_VIEW_POLICY_VERSION,
      buildChat: vi.fn().mockReturnValue({
        messages: [{ role: 'user', content: 'from policy' }],
        metadata: {
          includedRecords: [],
          excludedRecords: [],
          includesSystemPrompt: false
        }
      }),
      buildResume: vi.fn()
    } satisfies TapeViewPolicy

    const assembled = buildTapeChatView({
      sessionId: 's1',
      newUserContent: { text: 'next user', files: [] },
      systemPrompt: '',
      contextLength: 1000,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords: records,
      policy: customPolicy
    })

    expect(customPolicy.buildChat).toHaveBeenCalledOnce()
    expect(assembled.messages).toEqual([{ role: 'user', content: 'from policy' }])
    expect(assembled.policyId).toBe(LEGACY_TAPE_VIEW_POLICY_ID)
    expect(assembled.policySelectionReason).toBe('injected')
  })
})
