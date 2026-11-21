import { describe, expect, it } from 'vitest'
import { SessionResources as DeepChatAgentInstance } from '@/agent/shared/resources/sessionResources'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { computeToolSurfaceVirtualizationTrigger } from '@/tool/catalog/toolSurface'
import {
  createAutomaticToolSurfaceSelectionPolicy,
  isAutomaticToolSurfaceRunModeAssignment,
  selectAutomaticToolSurfaceRunMode,
  ToolSurfaceAdapterHistory,
  type ToolSurfaceRunModeAssignment
} from '@/tool/catalog/toolSurfaceSelection'

describe('Tool Surface adapter selection', () => {
  const policy = createAutomaticToolSurfaceSelectionPolicy(256)

  it('counts native search overhead and applies cross-Run hysteresis only as a hint', () => {
    expect(
      computeToolSurfaceVirtualizationTrigger({
        policy,
        ceilingToolCount: 39,
        ceilingDefinitionTokens: 1_000
      })
    ).toMatchObject({ virtualizationTriggered: false, triggerReason: 'none' })
    expect(
      computeToolSurfaceVirtualizationTrigger({
        policy,
        ceilingToolCount: 40,
        ceilingDefinitionTokens: 1_000
      })
    ).toMatchObject({ virtualizationTriggered: true, triggerReason: 'tool-count' })
    expect(
      computeToolSurfaceVirtualizationTrigger({
        policy,
        ceilingToolCount: 32,
        ceilingDefinitionTokens: 1_000,
        previouslyVirtualized: true
      })
    ).toMatchObject({ virtualizationTriggered: true, triggerReason: 'hysteresis' })
    expect(
      computeToolSurfaceVirtualizationTrigger({
        policy,
        ceilingToolCount: 31,
        ceilingDefinitionTokens: 1_000,
        previouslyVirtualized: true
      })
    ).toMatchObject({ virtualizationTriggered: false, triggerReason: 'none' })
  })

  it('uses Direct Native for a small catalog regardless of CLI evidence', () => {
    expect(
      selectAutomaticToolSurfaceRunMode({
        virtualizationTriggered: false,
        cliProgrammaticCapability: 'proven',
        agentExecAvailable: true,
        programmaticRunCeilingFits: true
      })
    ).toBe('full')
  })

  it.each([
    {
      cliProgrammaticCapability: 'unproven' as const,
      agentExecAvailable: true,
      programmaticRunCeilingFits: true
    },
    {
      cliProgrammaticCapability: 'proven' as const,
      agentExecAvailable: false,
      programmaticRunCeilingFits: true
    },
    {
      cliProgrammaticCapability: 'proven' as const,
      agentExecAvailable: true,
      programmaticRunCeilingFits: false
    }
  ])(
    'keeps a large catalog on Native Activation when a CLI gate is absent: $cliProgrammaticCapability/$agentExecAvailable/$programmaticRunCeilingFits',
    (input) => {
      expect(selectAutomaticToolSurfaceRunMode({ virtualizationTriggered: true, ...input })).toBe(
        'native-activation'
      )
    }
  )

  it('selects CLI Programmatic only when every CLI gate is proven', () => {
    expect(
      selectAutomaticToolSurfaceRunMode({
        virtualizationTriggered: true,
        cliProgrammaticCapability: 'proven',
        agentExecAvailable: true,
        programmaticRunCeilingFits: true
      })
    ).toBe('cli-programmatic')
  })

  it('keeps a virtualized lineage on Native Activation until rollout explicitly reassigns it', () => {
    expect(
      selectAutomaticToolSurfaceRunMode({
        virtualizationTriggered: true,
        cliProgrammaticCapability: 'proven',
        agentExecAvailable: true,
        programmaticRunCeilingFits: true,
        previousMode: 'native-activation'
      })
    ).toBe('native-activation')
    expect(
      selectAutomaticToolSurfaceRunMode({
        virtualizationTriggered: true,
        cliProgrammaticCapability: 'proven',
        agentExecAvailable: true,
        programmaticRunCeilingFits: true,
        previousMode: 'full'
      })
    ).toBe('cli-programmatic')
  })

  it('keeps bounded process-live adapter history isolated by instance and lineage', () => {
    const history = new ToolSurfaceAdapterHistory({ maxLineagesPerInstance: 2 })
    const firstInstance = new DeepChatAgentInstance(toAppSessionId('session-1'))
    const secondInstance = new DeepChatAgentInstance(toAppSessionId('session-1'))
    const scope = (modelId: string) => ({
      sessionId: 'session-1',
      providerId: 'provider-1',
      modelId,
      toolProfile: 'code' as const
    })

    history.record({ instance: firstInstance, scope: scope('model-1'), mode: 'native-activation' })
    history.record({ instance: firstInstance, scope: scope('model-2'), mode: 'cli-programmatic' })
    expect(history.previousMode({ instance: firstInstance, scope: scope('model-1') })).toBe(
      'native-activation'
    )
    history.record({ instance: firstInstance, scope: scope('model-1'), mode: 'native-activation' })
    history.record({ instance: firstInstance, scope: scope('model-3'), mode: 'full' })

    expect(history.previousMode({ instance: firstInstance, scope: scope('model-2') })).toBeNull()
    expect(history.previousMode({ instance: firstInstance, scope: scope('model-1') })).toBe(
      'native-activation'
    )
    expect(history.previousMode({ instance: firstInstance, scope: scope('model-3') })).toBe('full')
    expect(history.previousMode({ instance: secondInstance, scope: scope('model-1') })).toBeNull()
  })

  it('rejects malformed automatic assignments at the rollout boundary', () => {
    expect(
      isAutomaticToolSurfaceRunModeAssignment({
        mode: 'automatic',
        cliProgrammaticCapability: 'proven',
        previousMode: 'legacy'
      } as unknown as ToolSurfaceRunModeAssignment)
    ).toBe(false)
  })
})
