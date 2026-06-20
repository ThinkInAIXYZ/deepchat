import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDERS } from '../../../../src/main/presenter/configPresenter/providers'

describe('DEFAULT_PROVIDERS', () => {
  it('includes Mistral as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'mistral',
        name: 'Mistral',
        apiType: 'mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        enable: false,
        websites: expect.objectContaining({
          apiKey: 'https://console.mistral.ai/api-keys/',
          defaultBaseUrl: 'https://api.mistral.ai/v1'
        })
      })
    )
  })

  it('includes Kimi For Coding as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'kimi-for-coding',
        name: 'Kimi For Coding',
        apiType: 'openai-completions',
        baseUrl: 'https://api.kimi.com/coding/v1',
        enable: false,
        websites: expect.objectContaining({
          apiKey: 'https://www.kimi.com/code/console',
          docs: 'https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html',
          defaultBaseUrl: 'https://api.kimi.com/coding/v1'
        })
      })
    )
  })
})
