import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import { dimDatabase } from './fixtures/database'

it('persists non-secret grants, rotates credentials and fences replaced or disabled providers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-grants-'))
  const filename = path.join(directory, 'desktop.sqlite')
  let db = dimDatabase(filename)
  let resolutions = 0
  let modelEnabled = true
  let connection: unknown
  const provider: LLM_PROVIDER = {
    id: 'custom',
    name: 'Test',
    apiType: 'openai',
    baseUrl: 'https://example.test/v1',
    apiKey: 'protected-fixture-key',
    enable: true
  }
  const settings = {
    getProviderById: () => provider,
    getModelStatus: () => modelEnabled,
    getModelConfig: () =>
      ({
        contextLength: 8192,
        maxTokens: 1024,
        functionCall: true,
        vision: false,
        reasoning: false
      }) as ModelConfig,
    getProviderModelRouteMetadata: () => undefined,
    getCapabilitySnapshot: () =>
      ({
        supportsAudioInput: false,
        supportsReasoning: false,
        reasoningPortrait: null
      }) as ReturnType<ProviderSettingsPort['getCapabilitySnapshot']>
  }
  const create = () =>
    new DimModelCatalog({
      settings,
      models: {
        configure: async (config) => {
          connection = config
          return { providerId: 'native', modelId: 'fixture' }
        }
      },
      grants: db.data.dimProviderGrantsTable,
      credential: async (current) => {
        resolutions++
        return current.apiKey
      }
    })
  const signal = new AbortController().signal
  const reference = 'deepchat/provider/v1/custom'
  try {
    let catalog = create()
    await catalog.admit('custom', 'fixture')
    expect(JSON.stringify(connection)).not.toContain(provider.apiKey)
    expect(connection).toMatchObject({
      connection: { credential: { action: 'set_ref', reference } }
    })
    db.sqlite.close()
    db = dimDatabase(filename)
    catalog = create()
    provider.apiKey = 'rotated-protected-key'
    expect(await catalog.credential('native', reference, signal)).toBe('rotated-protected-key')
    await expect(catalog.credential('other', reference, signal)).rejects.toThrow()
    await expect(catalog.credential('native', 'other', signal)).rejects.toThrow()
    provider.baseUrl = 'https://replaced.test/v1'
    await expect(catalog.credential('native', reference, signal)).rejects.toThrow('replaced')
    provider.baseUrl = 'https://example.test/v1'
    modelEnabled = false
    await expect(catalog.credential('native', reference, signal)).rejects.toThrow('disabled')
    modelEnabled = true
    provider.enable = false
    await expect(catalog.credential('native', reference, signal)).rejects.toThrow('unavailable')
    modelEnabled = false
    expect(await catalog.registerForHistory('custom', 'fixture')).toEqual({
      providerId: 'native',
      modelId: 'fixture'
    })
    await expect(catalog.admit('custom', 'fixture')).rejects.toThrow('unavailable')
    await expect(catalog.credential('native', reference, signal)).rejects.toThrow('unavailable')
    expect(resolutions).toBe(1)
  } finally {
    db.sqlite.close()
    await rm(directory, { recursive: true, force: true })
  }
})
