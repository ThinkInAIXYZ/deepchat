import { describe, expect, it, vi } from 'vitest'
import {
  LiveDelegationSafetyCoordinator,
  type PrepareLiveDelegationTurnInput
} from '@/orchestration/liveDelegationSafety'
import type { ConversationSessionInfo } from '@/tool/runtimePorts'

const BASE_INPUT: PrepareLiveDelegationTurnInput = {
  parentSessionId: 'parent',
  parentAgentId: 'parent-agent',
  parentPermissionMode: 'default',
  childSessionId: 'child',
  targetAgentId: 'reviewer',
  slotId: 'reviewer-slot',
  delegationId: 'delegation-1',
  projectDir: '/repo',
  executionSnapshot: null
}

function createChild(overrides: Partial<ConversationSessionInfo> = {}): ConversationSessionInfo {
  return {
    sessionId: 'child',
    agentId: 'reviewer',
    agentName: 'Reviewer',
    agentType: 'deepchat',
    providerId: 'openai',
    modelId: 'gpt-5',
    projectDir: '/repo',
    permissionMode: 'default',
    orchestrationPolicy: 'explicit',
    generationSettings: { systemPrompt: 'Current prompt' },
    disabledAgentTools: [],
    activeSkills: [],
    sessionKind: 'subagent',
    parentSessionId: 'parent',
    subagentMeta: {
      slotId: 'reviewer-slot',
      displayName: 'Reviewer',
      liveDelegation: { delegationId: 'delegation-1' }
    },
    subagentCapability: { available: false, reason: 'regular_parent_required' },
    status: 'idle',
    ...overrides
  }
}

function createHarness(overrides: Partial<ConversationSessionInfo> = {}) {
  let child: ConversationSessionInfo | null = createChild(overrides)
  const events: string[] = []
  const resolveConversationSessionInfo = vi.fn(async () => child)
  const resolveSubagentAssignment = vi.fn(async () => ({
    agentId: 'reviewer',
    targetAgentId: 'reviewer',
    providerId: child?.providerId ?? 'openai',
    modelId: child?.modelId ?? 'gpt-5',
    permissionMode: BASE_INPUT.parentPermissionMode,
    generationSettings: child?.generationSettings ?? undefined,
    disabledAgentTools: child?.disabledAgentTools ?? [],
    activeSkills: child?.activeSkills ?? []
  }))
  const clearSessionPermissions = vi.fn(() => events.push('clear'))
  const setPermissionMode = vi.fn(async (_sessionId: string, permissionMode: string) => {
    events.push(`permission:${permissionMode}`)
    if (child) child.permissionMode = permissionMode as ConversationSessionInfo['permissionMode']
    return child as never
  })
  const setSessionProjectDir = vi.fn(async (_sessionId: string, projectDir: string | null) => {
    events.push(`project:${projectDir ?? 'none'}`)
    if (child) child.projectDir = projectDir
    return child as never
  })
  const applyTurnExecutionSnapshot = vi.fn(
    async (
      _sessionId: string,
      snapshot: {
        providerId: string
        modelId: string
        generationSettings: NonNullable<ConversationSessionInfo['generationSettings']>
      }
    ) => {
      events.push('snapshot')
      if (!child) return
      child.providerId = snapshot.providerId
      child.modelId = snapshot.modelId
      child.generationSettings = structuredClone(snapshot.generationSettings)
    }
  )
  const coordinator = new LiveDelegationSafetyCoordinator({
    sessions: { resolveConversationSessionInfo },
    assignmentPolicy: { resolveSubagentAssignment },
    assignment: { setPermissionMode, setSessionProjectDir },
    permissions: { clearSessionPermissions },
    executionSnapshots: { applyTurnExecutionSnapshot }
  })
  return {
    coordinator,
    events,
    get child() {
      return child
    },
    setChild(next: ConversationSessionInfo | null) {
      child = next
    },
    resolveConversationSessionInfo,
    resolveSubagentAssignment,
    clearSessionPermissions,
    setPermissionMode,
    setSessionProjectDir,
    applyTurnExecutionSnapshot
  }
}

