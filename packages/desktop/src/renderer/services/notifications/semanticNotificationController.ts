import {
  resolveSemanticNotification,
  type SemanticNotificationDelivery,
  type SemanticNotificationIntent
} from '@shared/notifications'
import type { NotificationLifecycleEvent, NotificationNotifyOptions } from './notificationManager'
import { resolveNotificationIdentity, type NotificationRecovery } from './notificationRequest'
import type { NotificationRequest } from './notificationTypes'

type IdentifiedNotificationRequest = Extract<NotificationRequest, { key: string }>

export type NotificationTranslator = (key: string, params?: Record<string, string>) => string

export interface SemanticNotificationManagerPort {
  notify(request: NotificationRequest, options?: NotificationNotifyOptions): unknown
  recover(recovery: NotificationRecovery): void
}

export type SemanticNotificationControllerDependencies = Readonly<{
  notifications: SemanticNotificationManagerPort
  translate: NotificationTranslator
  acknowledgePresentation: (episodeId: string) => Promise<boolean>
  openSettings: (navigation: {
    routeName: 'settings-database'
    section: 'database-repair'
  }) => void | Promise<void>
}>

type EpisodePresentation = {
  recovery: NotificationRecovery
  memberIdentity: string
  lifecycleListener: (event: NotificationLifecycleEvent) => void
}

const createMemberIdentity = (
  presentationIdentity: string,
  recovery: NotificationRecovery
): string => JSON.stringify([presentationIdentity, recovery.key])

export class SemanticNotificationController {
  private readonly notifications: SemanticNotificationManagerPort
  private readonly translate: NotificationTranslator
  private readonly acknowledgePresentation: (episodeId: string) => Promise<boolean>
  private readonly openSettings: SemanticNotificationControllerDependencies['openSettings']
  private readonly byEpisodeId = new Map<string, EpisodePresentation>()
  private readonly currentEpisodeByMember = new Map<string, string>()
  private disposed = false

  constructor(dependencies: SemanticNotificationControllerDependencies) {
    this.notifications = dependencies.notifications
    this.translate = dependencies.translate
    this.acknowledgePresentation = dependencies.acknowledgePresentation
    this.openSettings = dependencies.openSettings
  }

  handle(delivery: SemanticNotificationDelivery): void {
    if (this.disposed) return
    if (delivery.kind === 'recover') {
      this.handleRecovery(delivery.episodeId)
      return
    }

    this.handleOccurrence(delivery.episodeId, delivery.intent)
  }

  dispose(): void {
    this.disposed = true
    this.byEpisodeId.clear()
    this.currentEpisodeByMember.clear()
  }

  private handleOccurrence(episodeId: string, intent: SemanticNotificationIntent): void {
    const request = this.createRequest(intent)
    const presentationIdentity = resolveNotificationIdentity(request)
    if (!presentationIdentity) {
      throw new Error(`Semantic notification "${intent.code}" requires a stable identity`)
    }

    const recovery: NotificationRecovery = {
      kind: request.kind === 'actionable' ? 'actionable' : 'transient',
      code: request.code,
      key: request.key,
      ...(request.scope ? { scope: request.scope } : {})
    }
    const memberIdentity = createMemberIdentity(presentationIdentity, recovery)
    const existing = this.byEpisodeId.get(episodeId)
    if (existing && existing.memberIdentity !== memberIdentity) {
      throw new Error(`Semantic episode "${episodeId}" changed presentation identity`)
    }

    const lifecycleListener =
      existing?.lifecycleListener ??
      ((event: NotificationLifecycleEvent) => {
        this.handleLifecycle(episodeId, event)
      })
    this.byEpisodeId.set(episodeId, {
      recovery,
      memberIdentity,
      lifecycleListener
    })
    this.currentEpisodeByMember.set(memberIdentity, episodeId)

    try {
      this.notifications.notify(request, { onLifecycleEvent: lifecycleListener })
    } catch (error) {
      if (this.byEpisodeId.get(episodeId)?.lifecycleListener === lifecycleListener) {
        this.byEpisodeId.delete(episodeId)
      }
      if (this.currentEpisodeByMember.get(memberIdentity) === episodeId) {
        this.currentEpisodeByMember.delete(memberIdentity)
      }
      throw error
    }
  }

  private handleRecovery(episodeId: string): void {
    const presentation = this.byEpisodeId.get(episodeId)
    if (!presentation) return

    this.byEpisodeId.delete(episodeId)
    if (this.currentEpisodeByMember.get(presentation.memberIdentity) !== episodeId) {
      return
    }

    this.currentEpisodeByMember.delete(presentation.memberIdentity)
    this.notifications.recover(presentation.recovery)
  }

  private handleLifecycle(episodeId: string, event: NotificationLifecycleEvent): void {
    const presentation = this.byEpisodeId.get(episodeId)
    if (!presentation) return

    this.byEpisodeId.delete(episodeId)
    if (this.currentEpisodeByMember.get(presentation.memberIdentity) !== episodeId) {
      return
    }
    this.currentEpisodeByMember.delete(presentation.memberIdentity)
    if (event.reason === 'programmatic') return

    void this.acknowledgePresentation(episodeId).catch((error) => {
      console.error('[SemanticNotificationController] acknowledgement failed', error)
    })
  }

  private createRequest(intent: SemanticNotificationIntent): IdentifiedNotificationRequest {
    const resolved = resolveSemanticNotification(intent)
    const presentation = resolved.presentation

    switch (intent.code) {
      case 'mcp.connectionFailed': {
        if (presentation.kind !== 'error') {
          throw new Error(`Semantic notification "${intent.code}" must be transient`)
        }
        return {
          ...presentation,
          kind: 'error',
          title: this.translate('common.notifications.mcpConnectionFailed.title', {
            serverName: intent.serverName
          }),
          description: this.translate('common.notifications.mcpConnectionFailed.description')
        }
      }
      case 'mcp.toolListFailed': {
        if (presentation.kind !== 'error') {
          throw new Error(`Semantic notification "${intent.code}" must be transient`)
        }
        return {
          ...presentation,
          kind: 'error',
          title: this.translate('common.notifications.mcpToolListFailed.title', {
            serverName: intent.serverName
          }),
          description: this.translate('common.notifications.mcpToolListFailed.description')
        }
      }
      case 'providerDeeplink.failed': {
        if (presentation.kind !== 'error') {
          throw new Error(`Semantic notification "${intent.code}" must be transient`)
        }
        return {
          ...presentation,
          kind: 'error',
          title: this.translate('common.notifications.providerDeeplinkFailed.title'),
          description: this.translate(
            `common.notifications.providerDeeplinkFailed.reasons.${intent.reason}`
          )
        }
      }
      case 'databaseSecurity.repairSuggested': {
        if (presentation.kind !== 'actionable') {
          throw new Error(`Semantic notification "${intent.code}" must be actionable`)
        }
        return {
          ...presentation,
          kind: 'actionable',
          title: this.translate('settings.data.databaseRepair.toastSuggestedTitle'),
          description: this.translate('settings.data.databaseRepair.toastSuggestedDescription', {
            reason: this.translate(`settings.data.databaseRepair.reasons.${intent.reason}`)
          }),
          action: {
            label: this.translate('settings.data.databaseRepair.toastAction'),
            onClick: async () => {
              await this.openSettings(presentation.action)
            }
          }
        }
      }
    }
  }
}
