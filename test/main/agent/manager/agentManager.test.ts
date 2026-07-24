import { describe, expect, it, vi } from 'vitest'
import { AgentManager, AppSessionNotFoundError } from '@/agent/manager/agentManager'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentDescriptor } from '@/agent/shared/agentDescriptors'
import type { SubagentTapeLinkInput } from '@shared/types/agent-interface'
import { AgentUnavailableError } from '@/agent/shared/agentCatalogCodec'
import { createDeepChatAgentBackendFixture } from './deepChatAgentBackendFixture'

const implementation = (name: string) =>
  ({
    name,
    initSession: vi.fn(),
    processMessage: vi.fn(),
    cancelGeneration: vi.fn(),
    destroySession: vi.fn(),
    getSessionState: vi.fn(),
    hasMessages: vi.fn(),
    listPendingInputs: vi.fn(),
    steerActiveTurn: vi.fn(),
    queuePendingInput: vi.fn(),
    updateQueuedInput: vi.fn(),
    moveQueuedInput: vi.fn(),
    convertPendingInputToSteer: vi.fn(),
    steerPendingInput: vi.fn(),
    deletePendingInput: vi.fn(),
    getPermissionMode: vi.fn(),
    setPermissionMode: vi.fn(),
    getGenerationSettings: vi.fn(),
    updateGenerationSettings: vi.fn(),
    setSessionProjectDir: vi.fn(),
    respondToolInteraction: vi.fn(),
    setSessionAgentContext: vi.fn(),
    setSessionModel: vi.fn(),
    getSessionCompactionState: vi.fn(),
    compactSession: vi.fn(),
    linkSubagentTape: vi.fn((input: SubagentTapeLinkInput) =>
      Promise.resolve({
        linkEntry: { sessionId: input.parentSessionId, entryId: 1 },
        childSessionId: input.childSessionId,
        childHeadEntryId: 2,
        childEntryCount: 2,
        outcome: input.outcome
      })
    ),
    getActiveGeneration: vi.fn().mockReturnValue(null),
    cancelGenerationByEventId: vi.fn().mockResolvedValue(false),
    getMessage: vi.fn().mockResolvedValue(null)
  }) as never

const directBackend = (selected: ReturnType<typeof implementation>) => ({
  kind: 'acp' as const,
  runtime: selected,
  cleanupSession: vi.fn().mockResolvedValue(undefined),
  open: vi.fn(() => ({
    kind: 'acp',
    acp: { closeRuntime: vi.fn().mockResolvedValue(undefined) }
  })),
  transferSource: {
    hasMessages: (sessionId: string) => selected.hasMessages(sessionId),
    listPendingInputs: (sessionId: string) => selected.listPendingInputs(sessionId)
  },
  subagent: {
    linkTape: (input: SubagentTapeLinkInput) => selected.linkSubagentTape(input)
  },
  generationControl: {
    getActiveGeneration: (sessionId: string) => selected.getActiveGeneration(sessionId),
    cancelGenerationByEventId: (sessionId: string, eventId: string) =>
      selected.cancelGenerationByEventId(sessionId, eventId)
  }
})

const descriptor = (kind: 'deepchat' | 'acp'): AgentDescriptor =>
  kind === 'deepchat'
    ? {
        id: 'agent',
        kind,
        source: 'manual',
        name: 'Agent',
        enabled: true,
        protected: false,
        description: null,
        icon: null,
        avatar: null,
        config: { defaultModelPreset: { providerId: 'acp', modelId: 'agent' } }
      }
    : {
        id: 'agent',
        kind,
        source: 'manual',
        name: 'Agent',
        enabled: true,
        protected: false,
        description: null,
        icon: null,
        avatar: null,
        launch: { command: 'agent', args: [], env: {} }
      }

