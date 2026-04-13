export const PROVIDER_INSTALL_ROUTE = 'provider/install'
export const PROVIDER_INSTALL_VERSION = '1'

export const SUPPORTED_PROVIDER_INSTALL_CUSTOM_TYPES = [
  'minimax',
  'deepseek',
  'silicon',
  'siliconcloud',
  'dashscope',
  'ppio',
  'gemini',
  'vertex',
  'zhipu',
  'github',
  'github-copilot',
  'ollama',
  'anthropic',
  'doubao',
  'openai',
  'openai-completions',
  'voiceai',
  'openai-compatible',
  'openai-responses',
  'lmstudio',
  'together',
  'groq',
  'grok',
  'vercel-ai-gateway',
  'poe',
  'aws-bedrock',
  'jiekou',
  'zenmux',
  'o3fan',
  'laoshi'
] as const

const SUPPORTED_PROVIDER_INSTALL_CUSTOM_TYPE_SET = new Set<string>(
  SUPPORTED_PROVIDER_INSTALL_CUSTOM_TYPES
)

export type SupportedProviderInstallCustomType =
  (typeof SUPPORTED_PROVIDER_INSTALL_CUSTOM_TYPES)[number]

export type ProviderInstallByIdPayload = {
  id: string
  baseUrl: string
  apiKey: string
}

export type ProviderInstallByTypePayload = {
  name: string
  type: string
  baseUrl: string
  apiKey: string
}

export type ProviderInstallDeeplinkPayload =
  | ProviderInstallByIdPayload
  | ProviderInstallByTypePayload

export type ProviderInstallPreview =
  | {
      kind: 'builtin'
      id: string
      baseUrl: string
      apiKey: string
      maskedApiKey: string
      iconModelId: string
      willOverwrite: boolean
    }
  | {
      kind: 'custom'
      name: string
      type: string
      baseUrl: string
      apiKey: string
      maskedApiKey: string
      iconModelId: string
    }

export const maskApiKey = (value: string): string => {
  if (!value) {
    return ''
  }

  if (value.length <= 4) {
    return '****'
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

export const isProviderInstallCustomType = (
  value: string
): value is SupportedProviderInstallCustomType =>
  SUPPORTED_PROVIDER_INSTALL_CUSTOM_TYPE_SET.has(value)
