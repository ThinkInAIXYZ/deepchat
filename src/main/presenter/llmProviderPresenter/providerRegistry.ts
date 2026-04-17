import type { LLM_PROVIDER } from '@shared/presenter'
import type { AiSdkProviderKind } from './aiSdk/providerFactory'

export type AiSdkBehaviorPreset =
  | 'openai'
  | 'title-summary'
  | 'english-summary'
  | 'chinese-summary'
  | 'anthropic'
  | 'google'

export type AiSdkModelSourceStrategy =
  | 'openai'
  | 'github'
  | 'together'
  | 'provider-db'
  | 'config-db'
  | 'bedrock'
  | 'new-api'
  | 'openrouter'
  | 'ppio'
  | 'groq'
  | 'tokenflux'
  | '302ai'
  | 'astraflow'

export type AiSdkKeyStatusStrategy =
  | 'none'
  | 'openrouter'
  | 'deepseek'
  | 'ppio'
  | 'tokenflux'
  | '302ai'
  | 'cherryin'
  | 'modelscope'
  | 'siliconcloud'

export type AiSdkCheckStrategy = 'fetch-models' | 'key-status' | 'generate-text'

export type AiSdkCredentialStrategy = 'none' | 'api-key' | 'anthropic' | 'vertex' | 'bedrock'

export type AiSdkRouteStrategy = 'none' | 'grok' | 'new-api' | 'zenmux'

export type AiSdkEmbeddingStrategy = 'none' | 'openai' | 'google' | 'new-api' | 'zenmux'

export interface AiSdkProviderDefinition {
  runtimeKind: AiSdkProviderKind
  behaviorPreset: AiSdkBehaviorPreset
  modelSource: AiSdkModelSourceStrategy
  checkStrategy: AiSdkCheckStrategy
  credentialStrategy?: AiSdkCredentialStrategy
  keyStatusStrategy?: AiSdkKeyStatusStrategy
  routeStrategy?: AiSdkRouteStrategy
  embeddingStrategy?: AiSdkEmbeddingStrategy
  providerDbGroup?: string
  providerDbSourceId?: string
  checkModelId?: string
  checkPrompt?: string
  checkTemperature?: number
  checkMaxTokens?: number
  defaultHeadersPatch?: Record<string, string>
}

const createDefinition = (definition: AiSdkProviderDefinition): AiSdkProviderDefinition =>
  definition

const OPENAI_BASE = createDefinition({
  runtimeKind: 'openai-compatible',
  behaviorPreset: 'openai',
  modelSource: 'openai',
  checkStrategy: 'fetch-models',
  keyStatusStrategy: 'none',
  routeStrategy: 'none',
  embeddingStrategy: 'openai'
})

const TITLE_SUMMARY_OPENAI = createDefinition({
  ...OPENAI_BASE,
  behaviorPreset: 'title-summary'
})

const ENGLISH_SUMMARY_OPENAI = createDefinition({
  ...OPENAI_BASE,
  behaviorPreset: 'english-summary'
})

const CHINESE_SUMMARY_OPENAI = createDefinition({
  ...OPENAI_BASE,
  behaviorPreset: 'chinese-summary'
})

