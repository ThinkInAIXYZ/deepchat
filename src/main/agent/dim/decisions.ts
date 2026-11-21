import type { JevJudgmentRequest, JevJudgmentResult } from '@shared/jevProtocol'
import type { DimModelCatalog } from './modelCatalog'
import type { DimModelBridge } from './modelBridge'

/** Product admission only; native decision models own validation, retries and HTTP. */
export class DimDecisions {
  constructor(
    private readonly options: {
      models: Pick<DimModelCatalog, 'admit'>
      bridge: Pick<DimModelBridge, 'decide'>
    }
  ) {}

  async runJudgment(
    providerId: string,
    modelId: string,
    request: Omit<JevJudgmentRequest, 'model'>,
    options?: { signal?: AbortSignal }
  ): Promise<JevJudgmentResult> {
    options?.signal?.throwIfAborted()
    const model = await this.options.models.admit(providerId, modelId)
    options?.signal?.throwIfAborted()
    return this.options.bridge.decide(model, request, options?.signal)
  }
}
