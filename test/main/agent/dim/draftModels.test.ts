import { expect, it, vi } from 'vitest'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { dimDatabase } from './fixtures/database'

it('keeps draft grants in memory and revokes an in-flight credential callback before cleanup', async () => {
  const db = dimDatabase()
  const saved: LLM_PROVIDER = {
    id: 'custom',
    name: 'Saved',
    enable: false,
    apiType: 'openai-completions',
    apiKey: 'saved-secret',
    baseUrl: 'https://example.test/v1'
  }
  let hold = false
  let releaseSecret!: (secret: string) => void
  const held = new Promise<string>((resolve) => {
    releaseSecret = resolve
  })
  const configure = vi.fn(async () => ({ providerId: 'draft-native', modelId: 'fixture' }))
  const releaseConfiguration = vi.fn(async () => {})
  const catalog = new DimModelCatalog({
    settings: {
      getProviderById: () => saved,
      getModelStatus: () => false,
      getModelConfig: () =>
        ({
          maxTokens: 1024,
          contextLength: 8192,
          type: 'chat',
          functionCall: false,
          vision: false,
          reasoning: false
        }) as ModelConfig,
      getProviderModelRouteMetadata: () => undefined,
      getCapabilitySnapshot: () =>
        ({
          supportsReasoning: false,
          supportsAudioInput: false,
          reasoningPortrait: null
        }) as ReturnType<ProviderSettingsPort['getCapabilitySnapshot']>
    },
    models: { configure, releaseConfiguration },
    grants: db.data.dimProviderGrantsTable,
    credential: async (provider) => (hold ? held : provider.apiKey)
  })
  let denied!: Promise<void>
  const signal = new AbortController().signal
  try {
    await catalog.withDraft({ ...saved, apiKey: 'draft-secret' }, async (draft) => {
      await draft.admit(saved.id, 'fixture')
      expect(await catalog.credential('draft-native', 'deepchat/provider/v1/custom', signal)).toBe(
        'draft-secret'
      )
      expect(db.data.dimProviderGrantsTable.get('draft-native')).toBeNull()
      expect(saved).toMatchObject({ enable: false, apiKey: 'saved-secret' })
      expect(JSON.stringify(configure.mock.calls)).not.toContain('draft-secret')
      hold = true
      denied = expect(
        catalog.credential('draft-native', 'deepchat/provider/v1/custom', signal)
      ).rejects.toThrow()
    })
    expect(releaseConfiguration).toHaveBeenCalledWith('draft-native')
    releaseSecret('draft-secret')
    await denied
    await expect(
      catalog.credential('draft-native', 'deepchat/provider/v1/custom', signal)
    ).rejects.toThrow('Unknown native credential grant')
    await expect(
      catalog.withDraft({ ...saved, apiKey: 'draft-secret' }, async (draft) => {
        await draft.admit(saved.id, 'fixture')
        throw new Error('failed draft inference')
      })
    ).rejects.toThrow('failed draft inference')
    expect(releaseConfiguration).toHaveBeenCalledTimes(2)
    expect(db.data.dimProviderGrantsTable.get('draft-native')).toBeNull()
  } finally {
    db.sqlite.close()
  }
})
