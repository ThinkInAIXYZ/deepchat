export type McpPreDispatchErrorCode =
  | 'definition_changed'
  | 'invalid_request'
  | 'runtime_unavailable'
  | 'target_changed'
  | 'target_unavailable'
  | 'tool_not_allowed'

export class McpPreDispatchError extends Error {
  constructor(
    message: string,
    readonly code: McpPreDispatchErrorCode
  ) {
    super(message)
    this.name = 'McpPreDispatchError'
  }
}
