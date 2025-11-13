import { eventBus, SendTarget } from '@/eventbus'
import { OLLAMA_EVENTS } from '@/events'
import { OllamaModel } from '@shared/presenter'
import { ShowResponse } from 'ollama'
import { OllamaProvider } from '../providers/ollamaProvider'
import { BaseLLMProvider } from '../baseProvider'

interface OllamaManagerOptions {
  getProviderInstance: (providerId: string) => BaseLLMProvider
}

export class OllamaManager {
  constructor(private readonly options: OllamaManagerOptions) {}

  private isOllamaProvider(instance: BaseLLMProvider): instance is OllamaProvider {
    const candidate = instance as Partial<OllamaProvider>
    return (
      typeof candidate.listModels === 'function' &&
      typeof candidate.listRunningModels === 'function' &&
      typeof candidate.showModelInfo === 'function' &&
      typeof candidate.pullModel === 'function'
    )
  }

  getOllamaProviderInstance(providerId: string): OllamaProvider | null {
    try {
      const instance = this.options.getProviderInstance(providerId)
      if (this.isOllamaProvider(instance)) {
        return instance
      }
      console.warn(`Provider ${providerId} is not an Ollama provider instance`)
      return null
    } catch (error) {
      console.warn(`Failed to get Ollama provider instance for ${providerId}:`, error)
      return null
    }
  }

  listOllamaModels(providerId: string): Promise<OllamaModel[]> {
    const provider = this.getOllamaProviderInstance(providerId)
    if (!provider) {
      return Promise.resolve([])
    }
    return provider.listModels()
  }

  showOllamaModelInfo(providerId: string, modelName: string): Promise<ShowResponse> {
    const provider = this.getOllamaProviderInstance(providerId)
    if (!provider) {
      throw new Error('Ollama provider not found')
    }
    return provider.showModelInfo(modelName)
  }

  listOllamaRunningModels(providerId: string): Promise<OllamaModel[]> {
    const provider = this.getOllamaProviderInstance(providerId)
    if (!provider) {
      return Promise.resolve([])
    }
    return provider.listRunningModels()
  }

  pullOllamaModels(providerId: string, modelName: string): Promise<boolean> {
    const provider = this.getOllamaProviderInstance(providerId)
    if (!provider) {
      throw new Error('Ollama provider not found')
    }
    return provider.pullModel(modelName, (progress) => {
      eventBus.sendToRenderer(OLLAMA_EVENTS.PULL_MODEL_PROGRESS, SendTarget.ALL_WINDOWS, {
        eventId: 'pullOllamaModels',
        providerId,
        modelName,
        ...progress
      })
    })
  }
}
