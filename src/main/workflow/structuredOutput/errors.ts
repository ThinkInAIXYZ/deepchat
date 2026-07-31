export type WorkflowStructuredOutputErrorCode =
  | 'STRUCTURED_SCHEMA_INVALID'
  | 'STRUCTURED_RESULT_INVALID'
  | 'STRUCTURED_RESULT_MISSING'
  | 'STRUCTURED_OUTPUT_EXHAUSTED'
  | 'STRUCTURED_OUTPUT_CLOSED'

export class WorkflowStructuredOutputError extends Error {
  constructor(
    readonly code: WorkflowStructuredOutputErrorCode,
    message: string,
    readonly retriable = false,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'WorkflowStructuredOutputError'
  }
}
