import type { ModelConfig } from '@shared/presenter'

export interface ProviderRequestTracePayload {
  endpoint: string
  headers: Record<string, string>
  body: unknown
}

export interface ProviderRequestTraceContext {
  enabled: boolean
  persist: (payload: ProviderRequestTracePayload) => void | Promise<void>
}

type TraceAwareModelConfig = ModelConfig & {
  requestTraceContext?: ProviderRequestTraceContext
}

export function resolveRequestTraceContext(
  modelConfig: ModelConfig
): ProviderRequestTraceContext | null {
  const candidate = (modelConfig as TraceAwareModelConfig).requestTraceContext
  if (!candidate || candidate.enabled !== true || typeof candidate.persist !== 'function') {
    return null
  }
  return candidate
}
