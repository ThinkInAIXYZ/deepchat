import type { WorkflowEffectEvidence, WorkflowInvocation } from '@shared/workflow/domain'
import type { ToolEffectObservation, ToolEffectObserver } from '@/tool/effectObserver'
import { classifyToolEffect } from '@/tool/effectClassification'
import type { WorkflowInvocationContextPort } from './invocationContextRegistry'

export interface WorkflowEffectRepositoryPort {
  recordEffectIntent(
    invocationId: string,
    effectState: 'read' | 'unknown' | 'write',
    evidence: WorkflowEffectEvidence,
    now?: number
  ): WorkflowInvocation
}

export class WorkflowToolEffectObserver implements ToolEffectObserver {
  constructor(
    private readonly repository: WorkflowEffectRepositoryPort,
    private readonly contexts: WorkflowInvocationContextPort
  ) {}

  beforeToolExecution(observation: ToolEffectObservation): void {
    const context = this.contexts.get(observation.conversationId)
    if (!context) {
      return
    }

    const evidence = classifyToolEffect(observation)
    this.repository.recordEffectIntent(context.invocationId, evidence.classification, evidence)
  }
}
