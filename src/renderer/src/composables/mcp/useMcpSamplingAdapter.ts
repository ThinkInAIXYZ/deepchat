import { usePresenter } from '@/composables/usePresenter'
import type { McpSamplingDecision } from '@shared/presenter'

export type McpSamplingAdapter = {
  submitSamplingDecision: (decision: McpSamplingDecision) => Promise<void>
  cancelSamplingRequest: (requestId: string, reason: string) => Promise<void>
}

export const useMcpSamplingAdapter = (): McpSamplingAdapter => {
  const mcpPresenter = usePresenter('mcpPresenter')

  return {
    submitSamplingDecision: (decision: McpSamplingDecision) =>
      Promise.resolve(mcpPresenter.submitSamplingDecision(decision)),
    cancelSamplingRequest: (requestId: string, reason: string) =>
      Promise.resolve(mcpPresenter.cancelSamplingRequest?.(requestId, reason))
  }
}
