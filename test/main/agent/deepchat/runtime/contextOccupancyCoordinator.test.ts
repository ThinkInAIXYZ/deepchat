import { describe, expect, it, vi } from 'vitest'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type { TapeContextOccupancyEvidence } from '@/tape/application/contracts'
import type { TapeProviderAttemptRecord } from '@/tape/domain/providerAttempt'
import { ContextOccupancyCoordinator } from '@/agent/deepchat/runtime/contextOccupancyCoordinator'

const SESSION_ID = 'session-1'

function createManifestRecord(
  overrides: {
    providerId?: string
    modelId?: string
    contextLength?: number
    requestedMaxTokens?: number
    estimatedPromptTokens?: number
    toolReserveTokens?: number
    reconstructionAnchorEntryId?: number | null
    integrity?: 'valid' | 'invalid' | 'unverified'
  } = {}
): DeepChatTapeViewManifestRecord {
  return {
    sessionId: SESSION_ID,
    messageId: 'message-1',
    requestSeq: 3,
    entryId: 101,
    createdAt: 1_000,
    integrity: overrides.integrity ?? 'valid',
    manifest: {
      messageId: 'message-1',
      requestSeq: 3,
      reconstructionAnchorEntryId: overrides.reconstructionAnchorEntryId ?? 42,
      tokenBudget: {
        contextLength: overrides.contextLength ?? 1_000,
        requestedMaxTokens: overrides.requestedMaxTokens ?? 100,
        estimatedPromptTokens: overrides.estimatedPromptTokens ?? 400,
        toolReserveTokens: overrides.toolReserveTokens ?? 50
      },
      meta: {
        providerId: overrides.providerId ?? 'openai',
        modelId: overrides.modelId ?? 'gpt-4'
      }
    } as DeepChatTapeViewManifestRecord['manifest']
  }
}

function createProviderAttempt(
  overrides: {
    messageId?: string
    requestSeq?: number
    providerId?: string
    modelId?: string
    status?: 'completed' | 'context_overflow' | 'aborted' | 'error'
    inputTokens?: number
    cacheReadTokens?: number | null
    usage?: 'present' | 'missing'
  } = {}
): TapeProviderAttemptRecord {
  const inputTokens = overrides.inputTokens ?? 720
  return {
    entryId: 102,
    createdAt: 1_100,
    attempt: {
      schemaVersion: 1,
      messageId: overrides.messageId ?? 'message-1',
      requestSeq: overrides.requestSeq ?? 3,
      providerId: overrides.providerId ?? 'openai',
      modelId: overrides.modelId ?? 'gpt-4',
      status: overrides.status ?? 'completed',
      stopReason: 'complete',
      usage:
        overrides.usage === 'missing'
          ? null
          : {
              inputTokens,
              outputTokens: 20,
              totalTokens: inputTokens + 20,
              cacheReadTokens: overrides.cacheReadTokens ?? 500,
              cacheWriteTokens: null
            },
      cacheHitRate: null,
      contextPressure: null
    }
  }
}

function setup(
  overrides: {
    manifest?: DeepChatTapeViewManifestRecord | null
    providerAttempt?: TapeProviderAttemptRecord | null
    latestAnchorEntryId?: number | null
    activeProviderId?: string
    activeModelId?: string
    configuredContextLength?: number
    requestedMaxTokens?: number
    providerContextLimitTokens?: number
    providerPromptLimitTokens?: number
    hydrated?: boolean
    sessionExists?: boolean
  } = {}
) {
  const instance = {
    getContextWindowObservation: vi.fn(() => {
      const providerContextLimitTokens = overrides.providerContextLimitTokens
      const providerPromptLimitTokens = overrides.providerPromptLimitTokens
      return providerContextLimitTokens === undefined && providerPromptLimitTokens === undefined
        ? undefined
        : { providerContextLimitTokens, providerPromptLimitTokens }
    })
  }
  const state = {
    status: 'idle',
    providerId: overrides.activeProviderId ?? 'openai',
    modelId: overrides.activeModelId ?? 'gpt-4',
    permissionMode: 'full_access'
  }
  let runtimeState = overrides.hydrated === false ? undefined : state
  const scope = {
    instance,
    state: () => runtimeState,
    isCurrent: () => true
  }
  const evidence: TapeContextOccupancyEvidence = {
    manifest:
      overrides.manifest === undefined ? createManifestRecord() : overrides.manifest,
    providerAttempt:
      overrides.providerAttempt === undefined ? createProviderAttempt() : overrides.providerAttempt,
    latestReconstructionAnchorEntryId:
      overrides.latestAnchorEntryId === undefined ? 42 : overrides.latestAnchorEntryId
  }
  const dependencies = {
    runtime: {
      getOrHydrateScope: vi.fn(() => scope)
    },
    sessionState: {
      getSummary: vi.fn(async () => {
        if (overrides.sessionExists === false) return null
        runtimeState = state
        return state
      })
    },
    sessionSettings: {
      getEffectiveGenerationSettings: vi.fn(async () => ({
        contextLength: overrides.configuredContextLength ?? 1_000,
        maxTokens: overrides.requestedMaxTokens ?? 100
      }))
    },
    tape: {
      getContextOccupancyEvidence: vi.fn(() => evidence)
    }
  }
  return {
    coordinator: new ContextOccupancyCoordinator(dependencies as never),
    dependencies
  }
}

