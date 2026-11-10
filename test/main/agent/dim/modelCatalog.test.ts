import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
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

it('keeps custom headers behind immutable grants, including anonymous connections', async () => {
  const db = dimDatabase()
  const provider: LLM_PROVIDER = {
    id: 'ollama',
    name: 'Local',
    apiType: 'ollama',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    enable: true,
    customHeaders: { 'x-private': 'first-header-secret', 'x-empty': '' }
  }
  let connection: Record<string, unknown> = {}
  let lookups = 0
  const catalog = new DimModelCatalog({
    settings: {
      getProviderById: () => provider,
      getModelStatus: () => true,
      getModelConfig: () =>
        ({ contextLength: 8192, maxTokens: 1024, functionCall: true }) as ModelConfig,
      getProviderModelRouteMetadata: () => undefined,
      getCapabilitySnapshot: () =>
        ({ supportsReasoning: false, supportsAudioInput: false }) as ReturnType<
          ProviderSettingsPort['getCapabilitySnapshot']
        >
    },
    models: {
      configure: async (configuration) => {
        connection = configuration.connection
        return {
          providerId: createHash('sha256').update(JSON.stringify(configuration)).digest('hex'),
          modelId: 'local'
        }
      }
    },
    grants: db.data.dimProviderGrantsTable,
    credential: async () => {
      lookups++
      throw new Error('Anonymous connection has no API key')
    }
  })
  const signal = new AbortController().signal
  const reference = () =>
    (connection.headers as Record<string, string>)['x-private'].replace(
      'deepchat-header-ref:v1:',
      ''
    )
  try {
    const first = await catalog.admit(provider.id, 'local')
    const firstReference = reference()
    expect(JSON.stringify(connection)).not.toContain('first-header-secret')
    expect((connection.headers as Record<string, string>)['x-empty']).toBe('')
    expect(connection.credential).toEqual({
      action: 'set_ref',
      reference: 'deepchat/provider/v1/ollama'
    })
    expect(await catalog.credential(first.providerId, 'deepchat/provider/v1/ollama', signal)).toBe(
      'deepchat-admission-v1'
    )
    expect(await catalog.credential(first.providerId, firstReference, signal)).toBe(
      'first-header-secret'
    )
    provider.customHeaders = { 'x-private': 'second-header-secret' }
    await expect(catalog.credential(first.providerId, firstReference, signal)).rejects.toThrow(
      'replaced'
    )
    const second = await catalog.admit(provider.id, 'local')
    expect(second.providerId).not.toBe(first.providerId)
    expect(await catalog.credential(second.providerId, reference(), signal)).toBe(
      'second-header-secret'
    )
    await expect(catalog.credential(second.providerId, firstReference, signal)).rejects.toThrow(
      'Unknown'
    )
    provider.enable = false
    await expect(catalog.credential(second.providerId, reference(), signal)).rejects.toThrow(
      'unavailable'
    )
    expect(lookups).toBe(0)
  } finally {
    db.sqlite.close()
  }
})

it.each([
  { apiType: 'ollama', apiKey: '', auth: 'anonymous' },
  { apiType: 'ollama', apiKey: 'cloud-key', auth: 'bearer' },
  { apiType: 'openai-completions', apiKey: '', auth: 'anonymous' }
])(
  'adopts $apiType credentials with $auth and fences authentication changes',
  async ({ apiType, apiKey, auth }) => {
    const db = dimDatabase()
    const provider = {
      id: 'local-fixture',
      name: 'Local',
      enable: true,
      apiType,
      apiKey,
      baseUrl: 'http://127.0.0.1:11434/v1'
    } as LLM_PROVIDER
    const credential = vi.fn(async () => provider.apiKey)
    const configure = vi.fn(async () => ({ providerId: 'native', modelId: 'fixture' }))
    const catalog = new DimModelCatalog({
      settings: {
        getProviderById: () => provider,
        getModelStatus: () => true,
        getModelConfig: () =>
          ({
            contextLength: 8192,
            maxTokens: 1024,
            functionCall: false,
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
      },
      models: { configure },
      grants: db.data.dimProviderGrantsTable,
      credential
    })
    try {
      await catalog.admit(provider.id, 'fixture')
      expect(configure).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: expect.objectContaining({ auth: { type: auth }, baseUrl: provider.baseUrl })
        })
      )
      const reference = 'deepchat/provider/v1/local-fixture'
      expect(await catalog.credential('native', reference, new AbortController().signal)).toBe(
        apiKey || 'deepchat-admission-v1'
      )
      expect(credential).toHaveBeenCalledTimes(apiKey ? 1 : 0)
      provider.apiKey = apiKey ? '' : 'new-key'
      await expect(
        catalog.credential('native', reference, new AbortController().signal)
      ).rejects.toThrow('replaced')
    } finally {
      db.sqlite.close()
    }
  }
)
