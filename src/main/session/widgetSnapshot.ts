import type { Agent, SessionWithState } from '@shared/types/agent-interface'
import type {
  FloatingWidgetSessionAgent,
  FloatingWidgetSessionItem,
  FloatingWidgetSessionStatus,
  FloatingWidgetSnapshot
} from '@shared/types/floating-widget'

function mapSessionStatus(status: SessionWithState['status']): FloatingWidgetSessionStatus {
  switch (status) {
    case 'generating':
      return 'in_progress'
    case 'error':
      return 'error'
    case 'idle':
    default:
      return 'done'
  }
}

function getStatusPriority(status: FloatingWidgetSessionStatus): number {
  switch (status) {
    case 'in_progress':
      return 0
    case 'error':
      return 1
    case 'done':
    default:
      return 2
  }
}

function mapSessionAgent(
  session: SessionWithState,
  agentsById: Map<string, FloatingWidgetSessionAgent>
): FloatingWidgetSessionAgent {
  const matchedAgent = agentsById.get(session.agentId)
  if (matchedAgent) {
    return matchedAgent
  }

  return {
    id: session.agentId,
    name: session.agentId,
    type: session.agentId === 'deepchat' ? 'deepchat' : 'acp'
  }
}

export function buildFloatingWidgetSnapshot(
  sessions: SessionWithState[],
  agents: Agent[],
  expanded: boolean
): FloatingWidgetSnapshot {
  const agentsById = new Map<string, FloatingWidgetSessionAgent>(
    agents.map((agent) => [
      agent.id,
      {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        icon: agent.icon,
        avatar: agent.avatar
      }
    ])
  )

  const mappedSessions: FloatingWidgetSessionItem[] = sessions
    .filter((session) => !session.isDraft)
    .map((session) => ({
      id: session.id,
      title: session.title.trim(),
      status: mapSessionStatus(session.status),
      updatedAt: session.updatedAt,
      agent: mapSessionAgent(session, agentsById)
    }))
    .sort((left, right) => {
      const statusDiff = getStatusPriority(left.status) - getStatusPriority(right.status)
      if (statusDiff !== 0) {
        return statusDiff
      }
      return right.updatedAt - left.updatedAt
    })

  const activeCount = mappedSessions.filter((session) => session.status === 'in_progress').length

  return {
    expanded,
    activeCount,
    sessions: mappedSessions
  }
}
