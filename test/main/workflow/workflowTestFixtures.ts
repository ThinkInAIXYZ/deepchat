import type { WorkflowExecutionSnapshot } from '@shared/workflow/domain'

export const TEST_WORKFLOW_EXECUTION_SNAPSHOT = Object.freeze({
  schemaVersion: 1,
  providerId: 'openai',
  modelId: 'model-1',
  generationSettings: Object.freeze({
    systemPrompt: 'workflow launch snapshot',
    temperature: 0.2,
    contextLength: 32_000,
    maxTokens: 4_096,
    timeout: 60_000,
    reasoningEffort: 'medium' as const
  })
}) satisfies WorkflowExecutionSnapshot
