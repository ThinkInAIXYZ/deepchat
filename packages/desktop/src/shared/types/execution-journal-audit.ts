export const DEEPCHAT_NESTED_EXECUTION_AUDIT_OPERATION_LIMIT = 256

export type DeepChatNestedExecutionAuditState = 'available' | 'corrupt' | 'unavailable'

export type DeepChatNestedExecutionStatus = 'success' | 'error' | 'indeterminate'

export interface DeepChatNestedExecutionAuditOperation {
  runId: string
  requestSeq: number
  providerToolCallId: string
  childOrdinal: number
  toolName: string
  toolSource: 'agent' | 'mcp'
  target: {
    serverName: string
    originalName?: string
    ownerPluginId?: string
  }
  argumentsHash: string
  definitionHash: string
  capabilityHash: string
  status: DeepChatNestedExecutionStatus
  dispatchEntryId: number
  dispatchCreatedAt: number
  outcomeEntryId: number | null
  outcomeCreatedAt: number | null
  responseHash: string | null
  isError: boolean | null
}

export interface DeepChatNestedExecutionAudit {
  schemaVersion: 1
  state: DeepChatNestedExecutionAuditState
  operations: DeepChatNestedExecutionAuditOperation[]
  truncated: boolean
}
