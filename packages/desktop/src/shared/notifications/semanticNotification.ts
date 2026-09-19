import { z } from 'zod'
import { NOTIFICATION_POLICY_DEFAULTS, NOTIFICATION_PRIORITIES } from './notificationPolicy'

export const providerDeeplinkFailureReasonSchema = z.enum([
  'unsupported-version',
  'invalid-payload',
  'provider-not-found',
  'unsupported-provider',
  'settings-unavailable'
])

export type ProviderDeeplinkFailureReason = z.output<typeof providerDeeplinkFailureReasonSchema>

export const databaseRepairReasonSchema = z.enum([
  'missing-table',
  'missing-column',
  'column-count-mismatch',
  'type-mismatch'
])

export type DatabaseRepairReason = z.output<typeof databaseRepairReasonSchema>

const semanticEntitySchema = z.string().trim().min(1).max(256)
const semanticKeySchema = z.string().trim().min(1).max(256)

export const semanticNotificationIntentSchema = z.discriminatedUnion('code', [
  z
    .object({
      code: z.literal('mcp.connectionFailed'),
      serverName: semanticEntitySchema
    })
    .strict(),
  z
    .object({
      code: z.literal('mcp.toolListFailed'),
      serverName: semanticEntitySchema
    })
    .strict(),
  z
    .object({
      code: z.literal('providerDeeplink.failed'),
      reason: providerDeeplinkFailureReasonSchema
    })
    .strict(),
  z
    .object({
      code: z.literal('databaseSecurity.repairSuggested'),
      reason: databaseRepairReasonSchema,
      dedupeKey: semanticKeySchema
    })
    .strict()
])

export type SemanticNotificationIntent = z.output<typeof semanticNotificationIntentSchema>

export const semanticNotificationDeliverySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('occur'),
      episodeId: z.string().trim().min(1).max(96),
      intent: semanticNotificationIntentSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('recover'),
      episodeId: z.string().trim().min(1).max(96)
    })
    .strict()
])

export type SemanticNotificationDelivery = z.output<typeof semanticNotificationDeliverySchema>

export type SemanticNotificationTargetKind = 'main' | 'settings'
export type SemanticNotificationTargetCompatibility = 'any' | SemanticNotificationTargetKind

export type SemanticNotificationRouting = Readonly<{
  compatibility: SemanticNotificationTargetCompatibility
  preferredTarget: SemanticNotificationTargetKind
  waitWhenUnavailable: boolean
  pendingTtlMs?: number
}>

export type SemanticNotificationPresentation =
  | Readonly<{
      kind: 'error'
      code: 'mcp.connectionFailed' | 'mcp.toolListFailed' | 'providerDeeplink.failed'
      key: string
      scope?: string
      entity?: string
    }>
  | Readonly<{
      kind: 'actionable'
      code: 'databaseSecurity.repairSuggested'
      key: string
      scope: 'databaseSecurity.repair'
      urgency: 'high'
      retention: 'until-resolved'
      action: Readonly<{
        kind: 'open-settings'
        routeName: 'settings-database'
        section: 'database-repair'
      }>
    }>

export type ResolvedSemanticNotification = Readonly<{
  intent: SemanticNotificationIntent
  episodeIdentity: string
  quietTtlMs?: number
  priority: number
  routing: SemanticNotificationRouting
  presentation: SemanticNotificationPresentation
}>

const createEpisodeIdentity = (code: SemanticNotificationIntent['code'], key: string): string =>
  JSON.stringify([code, key])

export const resolveSemanticNotification = (
  input: SemanticNotificationIntent
): ResolvedSemanticNotification => {
  const intent = semanticNotificationIntentSchema.parse(input)

  switch (intent.code) {
    case 'mcp.connectionFailed':
      return Object.freeze({
        intent,
        episodeIdentity: createEpisodeIdentity(intent.code, intent.serverName),
        priority: NOTIFICATION_PRIORITIES.error,
        routing: Object.freeze({
          compatibility: 'any',
          preferredTarget: 'main',
          waitWhenUnavailable: false
        }),
        presentation: Object.freeze({
          kind: 'error',
          code: intent.code,
          key: intent.serverName,
          scope: 'mcp.connection',
          entity: intent.serverName
        })
      })
    case 'mcp.toolListFailed':
      return Object.freeze({
        intent,
        episodeIdentity: createEpisodeIdentity(intent.code, intent.serverName),
        priority: NOTIFICATION_PRIORITIES.error,
        routing: Object.freeze({
          compatibility: 'any',
          preferredTarget: 'main',
          waitWhenUnavailable: false
        }),
        presentation: Object.freeze({
          kind: 'error',
          code: intent.code,
          key: intent.serverName,
          scope: 'mcp.toolList',
          entity: intent.serverName
        })
      })
    case 'providerDeeplink.failed':
      return Object.freeze({
        intent,
        episodeIdentity: createEpisodeIdentity(intent.code, intent.reason),
        quietTtlMs: NOTIFICATION_POLICY_DEFAULTS.inferredRecoveryQuietTtlMs,
        priority: NOTIFICATION_PRIORITIES.error,
        routing: Object.freeze({
          compatibility: 'any',
          preferredTarget: 'settings',
          waitWhenUnavailable: false
        }),
        presentation: Object.freeze({
          kind: 'error',
          code: intent.code,
          key: intent.reason
        })
      })
    case 'databaseSecurity.repairSuggested':
      return Object.freeze({
        intent,
        episodeIdentity: createEpisodeIdentity(intent.code, intent.dedupeKey),
        priority: NOTIFICATION_PRIORITIES.actionable.untilResolved,
        routing: Object.freeze({
          compatibility: 'any',
          preferredTarget: 'settings',
          waitWhenUnavailable: true,
          pendingTtlMs: Infinity
        }),
        presentation: Object.freeze({
          kind: 'actionable',
          code: intent.code,
          key: intent.dedupeKey,
          scope: 'databaseSecurity.repair',
          urgency: 'high',
          retention: 'until-resolved',
          action: Object.freeze({
            kind: 'open-settings',
            routeName: 'settings-database',
            section: 'database-repair'
          })
        })
      })
  }
}
