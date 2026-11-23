import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { CODEX_RETIRED_NOTICE_PENDING_KEY, ProviderSettings } from '@/provider/settings'

const provider = (id: string, extra: Record<string, unknown> = {}): LLM_PROVIDER =>
  ({
    id,
    name: id,
    apiType: id,
    apiKey: '',
    baseUrl: '',
    enable: false,
    ...extra
  }) as LLM_PROVIDER

function run(
  initial: LLM_PROVIDER[],
  settings: Record<string, unknown> = {},
  stored: Record<string, unknown> = {}
) {
  let providers = initial
  const values = { ...settings }
  const store = new Map(Object.entries(stored))
  const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
    userDataPath: '/user-data',
    store: {
      get: (key: string) => store.get(key),
      delete: (key: string) => store.delete(key)
    },
    getProviders: vi.fn(() => providers),
    setProviders: vi.fn((next: LLM_PROVIDER[]) => {
      providers = next
    }),
    getSetting: vi.fn((key: string) => values[key]),
    setSetting: vi.fn((key: string, value: unknown) => {
      values[key] = value
    })
  })
  ;(presenter as ProviderSettings & { retireOpenAICodex: () => void }).retireOpenAICodex()
  return { providers: () => providers, values, store }
}

describe('retireOpenAICodex', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.rmSync).mockReset()
  })

  it('drops the ChatGPT auth mode, keeps the API key and owes one notice', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const result = run([
      provider('openai', { apiKey: 'sk-keep', openaiAuthMode: 'chatgpt', enable: true })
    ])
    expect(result.providers()[0]).toMatchObject({ id: 'openai', apiKey: 'sk-keep' })
    expect(result.providers()[0]).not.toHaveProperty('openaiAuthMode')
    expect(result.values[CODEX_RETIRED_NOTICE_PENDING_KEY]).toBe(true)
    expect(fs.rmSync).toHaveBeenCalledWith('/user-data/openai-codex-auth', {
      recursive: true,
      force: true
    })
  })

  it('clears OpenAI selections that relied on the ChatGPT mode only', () => {
    const openai = { providerId: 'openai', modelId: 'gpt-5-codex' }
    const other = { providerId: 'anthropic', modelId: 'claude' }
    const stored = { defaultModel: openai, assistantModel: other, preferredModel: openai }
    const retired = run([provider('openai', { openaiAuthMode: 'chatgpt' })], {}, stored)
    expect(Object.fromEntries(retired.store)).toEqual({ assistantModel: other })
    const apiKey = run([provider('openai', { openaiAuthMode: 'apiKey' })], {}, stored)
    expect(Object.fromEntries(apiKey.store)).toEqual(stored)
  })

  it('owes the notice for an enabled Codex provider or leftover credentials only', () => {
    expect(
      run([provider('openai-codex', { enable: true })]).values[CODEX_RETIRED_NOTICE_PENDING_KEY]
    ).toBe(true)
    expect(
      run([provider('openai-codex'), provider('openai')]).values[CODEX_RETIRED_NOTICE_PENDING_KEY]
    ).toBeUndefined()

    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(run([provider('openai')]).values[CODEX_RETIRED_NOTICE_PENDING_KEY]).toBe(true)
  })

  it('runs the one-time part once but still strips imported auth modes', () => {
    const result = run([provider('openai', { openaiAuthMode: 'chatgpt' })], {
      codexRetirementMigrated: true
    })
    expect(result.providers()[0]).not.toHaveProperty('openaiAuthMode')
    expect(result.values[CODEX_RETIRED_NOTICE_PENDING_KEY]).toBeUndefined()
    expect(fs.rmSync).not.toHaveBeenCalled()
  })

  it('retries deleting leftover credentials without owing the notice again', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.rmSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    })
    const first = run([provider('openai')])
    expect(first.values[CODEX_RETIRED_NOTICE_PENDING_KEY]).toBe(true)

    const later = run([provider('openai')], {
      codexRetirementMigrated: true,
      [CODEX_RETIRED_NOTICE_PENDING_KEY]: false
    })
    expect(fs.rmSync).toHaveBeenCalledTimes(2)
    expect(later.values[CODEX_RETIRED_NOTICE_PENDING_KEY]).toBe(false)
  })
})
