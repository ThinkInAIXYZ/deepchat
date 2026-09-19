import { describe, expect, it } from 'vitest'

import {
  buildBatchDecisionPrompt,
  parseBatchDecisionResults,
  partitionBatchDecisions,
  type BatchDecisionInput
} from '@/memory/core/batchDecision'
import { ATEMPORAL_MEMORY_METADATA } from '@/memory/core/temporal'

function input(
  candidateIndex: number,
  content = `candidate-${candidateIndex}`
): BatchDecisionInput {
  return {
    candidateIndex,
    candidate: {
      kind: 'semantic',
      category: null,
      content,
      importance: 0.5,
      temporal: ATEMPORAL_MEMORY_METADATA
    },
    neighbors: [
      { content: `neighbor-${candidateIndex}-0` },
      { content: `neighbor-${candidateIndex}-1` },
      { content: `neighbor-${candidateIndex}-2` }
    ]
  }
}

describe('batch memory decisions', () => {
  it('partitions at four candidates and two batches', () => {
    const result = partitionBatchDecisions(Array.from({ length: 9 }, (_, index) => input(index)))
    expect(result.partitions.map((partition) => partition.inputs.length)).toEqual([4, 4])
    expect(result.fallbackCandidateIndexes).toEqual([8])
    expect(result.partitions.every((partition) => partition.estimatedTokens <= 12_000)).toBe(true)
  })

  it('drops neighbor excerpts before falling back under a dense token budget', () => {
    const dense = input(0, '\u4e2d'.repeat(2_000))
    dense.neighbors = [{ content: '\u6587'.repeat(400) }, { content: '\u5b57'.repeat(400) }]
    const result = partitionBatchDecisions([dense])
    expect(result.fallbackCandidateIndexes).toEqual([])
    expect(result.partitions).toHaveLength(1)
    expect(result.partitions[0].estimatedTokens).toBeLessThanOrEqual(12_000)
  })

  it('drops the lowest-priority batch neighbors before splitting dense candidates', () => {
    const dense = Array.from({ length: 4 }, (_, index) => input(index, '\u4e2d'.repeat(1_700)))
    dense.forEach((item) => {
      item.neighbors = Array.from({ length: 5 }, (_, index) => ({
        content: `${index}${'\u6587'.repeat(399)}`
      }))
    })
    const result = partitionBatchDecisions(dense)
    expect(result.partitions.map((partition) => partition.inputs.length)).toEqual([4])
    expect(result.partitions[0].inputs.every((item) => item.neighbors.length <= 3)).toBe(true)
    expect(result.partitions[0].inputs.some((item) => item.neighbors.length < 3)).toBe(true)
    expect(result.partitions[0].estimatedTokens).toBeLessThanOrEqual(12_000)
    expect(result.fallbackCandidateIndexes).toEqual([])
  })

  it('renders indexed candidates and untrusted-data guidance', () => {
    const base = input(3)
    const temporal: BatchDecisionInput = {
      ...base,
      candidateTemporalAnnotation: '[Temporal: current state]',
      neighbors: [
        {
          ...base.neighbors[0],
          temporalAnnotation: '[Temporal: expired state]'
        },
        ...base.neighbors.slice(1)
      ]
    }
    const prompt = buildBatchDecisionPrompt([temporal])
    expect(prompt).toContain('Candidate 3')
    expect(prompt).toContain('candidate-3 [Temporal: current state]')
    expect(prompt).toContain('[0] neighbor-3-0 [Temporal: expired state]')
    expect(prompt).toContain('untrusted')
  })

  it('accepts the first valid occurrence for each candidate index', () => {
    const results = parseBatchDecisionResults(
      '[{"candidateIndex":0,"decision":"NOOP","targetIndex":1},' +
        '{"candidateIndex":0,"decision":"ADD","targetIndex":null}]',
      [input(0)]
    )
    expect(results.get(0)).toMatchObject({
      valid: true,
      decision: { decision: 'NOOP', targetIndex: 1 }
    })
  })

  it('marks oversized merged content invalid without affecting other items', () => {
    const results = parseBatchDecisionResults(
      JSON.stringify([
        {
          candidateIndex: 0,
          decision: 'UPDATE',
          targetIndex: 0,
          mergedContent: 'x'.repeat(2_001)
        },
        { candidateIndex: 1, decision: 'ADD', targetIndex: null }
      ]),
      [input(0), input(1)]
    )
    expect(results.get(0)?.valid).toBe(false)
    expect(results.get(1)?.valid).toBe(true)
  })

  it('applies merged-content and neighbor limits in Unicode code points', () => {
    const accepted = parseBatchDecisionResults(
      JSON.stringify({
        candidateIndex: 0,
        decision: 'UPDATE',
        targetIndex: 0,
        mergedContent: '😀'.repeat(2_000)
      }),
      [input(0)]
    )
    const rejected = parseBatchDecisionResults(
      JSON.stringify({
        candidateIndex: 0,
        decision: 'UPDATE',
        targetIndex: 0,
        mergedContent: '😀'.repeat(2_001)
      }),
      [input(0)]
    )
    const neighborInput = input(0)
    neighborInput.neighbors = [{ content: '😀'.repeat(401) }]
    const prompt = buildBatchDecisionPrompt([neighborInput])

    expect(accepted.get(0)?.valid).toBe(true)
    expect(rejected.get(0)?.valid).toBe(false)
    expect(prompt).toContain('😀'.repeat(400))
    expect(prompt).not.toContain('😀'.repeat(401))
  })

  it('ignores missing, unknown, and malformed candidate indexes', () => {
    const results = parseBatchDecisionResults(
      '[{"candidateIndex":9,"decision":"ADD"},{"decision":"ADD"}]',
      [input(0)]
    )
    expect(results.size).toBe(0)
  })

  it('rejects an explicit mismatched index in the single-object compatibility shape', () => {
    const results = parseBatchDecisionResults(
      '{"candidateIndex":999,"decision":"ADD","targetIndex":null}',
      [input(0)]
    )
    expect(results.size).toBe(0)
  })
})
