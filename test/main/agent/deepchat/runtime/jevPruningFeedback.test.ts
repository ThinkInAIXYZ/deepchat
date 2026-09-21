import { describe, expect, it } from 'vitest'
import {
  JEV_PRUNING_MAX_MISSES,
  JEV_PRUNING_TIGHTENED_KEEP_THRESHOLD,
  JevPruningFeedback,
  pruningInvocationSignature
} from '@/agent/deepchat/runtime/jevPruningFeedback'

const prunedEntry = (toolCallId: string, toolName: string, toolArgs: string) => ({
  toolCallId,
  toolName,
  toolArgs
})

describe('pruningInvocationSignature', () => {
  it('treats the same name and arguments as the same work', () => {
    expect(pruningInvocationSignature('exec', '{"command":"git status"}')).toBe(
      pruningInvocationSignature('exec', '{"command":"git status"}')
    )
  })

  it('separates different arguments', () => {
    expect(pruningInvocationSignature('exec', '{"command":"ls"}')).not.toBe(
      pruningInvocationSignature('exec', '{"command":"pwd"}')
    )
  })
})

describe('JevPruningFeedback', () => {
  it('reports a re-run of a pruned call as a miss', () => {
    // The pruning question asks whether re-running the tool would recover the contents. If the agent
    // then re-runs it, the judgment was wrong by its own stated criterion.
    const feedback = new JevPruningFeedback()
    feedback.recordPruned('s1', [prunedEntry('c1', 'exec', '{"command":"git status"}')])

    const missed = feedback.observeToolCall({
      sessionId: 's1',
      toolCallId: 'c2',
      toolName: 'exec',
      toolArgs: '{"command":"git status"}'
    })

    expect(missed).toBe(true)
    expect(feedback.missCount('s1')).toBe(1)
    expect(feedback.missesFor('s1')[0]).toEqual({
      toolName: 'exec',
      prunedToolCallId: 'c1',
      repeatedToolCallId: 'c2'
    })
  })

  it('does not report the original call as a miss', () => {
    const feedback = new JevPruningFeedback()
    feedback.recordPruned('s1', [prunedEntry('c1', 'exec', '{"command":"git status"}')])

    expect(
      feedback.observeToolCall({
        sessionId: 's1',
        toolCallId: 'c1',
        toolName: 'exec',
        toolArgs: '{"command":"git status"}'
      })
    ).toBe(false)
    expect(feedback.missCount('s1')).toBe(0)
  })

  it('does not report a different invocation as a miss', () => {
    const feedback = new JevPruningFeedback()
    feedback.recordPruned('s1', [prunedEntry('c1', 'exec', '{"command":"git status"}')])

    expect(
      feedback.observeToolCall({
        sessionId: 's1',
        toolCallId: 'c2',
        toolName: 'exec',
        toolArgs: '{"command":"ls"}'
      })
    ).toBe(false)
  })

  it('keeps sessions apart', () => {
    const feedback = new JevPruningFeedback()
    feedback.recordPruned('s1', [prunedEntry('c1', 'exec', '{"command":"git status"}')])

    expect(
      feedback.observeToolCall({
        sessionId: 's2',
        toolCallId: 'c2',
        toolName: 'exec',
        toolArgs: '{"command":"git status"}'
      })
    ).toBe(false)
  })

  it('tightens the threshold after the first miss', () => {
    const feedback = new JevPruningFeedback()
    expect(feedback.policyFor('s1')).toEqual({})

    feedback.recordPruned('s1', [prunedEntry('c1', 'exec', 'a')])
    feedback.observeToolCall({ sessionId: 's1', toolCallId: 'c2', toolName: 'exec', toolArgs: 'a' })

    expect(feedback.policyFor('s1')).toEqual({
      keepThreshold: JEV_PRUNING_TIGHTENED_KEEP_THRESHOLD
    })
  })

  it('stops pruning once enough misses accumulate', () => {
    const feedback = new JevPruningFeedback()

    for (let i = 0; i < JEV_PRUNING_MAX_MISSES; i += 1) {
      const id = `c${i}`
      feedback.recordPruned('s1', [prunedEntry(id, 'exec', `args-${i}`)])
      feedback.observeToolCall({
        sessionId: 's1',
        toolCallId: `${id}-rerun`,
        toolName: 'exec',
        toolArgs: `args-${i}`
      })
    }

    expect(feedback.missCount('s1')).toBe(JEV_PRUNING_MAX_MISSES)
    expect(feedback.policyFor('s1')).toBeNull()
  })

  it('records the oldest pruned call for a signature', () => {
    const feedback = new JevPruningFeedback()
    feedback.recordPruned('s1', [prunedEntry('c1', 'exec', 'same')])
    feedback.recordPruned('s1', [prunedEntry('c2', 'exec', 'same')])

    feedback.observeToolCall({ sessionId: 's1', toolCallId: 'c3', toolName: 'exec', toolArgs: 'same' })

    expect(feedback.missesFor('s1')[0].prunedToolCallId).toBe('c1')
  })

  it('clears a session', () => {
    const feedback = new JevPruningFeedback()
    feedback.recordPruned('s1', [prunedEntry('c1', 'exec', 'a')])
    feedback.observeToolCall({ sessionId: 's1', toolCallId: 'c2', toolName: 'exec', toolArgs: 'a' })

    feedback.clear('s1')

    expect(feedback.missCount('s1')).toBe(0)
    expect(feedback.policyFor('s1')).toEqual({})
  })

  it('ignores an empty prune record', () => {
    const feedback = new JevPruningFeedback()
    feedback.recordPruned('s1', [])

    expect(
      feedback.observeToolCall({ sessionId: 's1', toolCallId: 'c1', toolName: 'exec', toolArgs: 'a' })
    ).toBe(false)
  })
})
