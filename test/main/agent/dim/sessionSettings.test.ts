import { afterEach, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import { DesktopSessionState } from '@/session/desktopSessionState'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { DimSessionSettings } from '@/agent/dim/sessionSettings'
import { dimDatabase } from './fixtures/database'

const profile = { agentId: 'fixture-agent' }
const databases: ReturnType<typeof dimDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close()
})

function createFixture(providerId: string, apiType: 'anthropic' | 'gemini', modelId: string) {
  const database = dimDatabase()
  databases.push(database)
  const provider: LLM_PROVIDER = {
    id: providerId,
    name: providerId,
    apiType,
    baseUrl: 'https://example.test/v1',
    apiKey: 'fixture-key',
    enable: true
  }
  const modelConfig = {
    contextLength: 128000,
    maxTokens: 4096,
    timeout: 60000,
    temperature: 0.7,
    topP: 0.9,
    functionCall: true,
    vision: false,
    reasoning: true
  } as ModelConfig
  const settings = {
    getProviderById: () => provider,
    getModelStatus: () => true,
    getModelConfig: () => modelConfig,
    getProviderModelRouteMetadata: () => undefined,
    getCapabilitySnapshot: () =>
      ({
        supportsAudioInput: false,
        supportsReasoning: true,
        supportsReasoningEffort: true,
        identity: { providerId },
        mediaSettings: { image: false, video: false },
        requestPolicy: {
          temperature: { mode: 'passthrough' },
          topP: { mode: 'passthrough' },
          reasoning: { mode: 'passthrough' }
        },
        thinkingBudgetRange: {},
        reasoningEffortDefault: 'medium',
        reasoningPortrait: {
          mode: 'effort',
          supported: true,
          defaultEnabled: true,
          effort: 'medium',
          effortOptions: ['low', 'medium', 'high']
        }
      }) as ReturnType<ProviderSettingsPort['getCapabilitySnapshot']>
  }
  const nativeConfigure = vi.fn(async () => ({ providerId, modelId }))
  const controlsCall = vi.fn(async (operation: string) => {
    if (operation === 'agent') return profile
    if (operation === 'native_settings') return { providerId, modelId }
    if (operation === 'permission')
      return {
        version: 1,
        policy: { preset: 'workspace-write', allowedTools: [], disallowedTools: [] }
      }
    return { outcome: 'applied' }
  })
  const catalog = new DimModelCatalog({
    settings,
    models: { configure: nativeConfigure },
    grants: database.data.dimProviderGrantsTable,
    credential: async () => provider.apiKey
  })
  const state = new DesktopSessionState({
    database: database.data,
    providerSettings: settings,
    promptSettings: { getDefaultSystemPrompt: async () => 'fixture prompt' }
  })
  const sessionSettings = new DimSessionSettings({
    state,
    database: database.data,
    profiles: { ensure: vi.fn(async () => profile.agentId) } as never,
    models: catalog,
    controls: { call: controlsCall } as never,
    identity: async () => ({ name: 'Fixture', description: '', cwd: 'C:\\fixture' }),
    configurationChanged: async () => {}
  })
  return { database, sessionSettings, controlsCall, nativeConfigure, providerId }
}

async function prepare(
  fixture: ReturnType<typeof createFixture>,
  modelId: string,
  generationSettings: Record<string, unknown>
) {
  await fixture.sessionSettings.initSession('session', {
    providerId: fixture.providerId,
    modelId,
    generationSettings
  })
  const binding = fixture.database.data.dimSessionBindingsTable.bind('session', 'native-session')
  await fixture.sessionSettings.prepare(binding)
  const configure = fixture.controlsCall.mock.calls.find(
    ([operation]) => operation === 'native_configure'
  )
  expect(configure).toBeDefined()
  return configure![2] as { config: Record<string, unknown> }
}

it('prepares Anthropic native config from an always-enabled portrait', async () => {
  const fixture = createFixture('anthropic', 'anthropic', 'claude-fable-5')
  const payload = await prepare(fixture, 'claude-fable-5', {
    reasoningEffort: 'none',
    thinkingBudget: 2048
  })

  expect(payload.config).toMatchObject({
    providerOptions: { anthropic: { thinking: { type: 'adaptive' } } },
    reasoning: { effort: 'medium' }
  })
  expect(payload.config).not.toMatchObject({
    providerOptions: { anthropic: { thinking: { type: 'disabled' } } }
  })
  expect(payload.config).not.toMatchObject({
    providerOptions: { anthropic: { thinking: { budgetTokens: expect.anything() } } }
  })
})

it('retains retired database values without exposing or sending them to native', async () => {
  const fixture = createFixture('anthropic', 'anthropic', 'claude-fable-5')
  await fixture.sessionSettings.initSession('session', {
    providerId: fixture.providerId,
    modelId: 'claude-fable-5',
    generationSettings: { ...{ forceInterleavedThinkingCompat: true }, temperature: 0.6 }
  })
  const legacyValue = () =>
    fixture.database.sqlite
      .prepare(
        'SELECT force_interleaved_thinking_compat AS value FROM deepchat_sessions WHERE id = ?'
      )
      .get('session')?.value
  expect(legacyValue()).toBeNull()
  fixture.database.sqlite
    .prepare('UPDATE deepchat_sessions SET force_interleaved_thinking_compat = 1 WHERE id = ?')
    .run('session')

  expect(await fixture.sessionSettings.getGenerationSettings('session')).not.toHaveProperty(
    'forceInterleavedThinkingCompat'
  )
  expect(
    fixture.database.data.deepchatSessionsTable.getGenerationSettings('session')
  ).not.toHaveProperty('forceInterleavedThinkingCompat')
  await fixture.sessionSettings.updateGenerationSettings('session', { temperature: 0.5 })
  const binding = fixture.database.data.dimSessionBindingsTable.bind('session', 'native-session')
  await fixture.sessionSettings.prepare(binding)
  const configure = fixture.controlsCall.mock.calls.find(
    ([operation]) => operation === 'native_configure'
  )
  expect(configure).toBeDefined()
  expect(configure![2]).not.toHaveProperty('config.reasoning.interleavedThinking')
  expect(legacyValue()).toBe(1)
})

it('prepares Gemini effort without leaking its budget', async () => {
  const fixture = createFixture('gemini', 'gemini', 'gemini-3-flash')
  const payload = await prepare(fixture, 'gemini-3-flash', {
    reasoningEffort: 'high',
    thinkingBudget: 2048
  })

  expect(payload.config).toMatchObject({ reasoning: { effort: 'high' } })
  expect(payload.config).not.toMatchObject({ reasoning: { budgetTokens: expect.anything() } })
})