const PROVIDER_ID_REGISTRY = new Map<string, AiSdkProviderDefinition>([
  [
    '302ai',
    createDefinition({
      ...OPENAI_BASE,
      modelSource: '302ai',
      checkStrategy: 'key-status',
      keyStatusStrategy: '302ai'
    })
  ],
  [
    'aihubmix',
    createDefinition({
      ...OPENAI_BASE,
      defaultHeadersPatch: {
        'APP-Code': 'SMUE7630'
      }
    })
  ],
  [
    'anthropic',
    createDefinition({
      runtimeKind: 'anthropic',
      behaviorPreset: 'anthropic',
      modelSource: 'config-db',
      checkStrategy: 'generate-text',
      credentialStrategy: 'anthropic',
      keyStatusStrategy: 'none',
      routeStrategy: 'none',
      embeddingStrategy: 'none',
      checkModelId: 'claude-sonnet-4-5-20250929',
      checkPrompt: 'Hello',
      checkTemperature: 0.2,
      checkMaxTokens: 16
    })
  ],
  [
    'aws-bedrock',
    createDefinition({
      runtimeKind: 'aws-bedrock',
      behaviorPreset: 'anthropic',
      modelSource: 'bedrock',
      checkStrategy: 'generate-text',
      credentialStrategy: 'bedrock',
      keyStatusStrategy: 'none',
      routeStrategy: 'none',
      embeddingStrategy: 'none',
      checkModelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      checkPrompt: 'Hi',
      checkTemperature: 0.2,
      checkMaxTokens: 16,
      providerDbSourceId: 'amazon-bedrock'
    })
  ],
  [
    'azure-openai',
    createDefinition({
      ...OPENAI_BASE,
      runtimeKind: 'azure'
    })
  ],
  [
    'cherryin',
    createDefinition({
      ...OPENAI_BASE,
      checkStrategy: 'key-status',
      keyStatusStrategy: 'cherryin'
    })
  ],
  [
    'dashscope',
    createDefinition({
      ...ENGLISH_SUMMARY_OPENAI
    })
  ],
  [
    'deepseek',
    createDefinition({
      ...OPENAI_BASE,
      checkStrategy: 'key-status',
      keyStatusStrategy: 'deepseek'
    })
  ],
  [
    'doubao',
    createDefinition({
      ...OPENAI_BASE,
      modelSource: 'provider-db',
      providerDbGroup: 'default'
    })
  ],
  [
    'gemini',
    createDefinition({
      runtimeKind: 'gemini',
      behaviorPreset: 'google',
      modelSource: 'config-db',
      checkStrategy: 'generate-text',
      credentialStrategy: 'api-key',
      keyStatusStrategy: 'none',
      routeStrategy: 'none',
      embeddingStrategy: 'google',
      checkModelId: 'gemini-2.0-flash',
      checkPrompt: 'Hello',
      checkTemperature: 0.2,
      checkMaxTokens: 16
    })
  ],
  [
    'github',
    createDefinition({
      ...OPENAI_BASE,
      modelSource: 'github'
    })
  ],
  [
    'grok',
    createDefinition({
      ...OPENAI_BASE,
      routeStrategy: 'grok'
    })
  ],
  [
    'groq',
    createDefinition({
      ...ENGLISH_SUMMARY_OPENAI,
      modelSource: 'groq'
    })
  ],
  [
    'jiekou',
    createDefinition({
      ...OPENAI_BASE
    })
  ],
  [
    'lmstudio',
    createDefinition({
      ...OPENAI_BASE
    })
  ],
  [
    'minimax',
    createDefinition({
      runtimeKind: 'anthropic',
      behaviorPreset: 'anthropic',
      modelSource: 'provider-db',
      providerDbGroup: 'default',
      checkStrategy: 'generate-text',
      credentialStrategy: 'anthropic',
      keyStatusStrategy: 'none',
      routeStrategy: 'none',
      embeddingStrategy: 'none',
      checkModelId: 'claude-sonnet-4-5-20250929',
      checkPrompt: 'Hello',
      checkTemperature: 0.2,
      checkMaxTokens: 16
    })
  ],
  [
    'modelscope',
    createDefinition({
      ...TITLE_SUMMARY_OPENAI,
      checkStrategy: 'key-status',
      keyStatusStrategy: 'modelscope'
    })
  ],
  [
    'new-api',
    createDefinition({
      ...OPENAI_BASE,
      modelSource: 'new-api',
      routeStrategy: 'new-api',
      embeddingStrategy: 'new-api'
    })
  ],
  [
    'o3fan',
    createDefinition({
      ...TITLE_SUMMARY_OPENAI,
      modelSource: 'provider-db',
      providerDbGroup: 'o3fan'
    })
  ],
  [
    'openai',
    createDefinition({
      ...OPENAI_BASE,
      runtimeKind: 'openai-responses'
    })
  ],
  [
    'openai-responses',
    createDefinition({
      ...OPENAI_BASE,
      runtimeKind: 'openai-responses'
    })
  ],
  [
    'openrouter',
    createDefinition({
      ...OPENAI_BASE,
      modelSource: 'openrouter',
      checkStrategy: 'key-status',
      keyStatusStrategy: 'openrouter'
    })
  ],
  [
    'poe',
    createDefinition({
      ...OPENAI_BASE
    })
  ],
  [
    'ppio',
    createDefinition({
      ...TITLE_SUMMARY_OPENAI,
      modelSource: 'ppio',
      checkStrategy: 'key-status',
      keyStatusStrategy: 'ppio'
    })
  ],
  [
    'silicon',
    createDefinition({
      ...CHINESE_SUMMARY_OPENAI,
      checkStrategy: 'key-status',
      keyStatusStrategy: 'siliconcloud'
    })
  ],
  [
    'siliconcloud',
    createDefinition({
      ...CHINESE_SUMMARY_OPENAI,
      checkStrategy: 'key-status',
      keyStatusStrategy: 'siliconcloud'
    })
  ],
  [
    'together',
    createDefinition({
      ...CHINESE_SUMMARY_OPENAI,
      modelSource: 'together'
    })
  ],
  [
    'tokenflux',
    createDefinition({
      ...TITLE_SUMMARY_OPENAI,
      modelSource: 'tokenflux',
      checkStrategy: 'key-status',
      keyStatusStrategy: 'tokenflux'
    })
  ],
  [
    'vercel-ai-gateway',
    createDefinition({
      ...OPENAI_BASE
    })
  ],
  [
    'vertex',
    createDefinition({
      runtimeKind: 'vertex',
      behaviorPreset: 'google',
      modelSource: 'config-db',
      checkStrategy: 'generate-text',
      credentialStrategy: 'vertex',
      keyStatusStrategy: 'none',
      routeStrategy: 'none',
      embeddingStrategy: 'google',
      checkModelId: 'gemini-1.5-flash-001',
      checkPrompt: 'Hello from Vertex AI',
      checkTemperature: 0.2,
      checkMaxTokens: 16
    })
  ],
  [
    'zenmux',
    createDefinition({
      ...OPENAI_BASE,
      routeStrategy: 'zenmux',
      embeddingStrategy: 'zenmux'
    })
  ],
  [
    'zhipu',
    createDefinition({
      ...TITLE_SUMMARY_OPENAI,
      modelSource: 'provider-db',
      providerDbGroup: 'zhipu'
    })
  ],
  [
    'astraflow',
    createDefinition({
      ...OPENAI_BASE,
      modelSource: 'astraflow'
    })
  ],
  [
    'astraflow-cn',
    createDefinition({
      ...OPENAI_BASE,
      modelSource: 'astraflow'
    })
  ]
])

