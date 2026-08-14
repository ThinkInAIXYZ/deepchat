import { describe, expect, it } from 'vitest'
import { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { computeToolSurfaceVirtualizationTrigger } from '@/agent/deepchat/runtime/toolSurface'
import {
  createAutomaticToolSurfaceSelectionPolicy,
  isAutomaticToolSurfaceRunModeAssignment,
  selectAutomaticToolSurfaceRunMode,
  ToolSurfaceAdapterHistory,
  type ToolSurfaceRunModeAssignment
} from '@/agent/deepchat/runtime/toolSurfaceSelection'
import {
  TOOL_SURFACE_PRODUCTION_ROLLOUT_POLICY_V1,
  ToolSurfaceRolloutOwner
} from '@/agent/deepchat/runtime/toolSurfaceRollout'

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
      expect(
        selectAutomaticToolSurfaceRunMode({ virtualizationTriggered: true, ...input })
      ).toBe('native-activation')
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

  it('keeps the production rollout disabled until a canary is explicitly assigned', () => {
    const rollout = new ToolSurfaceRolloutOwner(TOOL_SURFACE_PRODUCTION_ROLLOUT_POLICY_V1)

    expect(
      rollout.resolve({
        sessionId: 'session-1',
        providerId: 'provider-1',
        modelId: 'model-1'
      })
    ).toBe('legacy')
  })

  it('uses only exact measured provider/model evidence inside a stable canary cohort', () => {
    const rollout = new ToolSurfaceRolloutOwner({
      policyVersion: 'test-rollout-v1',
      canaryBasisPoints: 10_000,
      measuredCliCapabilityEvidence: [
        {
          protocolVersion: 'cli-programmatic-v1',
          evidenceVersion: 'external-eval-1',
          providerId: 'provider-1',
          modelId: 'model-1',
          outcome: 'proven'
        }
      ]
    })
    const scope = {
      sessionId: 'session-1',
      providerId: 'provider-1',
      modelId: 'model-1'
    }

    expect(rollout.resolve(scope)).toEqual({
      mode: 'automatic',
      cliProgrammaticCapability: 'proven'
    })
    expect(rollout.resolve(scope)).toEqual(rollout.resolve(scope))
    expect(rollout.resolve({ ...scope, providerId: 'provider-2' })).toEqual({
      mode: 'automatic',
      cliProgrammaticCapability: 'unproven'
    })
    expect(rollout.resolve({ ...scope, modelId: 'model-2' })).toEqual({
      mode: 'automatic',
      cliProgrammaticCapability: 'unproven'
    })
  })

  it('keeps partial canary assignment stable for one session and model scope', () => {
    const rollout = new ToolSurfaceRolloutOwner({
      policyVersion: 'test-rollout-v1',
      canaryBasisPoints: 5_000,
      measuredCliCapabilityEvidence: []
    })
    const scope = {
      sessionId: 'session-1',
      providerId: 'provider-1',
      modelId: 'model-1'
    }

    expect(rollout.resolve(scope)).toEqual(rollout.resolve(scope))
  })

  it('rejects duplicate or malformed measured capability evidence', () => {
    const evidence = {
      protocolVersion: 'cli-programmatic-v1' as const,
      evidenceVersion: 'external-eval-1',
      providerId: 'provider-1',
      modelId: 'model-1',
      outcome: 'proven' as const
    }

    expect(
      () =>
        new ToolSurfaceRolloutOwner({
          policyVersion: 'test-rollout-v1',
          canaryBasisPoints: 1,
          measuredCliCapabilityEvidence: [evidence, evidence]
        })
    ).toThrow('duplicate model scope')
    expect(
      () =>
        new ToolSurfaceRolloutOwner({
          policyVersion: ' test-rollout-v1 ',
          canaryBasisPoints: 1,
          measuredCliCapabilityEvidence: []
        })
    ).toThrow('rollout policy is invalid')
  })
})
