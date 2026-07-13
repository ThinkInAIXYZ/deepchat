import { describe, expect, it, vi } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import {
  buildContextWithMetadata,
  buildResumeContextWithMetadata
} from '@/presenter/agentRuntimePresenter/contextBuilder'
import {
  buildTapeChatView,
  buildTapeResumeView,
  getTapeContextHistoryRecords,
  TAPE_VIEW_ASSEMBLER_VERSION,
  TAPE_VIEW_HISTORY_SOURCE
} from '@/presenter/agentRuntimePresenter/tapeViewAssembler'
import {
  LEGACY_TAPE_VIEW_POLICY_ID,
  LEGACY_TAPE_VIEW_POLICY_VERSION,
  type TapeViewPolicy
} from '@/presenter/agentRuntimePresenter/tapeViewPolicy'

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
  it('matches legacy chat context assembly while recording tape provenance', () => {
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

    const legacy = buildContextWithMetadata('s1', 'next user', 'System', 1000, 100, store, false, {
      ...options,
      historyRecords
    })
    const assembled = buildTapeChatView({
      sessionId: 's1',
      newUserContent: 'next user',
      systemPrompt: 'System',
      contextLength: 1000,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords,
      options
    })

    expect(assembled.messages).toEqual(legacy.messages)
    expect(assembled.metadata).toEqual(legacy.metadata)
    expect(assembled.historyRecords).toEqual(historyRecords)
    expect(assembled.assemblerVersion).toBe(TAPE_VIEW_ASSEMBLER_VERSION)
    expect(assembled.historySource).toBe(TAPE_VIEW_HISTORY_SOURCE)
    expect(assembled.policyId).toBe(LEGACY_TAPE_VIEW_POLICY_ID)
    expect(assembled.policyVersion).toBe(LEGACY_TAPE_VIEW_POLICY_VERSION)
    expect(assembled.policySelectionReason).toBe('default')
  })

  it('matches legacy resume context assembly while recording tape provenance', () => {
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

    const legacy = buildResumeContextWithMetadata(
      's1',
      'resume-target',
      'System',
      260,
      100,
      store,
      false,
      {
        ...options,
        historyRecords: records
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

    expect(assembled.messages).toEqual(legacy.messages)
    expect(assembled.metadata).toEqual(legacy.metadata)
    expect(assembled.historyRecords).toEqual(records)
    expect(assembled.assemblerVersion).toBe(TAPE_VIEW_ASSEMBLER_VERSION)
    expect(assembled.historySource).toBe(TAPE_VIEW_HISTORY_SOURCE)
    expect(assembled.policyId).toBe(LEGACY_TAPE_VIEW_POLICY_ID)
    expect(assembled.policyVersion).toBe(LEGACY_TAPE_VIEW_POLICY_VERSION)
    expect(assembled.policySelectionReason).toBe('default')
  })

  it('records requested and fallback policy selection reasons', () => {
    const records = [makeUserRecord(1, 'old user')]
    const store = createMockMessageStore(records)

    const requested = buildTapeChatView({
      sessionId: 's1',
      newUserContent: 'next user',
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
      newUserContent: 'next user',
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
    expect(fallback.policyId).toBe(LEGACY_TAPE_VIEW_POLICY_ID)
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
      newUserContent: 'next user',
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
