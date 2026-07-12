import { nanoid } from 'nanoid'
import type { AcpDebugEventEntry, AcpDebugEventKind } from '@shared/presenter'

const MAX_DEBUG_EVENTS_PER_AGENT = 300

export class AcpDebugLog {
  private readonly eventsByAgent = new Map<string, AcpDebugEventEntry[]>()

  append(
    agentId: string,
    entry: Omit<AcpDebugEventEntry, 'id' | 'timestamp' | 'agentId'>
  ): AcpDebugEventEntry {
    const event: AcpDebugEventEntry = {
      ...entry,
      id: nanoid(),
      timestamp: Date.now(),
      agentId
    }
    const events = this.eventsByAgent.get(agentId) ?? []
    events.push(event)
    if (events.length > MAX_DEBUG_EVENTS_PER_AGENT) {
      events.splice(0, events.length - MAX_DEBUG_EVENTS_PER_AGENT)
    }
    this.eventsByAgent.set(agentId, events)
    return event
  }

  appendLifecycle(agentId: string, action: string, payload?: unknown): AcpDebugEventEntry {
    return this.append(agentId, { kind: 'lifecycle' as AcpDebugEventKind, action, payload })
  }

  list(agentId: string): AcpDebugEventEntry[] {
    return [...(this.eventsByAgent.get(agentId) ?? [])]
  }

  clear(agentId?: string): void {
    if (agentId) {
      this.eventsByAgent.delete(agentId)
      return
    }
    this.eventsByAgent.clear()
  }
}
