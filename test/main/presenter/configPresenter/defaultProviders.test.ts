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

  it('includes Kimi For Coding as a disabled built-in Anthropic-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'kimi-for-coding',
        name: 'Kimi For Coding',
        apiType: 'anthropic',
        baseUrl: 'https://api.kimi.com/coding/',
        enable: false,
        websites: expect.objectContaining({
          apiKey: 'https://www.kimi.com/code/console',
          docs: 'https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html',
          defaultBaseUrl: 'https://api.kimi.com/coding/'
        })
      })
    )
  })

  it('includes the basic API-key provider batch as disabled built-ins', () => {
    const providersById = new Map(DEFAULT_PROVIDERS.map((provider) => [provider.id, provider]))

    expect(providersById.get('nvidia')).toMatchObject({
      apiType: 'openai-completions',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      enable: false
    })
    expect(providersById.get('huggingface')).toMatchObject({
      apiType: 'openai-completions',
      baseUrl: 'https://router.huggingface.co/v1',
      enable: false
    })
    expect(providersById.get('moonshot-ai')).toMatchObject({
      apiType: 'openai-completions',
      baseUrl: 'https://api.moonshot.ai/v1',
      enable: false
    })
    expect(providersById.get('stepfun')).toMatchObject({
      apiType: 'openai-completions',
      baseUrl: 'https://api.stepfun.com/v1',
      enable: false
    })
    expect(providersById.get('upstage')).toMatchObject({
      apiType: 'openai-completions',
      baseUrl: 'https://api.upstage.ai/v1/solar',
      enable: false
    })
    expect(providersById.get('alibaba-token-plan')).toMatchObject({
      apiType: 'openai-completions',
      baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
      enable: false
    })
    expect(providersById.get('alibaba-token-plan-cn')).toMatchObject({
      apiType: 'openai-completions',
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      enable: false
    })
    expect(providersById.get('minimax-global')).toMatchObject({
      apiType: 'anthropic',
      baseUrl: 'https://api.minimax.io/anthropic/v1',
      enable: false
    })
    expect(providersById.get('opencode-go')).toMatchObject({
      name: 'OpenCode Go',
      apiType: 'openai-completions',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      enable: false,
      websites: expect.objectContaining({
        official: 'https://opencode.ai/auth',
        apiKey: 'https://opencode.ai/auth',
        docs: 'https://opencode.ai/docs/zh-cn/go/',
        models: 'https://opencode.ai/zen/go/v1/models',
        defaultBaseUrl: 'https://opencode.ai/zen/go/v1'
      })
    })
    expect(providersById.get('daoxe')).toMatchObject({
      name: 'DaoXE',
      apiType: 'openai-completions',
      baseUrl: 'https://daoxe.com/v1',
      enable: false,
      websites: expect.objectContaining({
        official: 'https://daoxe.com/',
        apiKey: 'https://daoxe.com/token',
        docs: 'https://github.com/seven7763/DaoXE-AI',
        models: 'https://daoxe.com/pricing',
        defaultBaseUrl: 'https://daoxe.com/v1'
      })
    })
  })
})
