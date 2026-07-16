import { describe, expect, it, vi } from 'vitest'
import { SessionAgentAssignmentPolicy } from '@/presenter/sessionApplication/agentAssignmentPolicy'
import {
  normalizeActiveSkills,
  normalizeDisabledAgentTools
} from '@/agent/shared/agentSessionNormalization'
import { TAPE_TOOL_NAMES } from '@shared/agentTools'

function createHarness() {
  const agents = new Map([
    ['deepchat', { id: 'deepchat', kind: 'deepchat' as const }],
    ['reviewer', { id: 'reviewer', kind: 'deepchat' as const }],
    ['claude-acp', { id: 'claude-acp', kind: 'acp' as const }]
  ])
  const catalog = {
    resolveAgent: vi.fn((agentId: string) => {
      const descriptor = agents.get(agentId)
      if (!descriptor) throw new Error(`Agent not found: ${agentId}`)
      return descriptor
    })
  }
  const configs = new Map<string, any>([
    [
      'deepchat',
      {
        defaultModelPreset: { providerId: 'anthropic', modelId: 'claude' },
        defaultProjectPath: '/agent-project',
        permissionMode: 'auto_approve',
        systemPrompt: 'Agent prompt',
        disabledAgentTools: ['find', 'write', 'write'],
        subagentEnabled: true
      }
    ],
    ['reviewer', {}]
  ])
  const config = {
    getDefaultModel: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4' })),
    getDefaultProjectPath: vi.fn(() => '/global-project'),
    resolveDeepChatAgentConfig: vi.fn(async (agentId: string) => configs.get(agentId) ?? null)
  }
  return { policy: new SessionAgentAssignmentPolicy(catalog, config), catalog, config, configs }
}

