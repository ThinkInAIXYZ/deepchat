import type { ProviderCatalogPort } from '@/presenter/runtimePorts'
import type { ProviderConnectionCheckResult } from '@shared/presenter'
import type { ProviderExecutionPort } from '../hotPathPorts'
import { CancellableDeadlineError, type OperationRunner } from '../operationRunner'

const PROVIDER_CHECK_DEADLINE_MS = 60_000

export class ProviderService {
  constructor(
    private readonly deps: {
      providerCatalogPort: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
      providerExecutionPort: Pick<ProviderExecutionPort, 'testConnection'>
      scheduler: OperationRunner
    }
  ) {}

  async listModels(providerId: string): Promise<{
    providerModels: ReturnType<ProviderCatalogPort['getProviderModels']>
    customModels: ReturnType<ProviderCatalogPort['getCustomModels']>
  }> {
    const providerModels = this.deps.providerCatalogPort.getProviderModels(providerId)
    const customModels = this.deps.providerCatalogPort.getCustomModels(providerId)

    return {
      providerModels,
      customModels
    }
  }

  async testConnection(input: {
    providerId: string
    modelId?: string
  }): Promise<ProviderConnectionCheckResult> {
    const reason = `providers.testConnection:${input.providerId}`
    try {
      return await this.deps.scheduler.runCancellable({
        task: (signal) =>
          this.deps.providerExecutionPort.testConnection(input.providerId, input.modelId, {
            signal
          }),
        deadlineMs: PROVIDER_CHECK_DEADLINE_MS,
        reason
      })
    } catch (error) {
      if (error instanceof CancellableDeadlineError) {
        return {
          isOk: false,
          errorMsg: `Provider connection test timed out after ${PROVIDER_CHECK_DEADLINE_MS}ms`,
          code: 'deadline_exceeded'
        }
      }
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          isOk: false,
          errorMsg: 'Provider connection test was cancelled',
          code: 'cancelled'
        }
      }
      throw error
    }
  }
}
