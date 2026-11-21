import { ProviderService } from '@/provider/providerService'
import { createNodeScheduler } from '@/routes/scheduler'

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

  it('allows a model probe to outlast the catalog query deadline', async () => {
    const scheduler = createNodeScheduler()
    const providerExecutionPort = {
      testConnection: vi.fn(async () => {
        await scheduler.sleep({ ms: 5_100, reason: 'model response' })
        return { isOk: true, errorMsg: null }
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
  }, 15_000)
})
