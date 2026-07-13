import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { RuntimeSharedState } from '@/presenter/agentRuntimePresenter/runtimeSharedState'
import {
  SessionLifecycleService,
  type SessionLifecycleDependencies,
  type SessionLifecycleHost
} from '@/presenter/agentRuntimePresenter/sessionLifecycleService'

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

vi.mock('@/presenter/agentRuntimePresenter/internalSessionEvents', () => ({
  emitDeepChatInternalSessionUpdate: vi.fn()
}))

describe('SessionLifecycleService', () => {
  let runtimeSharedState: RuntimeSharedState
  let sessionStore: Record<string, ReturnType<typeof vi.fn>>
  let messageStore: Record<string, ReturnType<typeof vi.fn>>
  let sessionSettingsService: Record<string, ReturnType<typeof vi.fn>>
  let generationControlService: Record<string, ReturnType<typeof vi.fn>>
  let sqlitePresenter: {
    newSessionsTable: { get: ReturnType<typeof vi.fn> }
  }
  let host: SessionLifecycleHost
  let service: SessionLifecycleService
  let generationSettings: {
    systemPrompt: string
    temperature: number
    contextLength: number
    maxTokens: number
    timeout: number
  }

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeSharedState = new RuntimeSharedState()
    generationSettings = {
      systemPrompt: 'system',
      temperature: 0.7,
      contextLength: 32000,
      maxTokens: 4096,
      timeout: 30000
    }
    sessionStore = {
      create: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      updateSessionModel: vi.fn(),
      updatePermissionMode: vi.fn()
    }
    messageStore = {
      deleteBySession: vi.fn()
    }
    sessionSettingsService = {
      prepareGenerationSettings: vi.fn().mockResolvedValue(generationSettings),
      cacheGenerationSettings: vi.fn(),
      replaceGenerationSettings: vi.fn(),
      clearSession: vi.fn(),
      getEffectiveGenerationSettings: vi.fn().mockResolvedValue(generationSettings)
    }
    generationControlService = {
      destroySession: vi.fn()
    }
    sqlitePresenter = {
      newSessionsTable: { get: vi.fn() }
    }
    host = {
      hasPendingInteractions: vi.fn(() => false),
      destroyPendingInputs: vi.fn(),
      initializeMemoryCompactionSession: vi.fn(),
      destroyMemoryCompactionSession: vi.fn(),
      invalidateSystemPromptCache: vi.fn(),
      invalidateToolProfileCache: vi.fn(),
      clearRuntimeActivatedSkills: vi.fn(),
      clearConversationToolMapping: vi.fn()
    }
    service = new SessionLifecycleService(
      {
        sqlitePresenter,
        sessionStore,
        messageStore,
        runtimeSharedState,
        sessionSettingsService,
        generationControlService,
        sessionUiPort: { refreshSessionUi: vi.fn() }
      } as unknown as SessionLifecycleDependencies,
      host
    )
  })

  it('initializes persistence, runtime state, owned context, and collaborator state', async () => {
    await service.initSession('s1', {
      agentId: ' coder ',
      providerId: 'openai',
      modelId: 'gpt-4',
      projectDir: ' /tmp/workspace ',
      permissionMode: 'auto_approve',
      generationSettings: { maxTokens: 2048 }
    })

    expect(sessionSettingsService.prepareGenerationSettings).toHaveBeenCalledWith(
      'openai',
      'gpt-4',
      { maxTokens: 2048 }
    )
    expect(sessionStore.create).toHaveBeenCalledWith(
      's1',
      'openai',
      'gpt-4',
      'auto_approve',
      generationSettings
    )
    expect(runtimeSharedState.runtimeState.get('s1')).toEqual({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'auto_approve'
    })
    expect(service.getSessionAgentId('s1')).toBe('coder')
    expect(service.resolveProjectDir('s1')).toBe('/tmp/workspace')
    expect(host.initializeMemoryCompactionSession).toHaveBeenCalledWith('s1')
    expect(host.invalidateSystemPromptCache).toHaveBeenCalledWith('s1')
    expect(host.invalidateToolProfileCache).toHaveBeenCalledWith('s1')
  })

  it('hydrates full restored state but keeps list hydration lightweight', async () => {
    sessionStore.get.mockReturnValue({
      provider_id: 'anthropic',
      model_id: 'claude',
      permission_mode: 'default'
    })
    sqlitePresenter.newSessionsTable.get.mockReturnValue({
      agent_id: 'researcher',
      project_dir: '/persisted'
    })

    await expect(service.getSessionListState('s1')).resolves.toEqual({
      status: 'idle',
      providerId: 'anthropic',
      modelId: 'claude',
      permissionMode: 'default'
    })
    expect(sessionSettingsService.getEffectiveGenerationSettings).not.toHaveBeenCalled()
    expect(service.getSessionAgentId('s1')).toBe('researcher')
    expect(service.resolveProjectDir('s1')).toBe('/persisted')

    await service.getSessionState('s1')
    expect(sessionSettingsService.getEffectiveGenerationSettings).toHaveBeenCalledWith('s1')
  })

  it('reflects pending interactions while resolving state', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    })
    vi.mocked(host.hasPendingInteractions).mockReturnValue(true)

    await expect(service.getSessionListState('s1')).resolves.toMatchObject({
      status: 'generating'
    })
  })

  it('settles first-turn waiters on ready, clear, and timeout', async () => {
    const ready = service.waitForFirstTurnReady('s1', { timeoutMs: 1000 })
    service.markFirstTurnReady('s1')
    await expect(ready).resolves.toBe(true)
    await expect(service.waitForFirstTurnReady('s1', { timeoutMs: 0 })).resolves.toBe(true)

    const cleared = service.waitForFirstTurnReady('s2', { timeoutMs: 1000 })
    service.clearFirstTurnReady('s2')
    await expect(cleared).resolves.toBe(false)
    await expect(service.waitForFirstTurnReady('s3', { timeoutMs: 0 })).resolves.toBe(false)
  })

  it('destroys collaborators and owned state in cancellation-safe order', async () => {
    await service.initSession('s1', {
      agentId: 'coder',
      providerId: 'openai',
      modelId: 'gpt-4',
      projectDir: '/tmp/workspace'
    })
    const readiness = service.waitForFirstTurnReady('s1', { timeoutMs: 1000 })

    await service.destroySession('s1')

    await expect(readiness).resolves.toBe(false)
    expect(host.destroyMemoryCompactionSession).toHaveBeenCalledWith('s1')
    expect(generationControlService.destroySession).toHaveBeenCalledWith('s1')
    expect(host.destroyPendingInputs).toHaveBeenCalledWith('s1')
    expect(messageStore.deleteBySession).toHaveBeenCalledWith('s1')
    expect(sessionStore.delete).toHaveBeenCalledWith('s1')
    expect(runtimeSharedState.runtimeState.has('s1')).toBe(false)
    expect(service.getSessionAgentId('s1')).toBeUndefined()
    expect(service.resolveProjectDir('s1')).toBeNull()
    expect(host.destroyMemoryCompactionSession).toHaveBeenCalledBefore(
      generationControlService.destroySession
    )
    expect(host.clearConversationToolMapping).toHaveBeenCalledWith('s1')
  })

  it('moves an idle session to a normalized agent context', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'old-provider',
      modelId: 'old-model',
      permissionMode: 'full_access'
    })
    sessionStore.get.mockReturnValue({ id: 's1' })

    await service.setSessionAgentContext('s1', {
      agentId: ' next-agent ',
      providerId: ' next-provider ',
      modelId: ' next-model ',
      permissionMode: 'auto_approve',
      projectDir: ' /next '
    })

    expect(runtimeSharedState.runtimeState.get('s1')).toEqual({
      status: 'idle',
      providerId: 'next-provider',
      modelId: 'next-model',
      permissionMode: 'auto_approve'
    })
    expect(sessionStore.updateSessionModel).toHaveBeenCalledWith(
      's1',
      'next-provider',
      'next-model'
    )
    expect(sessionStore.updatePermissionMode).toHaveBeenCalledWith('s1', 'auto_approve')
    expect(sessionSettingsService.replaceGenerationSettings).toHaveBeenCalledWith(
      's1',
      generationSettings
    )
    expect(service.getSessionAgentId('s1')).toBe('next-agent')
    expect(service.resolveProjectDir('s1')).toBe('/next')
  })

  it('rejects moving a generating session', async () => {
    runtimeSharedState.runtimeState.set('s1', {
      status: 'generating',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    })

    await expect(
      service.setSessionAgentContext('s1', {
        agentId: 'coder',
        providerId: 'anthropic',
        modelId: 'claude'
      })
    ).rejects.toThrow('Cannot move session while it is generating.')
  })

  it('invalidates preparation caches only when the project changes', async () => {
    sqlitePresenter.newSessionsTable.get.mockReturnValue({ project_dir: '/same' })

    await service.setSessionProjectDir('s1', ' /same ')
    expect(host.invalidateSystemPromptCache).not.toHaveBeenCalled()

    await service.setSessionProjectDir('s1', '/next')
    expect(host.invalidateSystemPromptCache).toHaveBeenCalledWith('s1')
    expect(host.invalidateToolProfileCache).toHaveBeenCalledWith('s1')
  })

  it('publishes status changes once and refreshes session UI', () => {
    const refreshSessionUi = vi.fn()
    service = new SessionLifecycleService(
      {
        sqlitePresenter,
        sessionStore,
        messageStore,
        runtimeSharedState,
        sessionSettingsService,
        generationControlService,
        sessionUiPort: { refreshSessionUi }
      } as unknown as SessionLifecycleDependencies,
      host
    )
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    })

    service.setSessionStatus('s1', 'generating')
    service.setSessionStatus('s1', 'generating')

    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'sessions.status.changed',
      expect.objectContaining({ sessionId: 's1', status: 'generating' })
    )
    expect(vi.mocked(publishDeepchatEvent)).toHaveBeenCalledTimes(2)
    expect(refreshSessionUi).toHaveBeenCalledTimes(1)
  })
})
