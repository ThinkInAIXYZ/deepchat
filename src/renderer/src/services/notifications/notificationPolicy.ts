import type {
  ActionableNotificationRequest,
  NotificationKind,
  NotificationRequest
} from './notificationTypes'
import { NOTIFICATION_POLICY_DEFAULTS, NOTIFICATION_PRIORITIES } from '@shared/notifications'

export { NOTIFICATION_POLICY_DEFAULTS } from '@shared/notifications'

export type ResolvedNotificationPolicy = Readonly<{
  priority: number
  displayBudgetMs: number
  maxLifetimeMs: number
  slot: 'transient' | 'persistent'
  content: 'native' | 'managed'
}>

const TRANSIENT_PRIORITY: Record<Exclude<NotificationKind, 'actionable' | 'progress'>, number> = {
  success: NOTIFICATION_PRIORITIES.success,
  info: NOTIFICATION_PRIORITIES.info,
  warning: NOTIFICATION_PRIORITIES.warning,
  error: NOTIFICATION_PRIORITIES.error
}

const ACTIONABLE_PRIORITY = NOTIFICATION_PRIORITIES.actionable

const TRANSIENT_POLICIES = Object.freeze(
  Object.fromEntries(
    (Object.keys(TRANSIENT_PRIORITY) as Array<keyof typeof TRANSIENT_PRIORITY>).map((kind) => [
      kind,
      Object.freeze({
        priority: TRANSIENT_PRIORITY[kind],
        displayBudgetMs: NOTIFICATION_POLICY_DEFAULTS.displayBudgetMs[kind],
        maxLifetimeMs: NOTIFICATION_POLICY_DEFAULTS.maxLifetimeMs[kind],
        slot: 'transient' as const,
        content: kind === 'success' || kind === 'info' ? ('native' as const) : ('managed' as const)
      })
    ])
  ) as Record<keyof typeof TRANSIENT_PRIORITY, ResolvedNotificationPolicy>
)

const MANAGED_TRANSIENT_POLICIES = Object.freeze({
  success: Object.freeze({ ...TRANSIENT_POLICIES.success, content: 'managed' as const }),
  info: Object.freeze({ ...TRANSIENT_POLICIES.info, content: 'managed' as const })
})

const ACTIONABLE_POLICIES = Object.freeze({
  normal: Object.freeze({
    priority: ACTIONABLE_PRIORITY.normal,
    displayBudgetMs: Infinity,
    maxLifetimeMs: Infinity,
    slot: 'persistent' as const,
    content: 'managed' as const
  }),
  high: Object.freeze({
    priority: ACTIONABLE_PRIORITY.high,
    displayBudgetMs: Infinity,
    maxLifetimeMs: Infinity,
    slot: 'persistent' as const,
    content: 'managed' as const
  }),
  critical: Object.freeze({
    priority: ACTIONABLE_PRIORITY.critical,
    displayBudgetMs: Infinity,
    maxLifetimeMs: Infinity,
    slot: 'persistent' as const,
    content: 'managed' as const
  }),
  untilResolved: Object.freeze({
    priority: ACTIONABLE_PRIORITY.untilResolved,
    displayBudgetMs: Infinity,
    maxLifetimeMs: Infinity,
    slot: 'persistent' as const,
    content: 'managed' as const
  })
})

const PROGRESS_POLICY: ResolvedNotificationPolicy = Object.freeze({
  priority: NOTIFICATION_PRIORITIES.progress,
  displayBudgetMs: Infinity,
  maxLifetimeMs: Infinity,
  slot: 'persistent',
  content: 'managed'
})

export class NotificationPolicy {
  get inlineSuccessDisplayBudgetMs(): number {
    return NOTIFICATION_POLICY_DEFAULTS.inlineSuccessDisplayBudgetMs
  }

  get surfaceHandoffGraceMs(): number {
    return NOTIFICATION_POLICY_DEFAULTS.surfaceHandoffGraceMs
  }

  get transientCandidateFreshnessMs(): number {
    return NOTIFICATION_POLICY_DEFAULTS.transientCandidateFreshnessMs
  }

  get actionableQueueCapacity(): number {
    return NOTIFICATION_POLICY_DEFAULTS.actionableQueueCapacity
  }

  actionableQueueTtlMs(request: ActionableNotificationRequest): number {
    return request.retention === 'until-resolved'
      ? Infinity
      : NOTIFICATION_POLICY_DEFAULTS.actionableQueueTtlMs
  }

  resolve(request: NotificationRequest): ResolvedNotificationPolicy {
    if (request.kind === 'actionable') {
      return request.retention === 'until-resolved'
        ? ACTIONABLE_POLICIES.untilResolved
        : ACTIONABLE_POLICIES[request.urgency ?? 'normal']
    }

    if (request.kind === 'progress') {
      return PROGRESS_POLICY
    }

    const resolved = TRANSIENT_POLICIES[request.kind]
    if (
      (request.kind === 'success' || request.kind === 'info') &&
      'key' in request &&
      typeof request.key === 'string'
    ) {
      return MANAGED_TRANSIENT_POLICIES[request.kind]
    }
    return resolved
  }

  canBecomeTransientCandidate(request: NotificationRequest): boolean {
    return request.kind === 'warning' || request.kind === 'error'
  }
}
