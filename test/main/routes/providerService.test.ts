import { ProviderService } from '@/routes/providers/providerService'

describe('ProviderService', () => {
  const createScheduler = () => ({
    sleep: vi.fn(),
    timeout: vi.fn(async <T>({ task }: { task: Promise<T> }) => await task),
    retry: vi.fn()
  })

  it('lists provider and custom models through the provider catalog port', async () => {
    const scheduler = createScheduler()
    const providerCatalogPort = {
      getProviderModels: vi.fn(() => [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          group: 'default',
          providerId: 'openai'
        }
      ]),
      getCustomModels: vi.fn(() => [
        {
          id: 'gpt-5.4-mini-custom',
          name: 'GPT-5.4 Mini Custom',
          group: 'custom',
          providerId: 'openai',
          isCustom: true
        }
      ])
    }

    const service = new ProviderService({
      providerCatalogPort: providerCatalogPort as any,
      providerExecutionPort: {
        testConnection: vi.fn()
      },
      scheduler
    })

    await expect(service.listModels('openai')).resolves.toEqual({
      providerModels: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          group: 'default',
          providerId: 'openai'
        }
      ],
      customModels: [
        {
          id: 'gpt-5.4-mini-custom',
          name: 'GPT-5.4 Mini Custom',
          group: 'custom',
          providerId: 'openai',
          isCustom: true
        }
      ]
    })

    expect(providerCatalogPort.getProviderModels).toHaveBeenCalledWith('openai')
    expect(providerCatalogPort.getCustomModels).toHaveBeenCalledWith('openai')
    expect(scheduler.timeout).toHaveBeenCalledTimes(2)
  })

  it('tests provider connections through the provider execution port', async () => {
    const scheduler = createScheduler()
    const providerExecutionPort = {
      testConnection: vi.fn().mockResolvedValue({
        isOk: true,
        errorMsg: null
      })
    }

    const service = new ProviderService({
      providerCatalogPort: {
        getProviderModels: vi.fn(() => []),
        getCustomModels: vi.fn(() => [])
      } as any,
      providerExecutionPort,
      scheduler
    })

    await expect(
      service.testConnection({
        providerId: 'openai',
        modelId: 'gpt-5.4'
      })
    ).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })

    expect(providerExecutionPort.testConnection).toHaveBeenCalledWith('openai', 'gpt-5.4')
    expect(scheduler.timeout).toHaveBeenCalledTimes(1)
  })
})
