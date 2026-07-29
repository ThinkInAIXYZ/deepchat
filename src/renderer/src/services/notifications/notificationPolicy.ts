import type {
  ActionableNotificationRequest,
  NotificationKind,
  NotificationRequest
} from './notificationTypes'

export const NOTIFICATION_POLICY_DEFAULTS = Object.freeze({
  displayBudgetMs: Object.freeze({
    success: 2_400,
    info: 4_000,
    warning: 6_000,
    error: 8_000
  }),
  maxLifetimeMs: Object.freeze({
    success: 15_000,
    info: 30_000,
    warning: 45_000,
    error: 60_000
  }),
  surfaceHandoffGraceMs: 200,
  transientCandidateFreshnessMs: 8_000,
  actionableQueueCapacity: 3,
  actionableQueueTtlMs: 10 * 60_000
})

export type ResolvedNotificationPolicy = Readonly<{
  priority: number
  displayBudgetMs: number
  maxLifetimeMs: number
  slot: 'transient' | 'persistent'
  content: 'native' | 'managed'
}>

const TRANSIENT_PRIORITY: Record<Exclude<NotificationKind, 'actionable' | 'progress'>, number> = {
  success: 10,
  info: 20,
  warning: 30,
  error: 40
}

const ACTIONABLE_PRIORITY = {
  normal: 50,
  high: 60,
  critical: 70
} as const

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
    priority: 80,
    displayBudgetMs: Infinity,
    maxLifetimeMs: Infinity,
    slot: 'persistent' as const,
    content: 'managed' as const
  })
})

const PROGRESS_POLICY: ResolvedNotificationPolicy = Object.freeze({
  priority: 25,
  displayBudgetMs: Infinity,
  maxLifetimeMs: Infinity,
  slot: 'persistent',
  content: 'managed'
})

export class NotificationPolicy {
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
