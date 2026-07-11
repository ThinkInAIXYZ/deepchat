import { ProviderService } from '@/routes/providers/providerService'
import { CancellableDeadlineError } from '@/routes/operationRunner'

describe('ProviderService', () => {
  const createScheduler = () => ({
    sleep: vi.fn(),
    observeIdempotent: vi.fn(),
    retryIdempotent: vi.fn(),
    runCancellable: vi.fn(
      async <T>({ task }: { task: (signal: AbortSignal) => Promise<T> }) =>
        await task(new AbortController().signal)
    ),
    timeout: vi.fn(async <T>({ task }: { task: Promise<T> }) => await task)
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
    expect(scheduler.timeout).not.toHaveBeenCalled()
    expect(scheduler.observeIdempotent).not.toHaveBeenCalled()
    expect(scheduler.retryIdempotent).not.toHaveBeenCalled()
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

    expect(providerExecutionPort.testConnection).toHaveBeenCalledWith('openai', 'gpt-5.4', {
      signal: expect.any(AbortSignal)
    })
    expect(scheduler.runCancellable).toHaveBeenCalledWith({
      task: expect.any(Function),
      deadlineMs: 60_000,
      reason: 'providers.testConnection:openai'
    })
    expect(scheduler.timeout).not.toHaveBeenCalled()
    expect(scheduler.retryIdempotent).not.toHaveBeenCalled()
  })

  it('maps a settled cancellation deadline to the stable route result', async () => {
    const scheduler = createScheduler()
    scheduler.runCancellable.mockRejectedValueOnce(
      new CancellableDeadlineError('providers.testConnection:openai', 60_000)
    )
    const service = new ProviderService({
      providerCatalogPort: {
        getProviderModels: vi.fn(() => []),
        getCustomModels: vi.fn(() => [])
      } as any,
      providerExecutionPort: {
        testConnection: vi.fn()
      },
      scheduler
    })

    await expect(service.testConnection({ providerId: 'openai' })).resolves.toEqual({
      isOk: false,
      errorMsg: 'Provider connection test timed out after 60000ms',
      code: 'deadline_exceeded'
    })
    expect(scheduler.retryIdempotent).not.toHaveBeenCalled()
    expect(scheduler.timeout).not.toHaveBeenCalled()
  })

  it('keeps ordinary provider failures distinct from cancellation and does not retry', async () => {
    const scheduler = createScheduler()
    const service = new ProviderService({
      providerCatalogPort: {
        getProviderModels: vi.fn(() => []),
        getCustomModels: vi.fn(() => [])
      } as any,
      providerExecutionPort: {
        testConnection: vi.fn().mockResolvedValue({
          isOk: false,
          errorMsg: 'network unavailable'
        })
      },
      scheduler
    })

    await expect(service.testConnection({ providerId: 'openai' })).resolves.toEqual({
      isOk: false,
      errorMsg: 'network unavailable'
    })
    expect(scheduler.retryIdempotent).not.toHaveBeenCalled()
    expect(scheduler.timeout).not.toHaveBeenCalled()
  })
})
