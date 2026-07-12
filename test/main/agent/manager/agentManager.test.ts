import { describe, expect, it, vi } from 'vitest'
import { AgentManager, AppSessionNotFoundError } from '@/agent/manager/agentManager'
import { createLegacyAgentBackend } from '@/agent/manager/legacyAgentBackends'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentDescriptor } from '@/agent/shared/agentDescriptors'
import { AgentUnavailableError } from '@/agent/shared/agentCatalogCodec'

const implementation = (name: string) =>
  ({
    name,
    processMessage: vi.fn(),
    cancelGeneration: vi.fn(),
    destroySession: vi.fn(),
    getSessionState: vi.fn(),
    hasMessages: vi.fn(),
    listPendingInputs: vi.fn(),
    setSessionAgentContext: vi.fn(),
    mergeSubagentTape: vi.fn(),
    discardSubagentTape: vi.fn(),
    getActiveGeneration: vi.fn().mockReturnValue(null),
    cancelGenerationByEventId: vi.fn().mockResolvedValue(false)
  }) as never

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
    const manager = new AgentManager(
      { resolveExecutableDescriptor: vi.fn(() => descriptor(kind)) },
      { get: vi.fn(() => null) },
      {
        deepchat: createLegacyAgentBackend('deepchat', deepchat),
        acp: createLegacyAgentBackend('acp', acp)
      }
    )

    const resolved = manager.resolveBackend('agent')

    expect(resolved.descriptor.kind).toBe(kind)
    expect(resolved.backend.kind).toBe(kind)
    expect(resolved.backend.implementation).toBe(kind === 'deepchat' ? deepchat : acp)
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
        deepchat: createLegacyAgentBackend('deepchat', implementation('deepchat')),
        acp: createLegacyAgentBackend('acp', implementation('acp'))
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
          deepchat: createLegacyAgentBackend('deepchat', deepchat),
          acp: createLegacyAgentBackend('acp', acp)
        }
      )
      const sessionId = toAppSessionId('session')

      await manager.resolveTransferSource(sessionId).facet.listPendingInputs(sessionId)
      const subagent = manager.resolveSubagentFacet(sessionId)
      await subagent.facet.mergeTape(sessionId, toAppSessionId('child'))

      const selected = kind === 'deepchat' ? deepchat : acp
      expect(selected.listPendingInputs).toHaveBeenCalledWith('session')
      expect(selected.mergeSubagentTape).toHaveBeenCalledWith('session', 'child', undefined)
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
          deepchat: createLegacyAgentBackend(
            'deepchat',
            kind === 'deepchat' ? selected : implementation('deepchat')
          ),
          acp: createLegacyAgentBackend('acp', kind === 'acp' ? selected : implementation('acp'))
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
        deepchat: createLegacyAgentBackend('deepchat', deepchat),
        acp: createLegacyAgentBackend('acp', implementation('acp'))
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
        deepchat: createLegacyAgentBackend('deepchat', implementation('deepchat')),
        acp: createLegacyAgentBackend('acp', implementation('acp'))
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
        deepchat: createLegacyAgentBackend('deepchat', implementation('deepchat')),
        acp: createLegacyAgentBackend('acp', implementation('acp'))
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
        deepchat: createLegacyAgentBackend('deepchat', implementation('deepchat')),
        acp: createLegacyAgentBackend('acp', implementation('acp'))
      }
    )

    expect(() => manager.resolveBackend('broken')).toThrow(error)
  })
})
