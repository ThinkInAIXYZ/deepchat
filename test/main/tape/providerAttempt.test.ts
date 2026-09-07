import { describe, expect, it } from 'vitest'
import {
  buildTapeProviderAttemptEvent,
  parseTapeProviderAttemptEvent
} from '@/tape/domain/providerAttempt'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'

function completedAttempt() {
  return buildTapeProviderAttemptEvent({
    sessionId: 'session-1',
    messageId: 'message-1',
    logicalRound: 1,
    requestSeq: 1,
    physicalAttempt: 1,
    requestOrigin: 'chat',
    attemptOrigin: 'initial',
    providerId: 'provider-1',
    modelId: 'model-1',
    status: 'completed',
    stopReason: 'complete',
    failureClassification: null,
    retryDecision: 'none',
    httpStatus: null,
    errorCode: null,
    retryDelayMs: null,
    usage: {
      inputTokens: 1_001,
      outputTokens: 1,
      totalTokens: 1_002,
      cacheReadTokens: 900
    },
    contextPressure: {
      kind: 'successful_prompt_overflow',
      contextWindowTokens: 1_000,
      thresholdTokens: 1_000
    }
  })
}

function row(data: Record<string, unknown>): DeepChatTapeEntryRow {
  return {
    session_id: 'session-1',
    entry_id: 1,
    kind: 'event',
    name: 'provider/attempt_completed',
    source_type: 'runtime_event',
    source_id: 'message-1',
    source_seq: 1,
    provenance_key: 'provider-attempt:session-1:message-1:1:1',
    payload_json: JSON.stringify({ name: 'provider/attempt_completed', data }),
    meta_json: '{}',
    created_at: 1
  }
}

describe('provider attempt context pressure', () => {
  it('round-trips a valid schema v3 pressure observation', () => {
    const attempt = completedAttempt()

    expect(parseTapeProviderAttemptEvent(row(attempt))).toEqual(attempt)
  })

  it('keeps schema v1 and v2 attempts readable without inventing pressure', () => {
    const current = completedAttempt()
    const v2 = { ...current, schemaVersion: 2 } as Record<string, unknown>
    delete v2.contextPressure
    const v1 = {
      schemaVersion: 1,
      messageId: current.messageId,
      requestSeq: current.requestSeq,
      providerId: current.providerId,
      modelId: current.modelId,
      status: current.status,
      stopReason: current.stopReason,
      usage: current.usage,
      cacheHitRate: current.cacheHitRate
    }

    expect(parseTapeProviderAttemptEvent(row(v1))).toEqual({ ...v1, contextPressure: null })
    expect(parseTapeProviderAttemptEvent(row(v2))).toEqual({ ...v2, contextPressure: null })
  })

  it.each([
    { contextPressure: undefined },
    { contextPressure: { kind: 'unknown', contextWindowTokens: 1_000, thresholdTokens: 1_000 } },
    {
      contextPressure: {
        kind: 'successful_prompt_overflow',
        contextWindowTokens: 0,
        thresholdTokens: 1_000
      }
    },
    {
      contextPressure: {
        kind: 'successful_prompt_overflow',
        contextWindowTokens: 1_000,
        thresholdTokens: 999
      }
    }
  ])(
    'ignores malformed schema v3 pressure data without discarding the attempt: %#',
    ({ contextPressure }) => {
      const malformed = { ...completedAttempt() } as Record<string, unknown>
      if (contextPressure === undefined) {
        delete malformed.contextPressure
      } else {
        malformed.contextPressure = contextPressure
      }

      expect(parseTapeProviderAttemptEvent(row(malformed))).toEqual({
        ...malformed,
        contextPressure: null
      })
    }
  )

  it('accepts an explicit null pressure observation', () => {
    const attempt = { ...completedAttempt(), contextPressure: null }

    expect(parseTapeProviderAttemptEvent(row(attempt))).toEqual(attempt)
  })

  it('preserves a valid historical zero-output threshold without reapplying current policy', () => {
    const attempt = {
      ...completedAttempt(),
      stopReason: 'max_tokens',
      usage: {
        inputTokens: 980,
        outputTokens: 0,
        totalTokens: 980,
        cacheReadTokens: 900,
        cacheWriteTokens: null
      },
      cacheHitRate: 900 / 980,
      contextPressure: {
        kind: 'zero_output_length_at_limit',
        contextWindowTokens: 1_000,
        thresholdTokens: 980
      }
    }

    expect(parseTapeProviderAttemptEvent(row(attempt))).toEqual(attempt)
  })
})
