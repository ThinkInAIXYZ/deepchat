import { describe, expect, it, vi } from 'vitest'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  advanceRequestSequence,
  bindActiveRequestContract,
  bindActiveRequestToolSurface,
  collectRuntimeSkillViewProjections,
  createLoopRun,
  enterLogicalRound,
  enterPhysicalAttempt,
  registerMaterializedSkillContext,
  registerRuntimeSkillContext,
  resolveSkillContextsForRequest
} from '@/agent/deepchat/loop/loopRun'
import { inheritProviderProjectionIdentities } from '@/agent/deepchat/loop/providerProjectionIdentity'
import {
  buildToolSurfaceRunCeiling,
  createProviderOrderedToolSurfaceActivationLedger,
  createToolSurfaceSnapshot
} from '@/agent/deepchat/runtime/toolSurface'
import { hashSkillEffectiveContent } from '@/tape/domain/skillMaterialization'
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

function runtimeExecutionRef(
  identity: {
    agentId: string
    sourceType: 'created'
    sourceId: string
    skillName: string
  },
  tapeIncarnationId = 'incarnation-1'
) {
  return {
    kind: 'materialization' as const,
    entryId: 11,
    tapeIncarnationId,
    ...identity,
    effectiveContentHash: 'b'.repeat(64)
  }
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
    expect(second.resources.toolSurfaceMode).toBe('legacy')
    expect(second.providerRecovery).toEqual({
      contextOverflowHandoffAttempted: false,
      strictProviderOverflowRetryUsed: false,
      contextRecoverySequencesUsed: 0
    })
    expect(second.promptUsageAnchor).toBeNull()
    expect(second.initialRequestSeq).toBe(0)
    expect(second.logicalRound).toBe(0)
    expect(second.requestSeq).toBe(0)
    expect(second.physicalAttempt).toBe(0)
  })

  it('freezes the selected Tool Surface mode into Run resources', () => {
    const run = createLoopRun({
      runId: 'full:1',
      sessionId: toAppSessionId('full'),
      messageId: 'full-message',
      abortController: new AbortController(),
      messages: [],
      streamState: {},
      resources: {
        toolDefinitions: [],
        activeSkillNames: [],
        commandShell: POSIX_COMMAND_SHELL,
        toolSurfaceMode: 'full'
      }
    })

    expect(run.resources.toolSurfaceMode).toBe('full')
    expect(Object.getOwnPropertyDescriptor(run.resources, 'toolSurfaceMode')).toMatchObject({
      configurable: false,
      enumerable: true,
      writable: false
    })
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

  it('binds one request-scoped contract and clears it before the next request', () => {
    const run = createRun('session')
    const requestSeq = advanceRequestSequence(run)
    const executionContract = {
      request: {
        sessionId: run.sessionId,
        messageId: run.messageId,
        runId: run.runId,
        requestSeq
      }
    } as any

    const binding = bindActiveRequestContract(run, requestSeq, executionContract)

    expect(binding.executionContract).toBe(executionContract)
    expect(run.activeRequestContract).toBe(binding)
    expect(Object.isFrozen(binding)).toBe(true)
    enterPhysicalAttempt(run)
    expect(run.activeRequestContract).toBe(binding)
    advanceRequestSequence(run)
    expect(run.activeRequestContract).toBeNull()
  })

  it('rejects stale or cross-run execution contract bindings', () => {
    const run = createRun('session')
    const requestSeq = advanceRequestSequence(run)
    const contract = (overrides: Record<string, unknown> = {}) =>
      ({
        request: {
          sessionId: run.sessionId,
          messageId: run.messageId,
          runId: run.runId,
          requestSeq,
          ...overrides
        }
      }) as any

    expect(() => bindActiveRequestContract(run, requestSeq + 1, null)).toThrow(/request sequence/)
    expect(() => bindActiveRequestContract(run, requestSeq, contract({ runId: 'other' }))).toThrow(
      /Loop Run/
    )
  })

  it('retains one exact Tool Surface through retries and clears it before the next View', () => {
    const run = createRun('session')
    const requestSeq = advanceRequestSequence(run)
    const snapshot = createToolSurfaceSnapshot({
      request: {
        sessionId: run.sessionId,
        messageId: run.messageId,
        runId: run.runId,
        requestSeq
      },
      policyVersion: 'full-v1',
      virtualizationTriggered: false,
      ceiling: buildToolSurfaceRunCeiling([]),
      eligibleDefinitions: [],
      activationLedger: createProviderOrderedToolSurfaceActivationLedger([])
    })

    const releaseActivationCandidates = vi.fn()
    const binding = bindActiveRequestToolSurface(
      run,
      requestSeq,
      snapshot,
      releaseActivationCandidates
    )

    expect(binding.snapshot).toBe(snapshot)
    expect(binding.releaseActivationCandidates).toBe(releaseActivationCandidates)
    expect(run.activeRequestToolSurface).toBe(binding)
    expect(Object.isFrozen(binding)).toBe(true)
    enterPhysicalAttempt(run)
    enterPhysicalAttempt(run)
    expect(run.activeRequestToolSurface?.snapshot).toBe(snapshot)
    advanceRequestSequence(run)
    expect(run.activeRequestToolSurface).toBeNull()
  })

  it('rejects stale or cross-run Tool Surface bindings', () => {
    const run = createRun('session')
    const requestSeq = advanceRequestSequence(run)
    const snapshot = (overrides: Record<string, unknown> = {}) =>
      createToolSurfaceSnapshot({
        request: {
          sessionId: run.sessionId,
          messageId: run.messageId,
          runId: run.runId,
          requestSeq,
          ...overrides
        },
        policyVersion: 'full-v1',
        virtualizationTriggered: false,
        ceiling: buildToolSurfaceRunCeiling([]),
        eligibleDefinitions: [],
        activationLedger: createProviderOrderedToolSurfaceActivationLedger([])
      })

    const releaseActivationCandidates = vi.fn()
    expect(() =>
      bindActiveRequestToolSurface(run, requestSeq + 1, snapshot(), releaseActivationCandidates)
    ).toThrow(/request sequence/)
    expect(() =>
      bindActiveRequestToolSurface(
        run,
        requestSeq,
        snapshot({ messageId: 'other' }),
        releaseActivationCandidates
      )
    ).toThrow(/Loop Run/)
    expect(() =>
      bindActiveRequestToolSurface(
        run,
        requestSeq,
        {
          request: {
            sessionId: run.sessionId,
            messageId: run.messageId,
            runId: run.runId,
            requestSeq
          }
        } as any,
        releaseActivationCandidates
      )
    ).toThrow(/canonical builder/)
    expect(() => bindActiveRequestToolSurface(run, requestSeq, snapshot(), null as never)).toThrow(
      /release capability/
    )
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

  it('retains the exact immutable prompt assembly on the run path', () => {
    const promptAssembly = Object.freeze({
      prompt: 'system prompt',
      sections: Object.freeze([
        Object.freeze({
          kind: 'configured_prompt' as const,
          sourceRef: 'session:generation-settings.system-prompt',
          inclusion: 'included' as const,
          contentHash: 'a'.repeat(64),
          content: 'system prompt'
        })
      ])
    })
    const run = createLoopRun({
      runId: 'run',
      sessionId: toAppSessionId('session'),
      messageId: 'message',
      abortController: new AbortController(),
      messages: [{ role: 'system', content: promptAssembly.prompt }],
      streamState: {},
      resources: {
        toolDefinitions: [],
        activeSkillNames: [],
        promptAssembly,
        commandShell: POSIX_COMMAND_SHELL
      }
    })

    expect(run.resources.promptAssembly).toBe(promptAssembly)
  })

  it('binds runtime Skill evidence only to requests that project its exact tool result', () => {
    const run = createRun('session')
    const responseText = '{"success":true,"content":"effective Skill body"}'
    const contentHash = hashSkillEffectiveContent(responseText)
    run.resources.tapeIncarnationId = 'incarnation-1'

    const identity = {
      agentId: 'agent-1',
      sourceType: 'created' as const,
      sourceId: '/skills/skill-1',
      skillName: 'skill-1'
    }
    registerRuntimeSkillContext(run, {
      identity,
      toolCallId: 'tool-call-1',
      entryId: 12,
      tapeIncarnationId: 'incarnation-1',
      contentHash,
      executionRef: runtimeExecutionRef(identity)
    })

    expect(() => resolveSkillContextsForRequest(run, run.messages)).toThrow(
      'missing from the provider request projection'
    )
    const projected = resolveSkillContextsForRequest(run, [
      ...run.messages,
      { role: 'tool', tool_call_id: 'tool-call-1', content: responseText }
    ])
    expect(projected).toEqual([
      expect.objectContaining({
        activationScope: 'runtime_view',
        skillName: 'skill-1',
        projectedContentHash: contentHash,
        authoritativeRef: {
          kind: 'tool_result',
          entryId: 12,
          contentHash
        }
      })
    ])

    expect(() =>
      resolveSkillContextsForRequest(run, [
        { role: 'tool', tool_call_id: 'tool-call-1', content: 'drifted' }
      ])
    ).toThrow('projection drifted')
    expect(() =>
      resolveSkillContextsForRequest(run, [
        { role: 'tool', tool_call_id: 'tool-call-1', content: responseText },
        { role: 'tool', tool_call_id: 'tool-call-1', content: responseText }
      ])
    ).toThrow('ambiguous')
  })

  it('does not inspect provider history when no runtime Skill context is registered', () => {
    const run = createRun('session')
    const inaccessibleMessages = new Proxy([] as never[], {
      get() {
        throw new Error('provider history was inspected')
      }
    })

    expect(resolveSkillContextsForRequest(run, inaccessibleMessages)).toEqual([])
  })

  it('binds materialized Skill evidence to one exact role projection', () => {
    const run = createRun('session')
    const effectiveContent = 'Follow the materialized instructions.'
    const completeBodyFragment = ['### skill-1', effectiveContent].join('\n')
    const contentHash = hashSkillEffectiveContent(effectiveContent)
    run.resources.tapeIncarnationId = 'incarnation-1'
    run.messages[0] = { role: 'user', content: `context\n\n${completeBodyFragment}\n\nrequest` }
    registerMaterializedSkillContext(run, {
      tapeIncarnationId: 'incarnation-1',
      effectiveContent,
      completeBodyFragment,
      providerMessageIndex: 0,
      context: {
        activationScope: 'message',
        agentId: 'agent-1',
        sourceType: 'created',
        sourceId: '/skills/skill-1',
        skillName: 'skill-1',
        authoritativeRef: {
          kind: 'context',
          entryId: 13,
          provenanceKey: 'skill-materialization:v1:test',
          payloadHash: 'a'.repeat(64)
        },
        providerRole: 'user',
        sourceEntryIds: [11],
        projectedContentHash: contentHash,
        projectionVersion: 1,
        deduplicationSource: 'message'
      }
    })

    expect(
      resolveSkillContextsForRequest(run, [
        { role: 'user', content: completeBodyFragment },
        run.messages[0]
      ])
    ).toEqual([expect.objectContaining({ activationScope: 'message', skillName: 'skill-1' })])
    expect(() =>
      resolveSkillContextsForRequest(run, [
        inheritProviderProjectionIdentities(run.messages[0], {
          ...run.messages[0],
          role: 'system'
        }),
        { role: 'user', content: completeBodyFragment }
      ])
    ).toThrow('exactly one Tape-backed provider projection')
    const duplicateProjection = inheritProviderProjectionIdentities(run.messages[0], {
      ...run.messages[0]
    })
    expect(() =>
      resolveSkillContextsForRequest(run, [run.messages[0], duplicateProjection])
    ).toThrow('exactly one Tape-backed provider projection')
    expect(() => {
      const splitProjection = inheritProviderProjectionIdentities(run.messages[0], {
        ...run.messages[0],
        role: 'user',
        content: [
          { type: 'text', text: '### skill-1' },
          { type: 'text', text: effectiveContent }
        ]
      })
      resolveSkillContextsForRequest(run, [splitProjection])
    }).toThrow('removed its bound Skill context')
  })

  it('does not confuse repeated user text with duplicate Skill projections', () => {
    const run = createRun('session')
    const effectiveContent = '### skill-1'
    const completeBodyFragment = `### skill-1\n${effectiveContent}`
    run.resources.tapeIncarnationId = 'incarnation-1'
    run.messages[0] = {
      role: 'user',
      content: `${completeBodyFragment}\n\n${completeBodyFragment}`
    }
    registerMaterializedSkillContext(run, {
      tapeIncarnationId: 'incarnation-1',
      effectiveContent,
      completeBodyFragment,
      providerMessageIndex: 0,
      context: {
        activationScope: 'message',
        agentId: 'agent-1',
        sourceType: 'created',
        sourceId: '/skills/skill-1',
        skillName: 'skill-1',
        authoritativeRef: {
          kind: 'context',
          entryId: 13,
          provenanceKey: 'skill-materialization:v1:overlap',
          payloadHash: 'a'.repeat(64)
        },
        providerRole: 'user',
        sourceEntryIds: [11],
        projectedContentHash: hashSkillEffectiveContent(effectiveContent),
        projectionVersion: 1,
        deduplicationSource: 'message'
      }
    })

    expect(resolveSkillContextsForRequest(run, run.messages)).toEqual([
      expect.objectContaining({ activationScope: 'message', skillName: 'skill-1' })
    ])
  })

  it('does not inspect provider history when the current message has no runtime Skill view', () => {
    const inaccessibleMessages = new Proxy([] as never[], {
      get() {
        throw new Error('provider history was inspected')
      }
    })

    expect(collectRuntimeSkillViewProjections(inaccessibleMessages, [])).toEqual([])
  })

  it('accepts exact runtime Skill evidence reuse and rejects conflicting evidence', () => {
    const run = createRun('session')
    run.resources.tapeIncarnationId = 'incarnation-1'
    const input = {
      identity: {
        agentId: 'agent-1',
        sourceType: 'created' as const,
        sourceId: '/skills/skill-1',
        skillName: 'skill-1'
      },
      toolCallId: 'tool-call-1',
      entryId: 12,
      tapeIncarnationId: 'incarnation-1',
      contentHash: 'a'.repeat(64),
      executionRef: runtimeExecutionRef({
        agentId: 'agent-1',
        sourceType: 'created',
        sourceId: '/skills/skill-1',
        skillName: 'skill-1'
      })
    }

    registerRuntimeSkillContext(run, input)
    registerRuntimeSkillContext(run, input)
    expect(run.resources.runtimeSkillContexts).toHaveLength(1)
    expect(() => registerRuntimeSkillContext(run, { ...input, entryId: 13 })).toThrow(
      'conflicting evidence'
    )
    expect(() =>
      registerRuntimeSkillContext(run, {
        ...input,
        tapeIncarnationId: 'incarnation-2',
        executionRef: { ...input.executionRef, tapeIncarnationId: 'incarnation-2' }
      })
    ).toThrow('another Session Tape incarnation')
  })

  it('discovers only versioned root skill_view projections for continuation recovery', () => {
    const responseText = JSON.stringify({
      success: true,
      name: 'skill-1',
      content: 'effective body',
      activatedForMessage: true,
      activationScope: 'message',
      activationEvidenceVersion: 1
    })
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'tool-call-1',
            type: 'function' as const,
            function: { name: 'skill_view', arguments: '{"name":"skill-1"}' }
          }
        ]
      },
      { role: 'tool' as const, tool_call_id: 'tool-call-1', content: responseText },
      {
        role: 'tool' as const,
        tool_call_id: 'legacy-tool-call',
        content: JSON.stringify({ activatedForMessage: true, activationScope: 'message' })
      }
    ]
    const currentBlocks = [
      {
        type: 'tool_call' as const,
        content: '',
        status: 'success' as const,
        timestamp: 1,
        tool_call: {
          id: 'tool-call-1',
          name: 'skill_view',
          params: '{"name":"skill-1"}',
          response: responseText
        }
      }
    ]

    expect(collectRuntimeSkillViewProjections(messages, currentBlocks)).toEqual([
      {
        toolCallId: 'tool-call-1',
        responseText,
        blockIndex: 0,
        timestamp: 1
      }
    ])
    expect(() =>
      collectRuntimeSkillViewProjections(
        [
          messages[0],
          messages[1],
          { role: 'tool', tool_call_id: 'tool-call-1', content: responseText }
        ],
        currentBlocks
      )
    ).toThrow('invalid or ambiguous')

    expect(() =>
      collectRuntimeSkillViewProjections(messages, [
        {
          ...currentBlocks[0],
          tool_call: { ...currentBlocks[0].tool_call, id: 'current-message-call' }
        }
      ])
    ).toThrow('missing from continuation')
    const oversizedResponse = JSON.stringify({
      activatedForMessage: true,
      activationScope: 'message',
      activationEvidenceVersion: 1,
      content: 'x'.repeat(768 * 1024)
    })
    expect(() =>
      collectRuntimeSkillViewProjections(
        [],
        [
          {
            ...currentBlocks[0],
            tool_call: { ...currentBlocks[0].tool_call, response: oversizedResponse }
          }
        ]
      )
    ).toThrow('recovery byte limit')
  })

  it('fails explicitly instead of wrapping an exhausted request sequence', () => {
    const run = createRun('session', Number.MAX_SAFE_INTEGER)

    expect(() => advanceRequestSequence(run)).toThrow('Provider request sequence is exhausted.')
    expect(run.requestSeq).toBe(Number.MAX_SAFE_INTEGER)
  })
})
