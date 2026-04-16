import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('ConfigPresenter provider model capability mapping', () => {
  const loadConfigPresenter = async () => {
    vi.doMock('@/presenter', () => ({
      presenter: {}
    }))

    const { ConfigPresenter } = await import('../../../../src/main/presenter/configPresenter/index')
    const { modelCapabilities } =
      await import('../../../../src/main/presenter/configPresenter/modelCapabilities')
    return { ConfigPresenter, modelCapabilities }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves new-api reasoning capability from endpoint type instead of stored default state', async () => {
    const { ConfigPresenter, modelCapabilities } = await loadConfigPresenter()
    const supportsReasoning = vi
      .spyOn(modelCapabilities, 'supportsReasoning')
      .mockImplementation((providerId, modelId) => providerId === 'openai' && modelId === 'gpt-5.4')

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      providerModelHelper: {
        getProviderModels: vi.fn().mockReturnValue([
          {
            id: 'gpt-5.4',
            name: 'GPT-5.4',
            group: 'default',
            providerId: 'new-api',
            isCustom: false,
            endpointType: 'openai',
            reasoning: false
          }
        ]),
        getCustomModels: vi.fn().mockReturnValue([])
      },
      getModelConfig: vi.fn().mockReturnValue({ endpointType: undefined })
    }) as InstanceType<typeof ConfigPresenter>

    const models = presenter.getProviderModels('new-api')

    expect(models).toEqual([
      expect.objectContaining({
        id: 'gpt-5.4',
        reasoning: true
      })
    ])
    expect(supportsReasoning).toHaveBeenCalledWith('openai', 'gpt-5.4')
  })

  it('preserves explicit stored reasoning support when capability registry has no match', async () => {
    const { ConfigPresenter, modelCapabilities } = await loadConfigPresenter()
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      providerModelHelper: {
        getProviderModels: vi.fn().mockReturnValue([
          {
            id: 'vendor-special',
            name: 'Vendor Special',
            group: 'default',
            providerId: 'new-api',
            isCustom: false,
            endpointType: 'openai',
            reasoning: true
          }
        ]),
        getCustomModels: vi.fn().mockReturnValue([])
      },
      getModelConfig: vi.fn().mockReturnValue({ endpointType: undefined })
    }) as InstanceType<typeof ConfigPresenter>

    const models = presenter.getProviderModels('new-api')

    expect(models).toEqual([
      expect.objectContaining({
        id: 'vendor-special',
        reasoning: true
      })
    ])
  })
})
