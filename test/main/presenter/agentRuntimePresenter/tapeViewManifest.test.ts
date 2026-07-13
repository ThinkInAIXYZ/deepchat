import { describe, expect, it } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import {
  buildIncludedRefs,
  buildRequestRefs,
  createTapeViewManifest,
  hashJson,
  resolveTapeViewManifestPolicy,
  verifyTapeViewManifestHash
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

  it('excludes wall-clock assembledAt from the manifest hash and viewId', () => {
    const baseInput = {
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
      included: [],
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
      traceDebugEnabled: false
    }

    const early = createTapeViewManifest({ ...baseInput, assembledAt: 100 })
    const late = createTapeViewManifest({ ...baseInput, assembledAt: 999999 })

    expect(early.assembledAt).toBe(100)
    expect(late.assembledAt).toBe(999999)
    expect(early.hashes.manifestHash).toBe(late.hashes.manifestHash)
    expect(early.viewId).toBe(late.viewId)
    expect(early.schemaVersion).toBe(2)
    expect(early.hashVersion).toBe(2)
    expect(early.viewId).toBe(`view_${early.hashes.manifestHash.slice(0, 16)}`)
  })

  it('verifies the manifest hash by hashVersion', () => {
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: 7,
      anchorEntryIds: [1],
      included: [],
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
      traceDebugEnabled: false
    })

    expect(verifyTapeViewManifestHash(manifest)).toBe('valid')
    expect(verifyTapeViewManifestHash({ ...manifest, latestEntryId: 999 })).toBe('invalid')
    expect(verifyTapeViewManifestHash({ ...manifest, hashVersion: 1 })).toBe('unverified')
  })

  it('converts summary cursor metadata into a bounded excluded range', () => {
    const baseInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: 7,
      anchorEntryIds: [1],
      included: [],
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
      summaryCursorOrderSeq: 3,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 123
    }

    const withCursor = createTapeViewManifest({
      ...baseInput,
      summaryCursor: {
        summaryCursorOrderSeq: 3,
        preCursorOrderSeqMin: 1,
        preCursorOrderSeqMax: 2,
        preCursorCount: 2
      }
    })
    expect(withCursor.excludedRanges).toEqual([
      { fromOrderSeq: 1, toOrderSeq: 2, count: 2, reason: 'before_summary_cursor' }
    ])

    const emptyCursor = createTapeViewManifest({
      ...baseInput,
      summaryCursor: {
        summaryCursorOrderSeq: 1,
        preCursorOrderSeqMin: null,
        preCursorOrderSeqMax: null,
        preCursorCount: 0
      }
    })
    expect(emptyCursor.excludedRanges).toBeUndefined()
  })

  it('binds the reconstruction anchor lineage into the manifest hash', () => {
    const baseInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: 7,
      anchorEntryIds: [5],
      reconstructionAnchorEntryId: 5,
      included: [],
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

    const withAnchor = createTapeViewManifest(baseInput)
    const withoutAnchor = createTapeViewManifest({
      ...baseInput,
      anchorEntryIds: [],
      reconstructionAnchorEntryId: null
    })

    expect(withAnchor.anchorEntryIds).toEqual([5])
    expect(withAnchor.reconstructionAnchorEntryId).toBe(5)
    expect('diagnosticAnchorEntryIds' in withAnchor).toBe(false)
    expect(withAnchor.hashes.manifestHash).not.toBe(withoutAnchor.hashes.manifestHash)
  })

  it('copies manifest refs so caller mutations cannot alter the hashed snapshot', () => {
    const input = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
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
      excluded: [
        {
          entryId: 3,
          messageId: 'u0',
          orderSeq: 0,
          role: 'user' as const,
          source: 'tape' as const,
          reason: 'out_of_budget' as const
        }
      ],
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

    const manifest = createTapeViewManifest(input)
    input.included[0].entryId = 99
    input.excluded[0].reason = 'empty_after_formatting'

    expect(manifest.included[0].entryId).toBe(2)
    expect(manifest.excluded[0].reason).toBe('out_of_budget')
    expect(manifest.hashes.manifestHash).not.toBe(createTapeViewManifest(input).hashes.manifestHash)
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

  it('builds synthetic request refs when no tape entries resolve', () => {
    expect(
      buildRequestRefs([
        { role: 'system', content: 'system' },
        { role: 'user', content: 'question' },
        { role: 'tool', content: 'tool output', tool_call_id: 'call_missing' }
      ])
    ).toMatchObject([
      { role: 'system', reason: 'system_prompt', source: 'synthetic' },
      { role: 'user', reason: 'selected_history', source: 'synthetic' },
      { role: 'tool', reason: 'tool_loop_message', source: 'synthetic', entryId: null }
    ])
  })

  it('grounds tool-loop refs to real tape entries via source maps', () => {
    const refs = buildRequestRefs(
      [
        { role: 'system', content: 'system' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }
          ]
        },
        { role: 'tool', content: 'result', tool_call_id: 'call_1' }
      ],
      {
        toolCallEntryIdByToolId: new Map([['call_1', 41]]),
        toolResultEntryIdByToolId: new Map([['call_1', 42]])
      }
    )

    expect(refs).toMatchObject([
      { role: 'system', reason: 'system_prompt', source: 'synthetic', entryId: null },
      { role: 'assistant', reason: 'tool_loop_message', source: 'tape', entryId: 41 },
      { role: 'tool', reason: 'tool_loop_message', source: 'tape', entryId: 42 }
    ])
  })

  it('grounds only the last occurrence of a reused tool id, keeping history synthetic', () => {
    const toolCall = (id: string) => ({
      id,
      type: 'function' as const,
      function: { name: 'search', arguments: '{}' }
    })
    const refs = buildRequestRefs(
      [
        { role: 'assistant', content: '', tool_calls: [toolCall('tc1')] },
        { role: 'tool', content: 'old', tool_call_id: 'tc1' },
        { role: 'assistant', content: '', tool_calls: [toolCall('tc1')] },
        { role: 'tool', content: 'new', tool_call_id: 'tc1' }
      ],
      {
        toolCallEntryIdByToolId: new Map([['tc1', 91]]),
        toolResultEntryIdByToolId: new Map([['tc1', 92]])
      }
    )

    expect(refs).toMatchObject([
      { role: 'assistant', source: 'synthetic', entryId: null },
      { role: 'tool', source: 'synthetic', entryId: null },
      { role: 'assistant', source: 'tape', entryId: 91 },
      { role: 'tool', source: 'tape', entryId: 92 }
    ])
  })
})
