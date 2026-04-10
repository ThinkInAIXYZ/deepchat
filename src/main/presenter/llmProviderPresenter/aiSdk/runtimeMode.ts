import type { IConfigPresenter } from '@shared/presenter'

export type LlmRuntimeMode = 'ai-sdk' | 'legacy'

const normalizeRuntimeMode = (value: unknown): LlmRuntimeMode | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'ai-sdk' || normalized === 'legacy') {
    return normalized
  }

  return undefined
}

export function resolveLlmRuntimeMode(configPresenter?: IConfigPresenter): LlmRuntimeMode {
  const envMode = normalizeRuntimeMode(process.env.DEEPCHAT_LLM_RUNTIME)
  if (envMode) {
    return envMode
  }

  const settingMode = normalizeRuntimeMode(
    configPresenter?.getSetting?.<LlmRuntimeMode>('llmRuntimeMode')
  )
  if (settingMode) {
    return settingMode
  }

  return 'ai-sdk'
}

export function shouldUseAiSdkRuntime(configPresenter?: IConfigPresenter): boolean {
  return resolveLlmRuntimeMode(configPresenter) === 'ai-sdk'
}
