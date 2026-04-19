import type { DeepchatBridge } from '@shared/contracts/bridge'
import { sessionsUpdatedEvent } from '@shared/contracts/events'
import type { DeepchatRouteInput } from '@shared/contracts/routes'
import {
  sessionsActivateRoute,
  sessionsCreateRoute,
  sessionsDeactivateRoute,
  sessionsGetActiveRoute,
  sessionsListRoute,
  sessionsRestoreRoute
} from '@shared/contracts/routes'
import type { CreateSessionInput } from '@shared/types/agent-interface'
import { getDeepchatBridge } from './core'

export class SessionClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async create(input: CreateSessionInput) {
    return await this.bridge.invoke(
      sessionsCreateRoute.name,
      input as DeepchatRouteInput<typeof sessionsCreateRoute.name>
    )
  }

  async restore(sessionId: string) {
    return await this.bridge.invoke(sessionsRestoreRoute.name, { sessionId })
  }

  async activate(sessionId: string) {
    return await this.bridge.invoke(sessionsActivateRoute.name, { sessionId })
  }

  async deactivate() {
    return await this.bridge.invoke(sessionsDeactivateRoute.name, {})
  }

  async getActive() {
    return await this.bridge.invoke(sessionsGetActiveRoute.name, {})
  }

  async list(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }) {
    return await this.bridge.invoke(sessionsListRoute.name, filters ?? {})
  }

  onUpdated(
    listener: (payload: {
      sessionIds: string[]
      reason: 'created' | 'activated' | 'deactivated' | 'list-refreshed' | 'updated' | 'deleted'
      activeSessionId?: string | null
      webContentsId?: number
    }) => void
  ) {
    return this.bridge.on(sessionsUpdatedEvent.name, listener)
  }
}
