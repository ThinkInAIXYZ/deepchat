import { afterEach, expect, it, vi } from 'vitest'
import type { ProviderModelResolutionPort } from '@/provider/settings'
import { DesktopSessionState } from '@/session/desktopSessionState'
import { dimDatabase } from '../agent/dim/fixtures/database'

const handles: Array<ReturnType<typeof dimDatabase>> = []
afterEach(() => {
  for (const db of handles.splice(0)) db.sqlite.close()
})

function fixture() {
  const db = dimDatabase()
  handles.push(db)
  const providers = {
    getModelConfig: () => ({
      contextLength: 32_000,
      maxTokens: 4096,
      temperature: 0.7,
      timeout: 60_000
    }),
    getCapabilitySnapshot: () => ({
      identity: { providerId: 'acp' },
      mediaSettings: { image: false, video: false },
      requestPolicy: {
        temperature: { mode: 'passthrough' },
        topP: { mode: 'passthrough' },
        reasoning: { mode: 'passthrough' },
        legacyThinking: { mode: 'passthrough' }
      },
      supportsReasoning: false,
      reasoningPortrait: null,
      thinkingBudgetRange: {},
      supportsReasoningEffort: false
    })
  } as unknown as ProviderModelResolutionPort
  const prompts = { getDefaultSystemPrompt: vi.fn().mockResolvedValue('desktop defaults') }
  return {
    ...db,
    prompts,
    state: new DesktopSessionState({
      database: db.data,
      providerSettings: providers,
      promptSettings: prompts
    })
  }
}

it('persists ACP settings without hydrating a built-in harness, dim session or Tape', async () => {
  const { data, sqlite, state } = fixture()
  await state.initSession('acp-session', {
    providerId: 'acp',
    modelId: 'external',
    permissionMode: 'default'
  })
  await state.setPermissionMode('acp-session', 'full_access')
  await state.updateGenerationSettings('acp-session', { maxTokens: 1000 })
  expect(await state.getSessionState('acp-session')).toEqual({
    status: 'idle',
    providerId: 'acp',
    modelId: 'external',
    permissionMode: 'full_access'
  })
  expect(await state.getGenerationSettings('acp-session')).toMatchObject({
    maxTokens: 1000,
    systemPrompt: 'desktop defaults'
  })
  expect(data.dimSessionBindingsTable.get('acp-session')).toBeNull()
  expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%tape%'").all()).toEqual(
    []
  )
  await state.destroySession('acp-session')
  expect(await state.getSessionState('acp-session')).toBeNull()
})

it('does not apply a slow settings patch to a session whose model changed in the meantime', async () => {
  const { data, prompts, state } = fixture()
  await state.initSession('session', { providerId: 'acp', modelId: 'external' })
  let release!: () => void
  prompts.getDefaultSystemPrompt.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = () => resolve('defaults')
      })
  )
  const updating = state.updateGenerationSettings('session', { maxTokens: 1000 })
  const rejected = expect(updating).rejects.toThrow('model changed')
  await expect.poll(() => typeof release).toBe('function')
  data.deepchatSessionsTable.updateSessionModel('session', 'acp', 'replacement')
  release()
  await rejected
  expect(data.deepchatSessionsTable.get('session')).toMatchObject({
    model_id: 'replacement',
    max_tokens: 4096
  })
})
