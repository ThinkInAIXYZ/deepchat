import { describe, expect, it } from 'vitest'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  advanceRequestSequence,
  createLoopRun,
  enterLogicalRound,
  enterPhysicalAttempt
} from '@/agent/deepchat/loop/loopRun'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

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
      activeSkillNames: [`${sessionId}-skill`],
      commandShell: POSIX_COMMAND_SHELL
    },
    initialRequestSeq,
    startedAt: 100
  })
}

describe('LoopRun', () => {
  it.each([
    ['missing', { toolDefinitions: [], activeSkillNames: [] }],
    [
      'contradictory',
      {
        toolDefinitions: [],
        activeSkillNames: [],
        commandShell: {
          ...POSIX_COMMAND_SHELL,
          dialect: 'powershell'
        }
      }
    ]
  ] as const)('rejects a %s command shell contract', (_kind, resources) => {
    expect(() =>
      createLoopRun({
        runId: 'invalid-shell',
        sessionId: toAppSessionId('session'),
        messageId: 'message',
        abortController: new AbortController(),
        messages: [],
        streamState: {},
        resources: resources as never
      })
    ).toThrow()
  })

  it('keeps mutable turn state isolated between sessions', () => {
    const first = createRun('first')
    const second = createRun('second')

    first.messages.push({ role: 'assistant', content: 'first response' })
    first.streamState.blocks.push('first block')
    first.resources.activeSkillNames.push('first-extra-skill')
    first.providerRecovery.contextOverflowHandoffAttempted = true
    advanceRequestSequence(first)
    enterLogicalRound(first)
    enterPhysicalAttempt(first)

    expect(second.messages).toEqual([{ role: 'user', content: 'second' }])
    expect(second.streamState.blocks).toEqual([])
    expect(second.resources.activeSkillNames).toEqual(['second-skill'])
    expect(second.providerRecovery).toEqual({
      contextOverflowHandoffAttempted: false,
      strictProviderOverflowRetryUsed: false
    })
    expect(second.initialRequestSeq).toBe(0)
    expect(second.logicalRound).toBe(0)
    expect(second.requestSeq).toBe(0)
    expect(second.physicalAttempt).toBe(0)
  })

  it('advances request and physical attempts independently from logical rounds', () => {
    const run = createRun('session', 4)

    expect(enterLogicalRound(run)).toBe(1)
    expect(advanceRequestSequence(run)).toBe(5)
    expect(enterPhysicalAttempt(run)).toBe(1)
    expect(enterPhysicalAttempt(run)).toBe(2)
    expect(advanceRequestSequence(run)).toBe(6)
    expect(run.physicalAttempt).toBe(0)
    expect(enterPhysicalAttempt(run)).toBe(1)

    expect(run.logicalRound).toBe(1)
    expect(run.initialRequestSeq).toBe(4)
    expect(run.requestSeq).toBe(6)
    expect(run.physicalAttempt).toBe(1)
  })

  it('restores only valid persisted logical rounds', () => {
    expect(
      createLoopRun({
        runId: 'restored',
        sessionId: toAppSessionId('session'),
        messageId: 'message',
        abortController: new AbortController(),
        messages: [],
        streamState: {},
        resources: { toolDefinitions: [], activeSkillNames: [], commandShell: POSIX_COMMAND_SHELL },
        initialLogicalRound: 3
      }).logicalRound
    ).toBe(3)

    expect(
      createLoopRun({
        runId: 'invalid',
        sessionId: toAppSessionId('session'),
        messageId: 'message',
        abortController: new AbortController(),
        messages: [],
        streamState: {},
        resources: { toolDefinitions: [], activeSkillNames: [], commandShell: POSIX_COMMAND_SHELL },
        initialLogicalRound: 1.5
      }).logicalRound
    ).toBe(0)
  })

  it('fails explicitly instead of wrapping an exhausted request sequence', () => {
    const run = createRun('session', Number.MAX_SAFE_INTEGER)

    expect(() => advanceRequestSequence(run)).toThrow('Provider request sequence is exhausted.')
    expect(run.requestSeq).toBe(Number.MAX_SAFE_INTEGER)
  })
})
