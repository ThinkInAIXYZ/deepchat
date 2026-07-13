import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/presenter'
import type { AcpClientRuntime } from '@/agent/acp/client'
import { AcpRuntimeOwner } from '@/agent/acp/client/acpRuntimeOwner'
import { ProviderInstanceManager } from '@/presenter/llmProviderPresenter/managers/providerInstanceManager'
import { RateLimitManager } from '@/presenter/llmProviderPresenter/managers/rateLimitManager'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getName: vi.fn(() => 'DeepChat'),
    getPath: vi.fn(() => '/tmp'),
    on: vi.fn()
  },
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))

vi.mock('@/presenter', () => ({ presenter: {} }))

const acpProviderInstances = vi.hoisted(
  () =>
    [] as Array<{
      owner: AcpRuntimeOwner
      cleanup: ReturnType<typeof vi.fn>
      updateConfig: ReturnType<typeof vi.fn>
    }>
)

vi.mock('@/presenter/llmProviderPresenter/providers/acpProvider', () => ({
  AcpProvider: class {
    cleanup = vi.fn(async () => undefined)
    updateConfig = vi.fn()
    onProxyResolved = vi.fn()

    constructor(
      _provider: LLM_PROVIDER,
      _config: unknown,
      readonly owner: AcpRuntimeOwner
    ) {
      owner.getOrCreate()
      acpProviderInstances.push(this)
    }
  }
}))

const provider: LLM_PROVIDER = {
  id: 'acp',
  name: 'ACP',
  apiType: 'acp',
  apiKey: '',
  baseUrl: '',
  enable: true
}

describe('ProviderInstanceManager ACP lifetime', () => {
  beforeEach(() => {
    acpProviderInstances.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rebuilds and removes compatibility providers without shutting down the shared owner', () => {
    const processShutdown = vi.fn()
    const sharedRuntime = {
      sessionManager: { clearAllSessions: vi.fn() },
      processManager: { shutdown: processShutdown }
    } as unknown as AcpClientRuntime
    const owner = new AcpRuntimeOwner(() => sharedRuntime)
    const providers = new Map([[provider.id, provider]])
    const manager = new ProviderInstanceManager({
      configPresenter: {
        getProviders: () => [...providers.values()]
      } as never,
      activeStreams: new Map(),
      rateLimitManager: {
        syncProviders: vi.fn(),
        cleanupProviderRateLimit: vi.fn()
      } as never,
      getCurrentProviderId: () => null,
      setCurrentProviderId: vi.fn(),
      acpRuntimeOwner: owner
    })
    manager.init()
    const first = manager.getProviderInstance('acp')

    manager.handleProviderAtomicUpdate({
      operation: 'update',
      providerId: 'acp',
      provider: { ...provider, name: 'ACP updated' },
      updates: { name: 'ACP updated' },
      requiresRebuild: true
    })
    const second = manager.getExistingProviderInstance('acp')

    expect(second).not.toBe(first)
    expect(acpProviderInstances).toHaveLength(2)
    expect(acpProviderInstances[0].owner).toBe(owner)
    expect(acpProviderInstances[1].owner).toBe(owner)
    expect(owner.peek()).toBe(sharedRuntime)
    expect(processShutdown).not.toHaveBeenCalled()

    manager.handleProviderAtomicUpdate({
      operation: 'remove',
      providerId: 'acp',
      requiresRebuild: true
    })

    expect(acpProviderInstances[1].cleanup).toHaveBeenCalledTimes(1)
    expect(owner.peek()).toBe(sharedRuntime)
    expect(processShutdown).not.toHaveBeenCalled()
  })

  it('aborts compatibility streams and clears provider state when ACP is disabled', () => {
    const processShutdown = vi.fn()
    const sharedRuntime = {
      sessionManager: { clearAllSessions: vi.fn() },
      processManager: { shutdown: processShutdown }
    } as unknown as AcpClientRuntime
    const owner = new AcpRuntimeOwner(() => sharedRuntime)
    const providers = new Map([[provider.id, provider]])
    const abortController = new AbortController()
    const cleanupRateLimit = vi.fn()
    const setCurrentProviderId = vi.fn()
    const manager = new ProviderInstanceManager({
      configPresenter: {
        getProviders: () => [...providers.values()]
      } as never,
      activeStreams: new Map([['stream', { providerId: 'acp', abortController } as never]]),
      rateLimitManager: {
        syncProviders: vi.fn(),
        cleanupProviderRateLimit: cleanupRateLimit
      } as never,
      getCurrentProviderId: () => 'acp',
      setCurrentProviderId,
      acpRuntimeOwner: owner
    })
    manager.init()
    manager.getProviderInstance('acp')

    manager.handleProviderAtomicUpdate({
      operation: 'update',
      providerId: 'acp',
      provider: { ...provider, enable: false },
      updates: { enable: false },
      requiresRebuild: true
    })

    expect(abortController.signal.aborted).toBe(true)
    expect(acpProviderInstances[0].cleanup).toHaveBeenCalledTimes(1)
    expect(cleanupRateLimit).toHaveBeenCalledWith('acp', 'provider')
    expect(setCurrentProviderId).toHaveBeenCalledWith(null)
    expect(owner.peek()).toBe(sharedRuntime)
    expect(processShutdown).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'rebuild',
      change: {
        operation: 'update' as const,
        providerId: 'acp',
        updates: { name: 'ACP rebuilt' },
        requiresRebuild: true
      }
    },
    {
      name: 'disable',
      change: {
        operation: 'update' as const,
        providerId: 'acp',
        updates: { enable: false },
        requiresRebuild: true
      }
    },
    {
      name: 'remove',
      change: {
        operation: 'remove' as const,
        providerId: 'acp',
        requiresRebuild: true
      }
    }
  ])('keeps direct admission alive through ACP provider $name', async ({ change }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'))
    const configuredProvider = {
      ...provider,
      rateLimit: { enabled: true, qpsLimit: 1 }
    }
    const providers = new Map([[configuredProvider.id, configuredProvider]])
    const configPresenter = {
      getProviders: () => [...providers.values()]
    }
    const rateLimitManager = new RateLimitManager(configPresenter as never)
    rateLimitManager.initializeProviderRateLimitConfigs()
    const owner = new AcpRuntimeOwner(
      () =>
        ({
          sessionManager: { clearAllSessions: vi.fn() },
          processManager: { shutdown: vi.fn() }
        }) as unknown as AcpClientRuntime
    )
    const manager = new ProviderInstanceManager({
      configPresenter: configPresenter as never,
      activeStreams: new Map(),
      rateLimitManager,
      getCurrentProviderId: () => null,
      setCurrentProviderId: vi.fn(),
      acpRuntimeOwner: owner
    })
    manager.init()
    manager.getProviderInstance('acp')
    await rateLimitManager.executeWithRateLimit('acp')
    const direct = rateLimitManager.executeWithRateLimit('acp', { scope: 'acp-direct' })
    const compatibility = rateLimitManager.executeWithRateLimit('acp')
    await Promise.resolve()

    manager.handleProviderAtomicUpdate(change)

    await expect(compatibility).rejects.toThrow('Provider removed')
    expect(rateLimitManager.getQueueLength('acp')).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(direct).resolves.toBeUndefined()
    expect(owner.peek()).toBeDefined()
  })
})
