import type { WorkflowEffectEvidence, WorkflowInvocation } from '@shared/workflow/domain'
import type { ToolEffectObservation, ToolEffectObserver } from '@/tool/effectObserver'
import type { WorkflowInvocationContextPort } from './invocationContextRegistry'

export interface WorkflowEffectRepositoryPort {
  recordEffectIntent(
    invocationId: string,
    effectState: 'read' | 'unknown' | 'write',
    evidence: WorkflowEffectEvidence,
    now?: number
  ): WorkflowInvocation
}

const SHELL_TOOL_NAMES = new Set(['exec', 'process'])

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

function classifyToolEffect(observation: ToolEffectObservation): WorkflowEffectEvidence {
  const common = {
    toolId: observation.toolName,
    toolCallId: observation.toolCallId
  }

  if (observation.source === 'mcp') {
    return {
      ...common,
      source: 'mcp',
      basis: 'conservative_fallback',
      classification: 'write',
      reason: 'Arbitrary MCP tool contracts are not trusted as read-only recovery evidence.'
    }
  }

  if (SHELL_TOOL_NAMES.has(observation.toolName)) {
    return {
      ...common,
      source: 'shell',
      basis: 'reviewed_contract',
      classification: 'write',
      reason: 'Shell and process tools may change external state.'
    }
  }

  if (observation.reviewedExecution?.effect === 'read') {
    return {
      ...common,
      source: 'builtin',
      basis: 'reviewed_contract',
      classification: 'read',
      reason: 'The built-in tool has a reviewed read-only execution contract.'
    }
  }

  if (observation.reviewedExecution?.effect === 'write') {
    return {
      ...common,
      source: 'builtin',
      basis: 'reviewed_contract',
      classification: 'write',
      reason: 'The built-in tool has a reviewed write execution contract.'
    }
  }

  return {
    ...common,
    source: 'unknown',
    basis: 'conservative_fallback',
    classification: 'unknown',
    reason: 'The built-in tool has no recognized execution contract.'
  }
}
