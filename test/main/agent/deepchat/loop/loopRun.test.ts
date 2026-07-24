import { describe, expect, it } from 'vitest'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  advanceRequestSequence,
  createLoopRun,
  enterProviderRound
} from '@/agent/deepchat/loop/loopRun'

function createRun(sessionId: string, initialRequestSeq = 0) {
  return createLoopRun({
    runId: `${sessionId}:1`,
    sessionId: toAppSessionId(sessionId),
    messageId: `${sessionId}-message`,
    abortController: new AbortController(),
    messages: [{ role: 'user', content: sessionId }],
    streamState: { blocks: [] as string[] },
    resources: {
      toolDefinitions: [],
      activeSkillNames: [`${sessionId}-skill`]
    },
    initialRequestSeq,
    startedAt: 100
  })
}

describe('LoopRun', () => {
  it('keeps mutable turn state isolated between sessions', () => {
    const first = createRun('first')
    const second = createRun('second')

    first.messages.push({ role: 'assistant', content: 'first response' })
    first.streamState.blocks.push('first block')
    first.resources.activeSkillNames.push('first-extra-skill')
    first.providerRecovery.contextOverflowHandoffAttempted = true
    advanceRequestSequence(first)
    enterProviderRound(first)

    expect(second.messages).toEqual([{ role: 'user', content: 'second' }])
    expect(second.streamState.blocks).toEqual([])
    expect(second.resources.activeSkillNames).toEqual(['second-skill'])
    expect(second.providerRecovery).toEqual({
      contextOverflowHandoffAttempted: false,
      strictProviderOverflowRetryUsed: false
    })
    expect(second.initialRequestSeq).toBe(0)
    expect(second.requestSeq).toBe(0)
    expect(second.providerRoundCount).toBe(0)
  })

  it('advances request attempts independently from outer provider rounds', () => {
    const run = createRun('session', 4)

    expect(enterProviderRound(run)).toBe(1)
    expect(advanceRequestSequence(run)).toBe(5)
    expect(advanceRequestSequence(run)).toBe(6)

    expect(run.providerRoundCount).toBe(1)
    expect(run.initialRequestSeq).toBe(4)
    expect(run.requestSeq).toBe(6)
  })

  it('fails explicitly instead of wrapping an exhausted request sequence', () => {
    const run = createRun('session', Number.MAX_SAFE_INTEGER)

    expect(() => advanceRequestSequence(run)).toThrow('Provider request sequence is exhausted.')
    expect(run.requestSeq).toBe(Number.MAX_SAFE_INTEGER)
  })
})
