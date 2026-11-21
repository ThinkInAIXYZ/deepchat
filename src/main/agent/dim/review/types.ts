/** One exact tool action dim asks DeepChat to review under `auto_approve`. */
export interface ToolPermissionReviewRequest {
  sessionId: string
  messageId: string
  toolCallId: string
  toolName: string
  toolArgs: string
  toolSource?: 'agent' | 'mcp'
  serverName?: string
  permission?: {
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    toolName?: string
    serverName?: string
    command?: string
    paths?: string[]
    shellProfile?: string
    commandInfo?: { baseCommand?: string }
  }
  reason: 'tool_call' | 'precheck' | 'requires_permission'
}

export interface ToolPermissionReviewResult {
  decision: 'auto_allow' | 'ask_user' | 'block'
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  userAuthorization?: 'unknown' | 'low' | 'medium' | 'high'
  rationale?: string
  actionHash?: string
}
