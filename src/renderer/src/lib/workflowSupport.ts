interface WorkflowSupportSession {
  id: string
  agentId: string
  sessionKind: string
}

interface WorkflowSupportAgent {
  id: string
  type?: string | null
  agentType?: string | null
}

export function isSavedWorkflowSupported(
  session: WorkflowSupportSession | null | undefined,
  expectedSessionId: string | null | undefined,
  agents: readonly WorkflowSupportAgent[]
): boolean {
  if (!session || session.id !== expectedSessionId || session.sessionKind !== 'regular') {
    return false
  }
  const agent = agents.find((candidate) => candidate.id === session.agentId)
  if (!agent) {
    return session.agentId === 'deepchat'
  }
  return (agent.agentType ?? agent.type) === 'deepchat'
}