const PROVIDER_API_TYPE_REGISTRY = new Map<string, AiSdkProviderDefinition>([
  ['anthropic', PROVIDER_ID_REGISTRY.get('anthropic')!],
  ['aws-bedrock', PROVIDER_ID_REGISTRY.get('aws-bedrock')!],
  ['doubao', PROVIDER_ID_REGISTRY.get('doubao')!],
  ['gemini', PROVIDER_ID_REGISTRY.get('gemini')!],
  ['grok', PROVIDER_ID_REGISTRY.get('grok')!],
  ['groq', PROVIDER_ID_REGISTRY.get('groq')!],
  ['new-api', PROVIDER_ID_REGISTRY.get('new-api')!],
  ['o3fan', PROVIDER_ID_REGISTRY.get('o3fan')!],
  ['openai', PROVIDER_ID_REGISTRY.get('openai')!],
  ['openai-compatible', OPENAI_BASE],
  ['openai-completions', OPENAI_BASE],
  ['openai-responses', PROVIDER_ID_REGISTRY.get('openai-responses')!],
  ['together', PROVIDER_ID_REGISTRY.get('together')!],
  ['vertex', PROVIDER_ID_REGISTRY.get('vertex')!],
  ['zenmux', PROVIDER_ID_REGISTRY.get('zenmux')!]
])

export function resolveAiSdkProviderDefinition(
  provider: LLM_PROVIDER
): AiSdkProviderDefinition | null {
  const providerId = provider.id.trim().toLowerCase()
  const apiType = provider.apiType.trim().toLowerCase()

  return PROVIDER_ID_REGISTRY.get(providerId) || PROVIDER_API_TYPE_REGISTRY.get(apiType) || null
}
