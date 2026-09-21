import { describe, expect, it } from 'vitest'
import { ModelType } from '../../../src/shared/model'
import { DEFAULT_PROVIDERS } from '../../../src/main/provider/defaults'

describe('DEFAULT_PROVIDERS', () => {
  it('includes TypeSafe as a disabled built-in System One provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'typesafe',
        name: 'TypeSafe',
        apiType: 'jev',
        baseUrl: 'https://api.typesafe.ai',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://typesafe.ai/',
          apiKey: 'https://console.typesafe.ai/keys',
          docs: 'https://docs.typesafe.ai/introduction',
          models: 'https://docs.typesafe.ai/models',
          defaultBaseUrl: 'https://api.typesafe.ai'
        })
      })
    )
  })

  it('ships the TypeSafe fallback catalog as judgment models', () => {
    const typesafe = DEFAULT_PROVIDERS.find((provider) => provider.id === 'typesafe')

    expect(typesafe?.models?.map((model) => model.id)).toEqual(['jev-latest', 'jev-1.13.0'])
    expect(typesafe?.models?.every((model) => model.type === ModelType.Judgment)).toBe(true)
  })
  it('includes AnonRouter as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'anonrouter',
        name: 'AnonRouter',
        apiType: 'openai-completions',
        baseUrl: 'https://api.anonrouter.ai/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://anonrouter.ai/',
          apiKey: 'https://anonrouter.ai/home/api-keys',
          docs: 'https://docs.anonrouter.ai/quickstart',
          models: 'https://anonrouter.ai/models',
          defaultBaseUrl: 'https://api.anonrouter.ai/v1'
        })
      })
    )
  })

  it('includes Cheaper Inference as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'cheaper-inference',
        name: 'Cheaper Inference',
        apiType: 'openai-completions',
        baseUrl: 'https://api.cheaperinference.com/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://www.cheaperinference.com/',
          apiKey: 'https://www.cheaperinference.com/dashboard/keys',
          docs: 'https://www.cheaperinference.com/docs',
          models: 'https://www.cheaperinference.com/markets',
          defaultBaseUrl: 'https://api.cheaperinference.com/v1'
        })
      })
    )
  })

  it('includes API Route as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'api-route',
        name: 'API Route',
        apiType: 'openai-completions',
        baseUrl: 'https://global.api-route.com/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://www.api-route.com/',
          apiKey: 'https://www.api-route.com/api-keys',
          docs: 'https://www.api-route.com/docs/quickstart',
          models: 'https://www.api-route.com/pricing',
          defaultBaseUrl: 'https://global.api-route.com/v1'
        })
      })
    )
  })

  it('includes AMD GPU Cloud as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'amd-developer',
        name: 'AMD GPU Cloud',
        apiType: 'openai-completions',
        baseUrl: 'https://developer.amd.com.cn/radeon/api/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://developer.amd.com.cn/radeon/',
          apiKey: 'https://developer.amd.com.cn/radeon/tokenfactory?source=deepchat',
          docs: 'https://developer.amd.com.cn/radeon/',
          models: 'https://developer.amd.com.cn/radeon/tokenfactory?source=deepchat',
          defaultBaseUrl: 'https://developer.amd.com.cn/radeon/api/v1'
        })
      })
    )
  })

  it('includes OrcaRouter as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'orcarouter',
        name: 'OrcaRouter',
        apiType: 'openai-completions',
        baseUrl: 'https://api.orcarouter.ai/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://www.orcarouter.ai/',
          apiKey: 'https://www.orcarouter.ai/console/token',
          docs: 'https://docs.orcarouter.ai',
          models: 'https://www.orcarouter.ai/models',
          defaultBaseUrl: 'https://api.orcarouter.ai/v1'
        })
      })
    )
  })

  it('includes Synthorai as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'synthorai',
        name: 'Synthorai',
        apiType: 'openai-completions',
        baseUrl: 'https://synthorai.io/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://synthorai.io/',
          apiKey: 'https://synthorai.io/console/api-keys',
          docs: 'https://synthorai.io/docs/',
          models: 'https://synthorai.io/models/',
          defaultBaseUrl: 'https://synthorai.io/v1'
        })
      })
    )
  })

  it('includes Modelsell as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'modelsell',
        name: 'Modelsell',
        apiType: 'openai-completions',
        baseUrl: 'https://modelsell.com/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://modelsell.com/',
          apiKey: 'https://modelsell.com/console/token',
          docs: 'https://modelsell.com/docs/api-reference',
          models: 'https://modelsell.com/v1/models',
          defaultBaseUrl: 'https://modelsell.com/v1'
        })
      })
    )
  })

  it('includes GreenPT as a disabled built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'greenpt',
        name: 'GreenPT',
        apiType: 'openai-completions',
        baseUrl: 'https://api.greenpt.ai/v1',
        enable: false,
        websites: expect.objectContaining({
          apiKey: 'https://account.greenpt.ai/api/keys',
          docs: 'https://docs.greenpt.ai/get-started',
          models: 'https://api.greenpt.ai/v1/models',
          defaultBaseUrl: 'https://api.greenpt.ai/v1'
        })
      })
    )
  })

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
      name: 'StepFun',
      apiType: 'openai-completions',
      baseUrl: 'https://api.stepfun.com/v1',
      enable: false
    })
    expect(providersById.get('stepfun-step-plan')).toMatchObject({
      name: 'StepFun Token Plan',
      apiType: 'openai-completions',
      baseUrl: 'https://api.stepfun.com/step_plan/v1',
      enable: false,
      websites: expect.objectContaining({
        official: 'https://platform.stepfun.com/step-plan',
        docs: 'https://platform.stepfun.com/docs/zh/step-plan/quick-start',
        defaultBaseUrl: 'https://api.stepfun.com/step_plan/v1'
      })
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