describe('LiveDelegationSafetyCoordinator', () => {
  it('restores a DeepChat execution snapshot before resolving live safety', async () => {
    const harness = createHarness()
    const executionSnapshot = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      generationSettings: { systemPrompt: 'Frozen prompt', temperature: 0.2 }
    }

    await expect(
      harness.coordinator.prepareTurn({ ...BASE_INPUT, executionSnapshot })
    ).resolves.toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      generationSettings: executionSnapshot.generationSettings
    })
    expect(harness.applyTurnExecutionSnapshot).toHaveBeenCalledWith('child', executionSnapshot)
    expect(harness.resolveSubagentAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        generationSettings: executionSnapshot.generationSettings
      })
    )
  })

  it('rejects mismatched lineage before changing the child Session', async () => {
    const harness = createHarness({ parentSessionId: 'another-parent' })

    await expect(
      harness.coordinator.prepareTurn({
        ...BASE_INPUT,
        executionSnapshot: {
          providerId: 'anthropic',
          modelId: 'claude-sonnet',
          generationSettings: { systemPrompt: 'Frozen prompt' }
        }
      })
    ).rejects.toThrow('lineage changed')
    expect(harness.applyTurnExecutionSnapshot).not.toHaveBeenCalled()
    expect(harness.resolveSubagentAssignment).not.toHaveBeenCalled()
    expect(harness.clearSessionPermissions).not.toHaveBeenCalled()
  })

  it('fails closed while moving a full-access child to another workdir', async () => {
    const harness = createHarness({ permissionMode: 'full_access' })
    harness.resolveSubagentAssignment.mockResolvedValueOnce({
      agentId: 'reviewer',
      targetAgentId: 'reviewer',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access',
      generationSettings: harness.child!.generationSettings ?? undefined,
      disabledAgentTools: [],
      activeSkills: []
    })

    await expect(
      harness.coordinator.prepareTurn({
        ...BASE_INPUT,
        parentPermissionMode: 'full_access',
        projectDir: '/next-repo'
      })
    ).resolves.toMatchObject({ projectDir: '/next-repo', permissionMode: 'full_access' })
    expect(harness.events).toEqual([
      'clear',
      'permission:default',
      'project:/next-repo',
      'permission:full_access'
    ])
  })

  it('leaves restrictive permission in place when a workdir update fails', async () => {
    const harness = createHarness({ permissionMode: 'full_access' })
    harness.resolveSubagentAssignment.mockResolvedValueOnce({
      agentId: 'reviewer',
      targetAgentId: 'reviewer',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access',
      generationSettings: harness.child!.generationSettings ?? undefined,
      disabledAgentTools: [],
      activeSkills: []
    })
    harness.setSessionProjectDir.mockRejectedValueOnce(new Error('workdir update failed'))

    await expect(
      harness.coordinator.prepareTurn({ ...BASE_INPUT, projectDir: '/next-repo' })
    ).rejects.toThrow('workdir update failed')
    expect(harness.child).toMatchObject({ projectDir: '/repo', permissionMode: 'default' })
    expect(harness.events).toEqual(['clear', 'permission:default'])
  })

  it('does not rewrite an unchanged live safety state', async () => {
    const harness = createHarness()

    await expect(harness.coordinator.prepareTurn(BASE_INPUT)).resolves.toBe(harness.child)
    expect(harness.clearSessionPermissions).not.toHaveBeenCalled()
    expect(harness.setPermissionMode).not.toHaveBeenCalled()
    expect(harness.setSessionProjectDir).not.toHaveBeenCalled()
  })

  it('rejects ACP execution drift because the host cannot restore its model', async () => {
    const harness = createHarness({
      agentType: 'acp',
      providerId: 'acp',
      modelId: 'claude-code'
    })

    await expect(
      harness.coordinator.prepareTurn({
        ...BASE_INPUT,
        executionSnapshot: {
          providerId: 'acp',
          modelId: 'changed-acp-agent',
          generationSettings: null
        }
      })
    ).rejects.toThrow('execution target changed')
    expect(harness.applyTurnExecutionSnapshot).not.toHaveBeenCalled()
    expect(harness.clearSessionPermissions).not.toHaveBeenCalled()
  })

  it('rejects a target policy mismatch before clearing permissions', async () => {
    const harness = createHarness()
    harness.resolveSubagentAssignment.mockResolvedValueOnce({
      agentId: 'another-agent',
      targetAgentId: 'another-agent',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'default',
      generationSettings: harness.child!.generationSettings ?? undefined,
      disabledAgentTools: [],
      activeSkills: []
    })

    await expect(
      harness.coordinator.prepareTurn({
        ...BASE_INPUT,
        executionSnapshot: {
          providerId: 'anthropic',
          modelId: 'claude-sonnet',
          generationSettings: { systemPrompt: 'Must not be applied' }
        }
      })
    ).rejects.toThrow('Subagent target changed')
    expect(harness.applyTurnExecutionSnapshot).not.toHaveBeenCalled()
    expect(harness.clearSessionPermissions).not.toHaveBeenCalled()
    expect(harness.setPermissionMode).not.toHaveBeenCalled()
    expect(harness.setSessionProjectDir).not.toHaveBeenCalled()
  })
})
