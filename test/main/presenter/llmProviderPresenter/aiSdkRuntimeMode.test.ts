import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  resolveLlmRuntimeMode,
  shouldUseAiSdkRuntime
} from '@/presenter/llmProviderPresenter/aiSdk/runtimeMode'

describe('AI SDK runtime mode', () => {
  afterEach(() => {
    delete process.env.DEEPCHAT_LLM_RUNTIME
    vi.restoreAllMocks()
  })

  it('defaults to ai-sdk when no env or setting is provided', () => {
    delete process.env.DEEPCHAT_LLM_RUNTIME
    const configPresenter = {
      getSetting: vi.fn().mockReturnValue(undefined)
    }

    expect(resolveLlmRuntimeMode(configPresenter as any)).toBe('ai-sdk')
    expect(shouldUseAiSdkRuntime(configPresenter as any)).toBe(true)
  })

  it('prefers env override over hidden setting', () => {
    process.env.DEEPCHAT_LLM_RUNTIME = 'legacy'
    const configPresenter = {
      getSetting: vi.fn().mockReturnValue('ai-sdk')
    }

    expect(resolveLlmRuntimeMode(configPresenter as any)).toBe('legacy')
    expect(shouldUseAiSdkRuntime(configPresenter as any)).toBe(false)
  })

  it('uses hidden setting when env is absent', () => {
    const configPresenter = {
      getSetting: vi.fn().mockReturnValue('legacy')
    }

    expect(resolveLlmRuntimeMode(configPresenter as any)).toBe('legacy')
  })
})
