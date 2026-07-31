import type { JsonValue } from '@shared/contracts/common'

export interface WorkflowStructuredOutputLease {
  instruction: string
  result: Promise<JsonValue>
  completeTurn(answerMarkdown: string): string | null
  close(): void
}

export interface WorkflowPreparedStructuredOutput {
  open(input: {
    runId: string
    invocationId: string
    childSessionId: string
    providerId: string
  }): WorkflowStructuredOutputLease
}

export interface WorkflowStructuredOutputPort {
  prepare(input: { schema: JsonValue; maxResultBytes: number }): WorkflowPreparedStructuredOutput
}
