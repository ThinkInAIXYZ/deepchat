/** Common eligibility and identity only; payloads and ordering belong to each consumer. */
export function projectPendingInteraction(block: {
  type: string
  action_type?: string
  status: string
  extra?: { needsUserAction?: boolean }
  tool_call?: { id?: string; name?: string; params?: string }
}): {
  actionType: 'tool_call_permission' | 'question_request'
  toolCallId: string
  toolName: string
  toolArgs: string
} | null {
  if (
    block.type !== 'action' ||
    (block.action_type !== 'tool_call_permission' && block.action_type !== 'question_request') ||
    block.status !== 'pending' ||
    block.extra?.needsUserAction === false ||
    !block.tool_call?.id
  ) {
    return null
  }

  return {
    actionType: block.action_type,
    toolCallId: block.tool_call.id,
    toolName: block.tool_call.name || '',
    toolArgs: block.tool_call.params || ''
  }
}
