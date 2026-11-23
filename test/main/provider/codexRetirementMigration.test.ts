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

function run(initial: LLM_PROVIDER[], settings: Record<string, unknown> = {}) {
  let providers = initial
  const values = { ...settings }
  const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
    userDataPath: '/user-data',
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
  return { providers: () => providers, values }
}

describe('retireOpenAICodex', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.rmSync).mockReset()
  })

  it('drops the ChatGPT auth mode, keeps the API key and owes one notice', () => {
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
})