describe('SessionAgentAssignmentPolicy', () => {
  it('resolves DeepChat creation precedence and configured settings', async () => {
    const { policy } = createHarness()

    await expect(
      policy.resolveCreateAssignment({
        agentId: 'deepchat',
        providerId: 'openrouter',
        modelId: 'custom-model',
        generationSettings: { temperature: 0.2 },
        preserveExplicitNullProjectDir: false
      })
    ).resolves.toEqual({
      agentId: 'deepchat',
      agentType: 'deepchat',
      providerId: 'openrouter',
      modelId: 'custom-model',
      projectDir: '/agent-project',
      permissionMode: 'auto_approve',
      generationSettings: { systemPrompt: 'Agent prompt', temperature: 0.2 },
      disabledAgentTools: ['write']
    })
  })

  it('owns the full-access default for omitted assignment modes', async () => {
    const { policy } = createHarness()

    await expect(
      policy.resolveCreateAssignment({
        agentId: 'reviewer',
        preserveExplicitNullProjectDir: false
      })
    ).resolves.toMatchObject({ permissionMode: 'full_access' })
    expect(policy.resolveAcpDraftAssignment('claude-acp')).toEqual({
      agentId: 'claude-acp',
      permissionMode: 'full_access'
    })
    expect(policy.resolveAcpDraftAssignment('claude-acp', 'default')).toEqual({
      agentId: 'claude-acp',
      permissionMode: 'default'
    })
  })

  it('preserves explicit null only for attached creation', async () => {
    const { policy } = createHarness()

    const attached = await policy.resolveCreateAssignment({
      agentId: 'deepchat',
      projectDir: null,
      preserveExplicitNullProjectDir: true
    })
    const detached = await policy.resolveCreateAssignment({
      agentId: 'deepchat',
      projectDir: null,
      preserveExplicitNullProjectDir: false
    })

    expect(attached.projectDir).toBeNull()
    expect(detached.projectDir).toBe('/agent-project')
  })

  it('forces ACP identity and requires a workdir', async () => {
    const { policy } = createHarness()

    await expect(
      policy.resolveCreateAssignment({
        agentId: 'claude-acp',
        projectDir: null,
        preserveExplicitNullProjectDir: true
      })
    ).rejects.toThrow('ACP agent requires selecting a workdir')

    await expect(
      policy.resolveCreateAssignment({
        agentId: 'claude-acp',
        providerId: 'ignored',
        modelId: 'ignored',
        projectDir: '/repo',
        disabledAgentTools: ['write'],
        preserveExplicitNullProjectDir: true
      })
    ).resolves.toMatchObject({
      agentId: 'claude-acp',
      agentType: 'acp',
      providerId: 'acp',
      modelId: 'claude-acp',
      disabledAgentTools: []
    })
  })

  it('canonicalizes ACP subagents and rejects ACP transfer targets', async () => {
    const { policy, catalog } = createHarness()

    await expect(
      policy.resolveSubagentAssignment({
        agentId: 'claude-code-acp',
        targetAgentId: 'legacy-slot',
        projectDir: '/repo',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'full_access',
        activeSkills: ['ignored']
      })
    ).resolves.toEqual({
      agentId: 'claude-acp',
      targetAgentId: 'claude-acp',
      providerId: 'acp',
      modelId: 'claude-acp',
      permissionMode: 'full_access',
      generationSettings: { systemPrompt: '' },
      disabledAgentTools: [],
      activeSkills: []
    })
    expect(catalog.resolveAgent).toHaveBeenCalledWith('claude-acp')
    await expect(policy.resolveTransferTarget('claude-acp', null)).rejects.toThrow(
      'Conversation history cannot be moved to ACP agents.'
    )
  })

  it('inherits parent surface for self-target DeepChat subagents', async () => {
    const { policy } = createHarness()

    await expect(
      policy.resolveSubagentAssignment({
        agentId: 'deepchat',
        parentAgentId: 'deepchat',
        targetAgentId: 'deepchat',
        projectDir: '/repo',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'default',
        generationSettings: { systemPrompt: 'parent prompt', temperature: 0.2 },
        disabledAgentTools: ['exec'],
        activeSkills: ['skill-a', 'skill-b']
      })
    ).resolves.toEqual({
      agentId: 'deepchat',
      targetAgentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'default',
      generationSettings: { systemPrompt: 'parent prompt', temperature: 0.2 },
      disabledAgentTools: ['exec'],
      activeSkills: ['skill-a', 'skill-b']
    })
  })

  it('applies target host policy for cross-agent DeepChat subagents', async () => {
    const { policy, configs } = createHarness()
    configs.set('reviewer', {
      defaultModelPreset: { providerId: 'anthropic', modelId: 'claude-review' },
      permissionMode: 'default',
      systemPrompt: 'Reviewer prompt',
      disabledAgentTools: ['write', 'exec'],
      enabledSkillNames: ['skill-b']
    })

    await expect(
      policy.resolveSubagentAssignment({
        agentId: 'reviewer',
        parentAgentId: 'deepchat',
        targetAgentId: 'reviewer',
        projectDir: '/repo',
        providerId: 'openai',
        modelId: 'gpt-4',
        permissionMode: 'full_access',
        generationSettings: { systemPrompt: 'parent prompt', temperature: 0.4 },
        disabledAgentTools: [],
        activeSkills: ['skill-a', 'skill-b', 'skill-c']
      })
    ).resolves.toEqual({
      agentId: 'reviewer',
      targetAgentId: 'reviewer',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'default',
      generationSettings: {
        systemPrompt: 'Reviewer prompt',
        temperature: 0.4
      },
      disabledAgentTools: ['exec', 'write'],
      activeSkills: ['skill-b']
    })
  })

  it('rejects DeepChat transfer targets backed by ACP defaults', async () => {
    const { policy, configs } = createHarness()
    configs.set('reviewer', {
      defaultModelPreset: { providerId: 'acp', modelId: 'claude-acp' }
    })

    await expect(policy.resolveTransferTarget('reviewer', null)).rejects.toThrow(
      'Conversation history cannot be moved to ACP agents.'
    )
  })

  it('normalizes legacy tool and skill values deterministically', () => {
    expect(
      normalizeDisabledAgentTools([' yo_browser_cdp_send ', 'grep', 'ls', 'cdp_send'], {
        dropLegacySearchTools: true
      })
    ).toEqual(['cdp_send'])
    expect(
      normalizeDisabledAgentTools([...Object.values(TAPE_TOOL_NAMES), 'read', 'tape_search'])
    ).toEqual(['read'])
    expect(normalizeDisabledAgentTools(['__proto__'])).toEqual(['__proto__'])
    expect(normalizeActiveSkills([' review ', '', 'review', 'test'])).toEqual(['review', 'test'])
  })
})
