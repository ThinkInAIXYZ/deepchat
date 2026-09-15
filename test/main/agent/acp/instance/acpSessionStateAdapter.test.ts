import { describe, expect, it, vi } from 'vitest'
import { AcpSessionStateAdapter } from '@/agent/acp/instance/acpSessionStateAdapter'
import type { SessionSettingsStore } from '@/session/data/settings'
import type { ProviderModelResolutionPort } from '@/provider/settings'

function createFixture() {
  const rows = new Map<string, Record<string, unknown>>()
  const settings = {
    get: vi.fn((id: string) => rows.get(id)),
    create: vi.fn(
      (
        id: string,
        providerId: string,
        modelId: string,
        permissionMode: string,
        generation: Record<string, unknown>
      ) =>
        rows.set(id, {
          provider_id: providerId,
          model_id: modelId,
          permission_mode: permissionMode,
          ...generation
        })
    ),
    delete: vi.fn((id: string) => rows.delete(id)),
    updatePermissionMode: vi.fn(),
    getGenerationSettings: vi.fn((id: string) => rows.get(id)?.generation ?? null),
    updateGenerationSettings: vi.fn()
  } as unknown as SessionSettingsStore
  const providerSettings = {
    getProviderById: vi.fn(() => undefined),
    getCapabilitySnapshot: vi.fn(() => ({
      identity: {
        providerId: 'provider',
        requestModelId: 'model',
        catalogMatched: false,
        catalogModelId: null
      },
      requestPolicy: {
        temperature: { mode: 'passthrough' },
        topP: { mode: 'passthrough' },
        reasoning: { mode: 'passthrough' },
        legacyThinking: { mode: 'passthrough' }
      },
      supportsAudioInput: false,
      supportsReasoning: false,
      reasoningPortrait: null,
      thinkingBudgetRange: {},
      supportsSearch: false,
      searchDefaults: {},
      temperatureCapability: undefined,
      supportsTemperatureControl: true,
      supportsReasoningEffort: false,
      reasoningEffortDefault: undefined,
      supportsVerbosity: false,
      verbosityDefault: undefined
    })),
    getModelConfig: vi.fn(() => ({ contextLength: 4096, maxTokens: 512 }))
  } as unknown as ProviderModelResolutionPort
  const promptSettings = { getDefaultSystemPrompt: vi.fn(async () => 'default prompt') } as Pick<
    PromptSettings,
    'getDefaultSystemPrompt'
  >
  const adapter = new AcpSessionStateAdapter(settings, providerSettings, promptSettings)
  return { adapter, settings, rows }
}

describe('AcpSessionStateAdapter', () => {
  it('initializes once and sanitizes generation settings', async () => {
    const { adapter, settings } = createFixture()
    await adapter.initSession('s1', {
      providerId: 'provider',
      modelId: 'model',
      generationSettings: { systemPrompt: 'prompt' }
    })
    await adapter.initSession('s1', {
      providerId: 'provider',
      modelId: 'model',
      generationSettings: { systemPrompt: 'changed' }
    })
    expect(settings.create).toHaveBeenCalledOnce()
    expect(settings.create).toHaveBeenCalledWith(
      's1',
      'provider',
      'model',
      'default',
      expect.objectContaining({ systemPrompt: 'prompt' })
    )
  })

  it('reads state, list state, and permission, and destroys through the host store', async () => {
    const { adapter, settings } = createFixture()
    await adapter.initSession('s1', {
      providerId: 'provider',
      modelId: 'model',
      permissionMode: 'auto_approve'
    })
    expect(await adapter.getSessionState('s1')).toMatchObject({
      status: 'idle',
      providerId: 'provider',
      modelId: 'model',
      permissionMode: 'auto_approve'
    })
    expect(await adapter.getSessionListState('s1')).toEqual(await adapter.getSessionState('s1'))
    expect(await adapter.getPermissionMode('s1')).toBe('auto_approve')
    await adapter.destroySession('s1')
    expect(settings.delete).toHaveBeenCalledWith('s1')
  })

  it('persists generation patches and ignores project directory', async () => {
    const { adapter, settings } = createFixture()
    await adapter.initSession('s1', { providerId: 'provider', modelId: 'model' })
    await adapter.updateGenerationSettings('s1', { temperature: 0.2 })
    expect(settings.updateGenerationSettings).toHaveBeenCalledWith('s1', { temperature: 0.2 })
    await expect(adapter.setSessionProjectDir('s1', '/tmp/project')).resolves.toBeUndefined()
  })
})