describe('AgentManager', () => {
  it.each(['deepchat', 'acp'] as const)('routes %s descriptors to the explicit backend', (kind) => {
    const deepchat = implementation('deepchat')
    const acp = implementation('acp')
    const deepchatBackend = createDeepChatAgentBackendFixture(deepchat)
    const acpBackend = directBackend(acp)
    const manager = new AgentManager(
      { resolveExecutableDescriptor: vi.fn(() => descriptor(kind)) },
      { get: vi.fn(() => null) },
      {
        deepchat: deepchatBackend,
        acp: acpBackend as never
      }
    )

    const resolved = manager.resolveBackend('agent')

    expect(resolved.descriptor.kind).toBe(kind)
    expect(resolved.backend.kind).toBe(kind)
    expect(resolved.backend).toBe(kind === 'deepchat' ? deepchatBackend : acpBackend)
  })

  it.each([
    ['regular', 'acp'],
    ['subagent', 'deepchat']
  ] as const)('routes a %s app session by agentId, not sessionKind', (sessionKind, kind) => {
    const manager = new AgentManager(
      { resolveExecutableDescriptor: vi.fn(() => descriptor(kind)) },
      {
        get: vi.fn(() => ({ agentId: 'agent', sessionKind }) as never)
      },
      {
        deepchat: createDeepChatAgentBackendFixture(implementation('deepchat')),
        acp: directBackend(implementation('acp')) as never
      }
    )

    expect(manager.resolveSessionBackend(toAppSessionId('session')).backend.kind).toBe(kind)
  })

  it.each(['deepchat', 'acp'] as const)(
    'resolves required transfer and subagent facets for %s sessions',
    async (kind) => {
      const deepchat = implementation('deepchat')
      const acp = implementation('acp')
      const manager = new AgentManager(
        { resolveExecutableDescriptor: vi.fn(() => descriptor(kind)) },
        { get: vi.fn(() => ({ agentId: 'agent', sessionKind: 'regular' }) as never) },
        {
          deepchat: createDeepChatAgentBackendFixture(deepchat, undefined, {
            transcript: { hasMessages: async () => false },
            tape: { linkSubagentTape: deepchat.linkSubagentTape }
          }),
          acp: directBackend(acp) as never
        }
      )
      const sessionId = toAppSessionId('session')

      await manager.resolveTransferSource(sessionId).facet.listPendingInputs(sessionId)
      const subagent = manager.resolveSubagentFacet(sessionId)
      const linkInput = {
        parentSessionId: sessionId,
        childSessionId: toAppSessionId('child'),
        runId: 'run',
        taskId: 'task',
        slotId: 'reviewer',
        taskTitle: 'Review',
        outcome: 'completed' as const,
        resultSummary: 'Done'
      }
      await subagent.facet.linkTape(linkInput)

      const selected = kind === 'deepchat' ? deepchat : acp
      expect(selected.listPendingInputs).toHaveBeenCalledWith('session')
      expect(selected.linkSubagentTape).toHaveBeenCalledWith(linkInput)
      expect(subagent.kind).toBe(kind)
    }
  )

  it.each(['deepchat', 'acp'] as const)(
    'routes remote generation control through the %s session backend',
    async (kind) => {
      const selected = implementation(kind)
      selected.getActiveGeneration.mockReturnValue({ eventId: 'message', runId: 'run' })
      selected.cancelGenerationByEventId.mockResolvedValue(true)
      const manager = new AgentManager(
        { resolveExecutableDescriptor: vi.fn(() => descriptor(kind)) },
        { get: vi.fn(() => ({ agentId: 'agent', sessionKind: 'regular' }) as never) },
        {
          deepchat: createDeepChatAgentBackendFixture(
            kind === 'deepchat' ? selected : implementation('deepchat')
          ),
          acp: directBackend(kind === 'acp' ? selected : implementation('acp')) as never
        }
      )
      const sessionId = toAppSessionId('session')

      expect(manager.getActiveGeneration(sessionId)).toEqual({ eventId: 'message', runId: 'run' })
      await expect(manager.cancelGenerationByEventId(sessionId, 'message')).resolves.toBe(true)

      expect(selected.getActiveGeneration).toHaveBeenCalledWith('session')
      expect(selected.cancelGenerationByEventId).toHaveBeenCalledWith('session', 'message')
    }
  )

  it('requires a DeepChat transfer target without inspecting provider selection', () => {
    const deepchat = implementation('deepchat')
    const manager = new AgentManager(
      { resolveExecutableDescriptor: vi.fn(() => descriptor('deepchat')) },
      { get: vi.fn(() => null) },
      {
        deepchat: createDeepChatAgentBackendFixture(deepchat),
        acp: directBackend(implementation('acp')) as never
      }
    )

    expect(
      manager.resolveDeepChatTransferTarget('agent').descriptor.config.defaultModelPreset
    ).toEqual({ providerId: 'acp', modelId: 'agent' })
  })

  it('rejects ACP agents as transfer targets', () => {
    const manager = new AgentManager(
      { resolveExecutableDescriptor: vi.fn(() => descriptor('acp')) },
      { get: vi.fn(() => null) },
      {
        deepchat: createDeepChatAgentBackendFixture(implementation('deepchat')),
        acp: directBackend(implementation('acp')) as never
      }
    )

    expect(() => manager.resolveDeepChatTransferTarget('agent')).toThrow(
      expect.objectContaining({
        code: 'AGENT_CAPABILITY_UNAVAILABLE',
        capability: 'transfer-target'
      })
    )
  })

  it('fails explicitly when an app session is missing', () => {
    const manager = new AgentManager(
      { resolveExecutableDescriptor: vi.fn(() => descriptor('deepchat')) },
      { get: vi.fn(() => null) },
      {
        deepchat: createDeepChatAgentBackendFixture(implementation('deepchat')),
        acp: directBackend(implementation('acp')) as never
      }
    )

    expect(() => manager.resolveSessionBackend(toAppSessionId('missing'))).toThrow(
      AppSessionNotFoundError
    )
  })

  it('propagates executable catalog errors without fallback', () => {
    const error = new AgentUnavailableError('broken', 'invalid-config')
    const manager = new AgentManager(
      {
        resolveExecutableDescriptor: () => {
          throw error
        }
      },
      { get: vi.fn(() => null) },
      {
        deepchat: createDeepChatAgentBackendFixture(implementation('deepchat')),
        acp: directBackend(implementation('acp')) as never
      }
    )

    expect(() => manager.resolveBackend('broken')).toThrow(error)
  })

  it('cleans both backend caches without resolving a descriptor or app session', async () => {
    const cleanupDeepChat = vi.fn().mockResolvedValue(undefined)
    const cleanupAcp = vi.fn().mockResolvedValue(undefined)
    const resolveExecutableDescriptor = vi.fn(() => {
      throw new Error('catalog must not be read')
    })
    const getSession = vi.fn(() => {
      throw new Error('session lookup must not be read')
    })
    const manager = new AgentManager(
      { resolveExecutableDescriptor },
      { get: getSession },
      {
        deepchat: { cleanupSession: cleanupDeepChat } as never,
        acp: { cleanupSession: cleanupAcp } as never
      }
    )

    await expect(manager.cleanupSessionBackends(toAppSessionId('orphan'))).resolves.toBeUndefined()
    expect(cleanupDeepChat).toHaveBeenCalledWith('orphan')
    expect(cleanupAcp).toHaveBeenCalledWith('orphan')
    expect(resolveExecutableDescriptor).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })
})
