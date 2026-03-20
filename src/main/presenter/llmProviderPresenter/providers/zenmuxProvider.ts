import { IConfigPresenter, LLM_PROVIDER, MODEL_META } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

export class ZenmuxProvider extends OpenAICompatibleProvider {
  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
  }

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const models = await super.fetchOpenAIModels(options)
    return models.map((model) => ({
      ...model,
      group: 'ZenMux'
    }))
  }
}