describe('ContextOccupancyCoordinator', () => {
  it('uses exact provider input usage without adding cache-read detail', async () => {
    const { coordinator } = setup({
      providerAttempt: createProviderAttempt({ inputTokens: 720, cacheReadTokens: 600 })
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toEqual({
      freshness: 'current',
      source: 'provider',
      occupiedTokens: 720,
      contextWindowTokens: 1_000,
      requestSeq: 3,
      manifestEntryId: 101,
      providerAttemptEntryId: 102,
      measuredAt: 1_100
    })
  })

  it('preserves a provider-reported zero input measurement', async () => {
    const { coordinator } = setup({
      providerAttempt: createProviderAttempt({ inputTokens: 0, cacheReadTokens: 0 })
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      source: 'provider',
      occupiedTokens: 0,
      providerAttemptEntryId: 102
    })
  })

  it('uses the manifest estimate when final-attempt usage is unavailable', async () => {
    const { coordinator } = setup({
      manifest: createManifestRecord({ estimatedPromptTokens: 430, toolReserveTokens: 70 }),
      providerAttempt: createProviderAttempt({ usage: 'missing' })
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      freshness: 'current',
      source: 'estimated',
      occupiedTokens: 500,
      providerAttemptEntryId: null,
      measuredAt: 1_000
    })
  })

  it('does not use usage from a different request or provider', async () => {
    const { coordinator } = setup({
      providerAttempt: createProviderAttempt({ requestSeq: 2, providerId: 'anthropic' })
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      source: 'estimated',
      occupiedTokens: 450,
      providerAttemptEntryId: null
    })
  })

  it.each([
    ['provider', { activeProviderId: 'anthropic' }],
    ['model', { activeModelId: 'gpt-5' }],
    ['effective window', { configuredContextLength: 2_000 }],
    ['reconstruction anchor', { latestAnchorEntryId: 43 }]
  ])('marks evidence stale after a %s change', async (_label, overrides) => {
    const { coordinator } = setup(overrides)
    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      freshness: 'stale'
    })
  })

  it('uses a matching provider limit to prove the request window is current', async () => {
    const { coordinator } = setup({
      configuredContextLength: 2_000,
      providerContextLimitTokens: 1_000
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      freshness: 'current',
      contextWindowTokens: 1_000
    })
  })

  it('recomputes a request-limited window from the manifest output budget', async () => {
    const { coordinator } = setup({
      manifest: createManifestRecord({ contextLength: 1_050, requestedMaxTokens: 50 }),
      configuredContextLength: 2_000,
      requestedMaxTokens: 100,
      providerPromptLimitTokens: 1_000
    })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      freshness: 'current',
      contextWindowTokens: 1_050
    })
  })

  it('does not become stale merely because ordinary output was appended after the request', async () => {
    const manifest = createManifestRecord()
    manifest.manifest.latestEntryId = 50
    const { coordinator } = setup({ manifest })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      freshness: 'current'
    })
  })

  it('hydrates a cold session before reading persisted occupancy evidence', async () => {
    const { coordinator, dependencies } = setup({ hydrated: false })

    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toMatchObject({
      freshness: 'current',
      occupiedTokens: 720
    })
    expect(dependencies.sessionState.getSummary).toHaveBeenCalledWith(SESSION_ID)
    expect(dependencies.sessionSettings.getEffectiveGenerationSettings).toHaveBeenCalledWith(
      SESSION_ID,
      expect.anything()
    )
  })

  it.each([
    ['missing manifest', { manifest: null }],
    ['invalid newest manifest', { manifest: createManifestRecord({ integrity: 'invalid' }) }],
    ['nonpositive window', { manifest: createManifestRecord({ contextLength: 0 }) }],
    ['missing cold session', { hydrated: false, sessionExists: false }]
  ])('returns unavailable for %s', async (_label, overrides) => {
    const { coordinator } = setup(overrides)
    await expect(coordinator.getSnapshot(SESSION_ID)).resolves.toEqual({
      freshness: 'unavailable',
      source: null,
      occupiedTokens: null,
      contextWindowTokens: null,
      requestSeq: null,
      manifestEntryId: null,
      providerAttemptEntryId: null,
      measuredAt: null
    })
  })
})
