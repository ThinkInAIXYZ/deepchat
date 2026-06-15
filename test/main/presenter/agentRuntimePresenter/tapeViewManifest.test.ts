import { describe, expect, it } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import {
  buildIncludedRefs,
  createTapeViewManifest,
  hashJson,
  resolveTapeViewManifestPolicy
} from '@/presenter/agentRuntimePresenter/tapeViewManifest'

function createRecord(overrides: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: 'm1',
    sessionId: 's1',
    orderSeq: 1,
    role: 'user',
    content: 'secret prompt content',
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  }
}

describe('tapeViewManifest', () => {
  it('hashes JSON with stable object key ordering', () => {
    expect(hashJson({ b: 1, a: { d: 4, c: 3 } })).toBe(hashJson({ a: { c: 3, d: 4 }, b: 1 }))
  })

  it('builds refs from context metadata without copying raw message content', () => {
    const refs = buildIncludedRefs(
      {
        includesSystemPrompt: true,
        includedRecords: [
          {
            record: createRecord({ id: 'u1', orderSeq: 3, content: 'do not persist this text' }),
            reason: 'selected_history'
          }
        ],
        excludedRecords: [],
        newUserMessageId: 'u2'
      },
      {
        entryIdByMessageId: new Map([
          ['u1', 11],
          ['u2', 12]
        ])
      }
    )

    expect(refs).toMatchObject([
      { entryId: null, role: 'system', reason: 'system_prompt', source: 'synthetic' },
      { entryId: 11, messageId: 'u1', orderSeq: 3, reason: 'selected_history', source: 'tape' },
      { entryId: 12, messageId: 'u2', reason: 'new_user_input', source: 'tape' }
    ])
    expect(JSON.stringify(refs)).not.toContain('do not persist this text')
  })

  it('creates deterministic prompt and manifest hashes without storing prompt bodies', () => {
    const input = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'secret prompt content' }],
      tools: [],
      latestEntryId: 7,
      anchorEntryIds: [1],
      included: [
        {
          entryId: 2,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user' as const,
          source: 'tape' as const,
          reason: 'selected_history' as const
        }
      ],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 123
    }

    const first = createTapeViewManifest(input)
    const second = createTapeViewManifest(input)

    expect(first.hashes).toEqual(second.hashes)
    expect(first.policy).toBe('legacy_context_v1')
    expect(first.policyVersion).toBe(1)
    expect(first.hashes.manifestHash).toHaveLength(64)
    expect(first.tokenBudget.estimatedPromptTokens).toBeGreaterThan(0)
    expect(JSON.stringify(first)).not.toContain('secret prompt content')
  })

  it('resolves initial Tape policy provenance and request-level shadow policies', () => {
    expect(
      resolveTapeViewManifestPolicy({
        recoveredFromContextPressure: false,
        isInitialViewRequest: true,
        viewPolicy: 'legacy_context_v1',
        viewPolicyVersion: 1
      })
    ).toEqual({
      policy: 'legacy_context_v1',
      policyVersion: 1
    })

    expect(
      resolveTapeViewManifestPolicy({
        recoveredFromContextPressure: false,
        isInitialViewRequest: true,
        viewPolicy: 'legacy_context_v1'
      })
    ).toEqual({
      policy: 'legacy_context_v1',
      policyVersion: null
    })

    expect(
      resolveTapeViewManifestPolicy({
        recoveredFromContextPressure: false,
        isInitialViewRequest: false,
        viewPolicy: 'legacy_context_v1',
        viewPolicyVersion: 1
      })
    ).toEqual({
      policy: 'tool_loop_shadow',
      policyVersion: null
    })

    expect(
      resolveTapeViewManifestPolicy({
        recoveredFromContextPressure: true,
        isInitialViewRequest: true,
        viewPolicy: 'legacy_context_v1',
        viewPolicyVersion: 1
      })
    ).toEqual({
      policy: 'context_pressure_recovery_shadow',
      policyVersion: null
    })
  })
})
