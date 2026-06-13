import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OllamaManager } from '@/presenter/llmProviderPresenter/managers/ollamaManager'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

describe('OllamaManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes typed pull progress events', async () => {
    const provider = {
      listModels: vi.fn(),
      listRunningModels: vi.fn(),
      showModelInfo: vi.fn(),
      pullModel: vi.fn(async (_modelName: string, onProgress: (progress: unknown) => void) => {
        onProgress({
          status: 'pulling manifest',
          completed: 1,
          total: 2
        })
        return true
      })
    }
    const manager = new OllamaManager({
      getProviderInstance: vi.fn(() => provider as never)
    })

    await expect(manager.pullOllamaModels('ollama-local', 'qwen3:8b')).resolves.toBe(true)

    expect(publishDeepchatEventMock).toHaveBeenCalledTimes(1)
    expect(publishDeepchatEventMock).toHaveBeenCalledWith(
      'providers.ollama.pull.progress',
      expect.objectContaining({
        eventId: 'pullOllamaModels',
        providerId: 'ollama-local',
        modelName: 'qwen3:8b',
        status: 'pulling manifest',
        completed: 1,
        total: 2,
        version: expect.any(Number)
      })
    )
  })
})
