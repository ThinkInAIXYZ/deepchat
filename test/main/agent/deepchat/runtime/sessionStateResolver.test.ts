import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  SessionStateResolver,
  type SessionStateResolverDependencies
} from '@/agent/deepchat/runtime/sessionStateResolver'

const SESSION_ID = 'session'

const PERSISTED_ROW = {
  provider_id: 'openai',
  model_id: 'gpt-5',
  permission_mode: 'full_access'
}

function createHarness(options: { persisted?: unknown; hasPendingInteractions?: boolean } = {}) {
  const order: string[] = []
  const runtime = new DeepChatAgentRuntime()
  const getAgentId = vi.fn(() => {
    order.push('identity.getAgentId')
    return 'deepchat'
  })
  const hasPendingInteractions = vi.fn(() => {
    order.push('runLifecycle.hasPendingInteractions')
    return options.hasPendingInteractions ?? false
  })
  const getEffectiveGenerationSettings = vi.fn(async () => {
    order.push('sessionSettings.getEffectiveGenerationSettings')
    return {} as never
  })
  const deps = {
    registry: runtime,
    sessionStore: {
      get: vi.fn(() => {
        order.push('sessionStore.get')
        return 'persisted' in options ? options.persisted : PERSISTED_ROW
      })
    },
    runLifecycle: { hasPendingInteractions },
    identity: { getAgentId },
    sessionSettings: { getEffectiveGenerationSettings }
  } as unknown as SessionStateResolverDependencies

  return {
    getEffectiveGenerationSettings,
    order,
    resolver: new SessionStateResolver(deps),
    runtime
  }
}

function hydrate(runtime: DeepChatAgentRuntime): void {
  runtime.getOrHydrateScope(toAppSessionId(SESSION_ID)).instance.setRuntimeState({
    status: 'idle',
    providerId: 'openai',
    modelId: 'gpt-5',
    permissionMode: 'full_access'
  })
}

describe('SessionStateResolver', () => {
  it('warms generation settings before reading pending interactions on a hydrated session', async () => {
    const { order, resolver, runtime } = createHarness()
    hydrate(runtime)

    await resolver.get(SESSION_ID)

    expect(order).toEqual([
      'identity.getAgentId',
      'sessionSettings.getEffectiveGenerationSettings',
      'runLifecycle.hasPendingInteractions'
    ])
  })

  it('skips generation settings for a summary read', async () => {
    const { getEffectiveGenerationSettings, resolver, runtime } = createHarness()
    hydrate(runtime)

    await resolver.getSummary(SESSION_ID)

    expect(getEffectiveGenerationSettings).not.toHaveBeenCalled()
  })

  it('reads pending interactions before persisting the rebuilt runtime state', async () => {
    const { order, resolver, runtime } = createHarness()

    const state = await resolver.get(SESSION_ID)

    expect(order).toEqual([
      'sessionStore.get',
      'identity.getAgentId',
      'runLifecycle.hasPendingInteractions',
      'sessionSettings.getEffectiveGenerationSettings'
    ])
    expect(state).toEqual({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))?.getRuntimeState()).toEqual({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
  })

  it('projects generating status without mutating the stored runtime state', async () => {
    const { resolver, runtime } = createHarness({ hasPendingInteractions: true })

    const state = await resolver.get(SESSION_ID)

    expect(state?.status).toBe('generating')
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))?.getRuntimeState()?.status).toBe('idle')
  })

  it('evicts the runtime instance and returns null when no persisted session exists', async () => {
    const { resolver, runtime } = createHarness({ persisted: undefined })

    await expect(resolver.get(SESSION_ID)).resolves.toBeNull()

    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))).toBeUndefined()
  })
})
