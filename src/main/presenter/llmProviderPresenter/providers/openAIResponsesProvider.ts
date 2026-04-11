import { LLM_PROVIDER, IConfigPresenter } from '@shared/presenter'
import { ApiEndpointType } from '@shared/model'
import type { AiSdkRuntimeContext } from '../aiSdk'
import type { ProviderMcpRuntimePort } from '../runtimePorts'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

const OPENAI_IMAGE_GENERATION_MODELS = ['gpt-4o-all', 'gpt-4o-image']
const OPENAI_IMAGE_GENERATION_MODEL_PREFIXES = ['dall-e-', 'gpt-image-']

const isOpenAIImageGenerationModel = (modelId: string): boolean =>
  OPENAI_IMAGE_GENERATION_MODELS.includes(modelId) ||
  OPENAI_IMAGE_GENERATION_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))

export class OpenAIResponsesProvider extends OpenAICompatibleProvider {
  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
  }

  protected override getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    const isAzureOpenAI = this.provider.id === 'azure-openai'

    return {
      providerKind: isAzureOpenAI ? 'azure' : 'openai-responses',
      provider: this.provider,
      configPresenter: this.configPresenter,
      defaultHeaders: this.defaultHeaders,
      buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
      emitRequestTrace: (modelConfig, payload) => this.emitRequestTrace(modelConfig, payload),
      buildTraceHeaders: () => this.buildTraceHeaders(),
      supportsNativeTools: (_modelId, modelConfig) => modelConfig.functionCall === true,
      shouldUseImageGeneration: (modelId, modelConfig) =>
        isAzureOpenAI
          ? modelConfig.apiEndpoint === ApiEndpointType.Image
          : isOpenAIImageGenerationModel(modelId)
    }
  }
}
