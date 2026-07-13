import { describe, expect, it, vi } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import {
  buildContextWithMetadata,
  buildResumeContextWithMetadata
} from '@/presenter/agentRuntimePresenter/contextBuilder'
import {
  LEGACY_TAPE_VIEW_POLICY_ID,
  LEGACY_TAPE_VIEW_POLICY_VERSION,
  getTapeViewPolicy,
  legacyTapeViewPolicy,
  listTapeViewPolicies,
  resolveTapeViewPolicy
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

describe('legacyTapeViewPolicy', () => {
  it('matches legacy chat context builder output', () => {
    const records = [
      makeUserRecord(1, 'old user'),
      makeAssistantRecord(2, 'old assistant'),
      makeUserRecord(3, 'recent user')
    ]
    const store = createMockMessageStore(records)
    const input = {
      sessionId: 's1',
      newUserContent: 'next user',
      systemPrompt: 'System',
      contextLength: 1000,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords: records,
      options: {
        summaryCursorOrderSeq: 2,
        extraReserveTokens: 16,
        supportsAudioInput: false
      }
    }

    const legacy = buildContextWithMetadata(
      input.sessionId,
      input.newUserContent,
      input.systemPrompt,
      input.contextLength,
      input.reserveTokens,
      input.messageStore,
      input.supportsVision,
      {
        ...input.options,
        historyRecords: input.historyRecords
      }
    )
    const policyResult = legacyTapeViewPolicy.buildChat(input)

    expect(legacyTapeViewPolicy.id).toBe(LEGACY_TAPE_VIEW_POLICY_ID)
    expect(legacyTapeViewPolicy.version).toBe(LEGACY_TAPE_VIEW_POLICY_VERSION)
    expect(policyResult).toEqual(legacy)
  })

  it('matches legacy resume context builder output', () => {
    const records = [
      makeUserRecord(1, 'old user'),
      makeAssistantRecord(2, 'old assistant'),
      makeUserRecord(3, 'recent user'),
      makeAssistantRecord(4, 'partial answer', 'pending')
    ]
    const store = createMockMessageStore(records)
    const input = {
      sessionId: 's1',
      assistantMessageId: 'resume-target',
      systemPrompt: 'System',
      contextLength: 260,
      reserveTokens: 100,
      messageStore: store,
      supportsVision: false,
      historyRecords: records,
      options: {
        summaryCursorOrderSeq: 1,
        fallbackProtectedTurnCount: 1,
        extraReserveTokens: 12,
        supportsAudioInput: false
      }
    }

    const legacy = buildResumeContextWithMetadata(
      input.sessionId,
      input.assistantMessageId,
      input.systemPrompt,
      input.contextLength,
      input.reserveTokens,
      input.messageStore,
      input.supportsVision,
      {
        ...input.options,
        historyRecords: input.historyRecords
      }
    )
    const policyResult = legacyTapeViewPolicy.buildResume(input)

    expect(policyResult).toEqual(legacy)
  })
})

describe('TapeViewPolicy registry', () => {
  it('lists and resolves the built-in legacy policy', () => {
    expect(listTapeViewPolicies()).toEqual([legacyTapeViewPolicy])
    expect(getTapeViewPolicy(LEGACY_TAPE_VIEW_POLICY_ID)).toBe(legacyTapeViewPolicy)
    expect(getTapeViewPolicy(` ${LEGACY_TAPE_VIEW_POLICY_ID} `)).toBe(legacyTapeViewPolicy)
    expect(getTapeViewPolicy('missing-policy')).toBeNull()
    expect(getTapeViewPolicy('')).toBeNull()
  })

  it('resolves default, requested, and fallback selections', () => {
    expect(resolveTapeViewPolicy()).toEqual({
      policy: legacyTapeViewPolicy,
      requestedPolicyId: null,
      reason: 'default'
    })

    expect(resolveTapeViewPolicy({ requestedPolicyId: LEGACY_TAPE_VIEW_POLICY_ID })).toEqual({
      policy: legacyTapeViewPolicy,
      requestedPolicyId: LEGACY_TAPE_VIEW_POLICY_ID,
      reason: 'requested'
    })

    expect(resolveTapeViewPolicy({ requestedPolicyId: 'missing-policy' })).toEqual({
      policy: legacyTapeViewPolicy,
      requestedPolicyId: 'missing-policy',
      reason: 'fallback_default'
    })
  })
})
